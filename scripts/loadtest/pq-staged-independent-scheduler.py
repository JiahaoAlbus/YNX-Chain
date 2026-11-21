"""Bounded independent publication, inclusion and ORIGINAL final-proof lanes.

Reuse the original ledger's nonce, UNKNOWN and full-success receipt gates.
This module neither signs nor implements a verifier. Imports do no IO except
loading the existing scheduler source; backend callees own all actual effects.
"""
import collections
import copy
import importlib.util
import json
from pathlib import Path
import queue
import threading
import time

spec=importlib.util.spec_from_file_location('staged_original_ledger',Path(__file__).with_name('pq-independent-scheduler.py'))
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
STAGES=('publish','observe','finalize')
WORKERS=dict(publish=2,observe=2,finalize=4)
DURABLE_CAPS=dict(arrivals=64,events=512,operations=32,publish=4,observe=8,finalize=8,samples=1024)


def _perform_stage(backend,stage,row,account,handle,callback,stop):
    if stage=='publish':return backend.publish(dict(row),dict(account),callback,stop)
    if stage=='observe':return backend.observe(handle,callback,stop)
    return backend.finalize(handle,callback,stop)

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
    observation_deadline=deadline
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
                result=_perform_stage(backend,stage,row,account,handle,callback,stop)
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
        observation_deadline=min(deadline,time.monotonic_ns())
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
    retired_ns=time.monotonic_ns()-origin
    result=ledger.report(observation_deadline-origin,failure)
    result.update(originMonotonicNs=str(origin),offeredWindowEndMonotonicNs=str(origin+plan['windowNs']),clockMeaning='same original parent monotonic clock; publication/inclusion/final-proof queues separated')
    result['pipeline']=dict(stageWorkers=dict(WORKERS),queueCapacity=dict(config['queueCapacity']),queuePeak=peak,queueAtCutoff=queue_at_cutoff,queueAtRetirement={k:q.qsize() for k,q in queues.items()},completedByStage=done,completedByStageMeaning='worker calls returned or raised; not successful business counts',workerThreadsRetired=not worker_timeouts,workerRetirementTimeouts=worker_timeouts,workerRetirementObservedNs=retired_ns,retainedUnfinishedHandles=list(retained.values()),lateEvidence=late_evidence,lateEvidenceMeaning='original events observed at/after the actual observation cutoff; retained for same-operation reconciliation, never cutoff qualification or nonce release',queueSamples=samples,queueSamplingAtomic=False,extraNodeOrSignerPIDStartedByScheduler=False,fullDemandUnchanged=n,chainSaturationProven=False)
    return result


