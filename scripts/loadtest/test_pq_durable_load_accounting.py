"""Finite driver/SQLite/thread controls; no actual source/crypto/load qualification."""
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

a=module('pq-durable-load-accounting.py')
driver=module('pq-independent-load.py')
controls=module('test_pq_staged_independent_scheduler.py')
guard_controls=module('test_resource_guard_sampling.py')


class DurableDriverControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.count=0
    def args(self,**changes):
        values=dict(mode='online',rate=100,seconds=1,tail_seconds=1,accounts=1,per_account=100,
            proof_timeout=1,staged_publication=True,owned_storage_accounting=True,durable_accounting=True,
            first_trial_profile='own1b',commit=driver.STAGED_CALLEE_SOURCE,execute=False,source='/UNUSED-CONTROL',
            wire_observation=False,network_accounting=False,header_hop_capture=False,commit_observation=False)
        values.update(changes);return SimpleNamespace(**values)
    def case(self,*,count=3,tail_ns=150_000_000,initial_error=None):
        self.count+=1;root=self.root/str(self.count);root.mkdir(mode=0o700)
        lab=guard_controls.lab
        window=guard_controls.ResourceGuardSamplingControls().window(root)
        (root/'.private').chmod(0o700);(root/'public'/'load-operations').mkdir(mode=0o700)
        # Real Window control, real private storage. Proc/RSS readings are
        # deterministic test inputs, never presented as physical RSS evidence.
        self.stack.enter_context(mock.patch.object(lab.guard,'proc_inventory',return_value=(guard_controls.ResourceGuardSamplingControls().rows(),[])))
        self.stack.enter_context(mock.patch.object(lab,'owned_rss',return_value=1024))
        stop=threading.Event();monitor=driver.Monitor(window,stop);self.addCleanup(monitor.close)
        monitor.error=initial_error
        owners=[dict(ownerIndex=4,address='UNIT-ONLY',nextNonce=2,capacity=max(count,1))]
        raw=a.d.make_plan('a'*64,'b'*64,'online',owners,1000,count*1_000_000,tail_ns,enabled=True)
        plan=a.staged.configure_durable(raw,enabled=True)
        return root,window,monitor,stop,raw,plan
    def execute(self,backend=None,*,count=3,tail_ns=150_000_000):
        root,w,monitor,stop,raw,plan=self.case(count=count,tail_ns=tail_ns)
        accounting=a.DriverAccounting(w,monitor,stop,plan)
        backend=controls.StructuralBackend() if backend is None else backend
        once=a.StopOnce(backend);journal=driver.Journal(root/'public'/'load-events.jsonl');self.addCleanup(journal.close)
        with mock.patch('socket.create_connection',side_effect=AssertionError('no network in driver control')), \
             mock.patch('subprocess.Popen',side_effect=AssertionError('no node/signer subprocess in driver control')):
            result=driver.run_load_window(plan,once,journal,monitor,stop,staged_scheduler=a.staged,durable_accounting=accounting)
        return result,accounting,once,backend,raw
    def receipt(self,accounting):
        raw=json.dumps(a.public_plan(accounting.staged_plan),separators=(',',':')).encode()
        receipt=accounting.receipt(hashlib.sha256(raw).hexdigest())
        return receipt,raw

    def test_opt_in_is_explicit_and_old_finite_conditions_stay_unchanged(self):
        args=self.args(durable_accounting=False)
        self.assertNotIn('durableAccounting',driver.load_conditions(args))
        del args.durable_accounting
        self.assertFalse(a.selected(args));self.assertEqual(driver.validate_options(args),100)
        args.durable_accounting=True
        self.assertTrue(driver.load_conditions(args)['durableAccounting'])
        self.assertEqual(driver.validate_options(args),100)

    def test_bad_configuration_cannot_expand_current_core_or_finite_limits(self):
        changes=[dict(durable_accounting=1),dict(staged_publication=False),dict(owned_storage_accounting=False),
                 dict(mode='pre-signed'),dict(initialization_only=True),dict(held_ready_only=True),
                 dict(seconds=600,rate=1000),dict(seconds=60,rate=1000),dict(per_account=1025),
                 dict(accounts=10,per_account=1000,seconds=10,rate=1000)]
        for change in changes:
            with self.subTest(change=change),self.assertRaises((ValueError,RuntimeError)):
                driver.validate_options(self.args(**change))

    def test_driver_plan_selector_is_lazy_and_old_branch_remains_original(self):
        args=self.args();ceremony=SimpleNamespace(pin='a'*64,workload_pin='b'*64)
        owners=[dict(ownerIndex=4,address='UNIT',nextNonce=2,capacity=100)]
        plan,staged=driver.make_load_plan(args,ceremony,owners)
        self.assertFalse(isinstance(plan['rows'],list));self.assertEqual(len(plan['rows']),100)
        self.assertEqual(plan['pipeline']['schema'],'YNX-PQ-DURABLE-STAGED/v1')
        args.durable_accounting=False
        old,_=driver.make_load_plan(args,ceremony,owners)
        self.assertEqual(old,staged.configure(driver.scheduler.make_plan('a'*64,'b'*64,'online',owners,100,1_000_000_000,1_000_000_000)))
        self.assertIsInstance(old['rows'],list)

    def test_source_qualification_still_refuses_before_window_or_children(self):
        args=self.args(execute=True)
        with mock.patch.object(driver.lab,'Window') as window, \
             mock.patch.object(driver,'STAGED_SOURCE_QUALIFICATION',None):
            with self.assertRaisesRegex(RuntimeError,'qualification NOT_SUPPLIED'):driver.run(args)
        window.assert_not_called()

    def test_actual_driver_dispatch_has_same_finite_outcomes_and_readonly_original(self):
        result,accounting,once,backend,raw=self.execute()
        old=driver.run_load_window(a.staged.configure(dict(raw,rows=list(raw['rows']))),controls.StructuralBackend(),
              SimpleNamespace(emit=lambda event:None),SimpleNamespace(check=lambda:None),threading.Event(),staged_scheduler=a.staged)
        for key in ('configuredDemand','logicalReleased','notReleased','submitted','notSubmitted','qualified','notQualified'):
            self.assertEqual(result[key],old[key],key)
        # FULL SQLite IO changes actual timings. Compare window/tail boundaries
        # and every quantile against the OLD reducer over the SAME original
        # stored clocks, never force two independent runs' timestamps to agree.
        replay=driver.scheduler.Ledger(dict(raw,rows=list(raw['rows'])),lambda event:None)
        stored=a.d.open_readonly(accounting.path,accounting.plan,accounting.database['planSHA256'])
        try:
            for encoded, in stored.db.execute('SELECT data FROM events ORDER BY seq'):
                event=json.loads(encoded);kind=event['kind']
                if kind=='logical_release_range':replay.release(event['atNs'])
                elif kind=='account_claim':replay.reserve(event['atNs'])
                elif kind=='retirement_unknown':replay.event(event['original'])
                elif kind not in ('admission_cutoff','observation_cutoff','late_original_event'):replay.event(event)
        finally:stored.close()
        replayed=replay.report(result['observationCutoffNs'])
        for key in (*a.COUNTS,'terminalCounts',*a.d.INTERVALS):
            self.assertEqual(result[key],replayed['observedThroughput']['successfulInclusion'] if key=='included' else replayed[key],key)
        self.assertNotIn('rows',result);self.assertNotIn('durableLedgerPath',result)
        self.assertNotIn('unwrittenEvents',result['pipeline'])
        initialization=result['pipeline']['ledgerInitialization']
        self.assertGreaterEqual(initialization['elapsedNs'],0)
        self.assertEqual(initialization['elapsedNs'],initialization['endMonotonicNs']-initialization['startMonotonicNs'])
        self.assertLessEqual(initialization['endMonotonicNs'],int(result['originMonotonicNs']))
        self.assertEqual(once.finish()['cleanupDebt'],False);self.assertEqual(backend.stop_calls,1)
        receipt,plan_raw=self.receipt(accounting)
        before=a.pin(accounting.path,a.DB_LIMIT)
        read=a.readback(receipt,plan_raw,private_database=accounting.path)
        self.assertEqual(read['privateOriginalStatus'],'READ_ONLY_ORIGINAL_ACCOUNTING_OBSERVED')
        self.assertEqual(read['pendingOriginalCount'],0);self.assertFalse(read['pressureAuthorized'])
        self.assertEqual(a.pin(accounting.path,a.DB_LIMIT),before)
        with accounting.readonly_rows() as rows:
            self.assertFalse(isinstance(rows,list));self.assertEqual([row['nonce'] for row in rows],[2,3,4])
        collector=driver.NormalBackend.__new__(driver.NormalBackend)
        collector.w=accounting.w;collector.c=SimpleNamespace(live=[])
        with accounting.readonly_rows() as rows:
            self.assertEqual(collector.retain_stopped_live_proof_failures(result,rows=rows),dict(records=[],altersLoadResult=False))

    def test_public_metadata_without_private_db_is_not_independent_readback(self):
        _,accounting,_,_,_=self.execute(count=1)
        receipt,plan_raw=self.receipt(accounting);read=a.readback(receipt,plan_raw)
        self.assertEqual(read['privateOriginalStatus'],'NOT_SUPPLIED')
        self.assertFalse(read['cryptographyReverified'] or read['pressureAuthorized'] or read['originalResourceGuardIndependentlyReverified'])

    def test_original_normal_backend_three_methods_keep_sign_post_proof_confirm_order(self):
        # Execute the actual NormalBackend.publish/observe/finalize bodies.
        # Only their effectful primitive callees return structural control data;
        # no original signer, RPC or cryptographic verifier is invoked here.
        for refused in (False,True):
            with self.subTest(confirm_refused=refused):
                root,w,monitor,stop,raw,plan=self.case(count=3)
                calls=[]
                class OriginalMethods(driver.NormalBackend):
                    def original(self,row,account,case,notify,cancel):
                        calls.append(('original',row['index'],row['nonce']))
                        tx=dict(abciHash='%064x'%(row['index']+1),nativeHash='%064x'%(row['index']+1000),members='1')
                        return tx,case/'CONTROL-NOT-A-TRANSACTION',b'CONTROL-NOT-A-TRANSACTION',dict(operationId=row['operationId'])
                    def broadcast_once(self,row,tx,wire,case,notify,cancel):
                        calls.append(('broadcast_once',row['index']));notify(dict(kind='submitted'));notify(dict(kind='ack'))
                    def observe_inclusion(self,row,tx,case,notify,cancel):
                        calls.append(('observe_inclusion',row['index']));notify(dict(kind='included'));return 7
                    def wait_successor(self,height,case,cancel):calls.append(('wait_successor',height))
                    def live_proof(self,row,tx,path,case,notify,cancel):
                        calls.append(('live_proof',row['index']))
                        self.control_verified=dict(included=True,finalized=True,executionSuccessful=True,executionCode='0',
                            nativeGrant=False,transactionHash=tx['abciHash'],nativeWireHash=tx['nativeHash'],transactionType='pq_transfer')
                        return {},dict(code='VERIFIED_TRANSACTION_DATA',result=self.control_verified),{'CONTROL_ONLY':True}
                    def confirm_original(self,row,request,proof,case,notify,cancel):
                        calls.append(('confirm_original',row['index']))
                        return dict(code='CONTROL_REFUSED' if refused else 'PROOF_CONFIRMED_DATA',result=dict(result=self.control_verified))
                    def stop(self):calls.append(('stop',))
                backend=OriginalMethods.__new__(OriginalMethods);backend.w=w;backend.c=SimpleNamespace(mode='online')
                accounting=a.DriverAccounting(w,monitor,stop,plan);once=a.StopOnce(backend)
                with mock.patch('subprocess.Popen',side_effect=AssertionError('no original Go process')), \
                     mock.patch('urllib.request.urlopen',side_effect=AssertionError('no original HTTP POST')), \
                     mock.patch.object(driver.proof_readback,'finalize_portable_catalog') as export:
                    result=driver.run_load_window(plan,once,SimpleNamespace(emit=lambda event:None),monitor,stop,durable_accounting=accounting)
                expected=0 if refused else 3
                self.assertEqual(result['qualified'],expected);self.assertEqual(export.call_count,expected)
                original=[row for row in calls if row[0]=='original']
                self.assertEqual([row[2] for row in original],[2] if refused else [2,3,4])
                names=[row[0] for row in calls[:6]]
                self.assertEqual(names,['original','broadcast_once','observe_inclusion','wait_successor','live_proof','confirm_original'])
                self.assertEqual(calls.count(('stop',)),1)
                if refused:
                    with accounting.readonly_rows() as rows:self.assertEqual(next(rows)['status'],'unknown')

    def test_unknown_retains_nonce_and_same_database_cannot_restart(self):
        result,accounting,once,backend,_=self.execute(controls.StructuralBackend(unknown_after_post=True))
        self.assertEqual(result['qualified'],0);self.assertEqual(len(backend.calls['publish']),1)
        receipt,plan_raw=self.receipt(accounting)
        self.assertEqual(a.readback(receipt,plan_raw,private_database=accounting.path)['pendingOriginalCount'],1)
        with accounting.readonly_rows() as rows:
            first=next(rows);self.assertEqual((first['status'],first['nonce']),('unknown',2))
        with self.assertRaisesRegex(ValueError,'cannot restart'):accounting.run(once,lambda event:None)
        with self.assertRaises(FileExistsError):a.DriverAccounting(accounting.w,accounting.monitor,accounting.stop,accounting.staged_plan)
        self.assertEqual(len(backend.calls['publish']),1)

    def test_initial_resource_refusal_starts_no_sqlite_or_business(self):
        root,w,monitor,stop,raw,plan=self.case(initial_error='original startup resource refusal')
        with self.assertRaisesRegex(RuntimeError,'startup resource refusal'):a.DriverAccounting(w,monitor,stop,plan)
        self.assertFalse((root/'.private/durable-demand/accounting.sqlite').exists())
        monitor.close() # A monitor that never started is safe to retire.

    def test_active_resource_refusal_retains_first_cause_and_does_not_write_large_envelope(self):
        root,w,monitor,stop,raw,plan=self.case()
        class Refuses(controls.StructuralBackend):
            def publish(self,row,account,notify,cancel):
                monitor.error='original active RSS refusal'
                cancel.set();return super().publish(row,account,notify,cancel)
            def stop(self):self.stop_calls+=1;raise RuntimeError('secondary stop error')
        backend=Refuses();accounting=a.DriverAccounting(w,monitor,stop,plan)
        result=driver.run_load_window(plan,a.StopOnce(backend),SimpleNamespace(emit=lambda event:None),monitor,stop,durable_accounting=accounting)
        self.assertEqual(result['firstCause'],'original active RSS refusal')
        self.assertFalse(result['durableAccountingComplete']);self.assertIsNone(result['qualified'])
        self.assertTrue(accounting.path.exists());self.assertFalse((accounting.directory/'interrupted-result.json').exists())
        receipt,_=self.receipt(accounting);self.assertEqual(receipt['interruptedEnvelopeStatus'],'NOT_RETAINED')
        self.assertTrue(all(value is None for value in receipt['counts'].values()))

    def test_original_window_inventory_includes_db_journal_and_supervisor_rss(self):
        _,accounting,_,_,_=self.execute(count=1)
        journal=Path(str(accounting.path)+'-journal');journal.write_bytes(b'CONTROL'*1000);journal.chmod(0o600)
        accounting.check();w=accounting.w;w.last_storage_sample=None;w.sample()
        self.assertGreaterEqual(w.peak_bytes,accounting.path.stat().st_size+journal.stat().st_size)
        self.assertEqual(w.peak_rss_sample['processes'][0]['pid'],os.getpid())
        self.assertEqual(w.peak_rss_sample['processes'][0]['name'],'supervisor')
        receipt,plan_raw=self.receipt(accounting)
        with self.assertRaisesRegex(ValueError,'owning recovery'):a.readback(receipt,plan_raw,private_database=accounting.path)
        self.assertEqual(journal.read_bytes(),b'CONTROL'*1000)

    def test_sidecar_limit_and_file_identity_fail_closed_without_deletion(self):
        _,accounting,_,_,_=self.execute(count=1)
        unknown=accounting.directory/'accounting.sqlite-wal';unknown.write_bytes(b'preserve');unknown.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'unexpected'):accounting.check()
        self.assertEqual(unknown.read_bytes(),b'preserve')
        unknown.unlink() # Only this synthetic fixture, never an original ledger.
        journal=Path(str(accounting.path)+'-journal');journal.write_bytes(b'x'*70000);journal.chmod(0o600)
        # Keep the original database bound valid; inject an actual oversized
        # journal stat only, avoiding large test allocations.
        old=accounting.path.stat().st_size
        with mock.patch.object(a,'DB_LIMIT',old):
            journal.write_bytes(b'x'*(old+65537))
            with self.assertRaisesRegex(ValueError,'budget exceeded'):accounting.check()
        self.assertTrue(journal.exists())

    def test_stop_once_handles_preparation_failure_without_second_close(self):
        backend=controls.StructuralBackend();once=a.StopOnce(backend)
        first=once.finish();second=once.finish()
        self.assertTrue(first['retired'] and second['retired']);self.assertEqual(backend.stop_calls,1)
        with self.assertRaisesRegex(ValueError,'already attempted'):once.stop()
        self.assertEqual(backend.stop_calls,1)

    def test_unretired_original_stop_remains_debt_and_is_not_retried(self):
        release=threading.Event()
        backend=SimpleNamespace(stop=mock.Mock(side_effect=lambda:release.wait(2)))
        once=a.StopOnce(backend)
        try:
            value=once.finish(.02);self.assertFalse(value['retired']);self.assertTrue(value['cleanupDebt'])
            self.assertTrue(once.finish(0)['cleanupDebt']);self.assertEqual(backend.stop.call_count,1)
        finally:release.set();self.assertTrue(once.done.wait(1))

    def test_driver_stop_keeps_primary_failure_and_skips_unretired_worker_reports(self):
        backend=SimpleNamespace(stop=mock.Mock(side_effect=RuntimeError('original stop failure')))
        once=a.StopOnce(backend);result=dict(firstCause='original preparation failure')
        self.assertTrue(driver.finish_load_backend(backend,once,result))
        self.assertEqual(result['firstCause'],'original preparation failure')
        self.assertTrue(result['durableBackendStop']['cleanupDebt'])
        result['loadResult']=dict(pipeline=dict(callbacksMayStillArrive=True))
        self.assertFalse(driver.finish_load_backend(backend,once,result));self.assertEqual(backend.stop.call_count,1)
        old=SimpleNamespace(stop=mock.Mock());legacy=dict(firstCause=None)
        self.assertTrue(driver.finish_load_backend(old,None,legacy));old.stop.assert_called_once()
        self.assertNotIn('durableBackendStop',legacy)
        class BadMessage(Exception):
            def __str__(self):raise ValueError('CONTROL bad stop message')
        for error in (RuntimeError(),BadMessage()):
            with self.subTest(error_type=type(error).__name__):
                wrapper=a.StopOnce(SimpleNamespace(stop=mock.Mock(side_effect=error)))
                observed=wrapper.finish()
                self.assertTrue(observed['retired'] and observed['cleanupDebt'])
                self.assertIn(type(error).__name__,observed['error'])

    def test_preparation_failure_receipt_keeps_missing_counts_and_original_cause(self):
        _,w,monitor,stop,raw,plan=self.case(count=1)
        accounting=a.DriverAccounting(w,monitor,stop,plan)
        plan_raw=json.dumps(a.public_plan(plan)).encode()
        receipt=accounting.receipt(hashlib.sha256(plan_raw).hexdigest(),'original preparation failed')
        self.assertFalse(receipt['loadStarted']);self.assertFalse(receipt['accountingComplete'])
        self.assertIsNone(receipt['database']);self.assertEqual(receipt['firstCause'],'original preparation failed')
        self.assertTrue(all(value is None for value in receipt['counts'].values()))
        self.assertEqual(a.readback(receipt,plan_raw)['privateOriginalStatus'],'NOT_SUPPLIED')

    def test_journal_close_failure_preserves_primary_and_unknown_pin_without_retry(self):
        journal=SimpleNamespace(close=mock.Mock(side_effect=OSError('original journal close failed')),paths=[])
        result=dict(firstCause='original guard failure')
        driver.close_load_journal(journal,self.root,result,durable=True)
        self.assertEqual(result['firstCause'],'original guard failure')
        self.assertEqual(result['loadJournalError']['status'],'UNKNOWN');self.assertNotIn('journalSegments',result)
        journal.close.assert_called_once()
        with self.assertRaisesRegex(OSError,'journal close failed'):
            driver.close_load_journal(journal,self.root,{},durable=False)
        class BadMessage(Exception):
            def __str__(self):raise ValueError('CONTROL bad close message')
        for error in (RuntimeError(),BadMessage()):
            with self.subTest(error_type=type(error).__name__):
                broken=SimpleNamespace(close=mock.Mock(side_effect=error),paths=[]);observed={}
                driver.close_load_journal(broken,self.root,observed,durable=True)
                self.assertIn(type(error).__name__,observed['firstCause'])
                self.assertEqual(observed['loadJournalError']['status'],'UNKNOWN')
                broken.close.assert_called_once()

    def test_actual_driver_finally_retains_unprintable_preparation_failure_receipt(self):
        # Run the actual top-level try/finally. Admission/source/hardware are
        # controlled inputs only, and the injected failure precedes any build.
        # A separate control above proves the real missing qualification gate.
        class BadMessage(Exception):
            def __str__(self):raise ValueError('CONTROL formatting failed')
        args=self.args(execute=True);window=None;old_module=driver.module
        def controlled_window(source,work,**kwargs):
            nonlocal window
            window=SimpleNamespace(work=work,storage_roots=[work],started=time.monotonic(),peak_rss=0,peak_bytes=0,
                samples=0,retired_samples=[],rss_fallback_samples=[],sample_stage_report=lambda:{},
                process_receipt=lambda:[],stop=mock.Mock(side_effect=BadMessage()))
            return window
        def controlled_module(name,file):
            return SimpleNamespace(capture=lambda work:dict(controlOnly=True)) if file=='pq-runtime-hardware.py' else old_module(name,file)
        with mock.patch.object(driver,'module',side_effect=controlled_module), \
             mock.patch.object(driver,'STAGED_SOURCE_QUALIFICATION',{'CONTROL_ONLY':True}), \
             mock.patch.object(driver.lab,'check_source',return_value={'tree':driver.STAGED_CALLEE_TREE}), \
             mock.patch.object(driver.lab,'git'),mock.patch('subprocess.check_output',return_value=b'live-materials'), \
             mock.patch.object(driver.sys,'platform','linux'),mock.patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_TEMP':str(self.root)}), \
             mock.patch.object(driver.lab.guard,'proc_inventory',return_value=({},[])), \
             mock.patch.object(driver.lab.guard,'memory_available',return_value=16<<30), \
             mock.patch.object(driver.lab,'admit'),mock.patch.object(driver.lab,'ports_available'), \
             mock.patch.object(driver.ctypes,'CDLL',return_value=SimpleNamespace(prctl=lambda *args:0)), \
             mock.patch.object(driver.lab,'Window',side_effect=controlled_window), \
             mock.patch.object(driver,'tool_identity',return_value={'CONTROL_ONLY':True}), \
             mock.patch.object(driver,'process_capacity',side_effect=BadMessage()), \
             mock.patch('subprocess.Popen',side_effect=AssertionError('no process is permitted')), \
             mock.patch('socket.create_connection',side_effect=AssertionError('no network is permitted')):
            result=driver.run(args)
        self.assertIn('BadMessage',result['firstCause']);self.assertFalse(result['loadExecuted'])
        self.assertFalse(result['cleanupComplete']);self.assertIn('BadMessage',result['cleanupError'])
        window.stop.assert_called_once()
        original=json.loads((window.work/'public/receipt.json').read_bytes())
        self.assertEqual(original['firstCause'],result['firstCause'])
        self.assertEqual(original['schema'],a.RUN_SCHEMA)
        self.assertFalse(original['loadCompletionDiagnostics']['fullBusinessDemandComplete'])

    def test_interrupted_original_fsyncs_directory_and_retention_failure_stays_incomplete(self):
        for refuse_directory_sync in (False,True):
            with self.subTest(refuse_directory_sync=refuse_directory_sync):
                root,w,monitor,stop,raw,plan=self.case(count=1)
                accounting=a.DriverAccounting(w,monitor,stop,plan);once=a.StopOnce(controls.StructuralBackend())
                original_fsync=os.fsync;observed=[]
                def sync(fd):
                    if (accounting.directory/'interrupted-result.json').exists() and stat.S_ISDIR(os.fstat(fd).st_mode):
                        observed.append(fd)
                        if refuse_directory_sync:raise OSError('CONTROL interrupted directory sync failed')
                    return original_fsync(fd)
                class BadMessage(Exception):
                    def __str__(self):raise ValueError('CONTROL emit formatting failed')
                def refused_emit(event):raise BadMessage()
                with mock.patch.object(os,'fsync',side_effect=sync):result=accounting.run(once,refused_emit)
                self.assertTrue(observed);self.assertFalse(result['durableAccountingComplete'])
                self.assertIn('BadMessage',result['firstCause']);self.assertIsNone(result['qualified'])
                original=accounting.directory/'interrupted-result.json'
                self.assertTrue(original.exists());self.assertEqual(original.stat().st_mode&0o777,0o600)
                self.assertEqual(accounting.envelope_status,'NOT_RETAINED' if refuse_directory_sync else 'RETAINED')
                if refuse_directory_sync:self.assertIn('directory sync failed',accounting.raw['privateEnvelopeError'])

    def test_unprintable_original_backend_failure_remains_unknown_without_resign(self):
        class BadMessage(Exception):
            def __str__(self):raise ValueError('CONTROL worker formatting failed')
        class Broken(controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                self.calls['publish'].append(dict(row));raise BadMessage()
            def stop(self):self.stop_calls+=1;raise BadMessage()
        result,accounting,once,backend,_=self.execute(Broken(),tail_ns=25_000_000)
        self.assertEqual(len(backend.calls['publish']),1);self.assertEqual(backend.stop_calls,1)
        self.assertIn('BadMessage',result['firstCause']);self.assertTrue(result['pipeline']['cleanupDebt'])
        self.assertEqual(result['qualified'],0)
        with accounting.readonly_rows() as rows:
            row=next(rows);self.assertEqual(row['status'],'unknown');self.assertEqual(row['nonce'],2)
            self.assertIn('BadMessage',row['error'])

    def test_strict_reader_rejects_forged_counts_metrics_pins_and_authority(self):
        _,accounting,_,_,_=self.execute(count=1);receipt,raw=self.receipt(accounting)
        changes=[lambda v:v.update(extra=True),lambda v:v.update(schema='YNX-PQ-INDEPENDENT-NORMAL-RUN/v1'),lambda v:v.update(pressureAuthorized=True),
            lambda v:v['counts'].update(qualified=0),lambda v:v['counts'].update(submitted=True),
            lambda v:v['intervals']['submitToInclusionObserved'].update(denominator=True),
            lambda v:v['intervals']['submitToInclusionObserved'].update(p95Ms=float('nan')),
            lambda v:v['database'].update(planSHA256='0'*64),lambda v:v['resourceScope'].update(parentAndDescendantRSS=1)]
        for change in changes:
            value=copy.deepcopy(receipt);change(value)
            with self.subTest(value=value),self.assertRaises(ValueError):a.readback(value,raw,private_database=accounting.path)
        for encoded in (b'{"schema":1,"schema":2}',b'{"value":NaN}'):
            with self.assertRaises(ValueError):a.strict(encoded)

    def test_changed_private_database_is_rejected_before_readonly_open(self):
        _,accounting,_,_,_=self.execute(count=1);receipt,raw=self.receipt(accounting)
        with accounting.path.open('ab') as out:out.write(b'CONTROL-ALTERED')
        with mock.patch.object(a.d,'open_readonly',side_effect=AssertionError('must bind original bytes first')):
            with self.assertRaisesRegex(ValueError,'DB bytes differ'):a.readback(receipt,raw,private_database=accounting.path)

    def test_readback_cli_uses_exact_pins_and_never_reopens_database_writable(self):
        _,accounting,_,_,_=self.execute(count=1);receipt,raw=self.receipt(accounting)
        plan=self.root/'plan.json';plan.write_bytes(raw)
        source=self.root/'receipt.json';source.write_bytes(json.dumps(receipt).encode())
        output=self.root/'readback.json';before=a.pin(accounting.path,a.DB_LIMIT)
        completed=subprocess.run([sys.executable,'-B',a.__file__,'--receipt',str(source),
            '--receipt-sha256',hashlib.sha256(source.read_bytes()).hexdigest(),'--plan',str(plan),
            '--plan-sha256',hashlib.sha256(raw).hexdigest(),'--database',str(accounting.path),
            '--output',str(output)],capture_output=True,timeout=10)
        self.assertEqual(completed.returncode,0,completed.stderr.decode())
        self.assertEqual(json.loads(output.read_bytes())['privateOriginalStatus'],'READ_ONLY_ORIGINAL_ACCOUNTING_OBSERVED')
        self.assertEqual(a.pin(accounting.path,a.DB_LIMIT),before)


if __name__=='__main__':unittest.main(verbosity=2)
