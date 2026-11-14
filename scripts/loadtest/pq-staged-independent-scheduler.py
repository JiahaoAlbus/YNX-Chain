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

def run(plan,backend,emit,check_resources,stop,origin=None,ledger_module=None):
    s=original if ledger_module is None else ledger_module
    config=plan.get('pipeline',{});n=plan['configuredDemand']
    s.require(config.get('stageWorkers')==WORKERS and config.get('queueCapacity')==dict(publish=4,observe=n,finalize=n) and plan['workerLimit']==8,'exact bounded staged pipeline required')
    ledger=s.Ledger(plan,emit);events=queue.Queue(maxsize=max(512,n*48));queues={k:queue.Queue(maxsize=config['queueCapacity'][k]) for k in STAGES}
    lock=threading.Lock();active={k:0 for k in STAGES};done={k:0 for k in STAGES};peak={k:0 for k in STAGES};retained={};samples=[];last_bucket=-1;failure=None;late_evidence=[];late_terminal=set()
    origin=time.monotonic_ns() if origin is None else origin;deadline=origin+plan['windowNs']+plan['tailNs'];clock=s.ArrivalClock(plan,origin,stop)
    def notify(row,payload):events.put(dict(payload,index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin))
    current_operations={}
    def worker(stage):
        while not stop.is_set():
            try:row,account,handle=queues[stage].get(timeout=.02)
            except queue.Empty:continue
            with lock:
                active[stage]+=1
                current_operations[threading.current_thread().name] = (stage, row['index'], row['operationId'])
            ok=False;result=None
            try:
                if stop.is_set():raise RuntimeError('staged lane canceled before original callee; preserve pending')
                notify(row,dict(kind='normal_stage',stage=stage+'_worker'))
                callback=lambda payload:notify(row,payload)
                if stage=='publish':result=backend.publish(dict(row),dict(account),callback,stop)
                elif stage=='observe':result=backend.observe(handle,callback,stop)
                else:result=backend.finalize(handle,callback,stop)
                ok=True
            except Exception as error:
                notify(row,dict(kind='failed' if isinstance(error,s.KnownFailure) else 'unknown',error=str(error)))
            finally:
                events.put(dict(kind='_phase_done',stage=stage,index=row['index'],id=row['id'],account=account,handle=result,ok=ok))
                with lock:
                    active[stage]-=1;done[stage]+=1
                    current_operations.pop(threading.current_thread().name)
                queues[stage].task_done()
    threads=[threading.Thread(target=worker,args=(stage,),name='normal-staged-'+stage+'-'+str(i),daemon=True) for stage in STAGES for i in range(WORKERS[stage])]
    def enqueue(stage,row,account,handle):
        s.require(not queues[stage].full(),'bounded '+stage+' queue exceeded; no demand dropped')
        ledger.event(dict(kind='normal_stage',stage={'publish':'publication_queue','observe':'inclusion_queue','finalize':'proof_worker_queue'}[stage],index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin))
        queues[stage].put_nowait((dict(row),dict(account),handle));peak[stage]=max(peak[stage],queues[stage].qsize())
    def drain(allow_dispatch=True):
        while True:
            try:event=events.get_nowait()
            except queue.Empty:return
            if event['kind']!='_phase_done':
                if event['atNs']>=plan['windowNs']+plan['tailNs']:
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
                if allow_dispatch and not stop.is_set():enqueue('observe' if stage=='publish' else 'finalize',row,event['account'],event['handle'])
                else:retained[row['index']]=dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff=stage+'-returned-at-stop',statusAtCutoff=row['status'])
    try:
        clock.thread.start()
        for thread in threads:thread.start()
        while time.monotonic_ns()<deadline and not stop.is_set():
            ledger.release_clock(clock);drain();check_resources()
            while not queues['publish'].full():
                reserved=ledger.reserve(time.monotonic_ns()-origin)
                if reserved is None:break
                row,account=reserved;enqueue('publish',row,account,None)
            # A full publication queue with free accounts is different from
            # waiting on an account's original pending operation.
            reason='publication_admission' if ledger.free and queues['publish'].full() else 'account_queue'
            for index in ledger.waiting:ledger.rows[index]['activeStage']=reason
            now=time.monotonic_ns()-origin;ledger.sample(now);bucket=now//1_000_000_000
            if bucket!=last_bucket:
                with lock:busy=dict(active)
                samples.append(dict(atNs=now,queued={k:q.qsize() for k,q in queues.items()},activeWorkers=busy,logicalReleased=ledger.next_release,pendingAccounts=sum(a['pending'] is not None for a in ledger.accounts.values())));last_bucket=bucket
            if now>=plan['windowNs'] and ledger.next_release==n and ledger.terminal_count==n:break
            stop.wait(.001)
    except BaseException as error:failure=str(error)
    finally:
        stop.set()
        # The resource monitor may have set stop between iterations. Read its
        # original failure before cleanup can report a secondary timeout.
        try:check_resources()
        except BaseException as error:failure=failure or str(error)
        queue_at_cutoff={k:q.qsize() for k,q in queues.items()}
        if clock.thread.ident is not None:clock.thread.join(timeout=1)
        if clock.thread.is_alive():failure=failure or 'original arrival clock did not retire'
        try:backend.stop()
        except BaseException as error:failure=failure or str(error)
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
        try:ledger.release_clock(clock);drain(allow_dispatch=False)
        except BaseException as error:failure=failure or str(error)
        for row in ledger.rows:
            if row['ownerIndex'] is not None and row['status'] not in ('qualified','failed','unknown'):
                retained.setdefault(row['index'],dict(index=row['index'],operationId=row['operationId'],ownerIndex=row['ownerIndex'],nonce=row['nonce'],phaseAtCutoff=row['activeStage'],statusAtCutoff=row['status']))
                ledger.event(dict(kind='unknown',index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin,error='original staged operation incomplete at cutoff; preserve original pending, never retry/re-sign'))
        try:check_resources()
        except BaseException as error:failure=failure or str(error)
    result=ledger.report(time.monotonic_ns()-origin,failure)
    result.update(originMonotonicNs=str(origin),offeredWindowEndMonotonicNs=str(origin+plan['windowNs']),clockMeaning='same original parent monotonic clock; publication/inclusion/final-proof queues separated')
    result['pipeline']=dict(stageWorkers=dict(WORKERS),queueCapacity=dict(config['queueCapacity']),queuePeak=peak,queueAtCutoff=queue_at_cutoff,queueAtRetirement={k:q.qsize() for k,q in queues.items()},completedByStage=done,completedByStageMeaning='worker calls returned or raised; not successful business counts',workerThreadsRetired=not worker_timeouts,workerRetirementTimeouts=worker_timeouts,retainedUnfinishedHandles=list(retained.values()),lateEvidence=late_evidence,lateEvidenceMeaning='original events observed at/after configured window+tail; retained for same-operation reconciliation, never cutoff qualification or nonce release',queueSamples=samples,queueSamplingAtomic=False,extraNodeOrSignerPIDStartedByScheduler=False,fullDemandUnchanged=n,chainSaturationProven=False)
    return result
