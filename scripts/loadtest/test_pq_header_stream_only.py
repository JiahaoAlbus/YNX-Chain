"""Original synthetic stream-only flags and stopped-read controls; no node or signer."""
import copy
import hashlib
import importlib.util
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('original_header_stream_driver_controls',Path(__file__).with_name('test_pq_synthetic_header_driver_data.py'))
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)

d=original.driver

class StreamOnlyControls(unittest.TestCase):
    def window(self,root):
        window,descriptors=original.StoppedHeaderDriverDataControls().setup_window(root)
        info=window.work.stat();pid=os.getpid()
        window.lock=threading.RLock();window.closed_for_launch=True;window.launches_closed=True
        window.pending_launches={};window.launch_cleanup_debt=[];window.launch_cleanup_failure=None
        window.known={pid:123};window.storage_roots=[window.work];window.started=time.monotonic()
        window._header_storage_identities={str(window.work):(info.st_dev,info.st_ino)}
        return window,descriptors

    def resources(self):
        from contextlib import ExitStack
        stack=ExitStack();pid=os.getpid()
        stack.enter_context(mock.patch.object(d.header_stopped_scope.sys,'platform','linux'))
        stack.enter_context(mock.patch.object(d.lab.guard,'proc_inventory',return_value=({pid:dict(startTicks=123)},None)))
        stack.enter_context(mock.patch.object(d.lab.guard,'owned_set',return_value=[pid]))
        stack.enter_context(mock.patch.object(d.lab,'owned_rss',return_value=1024))
        stack.enter_context(mock.patch.object(d.lab,'private_bytes',return_value=4096))
        stack.enter_context(mock.patch.object(d.header_stopped_scope.shutil,'disk_usage',return_value=SimpleNamespace(free=20<<30)))
        return stack

    def test_default_source_gate_and_legacy_observers_refuse_before_window(self):
        args=SimpleNamespace(first_trial_profile=d.HELD_TRIAL_PROFILE,staged_publication=True,header_stream_only_data=True,
            header_stream_data=False,commit_observation=False,commit_clock_observation=False,commit_validation_observation=False,
            commit=d.SYNTHETIC_HEADER_STREAM_ONLY_ABI_SOURCE)
        self.assertIsNone(d.SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS)
        with mock.patch.object(d.lab,'Window') as window,self.assertRaisesRegex(RuntimeError,'stream-only DATA source/CI'):
            d.validate_options(args)
        window.assert_not_called()
        with mock.patch.object(d,'SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS',dict(d.SYNTHETIC_HEADER_STREAM_ONLY_ABI_SOURCES)):
            for field in ('header_stream_data','commit_observation','commit_clock_observation','commit_validation_observation'):
                bad=copy.copy(args);setattr(bad,field,True)
                with self.subTest(field=field),self.assertRaises(RuntimeError):d.validate_options(bad)
            args.mode='online';args.rate=100;args.seconds=5;args.accounts=500;args.per_account=1
            args.tail_seconds=30;args.proof_timeout=30;args.sender_backend='public-owner';args.initialize_before_load=True
            args.startup_timings=True;args.wire_observation=True;args.network_accounting=True;args.owned_storage_accounting=True
            with mock.patch.object(d,'select_held_source',return_value=SimpleNamespace(SOURCE=args.commit)):
                self.assertEqual(d.validate_options(args),500) # CONTROL gate only; no runtime or source grant.

    def test_actual_activation_emits_four_distinct_stream_only_flags(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve();(root/'.private').mkdir();nodes=[];policies=[]
            for node in range(4):
                p=root/('policy-%d'%node);p.write_bytes(('synthetic-%d'%node).encode());policies.append(p);nodes.append(dict(index=node,args=['original-%d'%node]))
            owner=d.LoadCeremony.__new__(d.LoadCeremony);owner.w=SimpleNamespace(work=root);owner.root=root
            owner.operations=4;owner.proof_timeout=30;owner.pin='1'*64;owner.activation_pin='2'*64
            owner.measurements=SimpleNamespace(record=lambda *args:None);owner.live=[];owner.header_stream_only_data_enabled=True
            owner.header_stream_data_enabled=True;owner.header_stream_descriptors=[];owner.commit_observation_enabled=False
            def setup(name,args):
                node=int(name.rsplit('-',1)[1]);p=policies[node];digest=hashlib.sha256(p.read_bytes()).hexdigest()
                return dict(version='YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1',syntheticOnly=True,nodeStarted=False,authorityGranted=False,
                    policy=dict(path=str(p),sha256=digest),nodeArguments=[*nodes[node]['args'],'--proof-host-live-policy',str(p),'--proof-host-live-policy-sha256',digest])
            owner.call=setup;out=owner.activation_startup(dict(nodes=copy.deepcopy(nodes)))
            for node in out['nodes']:
                argv=node['args'];self.assertEqual(argv.count('--synthetic-commit-header-stream-only'),1)
                self.assertEqual(argv.count('--commit-observation-scope'),1);self.assertEqual(argv.count('--commit-header-stream-output'),1)
                self.assertFalse(any(x in argv for x in ('--commit-observation-output','--commit-monotonic-output','--commit-validation-observation','--finalize-observation-output')))
            self.assertEqual(len({item['path'] for item in owner.header_stream_descriptors}),4)

    def test_each_stream_abi_source_is_exact_and_still_requires_frozen_gate(self):
        identities={
            'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('a2348dc67ee627fcfc3021c513315acd7b9abc7b','aadf0831c6b65559065ca82228bab30811d36c67'),
            'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('7f70fd791e1706ad151b2e3d6e68a16c586650aa','5a128880d14bfc73de4334cba23218859ad3473c')}
        self.assertEqual(d.SYNTHETIC_HEADER_STREAM_ONLY_ABI_SOURCES,identities);self.assertIsNone(d.SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS)
        for commit in identities:
            args=SimpleNamespace(first_trial_profile=d.HELD_TRIAL_PROFILE,staged_publication=True,header_stream_only_data=True,
                header_stream_data=False,commit_observation=False,commit_clock_observation=False,commit_validation_observation=False,commit=commit)
            with self.subTest(commit=commit),self.assertRaisesRegex(RuntimeError,'stream-only DATA source/CI'):
                d.validate_options(args)
            with mock.patch.object(d,'SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS',{commit:identities[commit]}):
                self.assertTrue(d.stream_only_source_allowed(commit)) # CONTROL only; held gate remains independent.
                other=next(source for source in identities if source!=commit)
                self.assertFalse(d.stream_only_source_allowed(other))
            with mock.patch.object(d,'SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS',{commit:identities[next(source for source in identities if source!=commit)]}):
                self.assertFalse(d.stream_only_source_allowed(commit))

    def test_actual_driver_rejects_swapped_original_tree_and_fork_before_window(self):
        identities=d.SYNTHETIC_HEADER_STREAM_ONLY_ABI_SOURCES
        for source,(tree,fork) in identities.items():
            args=SimpleNamespace(first_trial_profile=d.HELD_TRIAL_PROFILE,staged_publication=True,header_stream_only_data=True,
                header_stream_data=False,commit_observation=False,commit_clock_observation=False,commit_validation_observation=False,
                commit=source,mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,
                sender_backend='public-owner',initialize_before_load=True,startup_timings=True,wire_observation=True,
                network_accounting=True,owned_storage_accounting=True,source='/CONTROL-not-read',execute=False)
            other=next(value for key,value in identities.items() if key!=source)
            with mock.patch.object(d,'SYNTHETIC_HEADER_STREAM_ONLY_BINDINGS',dict(identities)), \
                 mock.patch.object(d,'STARTUP_TIMING_ABI_SOURCES',d.STARTUP_TIMING_ABI_SOURCES|{source}), \
                 mock.patch.object(d,'select_held_source',return_value=SimpleNamespace(SOURCE=source,TREE=tree)), \
                 mock.patch.object(d,'sender_backend_kind',return_value='public-owner'), \
                 mock.patch.object(d.lab,'Window') as window:
                for wrong_tree,wrong_fork in ((other[0],fork),(tree,other[1])):
                    with self.subTest(source=source,wrong_tree=wrong_tree,wrong_fork=wrong_fork), \
                         mock.patch.object(d.lab,'check_source',return_value=dict(commit=source,tree=wrong_tree,forkTree=wrong_fork)), \
                         self.assertRaisesRegex(RuntimeError,'source tree|source tree/fork'):
                        d.run(args)
                window.assert_not_called()

    def test_actual_stopped_reader_uses_sampled_scope_and_keeps_data_only(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);ceremony=SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors)
            result=dict(firstCause=None,cleanupComplete=True)
            with self.resources():d.finish_synthetic_header_data(result,window,ceremony)
            self.assertEqual(result['syntheticHeaderStreamData']['status'],'OBSERVED_DATA')
            self.assertEqual(result['syntheticHeaderReadResources']['status'],'OBSERVED')
            self.assertTrue(result['syntheticHeaderReadResources']['monitorRetired'])
            self.assertFalse(result['syntheticHeaderReadResources']['continuousRSSLimitProven'])
            self.assertFalse(result['syntheticHeaderStreamData']['runtimeAuthorized'] or result['syntheticHeaderStreamData']['independentFinality'])
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.0,0.0))

    def test_unretired_child_or_changed_root_never_reads_original(self):
        for failure in ('child','root'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as t:
                window,descriptors=self.window(t)
                if failure=='child':window.children[0]['process'].returncode=None
                else:window._header_storage_identities[str(window.work)]=(0,0)
                result=dict(firstCause=None,cleanupComplete=True)
                with self.resources(),mock.patch.object(d.header_data.reader,'_read_private_pair',side_effect=AssertionError('no original read')) as reader:
                    d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
                reader.assert_not_called();self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED');self.assertIsNotNone(result['firstCause'])

    def test_resource_error_prevents_read_and_preserves_original_cause(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);result=dict(firstCause=None,cleanupComplete=True)
            with self.resources(),mock.patch.object(d.lab,'owned_rss',side_effect=OSError('CONTROL original RSS')),mock.patch.object(d.header_data.reader,'_read_private_pair') as reader:
                d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
            reader.assert_not_called();self.assertEqual(result['firstCause'],'CONTROL original RSS');self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED')

    def test_reader_failure_keeps_prior_cause_and_scope_resource_status(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);Path(descriptors[0]['path']).write_bytes(b'invalid\n')
            result=dict(firstCause='CONTROL prior cause',cleanupComplete=True)
            with self.resources():d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
            self.assertEqual(result['firstCause'],'CONTROL prior cause');self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED')
            self.assertEqual(result['syntheticHeaderReadResources']['status'],'OBSERVED')

    def test_original_scope_close_error_is_sticky_and_never_recloses_reused_fd(self):
        with tempfile.TemporaryDirectory() as t:
            window,_=self.window(t);original_close=os.close;sentinel=os.open('/dev/null',os.O_RDONLY);closed=[];reused=[]
            try:
                with self.resources():
                    scope=d.header_stopped_scope.StoppedReadScope(window,lab=d.lab,monitor_factory=d.Monitor);scope.start();fd=scope.roots[0][1]
                    def close(target):
                        if target==fd:
                            closed.append(target);original_close(target);os.dup2(sentinel,target);reused.append(target);raise OSError('CONTROL close UNKNOWN')
                        return original_close(target)
                    with mock.patch.object(d.header_stopped_scope.os,'close',side_effect=close):scope.close();scope.close()
                    self.assertTrue(scope.report()['cleanupDebt']);self.assertEqual(len(closed),1);os.fstat(reused[0])
                    self.assertEqual(scope.unknown_roots[0][1],fd);self.assertIsNotNone(scope.unknown_roots[0][2])
                    self.assertIn(scope,d.header_stopped_scope._READ_SCOPE_DEBT)
            finally:
                if reused:original_close(reused[0])
                original_close(sentinel)
                if 'scope' in locals() and scope in d.header_stopped_scope._READ_SCOPE_DEBT:d.header_stopped_scope._READ_SCOPE_DEBT.remove(scope)

    def test_scope_report_error_keeps_original_cause_and_retains_unknown(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);result=dict(firstCause='CONTROL original cause',cleanupComplete=True)
            before=list(d.header_stopped_scope._READ_SCOPE_DEBT)
            try:
                with self.resources(),mock.patch.object(d.header_stopped_scope.StoppedReadScope,'report',side_effect=OSError('CONTROL report')):
                    d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
                self.assertEqual(result['firstCause'],'CONTROL original cause');self.assertFalse(result['cleanupComplete'])
                self.assertEqual(result['syntheticHeaderReadResources']['status'],'UNKNOWN')
                self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED')
                self.assertEqual(len(d.header_stopped_scope._READ_SCOPE_DEBT),len(before)+1)
            finally:
                # CONTROL closed real roots and joined its monitor before the injected report failure.
                for item in list(d.header_stopped_scope._READ_SCOPE_DEBT):
                    if item not in before:d.header_stopped_scope._READ_SCOPE_DEBT.remove(item)

    def test_scope_join_exception_retains_real_original_fd_without_reclose(self):
        with tempfile.TemporaryDirectory() as t:
            window,_=self.window(t);scope=None;original_join=threading.Thread.join
            try:
                with self.resources():
                    scope=d.header_stopped_scope.StoppedReadScope(window,lab=d.lab,monitor_factory=d.Monitor);scope.start()
                    fd=scope.roots[0][1];monitor_thread=scope.monitor.thread
                    def fail_join(thread,*args,**kwargs):
                        if thread is monitor_thread:raise OSError('CONTROL original join UNKNOWN')
                        return original_join(thread,*args,**kwargs)
                    with mock.patch.object(threading.Thread,'join',fail_join):scope.close();scope.close()
                    self.assertTrue(scope.cleanup_debt);self.assertFalse(scope.observer_retired);self.assertEqual(scope.roots[0][1],fd)
                    os.fstat(fd);self.assertIn(scope,d.header_stopped_scope._READ_SCOPE_DEBT)
            finally:
                if scope is not None and scope.monitor is not None:
                    scope.monitor.finished.set();original_join(scope.monitor.thread,2)
                    self.assertFalse(scope.monitor.thread.is_alive())
                    for _,fd,_ in scope.roots:os.close(fd)
                    scope.roots=[] # CONTROL independently established thread exit before FD close.
                    if scope in d.header_stopped_scope._READ_SCOPE_DEBT:d.header_stopped_scope._READ_SCOPE_DEBT.remove(scope)

    def test_real_alarm_interrupts_original_reader_and_never_reads_next_node(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);target=Path(descriptors[0]['path']).stat();entered=[];closed=[]
            original_read=os.read;original_close=os.close;original_pair=d.header_data.reader._read_private_pair
            def slow_read(fd,size):
                info=os.fstat(fd)
                if threading.current_thread() is threading.main_thread() and (info.st_dev,info.st_ino)==(target.st_dev,target.st_ino):
                    entered.append(fd);time.sleep(.8)
                return original_read(fd,size)
            def close(fd):
                info=os.fstat(fd)
                if entered and fd==entered[0] and (info.st_dev,info.st_ino)==(target.st_dev,target.st_ino):closed.append(fd)
                return original_close(fd)
            result=dict(firstCause=None,cleanupComplete=True)
            with self.resources(),mock.patch.object(d.header_stopped_scope.StoppedReadScope,'SECONDS',.15), \
                 mock.patch.object(d.header_data.reader.os,'read',side_effect=slow_read), \
                 mock.patch.object(d.header_data.reader.os,'close',side_effect=close), \
                 mock.patch.object(d.header_data.reader,'_read_private_pair',wraps=original_pair) as reader:
                d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
            self.assertEqual(reader.call_count,1);self.assertEqual(len(entered),1);self.assertEqual(closed,entered)
            self.assertEqual(result['firstCauseErrorType'],'StoppedHeaderDeadline');self.assertEqual(result['syntheticHeaderStreamData']['status'],'NOT_SUPPLIED')
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.0,0.0))

    def test_real_alarm_plus_close_error_keeps_timeout_and_sticky_fd_debt(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);target=Path(descriptors[0]['path']).stat();entered=[];closed=[]
            original_read=os.read;original_close=os.close;original_pair=d.header_data.reader._read_private_pair
            before=list(d.header_data.reader._READBACK_CLOSE_CUSTODY)
            def slow_read(fd,size):
                info=os.fstat(fd)
                if threading.current_thread() is threading.main_thread() and (info.st_dev,info.st_ino)==(target.st_dev,target.st_ino):
                    entered.append(fd);time.sleep(.8)
                return original_read(fd,size)
            def close(fd):
                info=os.fstat(fd)
                if entered and fd==entered[0] and (info.st_dev,info.st_ino)==(target.st_dev,target.st_ino):
                    closed.append(fd);original_close(fd);raise OSError('CONTROL original close UNKNOWN')
                return original_close(fd)
            result=dict(firstCause=None,cleanupComplete=True)
            try:
                with self.resources(),mock.patch.object(d.header_stopped_scope.StoppedReadScope,'SECONDS',.15), \
                     mock.patch.object(d.header_data.reader.os,'read',side_effect=slow_read), \
                     mock.patch.object(d.header_data.reader.os,'close',side_effect=close), \
                     mock.patch.object(d.header_data.reader,'_read_private_pair',wraps=original_pair) as reader:
                    d.finish_synthetic_header_data(result,window,SimpleNamespace(header_stream_only_data_enabled=True,header_stream_descriptors=descriptors))
                self.assertEqual(reader.call_count,1);self.assertEqual(closed,entered);self.assertFalse(result['cleanupComplete'])
                self.assertEqual(result['firstCauseErrorType'],'StoppedHeaderDeadline');self.assertTrue(result['syntheticHeaderStreamData']['readbackCleanupDebt'])
                self.assertEqual(len(d.header_data.reader._READBACK_CLOSE_CUSTODY),len(before)+1)
            finally:
                # CONTROL hook physically closed the original leaf before raising.
                for item in list(d.header_data.reader._READBACK_CLOSE_CUSTODY):
                    if item not in before:d.header_data.reader._READBACK_CLOSE_CUSTODY.remove(item)

    def test_legacy_ordinary_timeout_remains_per_node_unknown_and_continues(self):
        with tempfile.TemporaryDirectory() as t:
            window,descriptors=self.window(t);original_pair=d.header_data.reader._read_private_pair;calls=[]
            def first_timeout(path,receipt):
                calls.append(path)
                if len(calls)==1:raise TimeoutError('CONTROL ordinary timeout')
                return original_pair(path,receipt)
            with mock.patch.object(d.header_data.reader,'_read_private_pair',side_effect=first_timeout):
                result=d.header_data.retain_after_stop(window,descriptors,True)
            self.assertEqual(len(calls),4);self.assertEqual(result['status'],'NOT_SUPPLIED')
            self.assertEqual(result['errors'][0]['errorType'],'TimeoutError');self.assertEqual([node['node'] for node in result['nodes']],[1,2,3])

    @unittest.skipUnless(__import__('sys').platform=='linux','original Linux procfs scope required')
    def test_real_linux_supervisor_rss_scope_without_descendant(self):
        with tempfile.TemporaryDirectory() as t:
            window,_=self.window(t);rows,_=d.lab.guard.proc_inventory();window.known={os.getpid():rows[os.getpid()]['startTicks']}
            scope=d.header_stopped_scope.StoppedReadScope(window,lab=d.lab,monitor_factory=d.Monitor)
            try:scope.start();scope.check(final=True)
            finally:scope.close()
            self.assertEqual(scope.report()['status'],'OBSERVED');self.assertTrue(scope.report()['monitorRetired'])

def portable_suite():
    names=[name for name in unittest.defaultTestLoader.getTestCaseNames(StreamOnlyControls)
           if name!='test_real_linux_supervisor_rss_scope_without_descendant']
    return unittest.TestSuite(StreamOnlyControls(name) for name in names)

if __name__=='__main__':unittest.main()
