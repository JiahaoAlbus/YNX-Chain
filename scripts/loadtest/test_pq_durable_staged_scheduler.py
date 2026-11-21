"""Real bounded controller/SQLite IO with structural callbacks, never chain TPS."""
import hashlib
import contextlib
import importlib.util
import json
from pathlib import Path
import queue
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import tracemalloc
import unittest
from unittest import mock

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

controls=load('original_structural_backend','test_pq_staged_independent_scheduler.py')
s=controls.staged
d=load('durable_staged_test_ledger','pq-durable-demand-ledger.py')


class DurableStagedControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
    def plan(self,count=3,owners=1,tail_ns=1_000_000_000):
        raw=d.make_plan('a'*64,'b'*64,'online',
             [dict(ownerIndex=4+i,address='UNIT-ONLY-%d'%i,nextNonce=2,capacity=max(count,1)) for i in range(owners)],
             1000,count*1_000_000,tail_ns,enabled=True)
        return raw,s.configure_durable(raw,enabled=True)
    def run_control(self,plan,backend,*,stop=None,check=lambda:None,name='accounting.sqlite'):
        stop=threading.Event() if stop is None else stop
        events=[]
        with mock.patch('subprocess.Popen',side_effect=AssertionError('structural controller launched a process')), \
             mock.patch('socket.create_connection',side_effect=AssertionError('structural controller opened a socket')):
            result=s.run_durable(plan,backend,events.append,check,stop,ledger_path=self.root/name,enabled=True)
        self.assertTrue(stop.is_set());self.assertFalse(result['runtimeAuthorized'] or result['pressureAuthorized'])
        self.assertEqual(result['pipeline']['bounds'],s.DURABLE_CAPS)
        self.assertLessEqual(result['pipeline']['operationPeak'],32)
        self.assertLessEqual(result['pipeline']['eventQueuePeak'],512)
        self.assertLessEqual(result['pipeline']['arrivalQueuePeak'],64)
        for stage in s.STAGES:self.assertLessEqual(result['pipeline']['queuePeak'][stage],s.DURABLE_CAPS[stage])
        return result,events
    def rows(self,result):
        with contextlib.closing(sqlite3.connect('file:'+result['durableLedgerPath']+'?mode=ro',uri=True)) as db:
            return [json.loads(row[0]) for row in db.execute('SELECT data FROM rows ORDER BY idx')]

    def test_default_and_wrong_bounds_refuse_before_database_or_business(self):
        raw,plan=self.plan();backend=controls.StructuralBackend()
        with self.assertRaisesRegex(ValueError,'opt-in'):
            s.run_durable(plan,backend,lambda event:None,lambda:None,threading.Event(),ledger_path=self.root/'absent')
        plan['pipeline']['bounds']['events']+=1
        with self.assertRaisesRegex(ValueError,'exact bounded'):
            s.run_durable(plan,backend,lambda event:None,lambda:None,threading.Event(),ledger_path=self.root/'absent',enabled=True)
        self.assertFalse((self.root/'absent').exists());self.assertEqual(backend.calls['publish'],[])
        self.assertEqual(s.original.MAX_DEMAND,10000)

    def test_small_cohort_uses_same_callees_and_original_outcomes(self):
        raw,plan=self.plan();backend=controls.StructuralBackend()
        result,_=self.run_control(plan,backend)
        old_backend=controls.StructuralBackend()
        old=s.run(s.configure(dict(raw,rows=list(raw['rows']))),old_backend,lambda event:None,lambda:None,threading.Event())
        self.assertIsNone(result['firstCause']);self.assertTrue(result['durableAccountingComplete'])
        for key in ('configuredDemand','submitted','qualified','notQualified','terminalCounts','accountState'):
            self.assertEqual(result[key],old[key],key)
        rows=self.rows(result)
        for row,original in zip(rows,old['rows']):
            for key in ('index','id','operationId','ownerIndex','nonce','hash','nativeHash','status'):
                self.assertEqual(row[key],original[key],key)
        self.assertEqual([r['nonce'] for r in backend.calls['publish']],[2,3,4])
        self.assertTrue(result['pipeline']['workerThreadsRetired']);self.assertEqual(backend.stop_calls,1)
        artifact=result['durableLedgerArtifact']
        self.assertEqual(hashlib.sha256(Path(artifact['path']).read_bytes()).hexdigest(),artifact['sha256'])

    def test_recorded_original_clocks_replay_to_identical_full_demand_quantiles(self):
        raw,plan=self.plan();result,_=self.run_control(plan,controls.StructuralBackend())
        old=s.original.Ledger(dict(raw,rows=list(raw['rows'])),lambda event:None)
        with contextlib.closing(sqlite3.connect(result['durableLedgerPath'])) as db:
            for encoded, in db.execute('SELECT data FROM events ORDER BY seq'):
                event=json.loads(encoded);kind=event['kind']
                if kind=='logical_release_range':old.release(event['atNs'])
                elif kind=='account_claim':
                    row,_=old.reserve(event['atNs']);self.assertEqual(row['operationId'],event['operationId'])
                elif kind=='retirement_unknown':old.event(event['original'])
                elif kind not in ('admission_cutoff','observation_cutoff','late_original_event'):old.event(event)
        replay=old.report(result['observationCutoffNs'])
        for key in d.INTERVALS:self.assertEqual(result[key],replay[key],key)
        self.assertEqual(self.rows(result),[{k:v for k,v in row.items() if k!='completedStageDurations'} for row in replay['rows']])

    def test_unknown_after_post_keeps_original_nonce_and_never_signs_next(self):
        _,plan=self.plan(count=3,tail_ns=60_000_000)
        backend=controls.StructuralBackend(unknown_after_post=True)
        result,_=self.run_control(plan,backend)
        self.assertEqual(len(backend.calls['publish']),1)
        self.assertEqual(result['qualified'],0);self.assertEqual(result['configuredDemand'],3)
        account=result['accountState'][0]
        self.assertEqual((account['pending'],account['nextNonce'],account['quarantined']),(0,2,True))
        self.assertIsNone(result['endToEndLogicalArrivalToQualified']['p95Ms'])

    def test_success_callback_after_cutoff_is_retained_but_never_releases(self):
        class Late(controls.StructuralBackend):
            def finalize(self,handle,notify,stop):
                stop.wait()
                return super().finalize(handle,notify,stop)
        _,plan=self.plan(count=1,tail_ns=80_000_000);backend=Late()
        result,_=self.run_control(plan,backend)
        self.assertEqual(result['qualified'],0);self.assertGreaterEqual(result['lateOriginalEvents'],1)
        self.assertEqual(self.rows(result)[0]['status'],'unknown')
        self.assertEqual(result['accountState'][0]['nextNonce'],2)
        self.assertIsNotNone(result['accountState'][0]['pending'])

    def test_pre_cutoff_observation_delivered_during_stop_can_finish_but_not_admit(self):
        _,plan=self.plan(count=2,tail_ns=80_000_000);stop=threading.Event();original_queue=s.queue.Queue
        class DelayedQueue(original_queue):
            def put(self,item,*args,**kwargs):
                if isinstance(item,dict) and item.get('kind')=='qualified':stop.wait(2)
                return super().put(item,*args,**kwargs)
        backend=controls.StructuralBackend()
        with mock.patch.object(s.queue,'Queue',DelayedQueue):result,_=self.run_control(plan,backend,stop=stop)
        self.assertEqual(result['qualified'],1);self.assertEqual(len(backend.calls['publish']),1)
        self.assertEqual(result['accountState'][0]['nextNonce'],3)
        self.assertIsNone(result['accountState'][0]['pending'])
        self.assertIsNone(result['endToEndLogicalArrivalToQualified']['p95Ms'])

    def test_known_failure_type_and_missing_phase_event_remain_closed(self):
        for kind in ('known','missing'):
            with self.subTest(kind=kind):
                _,plan=self.plan(count=1,tail_ns=100_000_000)
                backend=controls.StructuralBackend(publish_error=s.original.KnownFailure('exact original rejection')) if kind=='known' else controls.StructuralBackend(omit_event='submitted')
                result,_=self.run_control(plan,backend,name=kind+'.sqlite')
                self.assertEqual(result['qualified'],0)
                self.assertEqual(self.rows(result)[0]['status'],'failed' if kind=='known' else 'unknown')
                self.assertEqual(result['accountState'][0]['nextNonce'],2)

    def test_resource_failure_preserves_first_cause_and_returns_bounded_unwritten_evidence(self):
        backend=controls.StructuralBackend(block='publish')
        def check():
            if backend.started['publish'].is_set():raise RuntimeError('original resource quota failure')
        def stop_failed():
            backend.owned_stopped.set();backend.stop_calls+=1
            raise RuntimeError('secondary backend stop failure')
        backend.stop=stop_failed
        _,plan=self.plan(count=3);start=time.monotonic()
        result,_=self.run_control(plan,backend,check=check)
        self.assertLess(time.monotonic()-start,5)
        self.assertEqual(result['firstCause'],'original resource quota failure')
        self.assertFalse(result['durableAccountingComplete']);self.assertEqual(result['accountingStatus'],'UNKNOWN')
        self.assertEqual(result['configuredDemand'],3);self.assertIsNone(result['qualified'])
        self.assertLessEqual(len(result['pipeline']['unwrittenEvents']),512)
        self.assertTrue(result['pipeline']['workerThreadsRetired'])
        self.assertEqual(self.rows(result)[0]['nonce'],2)

    def test_event_budget_failure_does_not_deadlock_a_full_mailbox(self):
        class Excess(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                for _ in range(700):notify(dict(kind='normal_stage',stage='checkpoint'))
                return super().publish(row,account,notify,stop)
        _,plan=self.plan(count=1);start=time.monotonic()
        result,_=self.run_control(plan,Excess())
        self.assertLess(time.monotonic()-start,5)
        self.assertIn('event budget exceeded',result['firstCause'])
        self.assertFalse(result['durableAccountingComplete'])
        self.assertTrue(result['pipeline']['workerThreadsRetired'])
        self.assertLessEqual(len(result['pipeline']['undeliveredEvents']),8)

    def test_arrival_overflow_keeps_its_exact_final_range_and_has_no_future_array(self):
        _,plan=self.plan(count=1000);stop=threading.Event();clock=s.BoundedArrivalClock(plan,0,stop)
        tick=iter(range(0,2_000_000_000,1_000_000))
        with mock.patch.object(s.time,'monotonic_ns',side_effect=lambda:next(tick)):clock.loop()
        self.assertTrue(stop.is_set());self.assertEqual(clock.queue.qsize(),64)
        self.assertIn('arrival queue exhausted',clock.failure)
        self.assertFalse(hasattr(clock,'offsets'))
        self.assertEqual(clock.undelivered['first'],list(clock.queue.queue)[-1]['end'])

    def test_coalesced_arrivals_keep_logical_due_and_actual_observation_distinct(self):
        raw,plan=self.plan(count=1000);stop=threading.Event();clock=s.BoundedArrivalClock(plan,0,stop)
        original_put=clock.queue.put_nowait
        def one_range(value):original_put(value);stop.set()
        with mock.patch.object(s.time,'monotonic_ns',return_value=37_000_000),mock.patch.object(clock.queue,'put_nowait',one_range):clock.loop()
        self.assertIsNone(clock.failure);self.assertEqual(clock.queue.qsize(),1)
        observed=clock.queue.get_nowait()
        self.assertEqual(observed,dict(first=0,end=38,atNs=37_000_000))
        ledger=d.DurableLedger(raw,self.root/'arrival.sqlite',lambda event:None,lambda:None,enabled=True)
        self.addCleanup(ledger.close)
        ledger.release_observed(observed['first'],observed['end'],observed['atNs'])
        self.assertEqual((ledger.row(0)['logicalArrivalOffsetNs'],ledger.row(0)['releasedNs']),(0,37_000_000))
        self.assertEqual((ledger.row(37)['logicalArrivalOffsetNs'],ledger.row(37)['releasedNs']),(37_000_000,37_000_000))
        self.assertEqual(ledger.row(38)['status'],'not_released');self.assertIsNone(ledger.row(38)['releasedNs'])

    def test_600000_prestopped_control_has_zero_business_and_bounded_memory(self):
        owners=[dict(ownerIndex=4+i,address='UNIT-%d'%i,nextNonce=2,capacity=1000) for i in range(600)]
        raw=d.make_plan('a'*64,'b'*64,'online',owners,1000,600_000_000_000,1_000_000_000,enabled=True)
        plan=s.configure_durable(raw,enabled=True);stop=threading.Event();stop.set();backend=controls.StructuralBackend()
        tracemalloc.start()
        try:
            with mock.patch.object(s.original,'ArrivalClock',side_effect=AssertionError('future array allocated')):
                result,_=self.run_control(plan,backend,stop=stop)
            _,peak=tracemalloc.get_traced_memory()
        finally:tracemalloc.stop()
        self.assertLess(peak,8<<20);self.assertEqual(result['configuredDemand'],600000)
        self.assertEqual(result['rowCountMaterialized'],0);self.assertEqual(result['notReleased'],600000)
        self.assertEqual(backend.calls,dict(publish=[],observe=[],finalize=[]))
        self.assertEqual(result['pipeline']['operationPeak'],0)

    def test_crash_inside_original_publish_leaves_durable_claim_and_no_restart(self):
        raw,plan=self.plan(count=1);path=self.root/'crash.sqlite'
        script='''import importlib.util,os,sys,threading
from pathlib import Path
s=importlib.util.spec_from_file_location('stage',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
d=m._durable_module();p=d.make_plan('a'*64,'b'*64,'online',[dict(ownerIndex=4,address='UNIT-ONLY-0',nextNonce=2,capacity=1)],1000,1_000_000,1_000_000_000,enabled=True)
class Backend:
 def publish(self,*args):os._exit(23)
 def observe(self,*args):raise AssertionError('not reached')
 def finalize(self,*args):raise AssertionError('not reached')
 def stop(self):pass
m.run_durable(m.configure_durable(p,enabled=True),Backend(),lambda event:None,lambda:None,threading.Event(),ledger_path=Path(sys.argv[2]),enabled=True)
'''
        completed=subprocess.run([sys.executable,'-B','-c',script,str(Path(s.__file__).resolve()),str(path)],timeout=10)
        self.assertEqual(completed.returncode,23)
        pin=hashlib.sha256(d.encoded({k:v for k,v in raw.items() if k!='rows'},d.MAX_PLAN_BYTES).encode()).hexdigest()
        audit=d.open_readonly(path,raw,pin);self.addCleanup(audit.close)
        self.assertEqual(audit.row(0)['status'],'reserved');self.assertEqual(audit.audit()['originalPending'][0]['nextNonce'],2)
        backend=controls.StructuralBackend()
        with self.assertRaises(FileExistsError):s.run_durable(plan,backend,lambda event:None,lambda:None,threading.Event(),ledger_path=path,enabled=True)
        self.assertEqual(backend.calls['publish'],[])

    def test_unretired_callee_cannot_claim_complete_accounting_after_snapshot(self):
        release=threading.Event();late=threading.Event()
        class Stalled(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                handle=super().publish(row,account,notify,stop)
                release.wait(5)
                try:notify(dict(kind='normal_stage',stage='post'))
                finally:late.set()
                return handle
        _,plan=self.plan(count=1,tail_ns=60_000_000)
        base=time.monotonic();ticks=iter([base,base+11])
        try:
            # Only fast-forward the retirement budget, not original arrival /
            # event monotonic_ns observations. No ten-second test sleep.
            with mock.patch.object(s.time,'monotonic',side_effect=lambda:next(ticks,base+11)):
                result,_=self.run_control(plan,Stalled())
            self.assertFalse(result['durableAccountingComplete'])
            self.assertFalse(result['pipeline']['workerThreadsRetired'])
            self.assertTrue(result['pipeline']['callbacksMayStillArrive'])
            self.assertIsNone(result['qualified'])
        finally:release.set();self.assertTrue(late.wait(1))

    def test_stop_waiting_for_full_mailbox_worker_is_drained_concurrently(self):
        finished=threading.Event();stop_entered=threading.Event()
        class WaitingStop(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                handle=super().publish(row,account,notify,stop)
                stop_entered.wait(2)
                try:
                    for _ in range(600):notify(dict(kind='normal_stage',stage='post'))
                finally:finished.set()
                return handle
            def stop(self):
                self.stop_calls+=1
                stop_entered.set()
                self.worker_done_before_stop_return=finished.wait(.8)
        _,plan=self.plan(count=1,tail_ns=60_000_000);backend=WaitingStop()
        result,_=self.run_control(plan,backend)
        self.assertTrue(backend.worker_done_before_stop_return)
        self.assertIn('event budget exceeded',result['firstCause'])
        self.assertFalse(result['durableAccountingComplete'])
        self.assertTrue(result['pipeline']['backendStopRetired'])
        self.assertTrue(result['pipeline']['workerThreadsRetired'])

    def test_unretired_original_stop_is_explicit_cleanup_debt(self):
        release=threading.Event();finished=threading.Event()
        class StalledStop(controls.StructuralBackend):
            def stop(self):
                self.stop_calls+=1
                try:release.wait(5)
                finally:finished.set()
        _,plan=self.plan(count=1,tail_ns=60_000_000)
        base=time.monotonic();ticks=iter([base,base+11])
        try:
            with mock.patch.object(s.time,'monotonic',side_effect=lambda:next(ticks,base+11)):
                result,_=self.run_control(plan,StalledStop())
            self.assertFalse(result['durableAccountingComplete'])
            self.assertIsNone(result['qualified'])
            self.assertFalse(result['pipeline']['backendStopRetired'])
            self.assertTrue(result['pipeline']['cleanupDebt'])
            self.assertFalse(result['pressureAuthorized'])
        finally:release.set();self.assertTrue(finished.wait(1))

    def test_report_read_failure_preserves_original_database_and_unknown_result(self):
        _,plan=self.plan(count=1);factory=s.original.open_durable_ledger
        def open_with_failed_report(*args,**kwargs):
            ledger=factory(*args,**kwargs)
            ledger.report=mock.Mock(side_effect=sqlite3.OperationalError('original report read failed'))
            return ledger
        with mock.patch.object(s.original,'open_durable_ledger',side_effect=open_with_failed_report):
            result,_=self.run_control(plan,controls.StructuralBackend())
        self.assertFalse(result['durableAccountingComplete']);self.assertIsNone(result['qualified'])
        self.assertEqual(result['firstCause'],'original report read failed')
        self.assertTrue(Path(result['durableLedgerArtifact']['path']).exists())

    def test_failed_arrival_observer_retains_popped_original_range_without_releasing_work(self):
        _,plan=self.plan(count=1);factory=s.original.open_durable_ledger
        def open_with_failed_emit(*args,**kwargs):
            ledger=factory(*args,**kwargs);original_emit=ledger.emit
            def emit(event):
                if event['kind']=='logical_release_range':raise OSError('original arrival observer failed')
                original_emit(event)
            ledger.emit=emit;return ledger
        backend=controls.StructuralBackend()
        with mock.patch.object(s.original,'open_durable_ledger',side_effect=open_with_failed_emit):
            result,_=self.run_control(plan,backend)
        self.assertFalse(result['durableAccountingComplete']);self.assertIsNone(result['qualified'])
        self.assertEqual(result['firstCause'],'original arrival observer failed')
        pending=result['pipeline']['unappliedArrivalRange']
        self.assertEqual((pending['first'],pending['end']),(0,1));self.assertGreaterEqual(pending['atNs'],0)
        self.assertEqual(backend.calls['publish'],[])
        self.assertEqual(result['originalPendingAudit']['claimed'],0)

    def test_caller_plan_mutation_cannot_shrink_running_full_denominator(self):
        _,plan=self.plan(count=3)
        class MutatesCaller(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                plan['configuredDemand']=1;plan['windowNs']=1
                plan['accounts'][0]['nextNonce']=999
                return super().publish(row,account,notify,stop)
        backend=MutatesCaller();result,_=self.run_control(plan,backend)
        self.assertEqual(result['configuredDemand'],3)
        self.assertEqual(result['pipeline']['fullDemandUnchanged'],3)
        self.assertEqual([r['nonce'] for r in backend.calls['publish']],[2,3,4])
        self.assertEqual(result['qualified'],3)


if __name__=='__main__':unittest.main(verbosity=2)
