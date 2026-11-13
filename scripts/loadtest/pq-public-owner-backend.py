"""Normal sender-owners backend candidate. No CLI profile/source gate changed."""
import time


def backend_class(Base, Session, normal, lab):
    class PublicOwnerBackend(Base):
        def __init__(self,ceremony,owners,stop,*,prepare_source=False):
            lab.require(ceremony.mode=='online','public owner session requires original online workload')
            indices=sorted(v['ownerIndex'] for v in owners)
            lab.require(len(set(indices))==len(indices),'original initialized owners must be distinct')
            super().__init__(ceremony,owners,stop,open_persistent=False)
            # Four validators, one shared public owner process, parent and
            # original three proof helpers fit the unchanged owned PID cap.
            lab.require(6+self.helper_limit<=lab.guard.CAPS['ownedProcesses'],'unchanged original PID cap exceeded')
            self.prepare_source = prepare_source
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
                                maximumOwnedRuntimePIDs=6+self.helper_limit,
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
                    parentLaunchToReadyNs=ready_received_ns - launch_ns,
                    calleeStartupElapsedNs=ready['startupElapsedNs'],
                    calleePreparationTimings=ready['preparationTimings'],
                    parentClock='parent_monotonic_ns',
                    intervalsOverlap=True,
                    addedToPerCommand=False,
                    checkpointValidated=False,
                )
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
            return self.public_session.exchange(command,case/'original-sign-reply.json',stop,prepare_command=prepare)

        def confirm_original(self,row,request,proof,case,notify,stop):
            command=normal.sender_command_data('confirm',request,materials=proof['materials']['path'],
                                               materials_sha=proof['materials']['sha256'],proof=proof['proof']['path'])
            return self.public_session.exchange(command,case/'original-confirm-reply.json',stop)

        def public_owner_report(self):
            return self.public_session.transport_report()
    return PublicOwnerBackend
