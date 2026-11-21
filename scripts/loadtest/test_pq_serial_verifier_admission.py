"""Real bounded CONTROL children; not a Go verifier, signature or chain run."""
import concurrent.futures
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
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


helpers=module('test_pq_helper_lifecycle.py');d=helpers.driver
gate=module('pq-serial-verifier-admission.py')


def identity(index):return dict(index=index,logicalId=format(index+1,'064x'),operationId=format(index+100,'064x'))


class SerialVerifierControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        (self.root/'public').mkdir();bins=self.root/'bin';bins.mkdir()
        self.control=bins/'ynx-consensus-proof-verify'
        self.control.write_text('#!'+sys.executable+'\nimport json,pathlib,sys,time\n'
            'pathlib.Path(sys.argv[1]).touch()\n'
            'while not pathlib.Path(sys.argv[2]).exists():time.sleep(.005)\n'
            'print(json.dumps({"controlExited":True,"cryptographyVerified":False}))\n')
        self.control.chmod(0o700)
        self.w=helpers.ChildWindow(self.root);self.addCleanup(self.w.close)
        self.c=SimpleNamespace(w=self.w,bins=bins,live=[{} for _ in range(4)],mode='pre-signed',workload={'transactions':[]})
        self.b=d.NormalBackend(self.c,[],threading.Event())
    def enable(self,seconds=3):
        self.b.configure_serial_verifier();origin=time.monotonic_ns()
        self.b.verifier_admission.bind_window(origin,origin+int(seconds*1e9))
    def invoke(self,index):
        return self.b.helper('load-%05d-normal-verifier'%index,
            [str(self.control),str(self.root/('ready-'+str(index))),str(self.root/'release')],original_verifier=identity(index))
    def wait_for(self,predicate):
        until=time.monotonic()+2
        while not predicate() and time.monotonic()<until:time.sleep(.005)
        self.assertTrue(predicate())
    def test_default_old_helper_path_and_clock_are_unchanged(self):
        self.assertIsNone(self.b.verifier_admission)
        self.assertFalse(hasattr(self.b.stop_event,'ynx_verifier_admission_deadline_ns'))
        out=self.b.helper('ordinary',[sys.executable,'-I','-c','print("{}")'])
        self.assertEqual(out,{});self.assertEqual(self.b.helper_limit,3)
        self.assertNotIn('verifierAdmission',self.b.helper_timing_report()['records'][0])
    def test_four_real_verifiers_are_fifo_and_leave_shared_helpers_available(self):
        self.enable()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs=[pool.submit(self.invoke,0)];self.wait_for(lambda:(self.root/'ready-0').exists())
            for i in range(1,4):
                jobs.append(pool.submit(self.invoke,i));self.wait_for(lambda:self.b.verifier_admission.report()['queued']==i)
            self.assertEqual(len(self.w.children),1)
            # A queued verifier does not occupy the original shared PID/helper
            # slots: a different normal helper can still finish in this interval.
            self.assertEqual(self.b.helper('other-normal-helper',[sys.executable,'-I','-c','print("{}")']),{})
            self.assertEqual(len(self.w.children),2)
            (self.root/'release').touch()
            self.assertTrue(all(job.result(3)==dict(controlExited=True,cryptographyVerified=False) for job in jobs))
        names=[row['name'] for row in self.w.children if row['name'].endswith('-normal-verifier')]
        self.assertEqual(names,['load-%05d-normal-verifier'%i for i in range(4)])
        report=self.b.verifier_admission.report();self.assertEqual((report['admitted'],report['released'],report['active']),(4,4,0))
        records=sorted((r for r in self.b.helper_timing_report()['records'] if 'verifierAdmission' in r),key=lambda r:r['verifierAdmission']['index'])
        for index,row in enumerate(records):
            proof=row['verifierAdmission'];self.assertEqual(proof['operationId'],identity(index)['operationId'])
            self.assertLess(proof['admittedMonotonicNs'],proof['plannedObservationDeadlineMonotonicNs'])
            self.assertGreater(proof['remainingToPlannedCutoffAtAdmissionNs'],0)
            self.assertLessEqual(proof['admittedMonotonicNs'],row['slotAcquiredMonotonicNs'])
            self.assertEqual(row['remainingToPlannedCutoffAtLaunchReturnedNs'],proof['plannedObservationDeadlineMonotonicNs']-row['launchReturnedMonotonicNs'])
            self.assertLessEqual(row['waitReturnedMonotonicNs'],row['cleanupStartedMonotonicNs'])
            self.assertLessEqual(row['cleanupStartedMonotonicNs'],row['cleanupFinishedMonotonicNs'])
            if index:self.assertGreaterEqual(proof['admittedMonotonicNs'],records[index-1]['verifierAdmission']['releasedMonotonicNs'])
    def test_queued_verifier_cancellation_has_no_child_and_preserves_original(self):
        self.enable();hold={};ticket=self.b.verifier_admission.acquire(identity(99),hold)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                job=pool.submit(self.invoke,1);self.wait_for(lambda:self.b.verifier_admission.report()['queued']==1)
                self.b.stop_event.set()
                with self.assertRaisesRegex(RuntimeError,'canceled'):job.result(2)
            self.assertFalse(self.w.children)
            record=self.b.helper_timing_report()['records'][0]
            self.assertEqual(record['verifierAdmission']['status'],'CANCELED_BEFORE_ADMISSION')
            self.assertNotIn('slotAcquiredMonotonicNs',record)
        finally:self.b.verifier_admission.release(ticket,hold,no_live_original_child=True)
    def test_original_deadline_expires_while_waiting_for_shared_helper_without_launch(self):
        self.enable(.06)
        for _ in range(3):self.b.helper_slots.acquire()
        try:
            with self.assertRaisesRegex(TimeoutError,'waiting for helper slot'):self.invoke(0)
            self.assertFalse(self.w.children);self.assertTrue(self.b.stop_event.is_set())
            self.assertEqual(self.b.verifier_admission.report()['active'],0)
            row=self.b.helper_timing_report()['records'][0];self.assertNotIn('launchRequestedMonotonicNs',row)
        finally:
            for _ in range(3):self.b.helper_slots.release()
    def test_cutoff_queued_permit_cannot_get_a_fresh_timeout(self):
        self.enable(.06);trace={};ticket=self.b.verifier_admission.acquire(identity(99),trace)
        try:
            with self.assertRaisesRegex(TimeoutError,'before admission'):self.invoke(0)
            self.assertFalse(self.w.children)
            self.assertEqual(self.b.helper_timing_report()['records'][0]['verifierAdmission']['status'],'CUTOFF_BEFORE_ADMISSION')
            self.assertTrue(self.b.stop_event.is_set())
        finally:self.b.verifier_admission.release(ticket,trace,no_live_original_child=True)
    def test_original_wait_error_and_unknown_retirement_never_reopen_permit(self):
        self.enable();error=helpers.OriginalWaitFailure('UNIT original wait failure')
        with mock.patch.object(self.b,'_helper',side_effect=error),mock.patch.object(self.b.verifier_admission,'release',side_effect=OSError('UNIT later release failure')):
            with self.assertRaises(helpers.OriginalWaitFailure) as caught:self.invoke(0)
        self.assertIs(caught.exception,error);self.assertTrue(self.b.stop_event.is_set())
        self.assertEqual(self.b.verifier_admission.report()['active'],1)
        self.assertEqual(self.b.verifier_admission.report()['status'],'UNKNOWN')
        self.assertIs(self.b.verifier_admission.report()['cleanupDebt'],True)
        self.assertEqual(self.b.helper_cleanup_debt[0]['errorType'],'OSError')
        self.assertEqual(self.b.helper_timing_report()['records'][0]['errorType'],'OriginalWaitFailure')
        self.assertFalse(self.w.children)
    def test_permit_release_error_without_prior_failure_cannot_return_helper_success(self):
        self.enable();(self.root/'release').touch()
        with mock.patch.object(self.b.verifier_admission,'release',side_effect=OSError('UNIT uncertain release')):
            with self.assertRaisesRegex(OSError,'uncertain release'):self.invoke(0)
        self.assertTrue(all(row['process'].returncode==0 for row in self.w.children))
        self.assertTrue(self.b.stop_event.is_set());self.assertEqual(self.b.verifier_admission.report()['active'],1)
        self.assertEqual(self.b.verifier_admission.report()['status'],'UNKNOWN')
        self.assertIs(self.b.verifier_admission.report()['cleanupDebt'],True)
    def test_real_retirement_lock_contention_keeps_known_debt_in_nested_report(self):
        self.enable();(self.root/'release').touch()
        locked=threading.Event();unlock=threading.Event()
        def hold():
            with self.b.verifier_admission.condition:locked.set();unlock.wait(2)
        holder=threading.Thread(target=hold);original=helpers.OriginalWaitFailure('UNIT original wait boundary failure')
        real_wait=self.w.wait
        def fail_after_exit(proc):
            real_wait(proc);holder.start();self.assertTrue(locked.wait(1));raise original
        try:
            with mock.patch.object(self.w,'wait',side_effect=fail_after_exit):
                with self.assertRaises(helpers.OriginalWaitFailure) as caught:self.invoke(0)
            self.assertIs(caught.exception,original)
            self.assertEqual(self.b.helper_cleanup_debt[0]['errorType'],'RuntimeError')
            # Snapshot cannot acquire the same real lock. A known retirement
            # error must still be debt; unknown counters must remain null.
            report=self.b.verifier_admission.report()
            self.assertEqual(report['status'],'UNKNOWN');self.assertIs(report['cleanupDebt'],True)
            self.assertIsNone(report['active'])
        finally:
            unlock.set()
            if holder.ident is not None:holder.join(2)
        self.assertFalse(holder.is_alive())
        report=self.b.verifier_admission.report()
        self.assertEqual((report['status'],report['active'],report['released'],report['cleanupDebt']),('UNKNOWN',1,0,True))
    def test_exception_after_actual_permit_release_is_sticky_debt_without_inventing_active_child(self):
        self.enable();(self.root/'release').touch();release=self.b.verifier_admission.release
        def failed_return(*args,**kwargs):
            self.assertTrue(release(*args,**kwargs));raise OSError('UNIT uncertain release return')
        with mock.patch.object(self.b.verifier_admission,'release',side_effect=failed_return):
            with self.assertRaisesRegex(OSError,'uncertain release return'):self.invoke(0)
        report=self.b.verifier_admission.report()
        self.assertEqual((report['status'],report['active'],report['released'],report['cleanupDebt']),('UNKNOWN',0,1,True))
        with self.assertRaisesRegex(RuntimeError,'cleanup unresolved'):self.invoke(1)
        self.assertEqual(len(self.w.children),1)
    def test_unreaped_real_control_keeps_permit_and_original_failure(self):
        self.enable();original=helpers.OriginalWaitFailure('UNIT original wait failed before retirement')
        launch=self.w.launch
        with contextlib.ExitStack() as patches:
            def uncertain_launch(*args,**kwargs):
                proc=launch(*args,**kwargs)
                patches.enter_context(mock.patch.object(proc,'terminate'))
                patches.enter_context(mock.patch.object(proc,'kill'))
                patches.enter_context(mock.patch.object(proc,'wait',side_effect=d.subprocess.TimeoutExpired('CONTROL',1)))
                return proc
            patches.enter_context(mock.patch.object(self.w,'launch',side_effect=uncertain_launch))
            patches.enter_context(mock.patch.object(self.w,'wait',side_effect=original))
            with self.assertRaises(helpers.OriginalWaitFailure) as caught:self.invoke(0)
            self.assertIs(caught.exception,original)
            self.assertIsNone(self.w.children[0]['process'].poll())
            state=self.b.verifier_admission.report()
            self.assertEqual((state['active'],state['released'],state['cleanupDebt']),(1,0,True))
            record=self.b.helper_timing_report()['records'][0]
            self.assertEqual(record['verifierAdmission']['status'],'UNKNOWN_RETIREMENT')
            self.assertEqual(record['errorType'],'OriginalWaitFailure')
            with self.assertRaisesRegex(RuntimeError,'cleanup unresolved'):self.invoke(1)
            self.assertEqual(len(self.w.children),1)
        # Only this test's original CONTROL process is now allowed to exit;
        # the production permit remains debt and is never retried or released.
        (self.root/'release').touch();self.w.children[0]['process'].wait(timeout=2)
        self.assertEqual(self.b.verifier_admission.report()['active'],1)
    def test_closed_window_identity_and_waiter_bounds_refuse(self):
        with self.assertRaisesRegex(RuntimeError,'opt-in'):gate.SerialVerifierAdmission(threading.Event())
        self.b.configure_serial_verifier()
        with self.assertRaisesRegex(RuntimeError,'not bound'):self.invoke(0)
        for start,end in [(True,2),(1,True),(1,1),(1,1<<63)]:
            with self.assertRaises(RuntimeError):self.b.verifier_admission.bind_window(start,end)
        self.b.verifier_admission.bind_window(time.monotonic_ns(),time.monotonic_ns()+1_000_000_000)
        with self.assertRaisesRegex(RuntimeError,'rebound'):self.b.verifier_admission.bind_window(1,2)
        bad=identity(0);bad['index']=False
        with self.assertRaisesRegex(RuntimeError,'identity differs'):self.b.verifier_admission.acquire(bad,{})
        self.assertFalse(self.w.children)
    def test_fifth_request_cannot_expand_original_finalize_worker_bound(self):
        self.enable();hold={};ticket=self.b.verifier_admission.acquire(identity(99),hold)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                jobs=[]
                for index in range(3):
                    jobs.append(pool.submit(self.invoke,index))
                    self.wait_for(lambda:self.b.verifier_admission.report()['queued']==len(jobs))
                with self.assertRaisesRegex(RuntimeError,'bound exceeded'):self.invoke(4)
                self.assertFalse(self.w.children)
                refused=self.b.helper_timing_report()['records'][0]
                self.assertEqual(refused['verifierAdmission']['status'],'REFUSED_BEFORE_ADMISSION')
                self.assertNotIn('slotAcquiredMonotonicNs',refused)
                self.b.stop_event.set()
                for job in jobs:
                    with self.assertRaisesRegex(RuntimeError,'canceled'):job.result(2)
        finally:self.b.verifier_admission.release(ticket,hold,no_live_original_child=True)
    def test_driver_passes_the_exact_same_original_origin_and_deadline(self):
        self.b.configure_serial_verifier();plan=dict(windowNs=5_000_000_000,tailNs=30_000_000_000)
        staged=SimpleNamespace(run=mock.Mock(return_value={'CONTROL':True}));journal=SimpleNamespace(emit=lambda _:None);monitor=SimpleNamespace(check=lambda:None)
        out=d.run_load_window(plan,self.b,journal,monitor,self.b.stop_event,staged_scheduler=staged)
        self.assertEqual(out,{'CONTROL':True});origin=staged.run.call_args.kwargs['origin']
        self.assertEqual(self.b.verifier_admission.origin,origin)
        self.assertEqual(self.b.stop_event.ynx_verifier_admission_deadline_ns,origin+35_000_000_000)
        with self.assertRaisesRegex(RuntimeError,'finite staged clock'):
            d.run_load_window(plan,self.b,journal,monitor,self.b.stop_event,staged_scheduler=staged,durable_accounting=object())
    def test_options_and_comparison_conditions_cannot_silently_mix_arms(self):
        args=SimpleNamespace(mode='online',rate=100,accounts=500,per_account=1,seconds=5,tail_seconds=30,proof_timeout=30,
            first_trial_profile=d.HELD_TRIAL_PROFILE,commit=d.HELD_TRIAL_SOURCE,sender_backend='public-owner',
            staged_publication=True,initialize_before_load=True,startup_timings=True,wire_observation=True,
            commit_observation=True,network_accounting=True,owned_storage_accounting=True,header_hop_capture=False)
        original=d.load_conditions(args);self.assertNotIn('serialVerifierAdmission',original)
        args.serial_verifier=True;self.assertEqual(d.validate_options(args),500)
        self.assertNotEqual(d.load_conditions(args),original)
        for name,value in [('serial_verifier',1),('durable_accounting',True),('held_ready_only',True)]:
            changed=copy.copy(args);setattr(changed,name,value)
            with self.assertRaisesRegex(RuntimeError,'serial verifier'):d.validate_options(changed)
    def test_original_window_guard_crossing_cutoff_never_calls_popen(self):
        self.enable(.03)
        window=object.__new__(d.lab.Window)
        window.lock=threading.RLock();window.launch_lock=threading.Lock();window.children=[]
        window.closed_for_launch=False;window.launches_closed=False;window.launch_cleanup_debt=[]
        window.sample=lambda:time.sleep(.06)
        self.b.w=window
        with mock.patch.object(d.lab.subprocess,'Popen') as child:
            with self.assertRaisesRegex(RuntimeError,'admission deadline elapsed'):self.invoke(0)
        child.assert_not_called();self.assertEqual(self.b.verifier_admission.report()['active'],0)
    def test_original_live_proof_caller_binds_the_same_operation_and_keeps_normal_verifier(self):
        self.enable();lane=dict(node=0,pin='a'*64,policy=self.root/'policy.json',sequence=0,retired=False)
        self.b.queue=__import__('queue').Queue();self.b.queue.put(lane)
        self.b.live_materials_command=mock.Mock()
        self.b.wait_live_capture=mock.Mock()
        tx=dict(abciHash='1'*64,nativeHash='2'*64)
        request=self.root/'request';trust=self.root/'context'
        descriptors={key:dict(path=key,sha256='a'*64) for key in ('materials','proof','checkpoint','request','context')}
        context=dict(request=descriptors['request'],context=descriptors['context'],
            verifierArguments=['--trust-context',str(trust),'--trust-context-sha256','a'*64])
        result=dict(version='YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1',outcome='verified_transaction_data',
            policySHA256=lane['pin'],sequence='1',owningNodeIndex=0,sourceKind='original-node-owning-stores',
            syntheticOnly=True,sourceReadOnly=True,authorityGranted=False,fourNodeAgreementClaim=False,
            transactionHash=tx['abciHash'],nativeWireHash=tx['nativeHash'],verified=context,
            **{key:descriptors[key] for key in ('materials','proof','checkpoint')})
        self.b.live_materials_command.side_effect=[None,result]
        info=self.control.stat();self.c.verifier_binary_identity=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)
        self.c.verifier_binary_pin='f'*64;self.c.proof_timeout=30
        row=dict(index=0,id=identity(0)['logicalId'],operationId=identity(0)['operationId'])
        def original_file(directory,descriptor):return trust if descriptor is descriptors['context'] else request
        with mock.patch.object(d.normal,'public_file',side_effect=original_file), \
             mock.patch.object(d.proof_readback,'export_original_public_proof',return_value={'CONTROL':True}), \
             mock.patch.object(d.normal,'require_verified') as verifier_check, \
             mock.patch.object(self.b,'helper',return_value={'CONTROL_ONLY':True}) as helper:
            self.b.live_proof(row,tx,self.root/'tx',self.root,lambda _:None,self.b.stop_event)
        self.assertEqual(helper.call_args.kwargs['original_verifier'],identity(0))
        self.assertEqual(helper.call_args.args[1],[str(self.control),*context['verifierArguments']])
        self.assertIs(helper.call_args.args[2],request);verifier_check.assert_called_once_with({'CONTROL_ONLY':True},tx)
    def test_actual_finite_driver_scheduler_preserves_all_pending_control_operations(self):
        controls=module('test_pq_staged_independent_scheduler.py');structural=controls.StructuralBackend()
        plan=controls.plan(count=4,accounts=4,tail_ns=800_000_000)
        self.b.configure_serial_verifier();self.b.publish=structural.publish;self.b.observe=structural.observe
        self.b.stop=structural.stop
        (self.root/'release').touch()
        def final(handle,notify,stop):
            row=handle.row;notify(dict(kind='normal_stage',stage='verifier'))
            self.b.helper('load-%05d-normal-verifier'%row['index'],
                [str(self.control),str(self.root/('ready-'+str(row['index']))),str(self.root/'release')],
                original_verifier=dict(index=row['index'],logicalId=row['id'],operationId=row['operationId']))
            raise RuntimeError('CONTROL child is not a normal proof: preserve original UNKNOWN')
        self.b.finalize=final;events=[]
        result=d.run_load_window(plan,self.b,SimpleNamespace(emit=events.append),SimpleNamespace(check=lambda:None),
                                 self.b.stop_event,staged_scheduler=controls.staged)
        self.assertEqual((result['configuredDemand'],result['qualified'],result['notQualified']),(4,0,4))
        self.assertEqual(result['terminalCounts']['unknown'],4)
        self.assertIsNone(result['endToEndLogicalArrivalToQualified']['p95Ms'])
        self.assertEqual(int(result['originMonotonicNs']),self.b.verifier_admission.origin)
        self.assertLessEqual(result['observationCutoffNs'],plan['windowNs']+plan['tailNs'])
        self.assertEqual(self.b.verifier_admission.report()['released'],4)
        self.assertTrue(all(row['process'].returncode==0 for row in self.w.children))
    def test_earlier_resource_cutoff_keeps_late_structural_reply_unknown(self):
        controls=module('test_pq_staged_independent_scheduler.py');structural=controls.StructuralBackend()
        plan=controls.plan(count=1,accounts=1,tail_ns=800_000_000)
        self.b.configure_serial_verifier();self.b.publish=structural.publish;self.b.observe=structural.observe
        def finish():
            structural.stop();(self.root/'release').touch()
        self.b.stop=finish
        def final(handle,notify,stop):
            row=handle.row
            self.b.helper('load-%05d-normal-verifier'%row['index'],
                [str(self.control),str(self.root/'ready-0'),str(self.root/'release')],
                original_verifier=dict(index=row['index'],logicalId=row['id'],operationId=row['operationId']))
            # Reuse the original structural ledger callback solely to test
            # censoring. Neither this script nor callback verifies any proof.
            structural.finalize(handle,notify,stop)
        self.b.finalize=final
        def resource_check():
            if (self.root/'ready-0').exists():raise helpers.OriginalWaitFailure('UNIT earlier original resource failure')
        result=d.run_load_window(plan,self.b,SimpleNamespace(emit=lambda _:None),SimpleNamespace(check=resource_check),
                                 self.b.stop_event,staged_scheduler=controls.staged)
        self.assertEqual(result['firstCause'],'UNIT earlier original resource failure')
        self.assertLess(result['observationCutoffNs'],plan['windowNs']+plan['tailNs'])
        self.assertEqual((result['qualified'],result['terminalCounts']['unknown']),(0,1))
        self.assertIsNone(result['endToEndLogicalArrivalToQualified']['p95Ms'])
        late=[r for r in result['pipeline']['lateEvidence'] if r['kind']=='qualified']
        self.assertEqual(len(late),1);self.assertGreaterEqual(late[0]['atNs'],result['observationCutoffNs'])
        self.assertEqual(self.b.verifier_admission.report()['released'],1)
        self.assertEqual(result['pipeline']['retainedUnfinishedHandles'][0]['operationId'],structural.handles[0].row['operationId'])
        receipt=self.b.verifier_admission.report(result)
        self.assertEqual(receipt['actualObservationCutoffMonotonicNs'],int(result['originMonotonicNs'])+result['observationCutoffNs'])
        self.assertLess(receipt['actualObservationCutoffMonotonicNs'],receipt['plannedObservationDeadlineMonotonicNs'])
        for wrong in ({},dict(result,originMonotonicNs='1'),dict(result,observationCutoffNs=True)):
            self.assertIsNone(self.b.verifier_admission.report(wrong)['actualObservationCutoffMonotonicNs'])
    @unittest.skipUnless(sys.platform=='linux','actual Linux original Window affinity/proc controls required')
    def test_real_linux_original_window_keeps_one_verifier_and_its_deadline(self):
        private=self.root/'.private';private.mkdir()
        window=d.lab.Window(Path(__file__).resolve().parents[2],self.root)
        ceremony=SimpleNamespace(w=window,bins=self.c.bins,live=[{} for _ in range(4)],mode='pre-signed',workload={'transactions':[]})
        self.b=d.NormalBackend(ceremony,[],threading.Event());self.w=window;self.enable(5)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                first=pool.submit(self.invoke,0);self.wait_for(lambda:(self.root/'ready-0').exists())
                second=pool.submit(self.invoke,1);self.wait_for(lambda:self.b.verifier_admission.report()['queued']==1)
                self.assertEqual(len(window.children),1);window.sample()
                (self.root/'release').touch();first.result(4);second.result(4)
            self.assertEqual([r['process'].returncode for r in window.children],[0,0])
            self.assertEqual(self.b.verifier_admission.report()['released'],2)
        finally:
            (self.root/'release').touch(exist_ok=True)
            self.assertTrue(window.stop())


if __name__=='__main__':unittest.main()
