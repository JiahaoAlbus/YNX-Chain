"""Bounded cold opens of the EXISTING one-owner normal sender command.

Normal EOF releases only a process/key lease, never ledger pending/nonce.
Final confirmation reopens that same owner and confirms the same operation.
No signer, key codec, signature check, proof verifier or retry is implemented.
"""
import os
import signal
import threading
import time

def backend_class(Base,Session,normal,lab):
    class BoundedSenderBackend(Base):
        def __init__(self,ceremony,owners,stop):
            lab.require(ceremony.mode=='online','bounded original sender pool is online-only')
            super().__init__(ceremony,owners,stop,open_persistent=False)
            self.sign_slots=threading.BoundedSemaphore(2);self.cold_lock=threading.Lock();self.cold_sessions={};self.cold_records=[];self.cold_attempts=0;self.cold_peak=0;self.cold_cleanup_debt=[];self.initialized_owners={v['ownerIndex'] for v in owners}
            lab.require(len(self.initialized_owners)==len(owners),'original initialized owners must be distinct')
            lab.require(1+4+2+self.helper_limit<=lab.guard.CAPS['ownedProcesses'],'unchanged original PID cap cannot fit bounded sender/helper pools')
        def prepare(self,check):
            check()
            return dict(readyMode='DEFERRED_ORIGINAL_PER_OPERATION_DATA_READY',readyCount=0,originalInitializedAccountCount=len(self.initialized_owners),maximumConcurrentSigners=2,maximumConcurrentProofHelpers=self.helper_limit,maximumOwnedRuntimePIDs=5+2+self.helper_limit,originalOwnedPIDLimit=lab.guard.CAPS['ownedProcesses'],coldCustodyOpensIncludedInOperationTiming=True,signed=False,nonceReserved=False,sourceGrant=False,loadClockStarted=False,meaning='No synthetic DATA-ready replies are fabricated at preparation; every real original open must supply its own validated DATA-ready before sign or confirm.')
        def _close_original(self,session,trace):
            proc=session.proc
            trace['closeStartedMonotonicNs']=time.monotonic_ns()
            try:
                if self.stop_event.is_set() and proc.poll() is None:
                    try:os.killpg(proc.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                if proc.stdin is not None and not proc.stdin.closed:proc.stdin.close()
                if self.stop_event.is_set():
                    try:proc.wait(timeout=2)
                    except Exception:pass
                    lab.require(proc.poll() is not None,'original canceled sender did not retire; keep PID slot reserved')
                else:self.w.wait(proc)
                self.w.retire_log(proc);trace['closedByNormalEOF']=not self.stop_event.is_set() and proc.returncode==0
            finally:
                trace['producerRetired']=proc.poll() is not None;trace['closeReturnedMonotonicNs']=time.monotonic_ns()
        def _sender(self,row,request,phase,notify,stop,exchange):
            lab.require(phase in ('sign','confirm'),'original sender phase differs')
            lab.require(row['ownerIndex'] in self.initialized_owners and request['ownerIndex']==row['ownerIndex'] and request['operationId']==row['operationId'] and request['firstNonce']==str(row['nonce']) and request['members']==1,'same original account/operation/nonce required; no replacement or retry')
            notify(dict(kind='normal_stage',stage='sender_open_'+phase))
            slots=self.sign_slots if phase=='sign' else self.helper_slots
            trace=dict(index=row['index'],ownerIndex=row['ownerIndex'],operationId=row['operationId'],nonce=row['nonce'],phase=phase,requestedMonotonicNs=time.monotonic_ns())
            with self.cold_lock:self.cold_attempts+=1
            acquired=False;session=None;original_error=None;cleanup_error=None
            name='load-%05d-%s-sender'%(row['index'],phase)
            try:
                while not stop.is_set():
                    if slots.acquire(timeout=.02):acquired=True;break
                lab.require(acquired,'normal '+phase+' sender slot not supplied before cutoff; preserve pending original')
                trace['slotAcquiredMonotonicNs']=time.monotonic_ns()
                lab.require(not stop.is_set(),'normal sender canceled after slot acquisition; no original open or command')
                trace['launchRequestedMonotonicNs']=time.monotonic_ns()
                session=Session(self.c,row['ownerIndex'],name=name,startup_kind='sender_open_'+phase,startup_identity=row['operationId'],persistent=False)
                trace['launchReturnedMonotonicNs']=time.monotonic_ns()
                trace['pid']=session.proc.pid
                with self.cold_lock:
                    self.cold_sessions[name]=session;self.cold_peak=max(self.cold_peak,len(self.cold_sessions))
                session.wait_ready(stop,time.monotonic()+self.c.proof_timeout,self.w.sample)
                trace['normalDataReadyMonotonicNs']=time.monotonic_ns()
                trace['commandRequestedMonotonicNs']=time.monotonic_ns()
                value=exchange(session);trace['commandReturnedMonotonicNs']=time.monotonic_ns();return value
            except BaseException as error:
                original_error=error;trace['firstCause']=str(error);raise
            finally:
                retired=session is None
                if session is not None:
                    try:self._close_original(session,trace)
                    except BaseException as error:cleanup_error=error;trace['cleanupError']=str(error)
                    retired=session.proc.poll() is not None
                    with self.cold_lock:self.cold_sessions.pop(name,None)
                elif acquired:
                    # A launch failure may still have registered its original
                    # child in Window; never free a live PID slot blindly.
                    with self.w.lock:child=next((v for v in self.w.children if v['name']==name),None)
                    if child is not None:
                        proc=child['process']
                        trace['pid']=proc.pid
                        try:
                            if proc.poll() is None:
                                try:os.killpg(proc.pid,signal.SIGTERM)
                                except ProcessLookupError:pass
                                try:proc.wait(timeout=2)
                                except Exception:pass
                        except BaseException as error:cleanup_error=error;trace['cleanupError']=str(error)
                        retired=proc.poll() is not None
                if acquired and retired:slots.release()
                elif acquired:
                    with self.cold_lock:self.cold_cleanup_debt.append(dict(name=name,pid=trace.get('pid'),operationId=row['operationId']))
                    self.stop_event.set()
                trace['returnedMonotonicNs']=time.monotonic_ns()
                with self.cold_lock:
                    if len(self.cold_records)<2048:self.cold_records.append(trace)
                if original_error is None and cleanup_error is not None:raise cleanup_error
        def sign_original(self,row,request,checkpoint,case,notify,stop):
            return self._sender(row,request,'sign',notify,stop,lambda session:session.exchange(normal.sender_command_data('sign',request,checkpoint['height'],checkpoint['appHash']),case/'original-sign-reply.json',stop))
        def confirm_original(self,row,request,proof,case,notify,stop):
            return self._sender(row,request,'confirm',notify,stop,lambda session:session.exchange(normal.sender_command_data('confirm',request,materials=proof['materials']['path'],materials_sha=proof['materials']['sha256'],proof=proof['proof']['path']),case/'original-confirm-reply.json',stop))
        def cold_sender_report(self):
            with self.cold_lock:return dict(schema='YNX-PERF-BOUNDED-NORMAL-SENDER-LIFECYCLE/v1',attempted=self.cold_attempts,retained=len(self.cold_records),recordLimit=2048,omitted=max(0,self.cold_attempts-len(self.cold_records)),maxConcurrentSigners=2,maximumProofHelperSlots=self.helper_limit,observedPeakOpenSenderProcesses=self.cold_peak,cleanupDebt=[dict(v) for v in self.cold_cleanup_debt],records=[dict(v) for v in self.cold_records],accountPendingReleasedByProcessClose=False,automaticReSign=False,maximumOwnedRuntimePIDs=5+2+self.helper_limit)
        def stop(self):
            super().stop() # Original Window registry owns ALL load-* processes.
            with self.cold_lock:sessions=list(self.cold_sessions.values())
            for session in sessions:
                if session.proc.stdin is not None and not session.proc.stdin.closed:
                    try:session.proc.stdin.close()
                    except (OSError,ValueError):pass
    return BoundedSenderBackend
