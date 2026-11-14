"""Normal sender-owners backend candidate. No CLI profile/source gate changed."""
import time


def backend_class(Base, Session, normal, lab):
    class PublicOwnerBackend(Base):
        def __init__(self,ceremony,owners,stop,*,prepare_source=False,prepare_live_session=None):
            lab.require(ceremony.mode=='online','public owner session requires original online workload')
            indices=sorted(v['ownerIndex'] for v in owners)
            lab.require(len(set(indices))==len(indices),'original initialized owners must be distinct')
            super().__init__(ceremony,owners,stop,open_persistent=False)
            # Four validators, one shared public owner process, parent and
            # original three proof helpers fit the unchanged owned PID cap.
            lab.require(6+self.helper_limit<=lab.guard.CAPS['ownedProcesses'],'unchanged original PID cap exceeded')
            self.prepare_source = prepare_source
            self.prepare_live_session = prepare_live_session
            lane_count = len(ceremony.live) if prepare_live_session is not None else 0
            if prepare_live_session is not None:
                lab.require(sorted(lane['node'] for lane in ceremony.live) == list(range(4)),
                            'one original proof lane per validator required')
            self.maximum_pids = 6 + self.helper_limit + lane_count
            lab.require(self.maximum_pids <= lab.guard.CAPS['ownedProcesses'],
                        'original PID cap cannot accommodate the live proof sessions')
            self.public_session = (
                Session(ceremony, indices, prepare_source=True)
                if prepare_source else Session(ceremony, indices)
            )
            # Exactly one process in the existing session registry. Reuse the
            # original SIGTERM-before-close path and its broken-pipe handling.
            # Helper capacity was computed before this one shared handle, and
            # the complete parent/node/session/helper PID bound is above.
            self.sessions={indices[0]:self.public_session}
            self.checkpoint_after_ready=True

        def prepare(self,check):
            ready=self.public_session.wait_ready(self.stop_event,time.monotonic()+self.c.proof_timeout,check)
            ready_received_ns = time.monotonic_ns()
            check()
            self.pool_ready=dict(readyMode=('ORIGINAL_PUBLIC_STATIC_SOURCE_PREPARED'
                                            if self.prepare_source else 'ORIGINAL_PUBLIC_SCOPE_ONLY'),readyCount=1,
                                originalInitializedAccountCount=len(self.public_session.owners),
                                maximumOwnedRuntimePIDs=self.maximum_pids,
                                publicScopeReady=ready,signed=False,nonceReserved=False,
                                bootstrapLoaded=self.prepare_source,loadClockStarted=False,sourceGrant=False,
                                coldValidationIncludedInFirstCommand=not self.prepare_source)
            if self.prepare_source:
                launch_ns = self.public_session.launched_ns
                lab.require(launch_ns <= ready_received_ns, 'original sender preparation parent clock differs')
                ready_path = self.c.w.work / 'public' / (self.public_session.name + '-ready.json')
                self.pool_ready['sourcePreparation'] = dict(
                    sourceReply=ready_path.name,
                    sourceReplySHA256=lab.guard.digest(ready_path),
                    parentLaunchMonotonicNs=launch_ns,
                    parentReadyReceivedMonotonicNs=ready_received_ns,
                    parentLaunchToReadyNs=ready_received_ns - launch_ns,
                    calleeStartupElapsedNs=ready['startupElapsedNs'],
                    calleePreparationTimings=ready['preparationTimings'],
                    parentClock='parent_monotonic_ns',
                    intervalsOverlap=True,
                    addedToPerCommand=False,
                    checkpointValidated=False,
                )
            if self.prepare_live_session is not None:
                preparations = []
                self.pool_ready['liveMaterialsPreparation'] = preparations
                for lane in self.c.live:
                    preparations.append(self.prepare_live_session(self, lane, check))
                    check()
            return dict(self.pool_ready)

        def sign_original(self,row,request,checkpoint,case,notify,stop):
            def prepare():
                # Select once AFTER this stream's queue wait. Another owner's
                # cold validation must not age a checkpoint before our sign.
                notify(dict(kind='normal_stage',stage='sender_ready_checkpoint'))
                current=self.checkpoint(stop)
                notify(dict(kind='normal_stage',stage='sender_checkpoint_sign'))
                return normal.sender_command_data('sign',request,current['height'],current['appHash'])
            command=normal.sender_command_data('sign',request)
            options=dict(prepare_command=prepare)
            if getattr(self.c,'consumer_source',None) == normal.PREPARED_OWNER_SOURCE:
                options['prepare_owner_path']=case/'original-prepare-owner-reply.json'
                options['on_owner_prepare']=lambda:notify(dict(kind='normal_stage',stage='owner_prepare'))
            return self.public_session.exchange(command,case/'original-sign-reply.json',stop,**options)

        def confirm_original(self,row,request,proof,case,notify,stop):
            command=normal.sender_command_data('confirm',request,materials=proof['materials']['path'],
                                               materials_sha=proof['materials']['sha256'],proof=proof['proof']['path'])
            return self.public_session.exchange(command,case/'original-confirm-reply.json',stop)

        def public_owner_report(self):
            return self.public_session.transport_report()
    return PublicOwnerBackend
