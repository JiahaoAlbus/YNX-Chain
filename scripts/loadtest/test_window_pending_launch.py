"""Bounded original Window launch races; synthetic processes, no nodes or load."""
import importlib.util
import os
import sys
from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


resource=module('test_resource_guard_sampling.py')
driver=module('pq-independent-load.py')
lab=resource.lab


class Process:
    def __init__(self):self.pid=987654;self.returncode=None
    def poll(self):return self.returncode
    def terminate(self):self.returncode=-15
    def kill(self):self.returncode=-9
    def wait(self,timeout=None):
        if self.returncode is None:raise lab.subprocess.TimeoutExpired('synthetic child',timeout)
        return self.returncode


class PendingLaunchControls(unittest.TestCase):
    def test_previously_reaped_anchored_child_does_not_resignal_numeric_pid(self):
        original=Process();original.returncode=-9
        lab.bind_process_lifecycle(original)
        original._ynx_original_pidfd_required=True
        original._ynx_original_pidfd=SimpleNamespace(send=mock.Mock(side_effect=ProcessLookupError('reaped')))
        self.window.children.append(dict(name='load-original',process=original,startTicks=20,persistent=False))
        with mock.patch.object(lab.os,'killpg',side_effect=AssertionError('numeric fallback forbidden')):
            self.assertTrue(self.window.stop())
        original._ynx_original_pidfd.send.assert_not_called()

    def test_failed_pidfd_binding_never_falls_back_during_stop_cleanup(self):
        original=Process();lab.bind_process_lifecycle(original)
        original._ynx_original_pidfd_required=True
        self.window.children.append(dict(name='load-original',process=original,startTicks=20,persistent=False))
        with mock.patch.object(self.window,'_stop',side_effect=RuntimeError('original stop failure')), \
             mock.patch.object(lab.os,'killpg',side_effect=AssertionError('numeric group signal forbidden')), \
             mock.patch.object(original,'kill',side_effect=AssertionError('numeric child signal forbidden')):
            with self.assertRaisesRegex(RuntimeError,'original stop failure'):self.window.stop()
        self.assertTrue(self.window.launch_cleanup_debt)
        self.assertIn('errors',self.window.direct_cleanup_after_failure[-1])

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.window=resource.ResourceGuardSamplingControls().window(Path(self.temp.name))
        self.stop=threading.Event();self.child=Process();self.created=threading.Event();self.release=threading.Event()
        self.results=[];self.errors=[];self.sampling_errors=[]
        self.child_rss=lab.CAPS['rssBytes']
        self.monitor=driver.Monitor(self.window,self.stop);self.addCleanup(self.monitor.close)
        self.patches=[]
        def patch(target,name,**kwargs):
            p=mock.patch.object(target,name,**kwargs);self.patches.append(p);return p.start()
        patch(lab.guard,'proc_inventory',side_effect=self.inventory)
        patch(lab.guard,'bounded',return_value=b'CONTROL')
        patch(lab.guard,'parse_stat',return_value={'startTicks':20})
        self.popen=patch(lab.subprocess,'Popen',side_effect=self.blocked_popen)
        patch(lab,'owned_rss',side_effect=self.rss)
        patch(lab.shutil,'disk_usage',return_value=SimpleNamespace(free=16<<30))
        patch(lab.os,'killpg',side_effect=lambda pid,sig:self.child.terminate())
        self.addCleanup(self.retire)
    def inventory(self):
        rows={os.getpid():dict(pid=os.getpid(),parent=1,startTicks=10,state='S')}
        if self.created.is_set() and self.child.poll() is None:
            rows[self.child.pid]=dict(pid=self.child.pid,parent=os.getpid(),startTicks=20,state='S')
        return rows,[]
    def rss(self,pid,*args):return 1 if pid==os.getpid() else self.child_rss
    def blocked_popen(self,*args,**kwargs):
        self.created.set()
        if not self.release.wait(2):raise RuntimeError('control barrier not released')
        return self.child
    def launch(self):
        try:self.results.append(self.window.launch('load-control',['CONTROL'],thread_safe=True,stop=self.stop))
        except BaseException as e:self.errors.append(e)
    def sample(self):
        try:self.window.sample()
        except BaseException as e:self.sampling_errors.append(e)
    def retire(self):
        self.release.set()
        for name in ('launcher','sampler','stopper','second_launcher'):
            thread=getattr(self,name,None)
            if thread is not None:thread.join(3)
        self.child.returncode=-15
        for _,log in self.window.logs:
            if not log.closed:log.close()
        for p in reversed(self.patches):p.stop()
    def test_unregistered_child_rss_is_checked_while_popen_has_not_returned(self):
        self.launcher=threading.Thread(target=self.launch,name='blocked-original-launch');self.launcher.start()
        self.assertTrue(self.created.wait(1),repr(self.errors))
        self.sampler=threading.Thread(target=self.sample,name='concurrent-original-resource-sample');self.sampler.start();self.sampler.join(.4)
        self.assertFalse(self.sampler.is_alive(),'Popen blocked the original resource sampler')
        self.assertTrue(self.stop.is_set())
        self.assertEqual(str(self.sampling_errors[0]),'owned RSS exceeded 4GiB')
        self.assertEqual(self.window.peak_rss,lab.CAPS['rssBytes']+1)
        self.release.set();self.launcher.join(1)
        self.assertFalse(self.launcher.is_alive());self.assertFalse(self.results)
        self.assertIsNotNone(self.child.poll())
        self.assertEqual(len(self.window.children),1)
        with self.assertRaisesRegex(RuntimeError,'owned RSS exceeded 4GiB'):self.monitor.check()

    def start_pending(self):
        self.launcher=threading.Thread(target=self.launch,name='blocked-original-launch');self.launcher.start()
        self.assertTrue(self.created.wait(1),repr(self.errors))

    def test_healthy_sampling_keeps_discovering_pending_child_and_original_identity(self):
        self.child_rss=17;self.start_pending()
        self.sampler=threading.Thread(target=self.sample);self.sampler.start();self.sampler.join(.4)
        self.assertFalse(self.sampler.is_alive());self.assertFalse(self.sampling_errors)
        self.assertEqual(self.window.known[self.child.pid],20)
        self.assertEqual(self.window.peak_rss,18)
        self.assertEqual(self.window.peak_rss_sample['processes'][-1]['name'],'owned-descendant')
        self.release.set();self.launcher.join(1)
        self.assertEqual(self.results,[self.child]);self.assertFalse(self.window.pending_launches)

    def test_stop_closes_admission_and_reaps_child_returning_from_original_popen(self):
        self.child_rss=1;self.start_pending();stopped=[];errors=[]
        def stop():
            try:stopped.append(self.window.stop())
            except BaseException as e:errors.append(e)
        self.stopper=threading.Thread(target=stop);self.stopper.start()
        deadline=time.monotonic()+1
        while not self.window.launches_closed and time.monotonic()<deadline:time.sleep(.001)
        self.assertTrue(self.window.launches_closed)
        self.assertTrue(self.stopper.is_alive(),'cleanup cannot complete with an unresolved constructor')
        self.release.set();self.launcher.join(1);self.stopper.join(1)
        self.assertFalse(self.stopper.is_alive());self.assertFalse(errors);self.assertEqual(stopped,[True])
        self.assertFalse(self.results);self.assertIn('cancelled before publication',str(self.errors[0]))
        self.assertEqual(self.window.children[0]['startTicks'],20);self.assertIsNotNone(self.child.poll())
        self.assertFalse(self.window.pending_launches)

    def test_pending_constructor_at_cleanup_deadline_is_unknown_and_keeps_original_log(self):
        self.child_rss=1;self.start_pending()
        self.window.launch_cleanup_deadline=time.monotonic()+.02
        with self.assertRaisesRegex(RuntimeError,'launch remains pending'):self.window.stop()
        self.assertTrue(self.window.pending_launches);self.assertTrue(self.window.launch_cleanup_debt)
        self.assertFalse(self.window.logs[0][1].closed)
        self.release.set();self.launcher.join(1)
        self.assertFalse(self.results);self.assertIsNotNone(self.child.poll())
        self.assertFalse(self.window.pending_launches);self.assertTrue(self.window.launch_cleanup_debt)
        with self.assertRaisesRegex(RuntimeError,'closed to new launches'):
            self.window.launch('no-successor',['CONTROL'],thread_safe=True)
        self.assertEqual(self.popen.call_count,1)

    def test_constructor_error_is_preserved_without_fake_pid_or_open_log(self):
        original=OSError('original constructor refusal');self.popen.side_effect=original
        self.launch()
        self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
        self.assertFalse(self.window.children);self.assertFalse(self.window.pending_launches)
        self.assertTrue(self.window.logs[0][1].closed)

    def test_post_constructor_identity_error_registers_and_retires_original_handle(self):
        self.child_rss=1;self.release.set();original=PermissionError('original stat denied')
        with mock.patch.object(lab.guard,'parse_stat',side_effect=original):self.launch()
        self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
        self.assertIs(self.window.children[0]['process'],self.child)
        self.assertIsNotNone(self.child.poll());self.assertFalse(self.window.pending_launches)

    def test_live_child_without_start_identity_is_not_published(self):
        self.child_rss=1;self.release.set()
        with mock.patch.object(lab.guard,'bounded',side_effect=FileNotFoundError):self.launch()
        self.assertFalse(self.results);self.assertIn('identity unavailable',str(self.errors[0]))
        self.assertIsNone(self.window.children[0]['startTicks']);self.assertIsNotNone(self.child.poll())

    def test_exited_child_without_proc_stat_keeps_original_exit_semantics(self):
        self.child_rss=1;self.release.set();self.child.returncode=7
        with mock.patch.object(lab.guard,'bounded',side_effect=FileNotFoundError):self.launch()
        self.assertEqual(self.results,[self.child]);self.assertFalse(self.errors)
        self.assertIsNone(self.window.children[0]['startTicks'])
        with self.assertRaisesRegex(RuntimeError,'returnCode=7'):self.window.wait(self.child)

    def test_cleanup_failure_cannot_replace_guard_first_cause_or_drop_pending_debt(self):
        self.start_pending();self.sample()
        original=self.sampling_errors[0]
        self.child.terminate=mock.Mock()
        self.child.wait=mock.Mock(side_effect=RuntimeError('original child wait refused'))
        self.release.set();self.launcher.join(1)
        self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
        self.assertTrue(self.window.pending_launches);self.assertTrue(self.window.launch_cleanup_debt)
        self.assertFalse(self.window.logs[0][1].closed)
        self.assertEqual(self.monitor.failure_snapshot()['originalError'],'owned RSS exceeded 4GiB')

    def test_second_launch_stays_serial_and_stop_blocks_its_constructor(self):
        self.child_rss=1;self.start_pending()
        self.second_launcher=threading.Thread(target=self.launch);self.second_launcher.start()
        self.stop.set();self.release.set();self.launcher.join(1);self.second_launcher.join(1)
        self.assertFalse(self.results);self.assertEqual(self.popen.call_count,1)
        self.assertEqual(len(self.errors),2);self.assertFalse(self.window.pending_launches)

    def test_constructor_failure_survives_secondary_input_close_error(self):
        original=OSError('original exec error');self.popen.side_effect=original
        source=mock.Mock();source.close.side_effect=OSError('secondary close error')
        real_open=open
        def supplied(path,*args,**kwargs):
            return source if path=='CONTROL_INPUT' else real_open(path,*args,**kwargs)
        with mock.patch.object(lab,'open',side_effect=supplied,create=True):
            with self.assertRaises(OSError) as caught:
                self.window.launch('input-error',['CONTROL'],stdin_path='CONTROL_INPUT',thread_safe=True)
        self.assertIs(caught.exception,original);self.assertFalse(self.window.pending_launches)
        self.assertTrue(self.window.launch_cleanup_debt)

    def test_original_constructor_error_survives_log_fstat_failure(self):
        original=OSError('original constructor refusal');self.popen.side_effect=original
        with mock.patch.object(lab.os,'fstat',side_effect=PermissionError('secondary log fstat denied')):
            self.launch()
        self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
        self.assertFalse(self.window.pending_launches);self.assertTrue(self.window.launch_cleanup_debt)
        self.assertEqual(self.window.launch_cleanup_debt[-1]['errorType'],'PermissionError')

    def test_original_constructor_error_survives_log_close_failure(self):
        original=OSError('original constructor refusal');self.popen.side_effect=original
        real_open=open;logs=[]
        def opened(*args,**kwargs):
            stream=real_open(*args,**kwargs);logs.append(stream)
            return SimpleNamespace(name=stream.name,fileno=stream.fileno,closed=False,
                                   close=mock.Mock(side_effect=OSError('secondary log close denied')))
        try:
            with mock.patch.object(lab,'open',side_effect=opened,create=True):self.launch()
            self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
            self.assertTrue(self.window.launch_cleanup_debt)
        finally:
            for (_,proxy),stream in zip(self.window.logs,logs):proxy.close=stream.close

    def test_successful_constructor_cannot_publish_after_input_close_failure(self):
        self.child_rss=1;self.release.set();original=OSError('original input close denied')
        source=mock.Mock();source.close.side_effect=original;real_open=open
        def supplied(path,*args,**kwargs):return source if path=='CONTROL_INPUT' else real_open(path,*args,**kwargs)
        with mock.patch.object(lab,'open',side_effect=supplied,create=True):
            with self.assertRaises(OSError) as caught:
                self.window.launch('input-close',['CONTROL'],stdin_path='CONTROL_INPUT',thread_safe=True)
        self.assertIs(caught.exception,original);self.assertFalse(self.results)
        self.assertIs(self.window.children[0]['process'],self.child)
        self.assertIsNotNone(self.child.poll());self.assertFalse(self.window.pending_launches)

    def test_post_constructor_clock_failure_keeps_registered_original_handle(self):
        self.child_rss=1;original=OSError('original launch clock unavailable')
        failed=threading.Event();clock=lab.time.monotonic_ns
        def popen(*args,**kwargs):self.created.set();failed.set();return self.child
        def now():
            if failed.is_set():raise original
            return clock()
        self.popen.side_effect=popen
        with mock.patch.object(lab.time,'monotonic_ns',side_effect=now):self.launch()
        self.assertEqual(self.errors,[original]);self.assertFalse(self.results)
        self.assertIs(self.window.children[0]['process'],self.child)
        self.assertIsNone(self.window.children[0]['startedNs'])
        self.assertIsNotNone(self.child.poll());self.assertFalse(self.window.pending_launches)

    def test_group_signal_and_window_wait_cannot_reap_the_same_pid_concurrently(self):
        self.child_rss=1;self.release.set()
        enabled=threading.Event();entered=threading.Event();release=threading.Event();reaped=threading.Event()
        signals=[];failures=[];original_poll=self.child.poll
        def poll():
            if enabled.is_set() and threading.current_thread().name=='signal-original':
                entered.set()
                if not release.wait(2):raise RuntimeError('signal barrier expired')
                return None
            if enabled.is_set():reaped.set();self.child.returncode=0
            return original_poll()
        self.child.poll=poll;self.launch();self.assertEqual(self.results,[self.child]);enabled.set()
        def signal_original():
            try:self.window._retire_failed_launch(self.child)
            except BaseException as error:failures.append(error)
        def signal(pid,sig):signals.append((pid,reaped.is_set()));self.child.returncode=-15
        signaler=threading.Thread(target=signal_original,name='signal-original')
        waiter=threading.Thread(target=lambda:self.window.wait(self.child,allow_failure=True))
        with mock.patch.object(lab.os,'killpg',side_effect=signal):
            signaler.start()
            try:
                self.assertTrue(entered.wait(1));waiter.start()
                self.assertFalse(reaped.wait(.15),'Window.wait reaped the original PID between poll and signal')
            finally:release.set();signaler.join(2);waiter.join(2)
        self.assertFalse(failures);self.assertEqual(signals,[(self.child.pid,False)])

    def test_prior_cleanup_debt_blocks_a_later_successful_stop(self):
        self.child_rss=1;self.release.set();self.launch()
        self.window.launch_cleanup_debt.append(dict(name='load-control',errorType='OSError',meaning='original unresolved cleanup'))
        with mock.patch.object(lab.os,'waitpid',side_effect=ChildProcessError):
            with self.assertRaisesRegex(RuntimeError,'cleanup debt'):self.window.stop()


    def test_unmanaged_group_signal_is_refused_before_poll_or_signal(self):
        original=mock.Mock(pid=987123)
        with mock.patch.object(lab.os,'killpg') as kill:
            with self.assertRaisesRegex(RuntimeError,'unmanaged'):
                lab.signal_process_group(original,lab.signal.SIGTERM)
        kill.assert_not_called();original.poll.assert_not_called()

    def test_already_reaped_original_never_signals_reused_numeric_pid(self):
        self.child_rss=1;self.release.set();self.launch();self.child.returncode=0
        with mock.patch.object(lab.os,'killpg') as kill:
            lab.signal_process_group(self.child,lab.signal.SIGTERM)
        kill.assert_not_called()

    def test_receipt_retains_pending_and_debt_as_independent_data(self):
        self.child_rss=1;self.start_pending()
        debt=dict(name='original',errorType='OSError',meaning='unresolved original cleanup')
        self.window.launch_cleanup_debt.append(debt)
        report=self.window.launch_cleanup_report()
        self.assertEqual(report['status'],'UNKNOWN');self.assertFalse(report['cleanupCompleteProven'])
        self.assertIsNone(report['pending'][0]['pid'])
        report['pending'][0]['name']='changed';report['cleanupDebt'][0]['errorType']='changed'
        current=self.window.launch_cleanup_report()
        self.assertEqual(current['pending'][0]['name'],'load-control')
        self.assertEqual(current['cleanupDebt'],[debt])
        self.stop.set();self.release.set();self.launcher.join(1)
        self.assertFalse(self.results)
        with self.assertRaisesRegex(RuntimeError,'closed to new launches'):
            self.window.launch('must-not-retry',['CONTROL'],thread_safe=True)


    def test_original_prepare_network_can_activate_during_expected_node_stop(self):
        normal=driver.normal;ceremony=object.__new__(normal.Ceremony)
        ceremony.w=self.window;ceremony.bins=Path('/SYNTHETIC-BINS');ceremony.root=Path(self.temp.name)
        ceremony.plan={'initialHeight':1};ceremony.pin='synthetic-plan';ceremony.nodes=[]
        ceremony.quiet=mock.Mock(side_effect=[{'height':1} for _ in range(10)]+[{'height':7}])
        ceremony.start=mock.Mock(side_effect=lambda *args:setattr(self.window,'stopping',False))
        ceremony.post_once=mock.Mock();ceremony.halt_post=mock.Mock()
        ceremony.transfer=mock.Mock(return_value=({'transaction':{'abciHash':'synthetic-hash'}},b'x'))
        calls=[]
        def call(name,args):
            calls.append(name)
            if name=='activate-original':
                self.assertTrue(self.window.stopping)
                return normal.Ceremony.call(ceremony,name,args)
            return {'transaction':'eA==','transactionHash':'synthetic-hash'}
        ceremony.call=call;self.child_rss=1;self.child.returncode=0
        def popen(*args,**kwargs):
            self.created.set();kwargs['stdout'].write(b'{"registryHeight":3,"activationHeight":7}')
            return self.child
        self.popen.side_effect=popen
        with mock.patch.object(normal.lab.guard,'digest',return_value='synthetic-activation-pin'):
            result=ceremony.prepare_network()
        self.assertEqual(result,{'registryHeight':3,'activationHeight':7})
        self.assertEqual(calls.count('activate-original'),1)
        self.assertEqual(self.popen.call_count,1);self.assertFalse(self.window.launches_closed)


    def test_unmanaged_registered_child_stays_unknown_without_numeric_cleanup(self):
        child=SimpleNamespace(pid=987123,poll=mock.Mock(),wait=mock.Mock(),kill=mock.Mock())
        self.window.children.append(dict(name='unmanaged',process=child,startTicks=29))
        with mock.patch.object(lab.os,'killpg') as groups, mock.patch.object(lab.os,'kill') as kills:
            with self.assertRaisesRegex(RuntimeError,'unmanaged'):
                self.window.stop()
        groups.assert_not_called();kills.assert_not_called()
        child.poll.assert_not_called();child.wait.assert_not_called();child.kill.assert_not_called()
        row=self.window.direct_cleanup_after_failure[0]
        self.assertFalse(row['exited']);self.assertEqual({v['operation'] for v in row['errors']},{'signal','wait'})
        self.assertTrue(self.window.launches_closed)


    def test_unpublished_descendant_signals_only_bound_pidfd(self):
        with mock.patch.object(lab.os,'pidfd_open',return_value=77,create=True) as opened, \
             mock.patch.object(lab.signal,'pidfd_send_signal',create=True) as send, \
             mock.patch.object(lab.os,'close') as close, \
             mock.patch.object(lab.os,'kill') as numeric, \
             mock.patch.object(lab.guard,'bounded',side_effect=[b'stat',b'stat',b'Pid:\t987654\n']):
            lab.signal_owned_descendant(987654,{'startTicks':20},lab.signal.SIGKILL)
        opened.assert_called_once_with(987654,0);send.assert_called_once_with(77,lab.signal.SIGKILL,None,0)
        close.assert_called_once_with(77);numeric.assert_not_called()

    def test_unpublished_descendant_reuse_after_pidfd_open_cannot_signal(self):
        with mock.patch.object(lab.os,'pidfd_open',return_value=77,create=True), \
             mock.patch.object(lab.signal,'pidfd_send_signal',create=True) as send, \
             mock.patch.object(lab.os,'close') as close, \
             mock.patch.object(lab.guard,'parse_stat',side_effect=[{'startTicks':20},{'startTicks':21}]):
            with self.assertRaisesRegex(RuntimeError,'identity changed'):
                lab.signal_owned_descendant(987654,{'startTicks':20},lab.signal.SIGKILL)
        send.assert_not_called();close.assert_called_once_with(77)

    def test_all_cleanup_waits_share_original_expired_deadline(self):
        self.child_rss=1;self.release.set();self.launch()
        self.window.launch_cleanup_deadline=time.monotonic()-1
        timeouts=[]
        def wait(timeout):
            timeouts.append(timeout)
            raise lab.subprocess.TimeoutExpired('unresolved original child',timeout)
        self.child.wait=wait
        with self.assertRaises(lab.subprocess.TimeoutExpired):self.window.stop()
        self.assertEqual(timeouts,[0,0,0])
        self.assertTrue(self.window.launches_closed)
        self.assertEqual(self.window.direct_cleanup_after_failure[0]['errors'][0]['operation'],'wait')



