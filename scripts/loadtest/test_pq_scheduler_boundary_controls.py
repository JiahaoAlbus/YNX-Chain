"""Real thread and original scheduler deadline controls; no chain effects."""
import importlib.util
import contextlib
import io
import os
from pathlib import Path
import stat
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
staged_tests=module('boundary_staged_controls','test_pq_staged_independent_scheduler.py')
independent_tests=module('boundary_independent_controls','test_pq_independent_load.py')
staged=staged_tests.staged;original=independent_tests.s;driver=independent_tests.driver

class SchedulerBoundaryControls(unittest.TestCase):
    def test_empty_original_failure_survives_secondary_cleanup_for_both_schedulers(self):
        for staged_mode in (False,True):
            with self.subTest(staged=staged_mode):
                calls=[]
                def check():
                    calls.append(1)
                    if len(calls)==1:raise ValueError()
                backend=staged_tests.StructuralBackend() if staged_mode else SimpleNamespace(perform=lambda *args:None)
                backend.stop=mock.Mock(side_effect=RuntimeError('CONTROL later cleanup'))
                plan=staged_tests.plan(count=1,accounts=1) if staged_mode else independent_tests.plan(count=1,accounts=1)
                run=staged.run if staged_mode else original.run
                result=run(plan,backend,lambda _:None,check,threading.Event())
                self.assertEqual(result['firstCause'],'ValueError: original exception message empty')
                self.assertNotEqual(result['firstCause'],'CONTROL later cleanup')
    def test_staged_claim_or_queue_journal_crossing_never_starts_publish(self):
        for blocked_kind in ('account_claim','publication_queue'):
            with self.subTest(kind=blocked_kind):
                plan=staged_tests.plan(count=1,accounts=1,tail_ns=200_000_000);backend=staged_tests.StructuralBackend()
                ready=threading.Event();release=threading.Event();stop=threading.Event();holder={};origin=time.monotonic_ns();deadline=origin+plan['windowNs']+plan['tailNs']
                def emit(e):
                    target=e.get('kind')==blocked_kind or blocked_kind=='publication_queue' and e.get('kind')=='normal_stage' and e.get('stage')=='publication_queue'
                    if target and not ready.is_set():ready.set();self.assertTrue(release.wait(3))
                def execute():holder['result']=staged.run(plan,backend,emit,lambda:None,stop,origin=origin)
                thread=threading.Thread(target=execute);thread.start()
                try:
                    self.assertTrue(ready.wait(2));threading.Event().wait(max(0,(deadline-time.monotonic_ns())/1e9)+.02)
                finally:release.set();thread.join(4)
                self.assertFalse(thread.is_alive());self.assertEqual(backend.calls['publish'],[])
                self.assertEqual(holder['result']['notQualified'],1)
    def test_original_claim_journal_crossing_never_starts_callee(self):
        plan=independent_tests.plan(count=1,accounts=1);ready=threading.Event();release=threading.Event();stop=threading.Event();holder={};calls=[]
        backend=SimpleNamespace(perform=lambda *args:calls.append(1),stop=lambda:None)
        origin=time.monotonic_ns();deadline=origin+plan['windowNs']+plan['tailNs']
        def emit(e):
            if e.get('kind')=='account_claim' and not ready.is_set():ready.set();self.assertTrue(release.wait(3))
        def execute():holder['result']=original.run(plan,backend,emit,lambda:None,stop,origin=origin)
        thread=threading.Thread(target=execute);thread.start()
        try:
            self.assertTrue(ready.wait(2));threading.Event().wait(max(0,(deadline-time.monotonic_ns())/1e9)+.02)
        finally:release.set();thread.join(4)
        self.assertFalse(thread.is_alive());self.assertEqual(calls,[]);self.assertEqual(holder['result']['notQualified'],1)
    def test_actual_broadcast_intent_fsync_crossing_does_not_post(self):
        ready=threading.Event();release=threading.Event();stop=threading.Event();deadline=time.monotonic_ns()+200_000_000
        stop.ynx_staged_deadline_ns=deadline
        backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.submit_lock=threading.Lock();backend.attempted=set()
        backend.c=SimpleNamespace(plan={'nodes':[{'rpcAddress':'http://127.0.0.1:1'}]*4})
        row=dict(id='CONTROL',operationId='c'*64,ownerIndex=4,nonce=2,index=0);tx=dict(abciHash='a'*64,nativeHash='b'*64);holder={}
        with tempfile.TemporaryDirectory() as t:
            case=Path(t);original_write=driver.lab.write_new
            def write(path,value):
                original_write(path,value)
                if path.name=='submission-intent.json':ready.set();self.assertTrue(release.wait(3))
            def execute():
                try:backend.broadcast_once(row,tx,b'CONTROL',case,lambda _:None,stop)
                except BaseException as e:holder['error']=e
            with mock.patch.object(driver.lab,'write_new',side_effect=write),mock.patch.object(driver.urllib.request,'build_opener') as opener:
                thread=threading.Thread(target=execute);thread.start()
                try:
                    self.assertTrue(ready.wait(2));threading.Event().wait(max(0,(deadline-time.monotonic_ns())/1e9)+.02)
                finally:release.set();thread.join(4)
                self.assertFalse(thread.is_alive());opener.assert_not_called();self.assertTrue((case/'submission-intent.json').is_file())
                self.assertIn('error',holder)
    def test_blocked_post_stage_notification_past_cutoff_never_attempts_post(self):
        ready=threading.Event();release=threading.Event();stop=threading.Event();deadline=time.monotonic_ns()+200_000_000
        stop.ynx_staged_deadline_ns=deadline
        backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.submit_lock=threading.Lock();backend.attempted=set()
        backend.c=SimpleNamespace(plan={'nodes':[{'rpcAddress':'http://127.0.0.1:1'}]*4})
        row=dict(id='CONTROL',operationId='c'*64,ownerIndex=4,nonce=2,index=0);tx=dict(abciHash='a'*64,nativeHash='b'*64);holder={};events=[]
        def notify(event):
            events.append(event)
            if event.get('stage')=='post':ready.set();self.assertTrue(release.wait(3))
        with tempfile.TemporaryDirectory() as t:
            def execute():
                try:backend.broadcast_once(row,tx,b'CONTROL',Path(t),notify,stop)
                except BaseException as error:holder['error']=error
            with mock.patch.object(driver.urllib.request,'build_opener') as opener:
                thread=threading.Thread(target=execute);thread.start()
                try:
                    self.assertTrue(ready.wait(2));threading.Event().wait(max(0,(deadline-time.monotonic_ns())/1e9)+.02)
                finally:release.set();thread.join(4)
                self.assertFalse(thread.is_alive());opener.return_value.open.assert_not_called();self.assertIn('error',holder)
                self.assertFalse(any(event.get('kind')=='submitted' for event in events))

    def test_submission_attempt_interval_crossing_window_is_not_counted_as_inside(self):
        for lower,upper,inside,late,unknown in ((-2,-1,1,0,0),(-1,1,0,0,1),(1,2,0,1,0)):
            with self.subTest(lower=lower,upper=upper):
                plan=independent_tests.plan(count=1,accounts=1);ledger=original.Ledger(plan,lambda _:None)
                ledger.release(0);row,_=ledger.reserve(1)
                independent_tests.event(ledger,row,'signed',2,hash=format(1,'064x'),nativeHash=format(1000,'064x'))
                boundary=plan['windowNs']
                independent_tests.event(ledger,row,'submitted',boundary+lower,submissionClock='PRE_CALL_LOWER_BOUND',submissionReturnNs=boundary+upper)
                report=ledger.report(boundary+3)
                self.assertEqual(report['submissionTimingSchema'],'YNX-PQ-SUBMISSION-ATTEMPT-BOUNDS/v1')
                self.assertEqual((report['submitted'],report['submittedWithinWindow'],report['lateSubmitted'],report['submissionWindowUnknown']),(1,inside,late,unknown))
                if unknown:self.assertIsNone(report['actualSubmissionAttemptTPS'])
                self.assertEqual(report['submitToInclusionObserved']['observed'],0)

    def test_real_drain_inventory_and_lifecycle_locks_share_remaining_budget(self):
        for held in ('inventory','lifecycle'):
            with self.subTest(held=held):
                lock=threading.RLock();ready=threading.Event();release=threading.Event();stop=threading.Event();stop.set()
                process=SimpleNamespace(pid=101,poll=lambda:None,_ynx_lifecycle_lock=threading.RLock())
                child=dict(name='load-0-normal-verifier',process=process,startedNs=1,startTicks=11)
                started=time.monotonic()-(driver.lab.CAPS['totalSeconds']-driver.lab.CAPS['cleanupSeconds'])+.15
                window=SimpleNamespace(lock=lock,children=[child],started=started,sample=lambda:None)
                backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.w=window;backend.stop_event=stop;backend.helper_limit=3
                target=lock if held=='inventory' else process._ynx_lifecycle_lock
                def own():
                    with target:ready.set();release.wait(2)
                thread=threading.Thread(target=own);thread.start();self.assertTrue(ready.wait(1));before=time.monotonic()
                try:
                    with self.assertRaises(RuntimeError):backend.drain_cutoff_verifiers(time.monotonic_ns(),30,lambda:None)
                    self.assertLess(time.monotonic()-before,.7);self.assertTrue(stop.is_set())
                finally:release.set();thread.join(2)
                self.assertFalse(thread.is_alive())

    def test_drain_failure_after_real_resource_latch_preserves_guard_and_both_errors(self):
        plan=staged_tests.plan(count=1,accounts=1,tail_ns=120_000_000);backend=staged_tests.StructuralBackend(block='publish')
        resource=threading.Event();drain_entered=threading.Event();allow_failure=threading.Event();holder={}
        def check():
            if resource.is_set():raise RuntimeError('CONTROL original resource latch')
        def drain(*_):
            drain_entered.set();self.assertTrue(allow_failure.wait(2));raise OSError('CONTROL later drain failure')
        backend.drain_cutoff_verifiers=drain
        thread=threading.Thread(target=lambda:holder.setdefault('result',staged.run(plan,backend,lambda _:None,check,threading.Event(),verifier_drain_seconds=30)))
        thread.start()
        try:
            self.assertTrue(drain_entered.wait(2));resource.set();allow_failure.set();thread.join(3)
            self.assertFalse(thread.is_alive());result=holder['result']
            self.assertEqual(result['firstCause'],'CONTROL original resource latch');self.assertEqual(result['firstCauseOrder'],'UNKNOWN')
            self.assertEqual(result['pipeline']['postCutoffVerifierDrainError']['errorType'],'OSError')
            self.assertEqual(result['qualified'],0)
        finally:allow_failure.set();thread.join(2)

    def test_real_public_backend_confirmation_finishing_after_cutoff_does_not_release_nonce(self):
        plan=independent_tests.plan(count=1,accounts=1);backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.c=SimpleNamespace(mode='online');backend.post_cutoff_diagnostic_only=False
        ready=threading.Event();release=threading.Event();stop=threading.Event();holder={}
        tx=dict(abciHash=format(1,'064x'),nativeHash=format(1000,'064x'),members=1)
        verified=dict(code='VERIFIED_TRANSACTION_DATA',result=dict(executionSuccessful=True,executionCode='0',transactionType='pq_transfer',nativeGrant=False))
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);case=root/'public/load-operations/00000';case.mkdir(parents=True);backend.w=SimpleNamespace(work=root)
            def publish(row,account,notify,_stop):
                notify(dict(kind='signed',hash=tx['abciHash'],nativeHash=tx['nativeHash']));notify(dict(kind='submitted'))
                return dict(row=row,account=account,case=case,started=time.monotonic_ns(),tx=tx,path=case,request={})
            def observe(handle,notify,_stop):notify(dict(kind='included'));return handle
            def confirm(*_):ready.set();self.assertTrue(release.wait(3));return dict(code='PROOF_CONFIRMED_DATA',result=dict(result={}))
            backend.publish=publish;backend.observe=observe;backend.live_proof=lambda *_:({},verified,{})
            backend.confirm_original=confirm;backend.stop=lambda:None
            def run():holder['result']=original.run(plan,backend,lambda _:None,lambda:None,stop)
            with mock.patch.object(driver.normal,'require_verified'),mock.patch.object(driver.proof_readback,'finalize_portable_catalog'):
                thread=threading.Thread(target=run);thread.start()
                try:
                    self.assertTrue(ready.wait(2));self.assertTrue(stop.wait(2));release.set();thread.join(4)
                    self.assertFalse(thread.is_alive());result=holder['result']
                    self.assertEqual(result['qualified'],0);self.assertEqual(result['notQualified'],1)
                    self.assertEqual(result['accountState'][0]['pending'],0);self.assertEqual(result['accountState'][0]['nextNonce'],2)
                    self.assertTrue(any(event['kind']=='qualified' for event in result['lateEvidence']))
                finally:release.set();thread.join(2)

    def test_backend_stop_shares_deadline_and_still_attempts_independent_child(self):
        entered=threading.Event();release=threading.Event();signals=[]
        def process(pid):
            proc=SimpleNamespace(pid=pid,poll=lambda:None,wait=lambda **_:None,send_signal=lambda _:None,terminate=lambda:None,kill=lambda:None)
            return driver.lab.bind_process_lifecycle(proc)
        first=process(101);second=process(102)
        def hold():
            with first._ynx_lifecycle_lock:entered.set();release.wait(2)
        thread=threading.Thread(target=hold);thread.start();self.assertTrue(entered.wait(1))
        backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.stop_event=threading.Event();backend.sessions={}
        backend.w=SimpleNamespace(lock=threading.RLock(),children=[dict(name='load-a',process=first),dict(name='load-b',process=second)],launch_cleanup_deadline=time.monotonic()+.15)
        start=time.monotonic()
        try:
            with mock.patch.object(driver.lab.os,'killpg',side_effect=lambda pid,sig:signals.append((pid,sig))):
                with self.assertRaisesRegex(RuntimeError,'lifecycle lock unavailable'):backend.stop()
            self.assertLess(time.monotonic()-start,.7);self.assertEqual([pid for pid,_ in signals],[102])
            self.assertTrue(backend.stopCleanupDebt)
        finally:release.set();thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_publication_directory_fsync_failure_survives_one_ambiguous_fd_close(self):
        with tempfile.TemporaryDirectory() as t:
            work=Path(t);(work/'public/load-operations').mkdir(parents=True)
            backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.w=SimpleNamespace(work=work)
            backend.c=SimpleNamespace(mode='online');row=dict(index=0,id='CONTROL',operationId='c'*64,nonce=2)
            first=ValueError('CONTROL original directory fsync');closed=[];reused=[];before=len(driver._ORIGINAL_FD_CLOSE_CUSTODY)
            original_close=os.close;sentinel=os.open('/dev/null',os.O_RDONLY)
            def close(fd):
                closed.append(fd);original_close(fd);os.dup2(sentinel,fd);reused.append(fd);raise OSError('CONTROL ambiguous close')
            try:
                with mock.patch.object(driver.os,'fsync',side_effect=first),mock.patch.object(driver.os,'close',side_effect=close):
                    with self.assertRaises(ValueError) as caught:backend.publish(row,dict(ownerIndex=4),lambda _:None,threading.Event())
                self.assertIs(caught.exception,first);self.assertEqual(len(closed),1);os.fstat(reused[0])
                self.assertEqual(len(driver._ORIGINAL_FD_CLOSE_CUSTODY),before+1)
            finally:
                if reused:original_close(reused[0])
                original_close(sentinel)
                del driver._ORIGINAL_FD_CLOSE_CUSTODY[before:] # CONTROL proved original fd closed before reuse.

    def test_duplicate_stage_on_one_row_does_not_fill_missing_other_row(self):
        plan=independent_tests.plan(count=2,accounts=2);ledger=original.Ledger(plan,lambda _:None)
        ledger.release(100_000_000);row0,_=ledger.reserve(110_000_000);ledger.reserve(110_000_000)
        for stage,at in (('checkpoint',120_000_000),('checkpoint',130_000_000),('signer',140_000_000)):
            independent_tests.event(ledger,row0,'normal_stage',at,stage=stage)
        info=ledger.report(200_000_000)['completedStageIntervals']['checkpoint']
        self.assertEqual(info['completed'],2);self.assertEqual(info['censoredOrNotReached'],1)
        self.assertEqual(info['completedDistinctRows'],1);self.assertEqual(info['duplicateCompletedOccurrences'],1)
        self.assertTrue(all(v is None for v in info['fullDemandPercentilesMs'].values()))
    def test_qualified_event_cannot_precede_last_original_stage(self):
        plan=independent_tests.plan(count=1,accounts=1);ledger=original.Ledger(plan,lambda _:None)
        ledger.release(0);row,_=ledger.reserve(1)
        independent_tests.event(ledger,row,'signed',2,hash=format(1,'064x'),nativeHash=format(1000,'064x'))
        independent_tests.event(ledger,row,'submitted',3);independent_tests.event(ledger,row,'included',4)
        independent_tests.event(ledger,row,'normal_stage',10,stage='verifier')
        with self.assertRaises(ValueError):
            independent_tests.event(ledger,row,'qualified',5,hash=format(1,'064x'),nativeHash=format(1000,'064x'),
                normalVerifierCode='VERIFIED_TRANSACTION_DATA',executionSuccessful=True,executionCode='0',
                transactionType='pq_transfer',members=1,nativeGrant=False,normalConfirmCode='PROOF_CONFIRMED_DATA',proofReference='CONTROL')
        self.assertEqual(row['status'],'included');self.assertIsNone(row['finalNs'])
    def test_scheduler_and_driver_never_repeat_failed_original_backend_stop(self):
        first=OSError('CONTROL original stop failed');backend=staged_tests.StructuralBackend();backend.stop=mock.Mock(side_effect=first)
        result=staged.run(staged_tests.plan(count=1,accounts=1),backend,lambda _:None,lambda:None,threading.Event())
        outer=dict(firstCause=result['firstCause']);driver.stop_backend_preserving_cause(backend,outer)
        self.assertEqual(backend.stop.call_count,1);self.assertEqual(outer['firstCause'],'CONTROL original stop failed')
        self.assertTrue(outer['backendStopError']['cleanupDebt']);self.assertIn(backend,original._BACKEND_STOP_CUSTODY)
        original._BACKEND_STOP_CUSTODY.remove(backend) # CONTROL backend owns no real OS resources.
    def test_real_monitor_latch_precedes_backend_cleanup_error(self):
        reached=threading.Event()
        class Window:
            def _sample(self):reached.set();raise OSError('CONTROL earlier resource failure')
            def sample(self):return self._sample()
        window=Window();monitor=driver.Monitor(window,threading.Event());monitor.thread.start()
        self.assertTrue(reached.wait(2));monitor.thread.join(2);self.assertFalse(monitor.thread.is_alive())
        result=dict(firstCause=None);driver.retain_monitor_failure(result,monitor)
        backend=SimpleNamespace(stop=mock.Mock(side_effect=RuntimeError('CONTROL later backend stop')))
        driver.stop_backend_preserving_cause(backend,result)
        self.assertEqual(result['firstCause'],'CONTROL earlier resource failure');self.assertEqual(result['firstCauseErrorType'],'OSError')
        self.assertTrue(result['backendStopError']['cleanupDebt']);original._BACKEND_STOP_CUSTODY.remove(backend)
    def test_journal_directory_fsync_first_and_close_error_never_reclose(self):
        with tempfile.TemporaryDirectory() as t:
            first=ValueError('CONTROL directory fsync');original_fsync=os.fsync;original_close=os.close
            sentinel=os.open('/dev/null',os.O_RDONLY);target=[];reused=[];calls=[];before=list(driver._JOURNAL_UNKNOWN_CUSTODY)
            def fsync(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode):target.append(fd);raise first
                return original_fsync(fd)
            def close(fd):
                if target and fd==target[0]:
                    calls.append(fd);original_close(fd);os.dup2(sentinel,fd);reused.append(fd);raise OSError('CONTROL directory close')
                return original_close(fd)
            try:
                with mock.patch.object(driver.os,'fsync',side_effect=fsync),mock.patch.object(driver.os,'close',side_effect=close):
                    with self.assertRaises(ValueError) as raised:driver.Journal(Path(t)/'events.jsonl')
                self.assertIs(raised.exception,first);self.assertEqual(len(calls),1);os.fstat(reused[0])
                new=[j for j in driver._JOURNAL_UNKNOWN_CUSTODY if j not in before]
                self.assertEqual(len(new),1);self.assertIs(new[0].firstFailure,first);self.assertTrue(new[0].cleanupDebt)
                self.assertTrue(new[0].file.closed)
            finally:
                if reused:original_close(reused[0])
                original_close(sentinel)
                for journal in list(driver._JOURNAL_UNKNOWN_CUSTODY):
                    if journal not in before:driver._JOURNAL_UNKNOWN_CUSTODY.remove(journal) # CONTROL hook proved the original fd closed.
    def test_journal_rotation_close_unknown_never_recloses_or_writes(self):
        with tempfile.TemporaryDirectory() as t:
            journal=driver.Journal(Path(t)/'events.jsonl');old=journal.file;calls=[];writes=[]
            class OriginalCloseControl:
                def close(self):calls.append(1);old.close();raise OSError('CONTROL rotation close')
                def write(self,value):writes.append(value);return len(value)
                def fileno(self):return old.fileno()
            journal.file=OriginalCloseControl();journal.bytes=driver.lab.CAPS['logBytes']
            try:
                with self.assertRaises(OSError) as first:journal.emit({'control':'first'})
                with self.assertRaises(OSError) as second:journal.close()
                with self.assertRaises(RuntimeError):journal.emit({'control':'short'})
                self.assertIs(first.exception,second.exception);self.assertEqual(len(calls),1);self.assertEqual(writes,[])
                self.assertTrue(journal.cleanupDebt);self.assertIn(journal,driver._JOURNAL_UNKNOWN_CUSTODY)
            finally:
                if journal in driver._JOURNAL_UNKNOWN_CUSTODY:driver._JOURNAL_UNKNOWN_CUSTODY.remove(journal) # CONTROL hook closed the old file.
    def test_journal_write_fsync_failure_is_sticky_and_never_rewrites(self):
        with tempfile.TemporaryDirectory() as t:
            journal=driver.Journal(Path(t)/'events.jsonl');first=OSError('CONTROL journal fsync first')
            try:
                with mock.patch.object(driver.os,'fsync',side_effect=first):
                    with self.assertRaises(OSError) as caught:journal.emit({'control':'original'})
                self.assertIs(caught.exception,first);size=journal.paths[0].stat().st_size
                with self.assertRaises(RuntimeError):journal.emit({'control':'must not retry'})
                self.assertEqual(journal.paths[0].stat().st_size,size);self.assertIs(journal.writeFailure,first)
            finally:journal.close()
    def test_qualified_emit_failure_never_releases_original_account(self):
        first=OSError('CONTROL terminal journal failure');calls=[]
        def emit(event):
            calls.append(event['kind'])
            if event['kind']=='qualified':raise first
        ledger=original.Ledger(independent_tests.plan(count=1,accounts=1),emit)
        ledger.release(0);row,_=ledger.reserve(1)
        independent_tests.event(ledger,row,'signed',2,hash=format(1,'064x'),nativeHash=format(1000,'064x'))
        independent_tests.event(ledger,row,'submitted',3);independent_tests.event(ledger,row,'included',4)
        with self.assertRaises(OSError) as caught:
            independent_tests.event(ledger,row,'qualified',5,hash=format(1,'064x'),nativeHash=format(1000,'064x'),
                normalVerifierCode='VERIFIED_TRANSACTION_DATA',executionSuccessful=True,executionCode='0',transactionType='pq_transfer',
                members=1,nativeGrant=False,normalConfirmCode='PROOF_CONFIRMED_DATA',proofReference='CONTROL')
        self.assertIs(caught.exception,first);self.assertEqual(row['status'],'included');self.assertIsNone(row['finalNs'])
        self.assertEqual(ledger.accounts[row['ownerIndex']]['pending'],row['index']);self.assertEqual(calls.count('qualified'),1)
    def test_final_unknown_journal_failure_preserves_prior_cause_without_retry(self):
        for staged_mode in (False,True):
            with self.subTest(staged=staged_mode):
                claimed=threading.Event();unknown=[]
                def emit(event):
                    if event['kind']=='account_claim':claimed.set()
                    if event['kind']=='unknown':unknown.append(event);raise OSError('CONTROL journal unknown')
                def check():
                    if claimed.is_set():raise RuntimeError('CONTROL earlier guard')
                if staged_mode:
                    backend=staged_tests.StructuralBackend(block='publish');plan=staged_tests.plan(count=1,accounts=1)
                    result=staged.run(plan,backend,emit,check,threading.Event())
                else:
                    backend=SimpleNamespace(perform=lambda row,account,notify,stop:stop.wait(),stop=lambda:None)
                    result=original.run(independent_tests.plan(count=1,accounts=1),backend,emit,check,threading.Event())
                self.assertEqual(result['firstCause'],'CONTROL earlier guard');self.assertEqual(result['journalPersistenceStatus'],'UNKNOWN')
                self.assertEqual(len(unknown),1);self.assertEqual(result['notQualified'],1)
    def test_real_legacy_stdin_close_thread_timeout_is_sticky_and_single_attempt(self):
        with tempfile.TemporaryDirectory() as t:
            raw=open(Path(t)/'control','wb');entered=threading.Event();release=threading.Event();calls=[]
            class BlockedOriginal:
                def close(self):
                    calls.append(1);entered.set();release.wait(3);raw.close()
            process=SimpleNamespace(stdin=BlockedOriginal())
            try:
                start=time.monotonic();first=driver.retire_legacy_stdin_once(process,timeout=.05)
                self.assertTrue(entered.wait(1));self.assertLess(time.monotonic()-start,.5);self.assertTrue(first['cleanupDebt'])
                second=driver.retire_legacy_stdin_once(process,timeout=.05)
                self.assertTrue(second['cleanupDebt']);self.assertEqual(len(calls),1);self.assertIn(process,driver._LEGACY_STDIN_CUSTODY)
            finally:
                release.set();process._ynx_legacy_stdin_retirement['thread'].join(2)
            self.assertFalse(process._ynx_legacy_stdin_retirement['thread'].is_alive());self.assertTrue(raw.closed)
            self.assertTrue(driver.retire_legacy_stdin_once(process)['cleanupDebt']);self.assertEqual(len(calls),1)
            driver._LEGACY_STDIN_CUSTODY.remove(process) # CONTROL closure observed its actual file close.
    def test_real_concurrent_legacy_close_observer_cannot_clear_unknown(self):
        with tempfile.TemporaryDirectory() as t:
            raw=open(Path(t)/'control','wb');entered=threading.Event();release=threading.Event();calls=[];out=[]
            class BlockedOriginal:
                def close(self):calls.append(1);entered.set();release.wait(2);raw.close()
            process=SimpleNamespace(stdin=BlockedOriginal())
            thread=threading.Thread(target=lambda:out.append(driver.retire_legacy_stdin_once(process,timeout=1)))
            thread.start();self.assertTrue(entered.wait(1))
            try:
                second=driver.retire_legacy_stdin_once(process,timeout=.05)
                self.assertTrue(second['cleanupDebt'])
            finally:release.set();thread.join(2)
            self.assertFalse(thread.is_alive());self.assertTrue(out[0]['cleanupDebt']);self.assertEqual(len(calls),1);self.assertTrue(raw.closed)
            driver._LEGACY_STDIN_CUSTODY.remove(process) # CONTROL closure was observed.

    def test_real_legacy_owner_stop_reports_close_error_without_retry(self):
        with tempfile.TemporaryDirectory() as t:
            raw=open(Path(t)/'control','wb');calls=[];first=OSError('CONTROL original close error')
            class FailedOriginal:
                def close(self):calls.append(1);raw.close();raise first
            process=SimpleNamespace(stdin=FailedOriginal(),poll=lambda:0)
            session=SimpleNamespace(proc=process,poison_retirement=False)
            window=SimpleNamespace(lock=threading.RLock(),children=[dict(name='load-owner-0',process=process)])
            backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.stop_event=threading.Event();backend.w=window;backend.sessions={0:session}
            result=dict(firstCause='CONTROL earlier')
            driver.stop_backend_preserving_cause(backend,result);driver.stop_backend_preserving_cause(backend,result)
            self.assertEqual(result['firstCause'],'CONTROL earlier');self.assertTrue(result['backendStopError']['cleanupDebt'])
            self.assertEqual(len(calls),1);self.assertTrue(raw.closed);self.assertIs(process._ynx_legacy_stdin_retirement['error'],first)
            driver._LEGACY_STDIN_CUSTODY.remove(process);original._BACKEND_STOP_CUSTODY.remove(backend) # CONTROL hook proved file close.

if __name__=='__main__':unittest.main()
