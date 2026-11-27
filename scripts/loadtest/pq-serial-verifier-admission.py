"""Explicit finite-cohort admission for the SAME original proof verifier.

No signing, verification, Popen, resource sampling or deadline extension here.
One verifier permit is retained until its original helper has no live child.
"""
import collections
import re
import threading
import time


def require(value,message):
    if not value:raise RuntimeError(message)


class SerialVerifierAdmission:
    MAX_WAITERS=4 # Original staged finalize workers, not additional workers.
    def __init__(self,stop,*,enabled=False):
        require(enabled is True,'serial original verifier admission is explicitly opt-in')
        self.stop=stop;self.condition=threading.Condition();self.queue=collections.deque()
        self.owner=None;self.bound=False;self.debt=False;self.origin=None;self.deadline=None
        self.attempted=0;self.admitted=0;self.released=0;self.peak_waiters=0
    def retain_retirement_debt(self):
        # Sticky, fail-closed notification from the original helper exception
        # path. Never take the possibly unavailable admission lock, release a
        # permit, alter counters or clear this flag. No error formatting or IO.
        self.debt=True
    def bind_window(self,origin,deadline):
        require(type(origin) is int and type(deadline) is int and 0<origin<deadline<1<<63
                and deadline-origin<=180_000_000_000,'same finite original monotonic window required')
        require(not self.bound and not self.stop.is_set(),'original verifier window cannot be rebound or restarted')
        require(getattr(self.stop,'ynx_verifier_admission_deadline_ns',None) is None,
                'original verifier stop already has an admission deadline')
        self.origin=origin;self.deadline=deadline;self.bound=True
        # The SAME existing Window checks this before logs/Popen and again
        # after publication. A delayed launch never acquires a fresh timeout.
        self.stop.ynx_verifier_admission_deadline_ns=deadline
    def acquire(self,context,trace):
        require(type(context) is dict and set(context)=={'index','logicalId','operationId'},
                'original verifier operation identity required')
        require(type(context['index']) is int and 0<=context['index']<10000 and all(
            type(context[k]) is str and re.fullmatch('[0-9a-f]{64}',context[k]) for k in ('logicalId','operationId')),
            'original finite verifier identity differs')
        require(self.bound,'original verifier window is not bound')
        record=dict(context,status='QUEUED',queueEnteredMonotonicNs=time.monotonic_ns(),
                    observationOriginMonotonicNs=self.origin,plannedObservationDeadlineMonotonicNs=self.deadline,
                    earlierResourceOrStopCutoffStillApplies=True,deadlineExtended=False,normalVerifierReplaced=False)
        trace['verifierAdmission']=record;ticket=object();queued=False
        if not self.condition.acquire(timeout=.05):
            record.update(status='LOCK_UNAVAILABLE',refusedMonotonicNs=time.monotonic_ns())
            raise RuntimeError('original verifier admission lock unavailable')
        try:
            require(not self.debt,'original verifier cleanup unresolved; no new admission')
            require(len(self.queue)+int(self.owner is not None)<self.MAX_WAITERS,'original finalize worker admission bound exceeded')
            self.attempted+=1;self.queue.append(ticket);queued=True
            self.peak_waiters=max(self.peak_waiters,len(self.queue))
            while True:
                now=time.monotonic_ns()
                if now>=self.deadline:
                    record.update(status='CUTOFF_BEFORE_ADMISSION',refusedMonotonicNs=now)
                    # No child was admitted. The original scheduler owns normal
                    # deadline stop; do not turn its diagnostic drain into cancellation.
                    raise TimeoutError('original verifier observation deadline elapsed before admission; preserve UNKNOWN')
                require(not self.debt,'original verifier cleanup unresolved; preserve UNKNOWN')
                if self.stop.is_set():
                    record.update(status='CANCELED_BEFORE_ADMISSION',refusedMonotonicNs=now)
                    raise RuntimeError('original verifier canceled before admission; preserve UNKNOWN')
                if self.owner is None and self.queue[0] is ticket:
                    self.queue.popleft();queued=False;self.owner=ticket;self.admitted+=1
                    record.update(status='ADMITTED',admittedMonotonicNs=now,remainingToPlannedCutoffAtAdmissionNs=self.deadline-now)
                    return ticket
                self.condition.wait(min(.02,(self.deadline-now)/1e9))
        except BaseException:
            if record['status']=='QUEUED':
                record.update(status='REFUSED_BEFORE_ADMISSION',refusedMonotonicNs=time.monotonic_ns())
            raise
        finally:
            if queued:self.queue.remove(ticket)
            self.condition.notify_all();self.condition.release()
    def release(self,ticket,trace,*,no_live_original_child):
        require(self.condition.acquire(timeout=.05),'original verifier retirement lock unavailable')
        try:
            require(self.owner is ticket,'original verifier permit identity differs')
            record=trace['verifierAdmission']
            if no_live_original_child is not True:
                self.debt=True;self.stop.set();record['status']='UNKNOWN_RETIREMENT'
                return False # Keep the permit; never retry or reclaim it by PID.
            self.owner=None;self.released+=1
            record.update(status='PERMIT_RELEASED',noLiveOriginalChildObserved=True,releasedMonotonicNs=time.monotonic_ns())
            self.condition.notify_all();return True
        finally:self.condition.release()
    def report(self,load_result=None):
        result=dict(schema='YNX-PERF-SERIAL-ORIGINAL-VERIFIER/v1',enabled=True,maxConcurrent=1,
                    queueBound=self.MAX_WAITERS,originalHelperLimitUnchanged=True,
                    retirementMeaning='original helper leader absent or reaped; no additional descendant or hard resource-limit proof',
                    authorityGranted=False,deadlineExtended=False,automaticRetry=False,
                    observationOriginMonotonicNs=self.origin,plannedObservationDeadlineMonotonicNs=self.deadline,
                    actualCutoffSource='original loadResult.observationCutoffNs; same origin, may be earlier',
                    actualCutoffStatus='UNKNOWN',actualObservationCutoffMonotonicNs=None,
                    releaseWorkerClosureObserved=False,originalWorkerRetirementObservedNs=None,
                    snapshotFinal=False,
                    timingMeaning='queue/admission, original helper launch/wait and cleanup are separate parent boundaries; launch-to-cleanup is not verifier compute or window-qualified time',
                    status='UNKNOWN',attempted=None,admitted=None,released=None,queued=None,
                    active=None,peakQueued=None,cleanupDebt=None)
        if type(load_result) is dict and self.bound:
            cutoff=load_result.get('observationCutoffNs')
            if (load_result.get('originMonotonicNs')==str(self.origin) and type(cutoff) is int
                    and 0<=cutoff<=self.deadline-self.origin):
                result.update(actualCutoffStatus='ORIGINAL_SCHEDULER_OBSERVED',
                              actualObservationCutoffMonotonicNs=self.origin+cutoff)
                pipeline=load_result.get('pipeline')
                if type(pipeline) is dict:
                    retired=pipeline.get('workerRetirementObservedNs')
                    if (self.stop.is_set() and pipeline.get('stageWorkers')==dict(publish=2,observe=2,finalize=4)
                            and pipeline.get('workerThreadsRetired') is True
                            and type(pipeline.get('workerRetirementTimeouts')) is list
                            and not pipeline['workerRetirementTimeouts']
                            and type(retired) is int and cutoff<=retired<(1<<63)-self.origin):
                        # The normal finite scheduler checks each actual
                        # worker's is_alive after its original join. All
                        # verifier release callers run in those workers.
                        result.update(releaseWorkerClosureObserved=True,
                                      originalWorkerRetirementObservedNs=retired)
        if not self.condition.acquire(timeout=.05):
            # Counters remain unobserved, but an already known retirement
            # failure is not erased merely because the queue lock is busy.
            if self.debt:result['cleanupDebt']=True
            return result
        try:
            result.update(attempted=self.attempted,admitted=self.admitted,released=self.released,
                queued=len(self.queue),active=int(self.owner is not None),peakQueued=self.peak_waiters)
            # A condition-held counter snapshot is NOT worker retirement:
            # retain_retirement_debt deliberately never waits for this lock.
            # Without the original scheduler's completed worker lifecycle,
            # no read of False can establish a final absence of cleanup debt.
            final=(result['releaseWorkerClosureObserved'] and result['active']==0
                   and result['queued']==0 and result['admitted']==result['released'])
            debt=self.debt
            result.update(snapshotFinal=final,status='OBSERVED' if final and not debt else 'UNKNOWN',
                          cleanupDebt=True if debt else False if final else None)
            return result
        finally:self.condition.release()