def _durable_module():
    spec=importlib.util.spec_from_file_location('staged_durable_accounting',Path(__file__).with_name('pq-durable-demand-ledger.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def configure_durable(plan,*,enabled=False):
    original.require(enabled is True,'durable staged pipeline is explicitly opt-in')
    d=_durable_module()
    # Rebuild only bounded metadata and lazy ids. Never deepcopy a large rows
    # array, build future offsets, or import a previous execution grant.
    value=d.make_plan(plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],plan['accounts'],
                      plan['requestedOfferedTPS'],plan['windowNs'],plan['tailNs'],enabled=True)
    original.require(value['configuredDemand']==plan['configuredDemand'],'complete durable demand differs')
    value['workerLimit']=sum(WORKERS.values())
    value['pipeline']=dict(schema='YNX-PQ-DURABLE-STAGED/v1',stageWorkers=dict(WORKERS),bounds=dict(DURABLE_CAPS),
                           noAccountReleaseBeforeOriginalFinalConfirmation=True,automaticRetry=False,
                           runtimeAuthorized=False,pressureAuthorized=False)
    return value


class BoundedArrivalClock:
    """Real parent monotonic observations, coalesced only after an actual wake.

    A range shares its measured observation time; no timestamp is backfilled
    from a logical due time. Full queue fails closed and retains its one final
    undelivered range, instead of allocating a future array or silently dropping.
    """
    def __init__(self,plan,origin,stop):
        self.plan,self.origin,self.stop=plan,origin,stop
        self.queue=queue.Queue(maxsize=DURABLE_CAPS['arrivals']);self.undelivered=None;self.failure=None;self.peak=0
        self.thread=threading.Thread(target=self.loop,name='bounded-original-arrivals',daemon=True)
    def loop(self):
        index=0;n=self.plan['configuredDemand'];rate=self.plan['requestedOfferedTPS']
        try:
            while index<n and not self.stop.is_set():
                due=self.origin+index*1_000_000_000//rate
                remaining=due-time.monotonic_ns()
                if remaining>0:
                    self.stop.wait(remaining/1e9);continue
                if self.stop.is_set():return
                observed=time.monotonic_ns()-self.origin
                end=min(n,observed*rate//1_000_000_000+1)
                original.require(end>index,'original arrival clock regressed')
                value=dict(first=index,end=end,atNs=observed)
                try:self.queue.put_nowait(value)
                except queue.Full:
                    self.undelivered=value
                    raise RuntimeError('bounded original arrival queue exhausted; preserve final range and full demand')
                self.peak=max(self.peak,self.queue.qsize());index=end
        except BaseException as error:self.failure=str(error);self.stop.set()


class _DeliveryStopped(RuntimeError):pass


def run_durable(plan,backend,emit,check_resources,stop,*,ledger_path,enabled=False,origin=None,ledger_module=None,max_db_bytes=1<<30):
    """Same normal three callees, bounded control queues and disk-only demand.

    The driver exposes this only through its separate opt-in accounting profile. Core
    source/manifest capacity, authority, Window and resource admission still
    belong to that original driver. Structural callback tests grant none.
    """
    original.require(enabled is True,'durable staged pipeline is explicitly opt-in')
    expected=dict(schema='YNX-PQ-DURABLE-STAGED/v1',stageWorkers=dict(WORKERS),bounds=dict(DURABLE_CAPS),
                  noAccountReleaseBeforeOriginalFinalConfirmation=True,automaticRetry=False,runtimeAuthorized=False,pressureAuthorized=False)
    original.require(plan.get('pipeline')==expected and plan['workerLimit']==sum(WORKERS.values()),
                     'exact bounded durable pipeline required')
    # Keep all clocks, bounds and full-denominator reports bound to the same
    # private metadata copy as the durable ledger, even if a caller mutates its
    # input after the first normal callee starts. No demand-sized copy occurs.
    plan=configure_durable(plan,enabled=True)
    s=original if ledger_module is None else ledger_module
    d=_durable_module()
    if origin is not None:original.require(type(origin) is int and 0<=origin<=time.monotonic_ns(),'original parent monotonic origin required')
    ledger_open_started=time.monotonic_ns()
    ledger=original.open_durable_ledger(plan,ledger_path,emit,check_resources,enabled=True,max_db_bytes=max_db_bytes)
    ledger_open_returned=time.monotonic_ns()
    origin=time.monotonic_ns() if origin is None else origin
    deadline=origin+plan['windowNs']+plan['tailNs'];observation_deadline=deadline
    clock=BoundedArrivalClock(plan,origin,stop);events=queue.Queue(maxsize=DURABLE_CAPS['events'])
    queues={stage:queue.Queue(maxsize=DURABLE_CAPS[stage]) for stage in STAGES}
    lock=threading.Lock();abort_delivery=threading.Event()
    shared=dict(firstCause=None,eventQueuePeak=0);active={stage:0 for stage in STAGES};done=dict(active);peak=dict(active)
    operations={};operation_peak=0;current={};undelivered={};unreported_completions={};samples=[];last_bucket=-1
    sealed=False;admission_closed=False;accounting_complete=True;worker_timeouts=[];cutoff=0
    late_arrivals=[];unapplied_event=None;unapplied_arrival=None
    stop_state=dict(startedNs=None,returnedNs=None,error=None);backend_stop_retired=False
    def fail(error):
        with lock:
            if shared['firstCause'] is None:shared['firstCause']=d.failure_message(error)
        stop.set()
    def deliver(event):
        while not abort_delivery.is_set():
            try:events.put(event,timeout=.02)
            except queue.Full:continue
            with lock:shared['eventQueuePeak']=max(shared['eventQueuePeak'],events.qsize())
            return
        name=threading.current_thread().name
        with lock:
            if event['kind']=='_phase_done':
                unreported_completions.setdefault(name,{key:event[key] for key in ('stage','index','id','ok')})
            else:undelivered.setdefault(name,event)
        fail('original bounded event delivery did not retire; preserve pending and undelivered evidence')
        raise _DeliveryStopped('original event delivery stopped without retry')
    def notify(row,payload):
        event=dict(payload,index=row['index'],id=row['id'],atNs=time.monotonic_ns()-origin)
        # Detached bounded public event data; opaque backend handles never enter
        # this serialization or the public journal.
        deliver(json.loads(d.encoded(event)))
    def stop_original_backend():
        with lock:stop_state['startedNs']=time.monotonic_ns()-origin
        try:backend.stop()
        except BaseException as error:
            with lock:stop_state['error']=d.failure_message(error)
            fail(error)
        finally:
            with lock:stop_state['returnedNs']=time.monotonic_ns()-origin
    stop_thread=threading.Thread(target=stop_original_backend,name='normal-durable-backend-stop',daemon=True)
    def worker(stage):
        while not stop.is_set():
            try:index,row,account,handle=queues[stage].get(timeout=.02)
            except queue.Empty:continue
            name=threading.current_thread().name
            with lock:active[stage]+=1;current[name]=(stage,index,row['operationId'])
            ok=False;result=None
            try:
                if stop.is_set() or time.monotonic_ns()>=deadline:raise RuntimeError('staged lane canceled before original callee; preserve pending')
                notify(row,dict(kind='normal_stage',stage=stage+'_worker'))
                result=_perform_stage(backend,stage,row,account,handle,lambda event:notify(row,event),stop)
                ok=True
            except _DeliveryStopped:pass
            except Exception as error:
                try:notify(row,dict(kind='failed' if isinstance(error,s.KnownFailure) else 'unknown',error=d.failure_message(error)))
                except _DeliveryStopped:pass
            finally:
                try:deliver(dict(kind='_phase_done',stage=stage,index=index,id=row['id'],handle=result,ok=ok))
                except _DeliveryStopped:pass
                with lock:active[stage]-=1;done[stage]+=1;current.pop(name,None)
                queues[stage].task_done()
    threads=[threading.Thread(target=worker,args=(stage,),name='normal-durable-'+stage+'-'+str(i),daemon=True)
             for stage in STAGES for i in range(WORKERS[stage])]
    def drain_arrivals():
        nonlocal unapplied_arrival
        for _ in range(DURABLE_CAPS['arrivals']):
            try:value=clock.queue.get_nowait()
            except queue.Empty:break
            # The clock can be observed after the main loop's fixed deadline.
            # Keep that range out of cutoff accounting; its raw data is retained.
            if value['atNs']>=observation_deadline-origin:
                late_arrivals.append(value);continue
            unapplied_arrival=value
            ledger.release_observed(value['first'],value['end'],value['atNs'])
            unapplied_arrival=None
    def consume(event):
        if event['kind']!='_phase_done':
            if not admission_closed and event['atNs']>=observation_deadline-origin:
                return False # Retain this boundary event until the ledger is sealed.
            ledger.event(event);return True
        item=operations.get(event['index'])
        original.require(item is not None and item['row']['id']==event['id'],'original staged phase identity changed')
        row=ledger.row(event['index']);stage=event['stage']
        if admission_closed or not event['ok'] or row['status'] in ('failed','unknown'):
            operations.pop(event['index'],None);return True
        expected_status={'publish':'submitted','observe':'included','finalize':'qualified'}[stage]
        if row['status']!=expected_status:
            if row['status'] not in ('qualified','failed','unknown'):
                now=time.monotonic_ns()-origin
                if now<observation_deadline-origin:
                    ledger.event(dict(kind='unknown',index=row['index'],id=row['id'],atNs=now,
                                      error='original '+stage+' returned without required '+expected_status+' event; no fabricated completion'))
            else:raise RuntimeError('staged backend returned an out-of-order original terminal state')
            operations.pop(event['index'],None);return True
        if stage=='finalize':operations.pop(event['index'],None)
        else:item.update(row=row,stage='observe' if stage=='publish' else 'finalize',ready=True,handle=event['handle'])
        return True
    boundary_event=None
    def drain_events():
        nonlocal boundary_event,unapplied_event
        for _ in range(DURABLE_CAPS['events']):
            try:event=events.get_nowait()
            except queue.Empty:return
            try:
                if not consume(event):boundary_event=event;return
            except BaseException:
                unapplied_event=event;raise
    def dispatch():
        for index,item in list(operations.items()): # At most32 active handles.
            stage=item['stage']
            if not item['ready'] or queues[stage].full():continue
            if stop.is_set() or time.monotonic_ns()>=deadline:return
            row=item['row'];at=time.monotonic_ns()-origin
            if at>=deadline-origin:return
            ledger.event(dict(kind='normal_stage',stage={'publish':'publication_queue','observe':'inclusion_queue','finalize':'proof_worker_queue'}[stage],index=index,id=row['id'],atNs=at))
            if stop.is_set() or time.monotonic_ns()>=deadline:return
            queues[stage].put_nowait((index,dict(row),dict(item['account']),item['handle']))
            item['ready']=False;peak[stage]=max(peak[stage],queues[stage].qsize())
    try:
        check_resources();clock.thread.start()
        for thread in threads:thread.start()
        while time.monotonic_ns()<deadline and not stop.is_set():
            drain_arrivals();drain_events()
            if boundary_event is not None:break
            check_resources();dispatch()
            while len(operations)<DURABLE_CAPS['operations'] and not queues['publish'].full():
                if stop.is_set() or time.monotonic_ns()>=deadline:break
                at=time.monotonic_ns()-origin
                if at>=deadline-origin:break
                reserved=ledger.reserve(at)
                if reserved is None:break
                row,account=reserved
                operations[row['index']]=dict(row=row,account=account,stage='publish',ready=True,handle=None)
                operation_peak=max(operation_peak,len(operations));dispatch()
            now=time.monotonic_ns()-origin;bucket=now//1_000_000_000
            state=ledger.queue_state()
            if bucket!=last_bucket:
                original.require(len(samples)<DURABLE_CAPS['samples'],'bounded original pipeline sample capacity exceeded')
                with lock:busy=dict(active)
                samples.append(dict(atNs=now,queued={stage:q.qsize() for stage,q in queues.items()},activeWorkers=busy,
                                    queuedDemand=state['queued'],**{key:value for key,value in state.items() if key!='queued'}));last_bucket=bucket
            if now>=plan['windowNs'] and state['logicalReleased']==plan['configuredDemand'] and state['terminal']==plan['configuredDemand']:break
            stop.wait(.001)
    except BaseException as error:
        fail(error)
        if ledger.failed is not None:accounting_complete=False;abort_delivery.set()
    finally:
        observation_deadline=min(deadline,time.monotonic_ns());cutoff=observation_deadline-origin;stop.set()
        try:check_resources()
        except BaseException as error:fail(error)
        queue_at_cutoff={stage:q.qsize() for stage,q in queues.items()}
        if clock.thread.ident is not None:clock.thread.join(timeout=1)
        if clock.thread.is_alive():
            accounting_complete=False;abort_delivery.set();fail('original bounded arrival clock did not retire')
        if clock.failure:fail(clock.failure)
        try:
            if accounting_complete:
                drain_arrivals()
                if clock.undelivered and clock.undelivered['atNs']<cutoff:
                    value=clock.undelivered;ledger.release_observed(value['first'],value['end'],value['atNs']);clock.undelivered=None
                ledger.begin_cutoff(cutoff);admission_closed=True
                if boundary_event is not None:consume(boundary_event);boundary_event=None
                drain_events()
        except BaseException as error:accounting_complete=False;abort_delivery.set();fail(error)
        until=time.monotonic()+10
        # Call the SAME original stop exactly once. It may wait for a producer
        # blocked on this mailbox, so the controller must keep draining while
        # it runs. A callee that outlives the retirement budget remains debt;
        # this does not kill a Python thread or prove its children cleaned up.
        try:stop_thread.start()
        except BaseException as error:accounting_complete=False;abort_delivery.set();fail(error)
        while time.monotonic()<until:
            try:
                if admission_closed and accounting_complete:drain_events()
            except BaseException as error:accounting_complete=False;abort_delivery.set();fail(error)
            if not stop_thread.is_alive() and not any(thread.is_alive() for thread in threads) and (events.empty() or not accounting_complete):break
            for thread in threads:
                if thread.ident is not None:thread.join(timeout=min(.01,max(0,until-time.monotonic())))
            if stop_thread.ident is not None:stop_thread.join(timeout=min(.01,max(0,until-time.monotonic())))
        abort_delivery.set()
        for thread in threads:
            if thread.ident is not None:thread.join(timeout=.03)
        with lock:
            worker_timeouts=[dict(worker=thread.name,stage=current.get(thread.name,(None,None,None))[0],
                                 index=current.get(thread.name,(None,None,None))[1],operationId=current.get(thread.name,(None,None,None))[2])
                             for thread in threads if thread.is_alive()]
        if worker_timeouts:
            accounting_complete=False;fail('bounded staged original workers did not retire')
        backend_stop_retired=stop_thread.ident is not None and not stop_thread.is_alive()
        if not backend_stop_retired:
            accounting_complete=False;fail('original backend stop did not retire; cleanup debt, never retry')
        try:
            if admission_closed and accounting_complete:
                drain_events()
                for event in list(undelivered.values()):ledger.event(event)
                ledger.seal(cutoff);sealed=True
                ledger.retire_unresolved(time.monotonic_ns()-origin,'original staged operation incomplete at cutoff; preserve original pending, never retry/re-sign')
        except BaseException as error:accounting_complete=False;fail(error)
        try:check_resources()
        except BaseException as error:fail(error)
    try:
        result=None
        if accounting_complete and sealed:
            try:result=ledger.report(cutoff,shared['firstCause'])
            except BaseException as error:accounting_complete=False;fail(error)
        if result is None:
            try:audit=ledger.audit()
            except BaseException as error:audit=dict(status='UNKNOWN',reason=d.failure_message(error))
            result=dict(schema='YNX-PQ-DURABLE-LOAD-ACCOUNTING/v1',configuredDemand=plan['configuredDemand'],
                        observationCutoffNs=cutoff,qualified=None,notQualified=None,firstCause=shared['firstCause'],
                        accountingStatus='UNKNOWN',originalPendingAudit=audit,stableFinalTPS='UNMEASURED')
        result.update(originMonotonicNs=str(origin),offeredWindowEndMonotonicNs=str(origin+plan['windowNs']),
                      durableAccountingComplete=accounting_complete and sealed,P95FinalConfirmation='UNMEASURED',physicalCommitMeasured=False,
                      runtimeAuthorized=False,pressureAuthorized=False,durableLedgerPath=str(ledger.path))
        def project(event):
            if event is None:return None
            return {key:event[key] for key in ('kind','stage','index','id','ok') if key in event} if event['kind']=='_phase_done' else event
        with events.mutex:unwritten=[project(event) for event in events.queue]
        with clock.queue.mutex:remaining_arrivals=list(clock.queue.queue)
        with lock:
            undelivered_snapshot=list(undelivered.values());unreported_snapshot=list(unreported_completions.values())
            completed_snapshot=dict(done);event_peak=shared['eventQueuePeak'];stop_snapshot=dict(stop_state)
        result['pipeline']=dict(schema='YNX-PQ-DURABLE-STAGED/v1',stageWorkers=dict(WORKERS),bounds=dict(DURABLE_CAPS),
            ledgerInitialization=dict(startMonotonicNs=ledger_open_started,endMonotonicNs=ledger_open_returned,
                elapsedNs=ledger_open_returned-ledger_open_started,beforeOfferedOrigin=ledger_open_returned<=origin,
                meaning='actual original SQLite setup span; no signed work and no subtraction from original per-operation clocks'),
            queuePeak=dict(peak),eventQueuePeak=event_peak,arrivalQueuePeak=clock.peak,operationPeak=operation_peak,
            queueAtCutoff=queue_at_cutoff,queueAtRetirement={stage:q.qsize() for stage,q in queues.items()},completedByStage=completed_snapshot,
            completedByStageMeaning='worker calls returned or raised; not successful business counts',workerThreadsRetired=not worker_timeouts,
            callbacksMayStillArrive=bool(worker_timeouts) or clock.thread.is_alive(),
            backendStopRetired=backend_stop_retired,backendStopObserved=stop_snapshot,
            cleanupDebt=not backend_stop_retired or bool(worker_timeouts) or clock.thread.is_alive() or stop_snapshot['error'] is not None,
            cleanupMeaning='one original stop call and worker retirement only; no child-process cleanup attestation or activation grant',
            workerRetirementTimeouts=worker_timeouts,workerRetirementObservedNs=time.monotonic_ns()-origin,
            queueSamples=samples,undeliveredEvents=undelivered_snapshot,
            unreportedCompletions=unreported_snapshot,undeliveredArrivalRange=clock.undelivered,
            remainingArrivalRanges=remaining_arrivals,lateArrivalRanges=late_arrivals,remainingEventCount=events.qsize(),
            unappliedEvent=project(unapplied_event),boundaryEvent=project(boundary_event),
            unappliedArrivalRange=unapplied_arrival,unwrittenEvents=unwritten,
            lateEvidenceStorage='same original private SQLite ledger; no in-memory evidence history',
            fullDemandUnchanged=plan['configuredDemand'],automaticRetry=False,extraNodeOrSignerPIDStartedByScheduler=False,
            chainSaturationProven=False,arrivalClockMeaning='actual monotonic observations with contiguous due ranges; release time is never backfilled from logical schedule')
    finally:ledger.close()
    try:result['durableLedgerArtifact']=ledger.artifact()
    except BaseException as error:
        result['durableAccountingComplete']=False;result['artifactError']=d.failure_message(error)
        result['firstCause']=result['firstCause'] or d.failure_message(error)
    return result