@unittest.skipUnless(sys.platform=='linux','actual original Linux /proc required')
class LinuxPendingLaunchControls(unittest.TestCase):
    def setUp(self):
        affinity=os.sched_getaffinity(0)
        def restore():
            os.sched_setaffinity(0,affinity)
            self.assertEqual(os.sched_getaffinity(0),affinity)
        self.addCleanup(restore)

    def test_real_pidfd_child_reaped_before_actual_window_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'.private').mkdir();(root/'public').mkdir()
            window=lab.Window(Path(__file__).resolve().parents[2],root)
            child=window.launch('load-original-owner',[sys.executable,'-I','-c','import time; time.sleep(.25)'],
                                stdin_pipe=True,thread_safe=True,original_pidfd=True)
            anchor=child._ynx_original_pidfd
            try:
                self.assertEqual(child.wait(timeout=3),0)
                with mock.patch.object(lab.os,'killpg',side_effect=AssertionError('numeric fallback forbidden')):
                    self.assertTrue(window.stop())
                self.assertEqual(child.returncode,0)
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=1)
                if child.stdin is not None:
                    cut=child.stdin.cut_once(timeout=.05)
                    self.assertEqual(cut['status'],'CUT_AND_CLOSED')
                    self.assertFalse(cut['cleanupDebt'])
                self.assertTrue(anchor.close_bounded())
                self.assertIsNone(anchor.fd)

    def test_real_child_is_sampled_before_popen_wrapper_returns(self):
        # Real Python child only. It is not a node, signer, or performance sample.
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'.private').mkdir();(root/'public').mkdir()
            window=lab.Window(Path(__file__).resolve().parents[2],root)
            entered=threading.Event();release=threading.Event();children=[];results=[];errors=[]
            original_popen=lab.subprocess.Popen
            def popen(*args,**kwargs):
                child=original_popen(*args,**kwargs);children.append(child);entered.set()
                if not release.wait(2):raise RuntimeError('actual child control barrier expired')
                return child
            def launch():
                try:results.append(window.launch('actual-pending-control',[sys.executable,'-I','-c','import time; time.sleep(5)'],thread_safe=True))
                except BaseException as e:errors.append(e)
            with mock.patch.object(lab.subprocess,'Popen',side_effect=popen):
                worker=threading.Thread(target=launch);worker.start()
                try:
                    self.assertTrue(entered.wait(1))
                    sampled=threading.Event()
                    sampler=threading.Thread(target=lambda:(window.sample(),sampled.set()));sampler.start()
                    self.assertTrue(sampled.wait(.5),'actual child spawn blocked resource sampling')
                    sampler.join(1)
                    self.assertIn(children[0].pid,window.known)
                    self.assertGreater(window.known[children[0].pid],0)
                finally:
                    release.set();worker.join(2)
                    window.stop()
                    for child in children:
                        if child.poll() is None:child.kill();child.wait(timeout=1)
            self.assertFalse(errors);self.assertEqual(results,children)
            self.assertFalse(window.pending_launches)

    def test_real_wait_releases_lifecycle_lock_for_sample_and_group_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'.private').mkdir();(root/'public').mkdir()
            window=lab.Window(Path(__file__).resolve().parents[2],root)
            child=window.launch('actual-lifecycle-control',[sys.executable,'-I','-c','import time; time.sleep(5)'],thread_safe=True)
            outcomes=[];errors=[];entered=threading.Event()
            def wait():
                entered.set()
                try:outcomes.append(child.wait(timeout=2))
                except BaseException as e:errors.append(e)
            worker=threading.Thread(target=wait);worker.start()
            try:
                self.assertTrue(entered.wait(1));time.sleep(.02)
                sampled=threading.Event()
                sampler=threading.Thread(target=lambda:(window.sample(),sampled.set()));sampler.start()
                self.assertTrue(sampled.wait(.5),'original wait blocked resource sample')
                sampler.join(1);lab.signal_process_group(child,lab.signal.SIGTERM)
                worker.join(2)
                self.assertFalse(worker.is_alive());self.assertFalse(errors)
                self.assertEqual(outcomes,[-lab.signal.SIGTERM])
                with mock.patch.object(lab.os,'killpg') as signal_again:
                    lab.signal_process_group(child,lab.signal.SIGTERM)
                signal_again.assert_not_called()
            finally:
                child.kill();worker.join(2);window.stop()


    def test_real_unpublished_child_is_signaled_via_original_pidfd(self):
        child=lab.subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(5)'],start_new_session=True)
        try:
            identity=lab.guard.parse_stat(lab.guard.bounded(Path('/proc')/str(child.pid)/'stat'),child.pid)
            lab.signal_owned_descendant(child.pid,identity,lab.signal.SIGTERM)
            self.assertEqual(child.wait(timeout=1),-lab.signal.SIGTERM)
        finally:
            if child.poll() is None:child.kill()
            child.wait(timeout=1)



if __name__=='__main__':unittest.main(verbosity=2)
