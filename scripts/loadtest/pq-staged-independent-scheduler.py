"""Bounded independent publication, inclusion and ORIGINAL final-proof lanes.

Reuse the original ledger's nonce, UNKNOWN and full-success receipt gates.
This module neither signs nor implements a verifier. Imports do no IO except
loading the existing scheduler source; backend callees own all actual effects.
"""
import collections
import copy
import importlib.util
from pathlib import Path
import queue
import threading
import time

spec=importlib.util.spec_from_file_location('staged_original_ledger',Path(__file__).with_name('pq-independent-scheduler.py'))
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
STAGES=('publish','observe','finalize')
WORKERS=dict(publish=2,observe=2,finalize=4)

def configure(plan):
    value=copy.deepcopy(plan);n=value['configuredDemand']
    original.require(type(n) is int and 0<n<=original.MAX_DEMAND and len(value['rows'])==n,'complete bounded original demand required')
    value['workerLimit']=sum(WORKERS.values())
    value['pipeline']=dict(stageWorkers=dict(WORKERS),queueCapacity=dict(publish=4,observe=n,finalize=n),noAccountReleaseBeforeOriginalFinalConfirmation=True,automaticRetry=False)
    return value

def run(plan,backend,emit,check_resources,stop,origin=None,ledger_module=None,verifier_drain_seconds=0):
    s=original if ledger_module is None else ledger_module
    config=plan.get('pipeline',{});n=plan['configuredDemand']
    s.require(config.get('stageWorkers')==WORKERS and config.get('queueCapacity')==dict(publish=4,observe=n,finalize=n) and plan['workerLimit']==8,'exact bounded staged pipeline required')
    s.require(verifier_drain_seconds in (0, 30), 'explicit bounded verifier drain required')
    persistence_failure=None
    def emit_once(event):
        nonlocal persistence_failure
        if persistence_failure is not None:raise RuntimeError('original journal persistence UNKNOWN; no retry')
        try:emit(event)
        except BaseException as error:persistence_failure=error;raise
    ledger=s.Ledger(plan,emit_once);events=queue.Queue(maxsize=max(512,n*48));queues={k:queue.Queue(maxsize=config['queueCapacity'][k]) for k in STAGES}
    lock=threading.Lock();active={k:0 for k in STAGES};done={k:0 for k in STAGES};peak={k:0 for k in STAGES};retained={};samples=[];last_bucket=-1;failure=None;failure_type=None;failure_order_unknown=False;late_evidence=[];late_terminal=set();early_completion_ns=None;completion_boundary_unknown=False
    def preserve_failure(error):
        nonlocal failure,failure_type
        if failure is None:failure=s.failure_text(error);failure_type=type(error).__name__
    origin=time.monotonic_ns() if origin is None else origin;deadline=origin+plan['windowNs']+plan['tailNs'];clock=s.ArrivalClock(plan,origin,stop)
    stop.ynx_staged_deadline_ns=deadline
    if verifier_drain_seconds:
        stop.ynx_verifier_admission_deadline_ns=deadline
    def notify(row,payload):
        now=time.monotonic_ns();event=dict(payload)
        attempted=event.pop('originalAttemptMonotonicNs',None)
        returned=event.pop('originalAttemptReturnMonotonicNs',None)
        if attempted is not None:
            s.require(event.get('kind')=='submitted' and type(attempted) is int and type(returned) is int
                      and origin<=attempted<=returned<=now,
                      'original submission attempt clock differs')
            event['submissionClock']='PRE_CALL_LOWER_BOUND'
            event['submissionReturnNs']=returned-origin
        else:s.require(returned is None,'original submission return without attempt')
        events.put(dict(event,index=row['index'],id=row['id'],atNs=(now if attempted is None else attempted)-origin))
    current_operations={}
    observation_deadline=deadline
    def admission_open():return not stop.is_set() and time.monotonic_ns()<deadline
    def worker(stage):
        while not stop.is_set():
            try:row,account,handle=queues[stage].get(timeout=.02)
            except queue.Empty:continue
            with lock:
                active[stage]+=1
                current_operations[threading.current_thread().name] = (stage, row['index'], row['operationId'])
            ok=False;result=None
            try:
                if not admission_open():raise RuntimeError('staged lane canceled before original callee; preserve pending')
                notify(row,dict(kind='normal_stage',stage=stage+'_worker'))
                callback=lambda payload:notify(row,payload)
                if not admission_open():raise RuntimeError('staged lane cutoff before original callee; preserve pending')
                if stage=='publish':result=backend.publish(dict(row),dict(account),callback,stop)
                elif stage=='observe':result=backend.observe(handle,callback,stop)
                else:result=backend.finalize(handle,callback,stop)
                ok=True
            except Exception as error:
                notify(row,dict(kind='failed' if isinstance(error,s.KnownFailure) else 'unknown',error=s.failure_text(error)))
            finally:
                events.put(dict(kind='_phase_done',stage=stage,index=row['index'],id=row['id'],account=account,handle=result,ok=ok))
                with lock:
                    active[stage]-=1;done[stage]+=1
                    current_operations.pop(threading.current_thread().name)
                queues[stage].task_done()
    threads=[threading.Thread(target=worker,args=(stage,),name='normal-staged-'+stage+'-'+str(i),daemon=True) for stage in STAGES for i in range(WORKERS[stage])]
    def enqueue(stage,row,account,handle):
        if not admission_open():return False
        s.require(not queues[stage].full(),'bounded '+stage+' queue exceeded; no demand dropped')
        ledger.event(dict(kind='normal_stage',stage={'publish':'publication_queue','observe':'inclusion_queue','finalize':'proof_worker_queue'}[stage],index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin))
        if not admission_open():return False
        queues[stage].put_nowait((dict(row),dict(account),handle));peak[stage]=max(peak[stage],queues[stage].qsize())
        return True
    def drain(allow_dispatch=True):
        while True:
            try:event=events.get_nowait()
            except queue.Empty:return
            if event['kind']!='_phase_done':
                if event['atNs']>=observation_deadline-origin:
                    s.require(len(late_evidence)<n*48,'late original evidence bound exceeded; preserve first cause')
                    late_evidence.append(event)
                    if event['kind'] in ('qualified','failed','unknown'):late_terminal.add(event['index'])
                else:ledger.event(event)
                continue
            row=ledger.rows[event['index']];s.require(row['id']==event['id'],'original staged operation identity changed')
            if not event['ok'] or row['status'] in ('failed','unknown'):continue
            stage=event['stage']
            expected={'publish':'submitted','observe':'included','finalize':'qualified'}[stage]
            if row['status']!=expected:
                if row['index'] in late_terminal:
                    retained[row['index']]=dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff='late-original-terminal-evidence',statusAtCutoff=row['status'])
                    continue
                if row['status'] not in ('qualified','failed','unknown'):
                    ledger.event(dict(kind='unknown',index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin,error='original '+stage+' returned without required '+expected+' event; no fabricated completion'))
                else:s.require(False,'staged backend returned an out-of-order original terminal state')
                continue
            if stage!='finalize':
                if not (allow_dispatch and admission_open() and enqueue('observe' if stage=='publish' else 'finalize',row,event['account'],event['handle'])):
                    retained[row['index']]=dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff=stage+'-returned-at-stop',statusAtCutoff=row['status'])
    try:
        clock.thread.start()
        for thread in threads:thread.start()
        while time.monotonic_ns()<deadline and not stop.is_set():
            ledger.release_clock(clock);drain();check_resources()
            while not queues['publish'].full() and admission_open():
                reserved=ledger.reserve(time.monotonic_ns()-origin)
                if reserved is None:break
                row,account=reserved
                if not enqueue('publish',row,account,None):
                    retained[row['index']]=dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff='publication-admission-ended',statusAtCutoff=row['status'])
                    break
            # A full publication queue with free accounts is different from
            # waiting on an account's original pending operation.
            reason='publication_admission' if ledger.free and queues['publish'].full() else 'account_queue'
            for index in ledger.waiting:ledger.rows[index]['activeStage']=reason
            # Bracket the single scheduler thread's completion snapshot. If
            # descheduled across cutoff while observing it, the exact boundary
            # is unknown; do not invent an early completion or admit a drain.
            completion_before_ns=time.monotonic_ns()
            released_at_sample,terminal_at_sample=ledger.next_release,ledger.terminal_count
            completion_after_ns=time.monotonic_ns()
            now=completion_after_ns-origin;ledger.sample(now);bucket=now//1_000_000_000
            if bucket!=last_bucket:
                with lock:busy=dict(active)
                samples.append(dict(atNs=now,queued={k:q.qsize() for k,q in queues.items()},activeWorkers=busy,logicalReleased=ledger.next_release,pendingAccounts=sum(a['pending'] is not None for a in ledger.accounts.values())));last_bucket=bucket
            if now>=plan['windowNs'] and released_at_sample==n and terminal_at_sample==n:
                # Freeze the actual decision boundary. A later descheduling
                # must not turn an early terminal completion into the planned
                # cutoff or open the cutoff-only diagnostic drain.
                if completion_before_ns < deadline <= completion_after_ns:
                    completion_boundary_unknown=True
                    early_completion_ns=completion_before_ns  # Conservative lower bound, not an observed terminal timestamp.
                else:
                    early_completion_ns=completion_after_ns
                break
            stop.wait(.001)
    except BaseException as error:preserve_failure(error)
    finally:
        normal_cutoff = (failure is None and not stop.is_set() and
                         not completion_boundary_unknown and
                         (early_completion_ns is None or early_completion_ns>=deadline) and
                         time.monotonic_ns() >= deadline)
        observation_deadline=min(deadline,early_completion_ns if early_completion_ns is not None else time.monotonic_ns())
        queue_at_cutoff={k:q.qsize() for k,q in queues.items()}
        drain_report=None;drain_error=None
        # Preserve the original immediate cancellation boundary even if the
        # Window launch lock is busy; drain never reopens admission.
        stop.set()
        if normal_cutoff and verifier_drain_seconds:
            try:
                check_resources()
                drain_report=backend.drain_cutoff_verifiers(deadline, verifier_drain_seconds, check_resources)
            except BaseException as error:
                drain_error=dict(errorType=type(error).__name__,reason=s.failure_text(error),status='UNKNOWN')
                # A monitor may have latched while drain was entering or
                # waiting.  Do not confidently order two independently
                # observed failures without comparable original timestamps.
                try:check_resources()
                except BaseException as resource_error:
                    preserve_failure(resource_error);failure_order_unknown=True
                else:preserve_failure(error)
                stop.set()
        # The resource monitor may have set stop between iterations. Read its
        # original failure before cleanup can report a secondary timeout.
        try:check_resources()
        except BaseException as error:preserve_failure(error)
        clock_debt=False
        try:
            if clock.thread.ident is not None:clock.thread.join(timeout=1)
            if clock.thread.is_alive():
                clock_debt=True;preserve_failure(RuntimeError('original arrival clock did not retire'))
        except BaseException as error:
            clock_debt=True;preserve_failure(error)
        if clock_debt:s._ARRIVAL_CLOCK_CUSTODY.append(clock)
        try:s.stop_backend_once(backend)
        except BaseException as error:preserve_failure(error)
        until=time.monotonic()+10
        for thread in threads:
            if thread.ident is not None:thread.join(timeout=max(0,until-time.monotonic()))
        live_threads = [thread.name for thread in threads if thread.is_alive()]
        with lock:
            worker_timeouts = []
            for name in live_threads:
                stage, index, operation_id = current_operations.get(name, (None, None, None))
                worker_timeouts.append(dict(worker=name, stage=stage, index=index, operationId=operation_id))
        if worker_timeouts:failure=failure or 'bounded staged original workers did not retire'
        if persistence_failure is None:
            try:ledger.release_clock(clock);drain(allow_dispatch=False)
            except BaseException as error:preserve_failure(error)
        for row in ledger.rows:
            if persistence_failure is not None:break
            if row['ownerIndex'] is not None and row['status'] not in ('qualified','failed','unknown'):
                retained.setdefault(row['index'],dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff=row['activeStage'],statusAtCutoff=row['status']))
                try:ledger.event(dict(kind='unknown',index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin,error='original staged operation incomplete at cutoff; preserve original pending, never retry/re-sign'))
                except BaseException as error:preserve_failure(error);break
        try:check_resources()
        except BaseException as error:preserve_failure(error)
    retired_ns=time.monotonic_ns()-origin
    result=ledger.report(observation_deadline-origin,failure)
    result['firstCauseErrorType']=failure_type
    if failure_order_unknown:result['firstCauseOrder']='UNKNOWN'
    result['journalPersistenceStatus']='UNKNOWN' if persistence_failure is not None else 'ORIGINAL_EMIT_RETURNED'
    result.update(originMonotonicNs=str(origin),offeredWindowEndMonotonicNs=str(origin+plan['windowNs']),clockMeaning='same original parent monotonic clock; publication/inclusion/final-proof queues separated')
    result['pipeline']=dict(stageWorkers=dict(WORKERS),queueCapacity=dict(config['queueCapacity']),queuePeak=peak,queueAtCutoff=queue_at_cutoff,queueAtRetirement={k:q.qsize() for k,q in queues.items()},completedByStage=done,completedByStageMeaning='worker calls returned or raised; not successful business counts',workerThreadsRetired=not worker_timeouts,workerRetirementTimeouts=worker_timeouts,workerRetirementObservedNs=retired_ns,retainedUnfinishedHandles=list(retained.values()),lateEvidence=late_evidence,lateEvidenceMeaning='original events observed at/after the actual observation cutoff; retained for same-operation reconciliation, never cutoff qualification or nonce release',queueSamples=samples,queueSamplingAtomic=False,extraNodeOrSignerPIDStartedByScheduler=False,fullDemandUnchanged=n,chainSaturationProven=False)
    result['pipeline']['arrivalClockCleanupDebt']=clock_debt
    if drain_error is not None:result['pipeline']['postCutoffVerifierDrainError']=drain_error
    if worker_timeouts:
        result['submissionCoverage']='UNKNOWN_WORKER_NOT_RETIRED'
        result['notSubmitted']=None;result['actualSubmissionAttemptTPS']=None
    if completion_boundary_unknown:
        result['pipeline']['completionBoundaryStatus']='UNKNOWN_CROSSED_PLANNED_CUTOFF'
        result['pipeline']['completionBoundaryMeaning']='observation cutoff is the conservative pre-snapshot bound; actual terminal observation time is unknown'
    if verifier_drain_seconds:
        result['pipeline']['postCutoffVerifierDrain']=drain_report
    return result
