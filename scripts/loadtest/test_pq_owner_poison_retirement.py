"""Experimental one-process retirement; no nodes, no external authority."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from types import SimpleNamespace


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

transport=module('pq-public-owner-transport')
normal=module('pq-normal-process-lab')
driver=module('pq-independent-load')

def original_window_fixture():
    value=driver.lab.Window.__new__(driver.lab.Window)
    value.launch_lock=threading.Lock();value.pending_launches={};value.launches_closed=False
    value.closed_for_launch=False
    value.launch_guard_failure=None;value.launch_cleanup_debt=[];value.launch_cleanup_deadline=None
    value.closed_log_identity={}
    return value

def require(value,message):
    if not value:raise RuntimeError(message)
class Receiver:pass
Session=transport.session_class(Receiver,normal,SimpleNamespace(require=require))

def command():
    return normal.sender_command_data('sign',dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1',operationId='a'*64,ownerIndex=0,firstNonce='2',members=1),1,'b'*64)

def session(proc,reply):
    obj=Session.__new__(Session);obj.ready={};obj.owners=(0,);obj.lock=threading.Lock();obj.poisoned=False
    obj.poison_retirement=True;obj.trace_lock=threading.Lock();obj.traces=[];obj.attempts=0;obj.proc=proc
    obj.c=SimpleNamespace(measurements=SimpleNamespace(record=lambda *a,**kw:None));obj.receive=reply
    return obj

class PoisonControls(unittest.TestCase):
    def test_original_child_gets_eof_and_no_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'received'
            child=subprocess.Popen([sys.executable,'-c','import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())',str(path)],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            def lost(*args):raise TimeoutError('original reply lost')
            s=session(child,lost)
            try:
                with self.assertRaisesRegex(TimeoutError,'original reply lost'):s.exchange(command(),None,threading.Event())
                self.assertTrue(s.poisoned);self.assertIsNotNone(child.poll())
                trace=s.traces[0]['poisonRetirement'];self.assertTrue(trace['stdinCut']);self.assertTrue(trace['eofExitObserved'])
                self.assertFalse(trace['lateRepliesRead']);self.assertFalse(trace['originalOperationReplayed']);self.assertFalse(trace['wipeProven'])
                original=path.read_bytes();self.assertEqual(json.loads(original),command());self.assertEqual(original.count(b'\n'),1)
                with self.assertRaisesRegex(RuntimeError,'recover originals, never replay'):s.exchange(command(),None,threading.Event())
                self.assertEqual(path.read_bytes(),original)
            finally:
                if child.poll() is None:child.kill();child.wait()

    def test_cleanup_failure_does_not_replace_first_cause(self):
        child=SimpleNamespace(pid=10,stdin=None,poll=lambda:None)
        child._ynx_original_pidfd=SimpleNamespace(send=lambda signum,**kwargs:(_ for _ in ()).throw(OSError('no signal')))
        def lost(*args):raise TimeoutError('original reply lost')
        s=session(child,lost)
        class Sink:
            closed=False
            def fileno(self):raise OSError('no fd')
            def write(self,raw):return len(raw)
            def flush(self):pass
        child.stdin=Sink()
        with self.assertRaisesRegex(TimeoutError,'original reply lost'):s.exchange(command(),None,threading.Event())
        self.assertEqual(s.traces[0]['poisonRetirement']['cleanupErrorType'],'OSError')
        self.assertIsNone(s.traces[0]['poisonRetirement']['returnCode'])
        self.assertTrue(s.poisoned)
        with unittest.mock.patch.object(s,'retire_poisoned_original',side_effect=AssertionError('must not retry cleanup')):
            with self.assertRaisesRegex(RuntimeError,'recover originals, never replay'):
                s.exchange(command(),None,threading.Event())

    def test_pending_parent_buffer_is_never_flushed_to_original_pipe(self):
        readfd,writefd=os.pipe()
        stream=os.fdopen(writefd,'wb')
        stream.write(b'unknown-partial-command') # retained in Python buffer
        class Child:
            pid=42
            stdin=stream
            done=False
            def poll(self):return 0 if self.done else None
            def wait(self,timeout):self.done=True;return 0
        s=session(Child(),lambda *a:None)
        try:
            report=s.retire_poisoned_original()
            self.assertTrue(report['stdinCut']);self.assertEqual(os.read(readfd,1024),b'')
            self.assertFalse(report['originalOperationReplayed'])
        finally:os.close(readfd)

    def test_unresponsive_child_has_bounded_term_then_kill(self):
        class Child:
            pid=42
            stdin=None
            code=None
            def poll(self):return self.code
            def wait(self,timeout):
                if self.code is None:raise subprocess.TimeoutExpired('original',timeout)
                return self.code
            def terminate(self):pass
            def kill(self):self.code=-9
        child=Child()
        child._ynx_original_pidfd=SimpleNamespace(send=lambda signum,**kwargs:child.kill() if signum==driver.signal.SIGKILL else child.terminate())
        s=session(child,lambda *a:None)
        report=s.retire_poisoned_original()
        self.assertTrue(report['terminateRequested']);self.assertTrue(report['killRequested'])
        self.assertEqual(report['returnCode'],-9);self.assertFalse(report['wipeProven'])
        self.assertFalse(report['lateRepliesRead']);self.assertFalse(report['originalOperationReplayed'])

    def test_cutoff_does_not_close_or_replace_fd_held_by_exchange(self):
        class Sink:
            closed=False
            touched=False
            def close(self):self.touched=True
        process=SimpleNamespace(pid=12345,stdin=Sink(),poll=lambda:None)
        process._ynx_lifecycle_lock=threading.RLock()
        s=session(process,lambda *a:None)
        window=SimpleNamespace(stopping=False,lock=threading.Lock(),children=[dict(name='load-public-owners',process=process)])
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.stop_event=threading.Event();backend.w=window;backend.sessions={0:s}
        s.lock.acquire()
        try:
            with mock.patch.object(driver.os,'killpg'):
                started=__import__('time').monotonic()
                with self.assertRaisesRegex(RuntimeError,'preserve cleanup debt'):backend.stop()
                elapsed=__import__('time').monotonic()-started
            self.assertLess(elapsed,1);self.assertFalse(process.stdin.touched)
            self.assertTrue(s.stopStreamLockDeferred)
        finally:s.lock.release()

    def test_cutoff_uses_same_poison_retirement_once(self):
        process=SimpleNamespace(pid=12345,stdin=None,poll=lambda:None)
        process._ynx_lifecycle_lock=threading.RLock()
        s=session(process,lambda *a:None);s.poisoned=True
        s.poison_retirement_report=dict(returnCode=None,wipeProven=False)
        window=SimpleNamespace(stopping=False,lock=threading.Lock(),children=[dict(name='load-public-owners',process=process)])
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.stop_event=threading.Event();backend.w=window;backend.sessions={0:s}
        with mock.patch.object(driver.os,'killpg'),mock.patch.object(s,'retire_poisoned_original',side_effect=AssertionError('must not retry cleanup')):
            backend.stop()
        self.assertIsNone(s.poison_retirement_report['returnCode'])

    def test_reaped_pid_reuse_never_receives_a_numeric_signal(self):
        proc=SimpleNamespace(pid=12345,poll=lambda:None,_ynx_lifecycle_lock=threading.RLock())
        calls=[]
        proc._ynx_original_pidfd=SimpleNamespace(send=lambda signum,**kwargs:calls.append(signum))
        with mock.patch.object(driver.os,'killpg',side_effect=AssertionError('numeric PID signal refused')):
            driver.lab.signal_original_child(proc,driver.signal.SIGTERM)
        self.assertEqual(calls,[driver.signal.SIGTERM])

    @unittest.skipUnless(sys.platform=='linux','original pidfd requires Linux')
    def test_real_original_pidfd_signals_exact_child(self):
        self.assertTrue(hasattr(os,'pidfd_open') and hasattr(driver.signal,'pidfd_send_signal'),'Linux original pidfd APIs required')
        child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],stdin=subprocess.DEVNULL)
        identity=module('pq-experimental-owner-pidfd').OriginalOwnerPidfd(child)
        try:
            identity.send(driver.signal.SIGTERM)
            child.wait(timeout=3)
            self.assertEqual(child.returncode,-driver.signal.SIGTERM)
        finally:
            identity.close()
            if child.poll() is None:child.kill();child.wait()

    def test_missing_identity_never_falls_back_to_numeric_signal(self):
        proc=SimpleNamespace(pid=12345,stdin=None,poll=lambda:None)
        s=session(proc,lambda *a:None)
        with mock.patch.object(driver.os,'killpg',side_effect=AssertionError('numeric signal forbidden')):
            report=s.retire_poisoned_original()
        self.assertEqual(report['cleanupErrorType'],'RuntimeError')
        self.assertIsNone(report['returnCode']);self.assertFalse(report['wipeProven'])

    def test_identity_closes_only_after_reap_and_stream_unlock(self):
        closed=[]
        proc=SimpleNamespace(pid=12345,stdin=None,poll=lambda:0,_ynx_lifecycle_lock=threading.RLock())
        proc._ynx_original_pidfd=SimpleNamespace(close_bounded=lambda **kwargs:(closed.append(True) or True))
        s=session(proc,lambda *a:None);s.lock.acquire()
        try:
            self.assertEqual(s.retire_identity_after_window()['status'],'WORKER_STILL_OWNS_STREAM')
            self.assertEqual(closed,[])
        finally:s.lock.release()
        self.assertEqual(s.retire_identity_after_window()['status'],'ORIGINAL_IDENTITY_CLOSED_AFTER_REAP')
        self.assertEqual(closed,[True])

    def test_required_identity_missing_never_downgrades_to_pid(self):
        proc=SimpleNamespace(pid=12345,_ynx_original_pidfd_required=True)
        with mock.patch.object(driver.os,'killpg',side_effect=AssertionError('numeric PID fallback forbidden')):
            with self.assertRaisesRegex(RuntimeError,'pidfd missing'):
                driver.lab.signal_original_child(proc,driver.signal.SIGTERM)

    def test_non_linux_refused_before_child_launch(self):
        ceremony=SimpleNamespace(w=SimpleNamespace(launch=mock.Mock()))
        with mock.patch.object(transport.sys,'platform','darwin'):
            with self.assertRaisesRegex(RuntimeError,'pidfd required'):
                Session(ceremony,(0,),poison_retirement=True)
        ceremony.w.launch.assert_not_called()

    def test_window_publishes_child_only_after_original_identity_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            process=SimpleNamespace(pid=12345,returncode=None,stdin=object())
            handle=SimpleNamespace(send=lambda sig:None)
            def bind(original):
                self.assertIs(original,process);self.assertEqual(w.children,[])
                self.assertTrue(original._ynx_original_pidfd_required)
                return handle
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda m:None))
            mod=SimpleNamespace(OriginalOwnerPidfd=bind,GuardedOriginalStdin=lambda raw:raw)
            with mock.patch.object(driver.lab.subprocess,'Popen',return_value=process), \
                 mock.patch.object(driver.lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(driver.lab.guard,'parse_stat',return_value=dict(startTicks=123)), \
                 mock.patch.object(driver.lab.importlib.util,'spec_from_file_location',return_value=spec), \
                 mock.patch.object(driver.lab.importlib.util,'module_from_spec',return_value=mod):
                try:
                    result=w.launch('load-public-owners',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                    self.assertIs(result,process);self.assertEqual(len(w.children),1)
                    self.assertIs(w.children[0]['process']._ynx_original_pidfd,handle)
                finally:
                    for _,log in w.logs:log.close()

    def test_failed_identity_binding_retains_child_without_numeric_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            process=SimpleNamespace(pid=12345,returncode=None,stdin=object())
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda m:None))
            def refused(original):raise OSError('pidfd refused')
            mod=SimpleNamespace(OriginalOwnerPidfd=refused,GuardedOriginalStdin=lambda raw:raw)
            with mock.patch.object(driver.lab.subprocess,'Popen',return_value=process), \
                 mock.patch.object(driver.lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(driver.lab.guard,'parse_stat',return_value=dict(startTicks=123)), \
                 mock.patch.object(driver.lab.importlib.util,'spec_from_file_location',return_value=spec), \
                 mock.patch.object(driver.lab.importlib.util,'module_from_spec',return_value=mod), \
                 mock.patch.object(driver.lab.os,'killpg',side_effect=AssertionError('numeric signal forbidden')):
                try:
                    with self.assertRaisesRegex(OSError,'pidfd refused'):
                        w.launch('load-public-owners',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                    self.assertEqual(len(w.children),1);self.assertIs(w.children[0]['process'],process)
                    with self.assertRaisesRegex(RuntimeError,'pidfd missing'):
                        driver.lab.signal_original_child(process,driver.signal.SIGTERM)
                finally:
                    for _,log in w.logs:log.close()

    def test_window_stop_cannot_reap_unpublished_child_during_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            entered=threading.Event();release=threading.Event();reaper=threading.Event();errors=[]
            process=SimpleNamespace(pid=12345,returncode=None,stdin=object());handle=SimpleNamespace(send=lambda sig:None)
            def bind(original):
                entered.set()
                if not release.wait(2):raise RuntimeError('test binding timeout')
                return handle
            def finish_stop():
                self.assertIs(w.children[0]['process']._ynx_original_pidfd,handle)
                reaper.set();return True
            w._stop_owned=finish_stop
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda m:None))
            mod=SimpleNamespace(OriginalOwnerPidfd=bind,GuardedOriginalStdin=lambda raw:raw)
            def launch():
                try:w.launch('load-public-owners',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                except BaseException as e:errors.append(e)
            with mock.patch.object(driver.lab.subprocess,'Popen',return_value=process), \
                 mock.patch.object(driver.lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(driver.lab.guard,'parse_stat',return_value=dict(startTicks=123)), \
                 mock.patch.object(driver.lab.importlib.util,'spec_from_file_location',return_value=spec), \
                 mock.patch.object(driver.lab.importlib.util,'module_from_spec',return_value=mod):
                a=threading.Thread(target=launch);a.start();self.assertTrue(entered.wait(2))
                b=threading.Thread(target=w.stop);b.start()
                try:self.assertFalse(reaper.wait(.05))
                finally:release.set();a.join(2);b.join(2)
                self.assertFalse(a.is_alive() or b.is_alive());self.assertTrue(reaper.is_set())
                self.assertEqual(len(errors),1);self.assertIn('cancelled before publication',str(errors[0]))
                for _,log in w.logs:log.close()

    def test_terminal_stop_refuses_late_launch_before_open_or_popen(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            w._stop_owned=lambda:True
            self.assertTrue(w.stop())
            with mock.patch.object(driver.lab.subprocess,'Popen') as spawn:
                with self.assertRaisesRegex(RuntimeError,'terminal stop'):
                    w.launch('load-public-owners',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                spawn.assert_not_called()
            self.assertEqual(w.children,[]);self.assertEqual(w.logs,[])

    def test_bootstrap_stopping_flag_does_not_close_launch_gate(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            w.stopping=True;w.closed_for_launch=False
            process=SimpleNamespace(pid=12345,returncode=None,stdin=object())
            with mock.patch.object(driver.lab.subprocess,'Popen',return_value=process), \
                 mock.patch.object(driver.lab.guard,'bounded',return_value=b''), \
                 mock.patch.object(driver.lab.guard,'parse_stat',return_value=dict(startTicks=123)):
                try:self.assertIs(w.launch('activation',['no-exec'],True,stdin_pipe=True,thread_safe=True),process)
                finally:
                    for _,log in w.logs:log.close()

    def test_stalled_launch_lock_refuses_bounded_cleanup_and_fences_later_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.sample=lambda:None
            w.stopping=False;w.closed_for_launch=False
            held=threading.Event();release=threading.Event()
            def holder():
                with w.lock:held.set();release.wait(5)
            thread=threading.Thread(target=holder);thread.start();self.assertTrue(held.wait(1))
            try:
                with mock.patch.object(driver.lab.os,'killpg',side_effect=AssertionError('no unbound signal')), \
                     mock.patch.object(driver.lab.os,'waitpid',side_effect=AssertionError('no unsafe reap')):
                    started=__import__('time').monotonic()
                    with self.assertRaisesRegex(RuntimeError,'cleanup lock did not retire'):
                        w.stop()
                    self.assertLess(__import__('time').monotonic()-started,2)
                self.assertTrue(w.closed_for_launch)
            finally:
                release.set();thread.join(2)
            with mock.patch.object(driver.lab.subprocess,'Popen') as spawn:
                with self.assertRaisesRegex(RuntimeError,'terminal stop'):
                    w.launch('late',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                spawn.assert_not_called()
            self.assertEqual(w.children,[]);self.assertEqual(w.logs,[])

    def test_stop_fence_during_sample_refuses_popen(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.RLock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0];w.closed_for_launch=False
            w.sample=lambda:setattr(w,'closed_for_launch',True)
            with mock.patch.object(driver.lab.subprocess,'Popen') as spawn:
                with self.assertRaisesRegex(RuntimeError,'terminal stop'):
                    w.launch('late',['no-exec'],True,stdin_pipe=True,thread_safe=True,original_pidfd=True)
                spawn.assert_not_called()
            self.assertEqual(w.logs,[])

    def test_backend_stalled_window_lock_preserves_debt_and_never_signals(self):
        w=SimpleNamespace(lock=threading.Lock(),stopping=False,closed_for_launch=False,children=[])
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.stop_event=threading.Event();backend.w=w;backend.sessions={}
        held=threading.Event();release=threading.Event()
        def holder():
            with w.lock:held.set();release.wait(5)
        thread=threading.Thread(target=holder);thread.start();self.assertTrue(held.wait(1))
        result=dict(firstCause='original transaction UNKNOWN')
        try:
            with mock.patch.object(driver.os,'killpg',side_effect=AssertionError('unsafe signal')):
                started=__import__('time').monotonic()
                driver.stop_backend_preserving_cause(backend,result)
                self.assertLess(__import__('time').monotonic()-started,2)
            self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
            self.assertEqual(result['backendStopError']['errorType'],'RuntimeError')
            self.assertTrue(result['backendStopError']['cleanupDebt'])
            self.assertTrue(w.closed_for_launch);self.assertTrue(backend.stop_event.is_set())
        finally:release.set();thread.join(2)

    def test_backend_stop_error_retains_first_failure_and_allows_next_cleanup(self):
        backend=SimpleNamespace(stop=mock.Mock(side_effect=RuntimeError('owned cleanup failed')))
        for existing in ('first original rejection',None):
            result=dict(firstCause=existing)
            driver.stop_backend_preserving_cause(backend,result)
            self.assertEqual(result['firstCause'],existing or 'owned cleanup failed')
            self.assertTrue(result['backendStopError']['cleanupDebt'])

    def test_shutdown_lock_is_rechecked_after_successful_probe(self):
        w=original_window_fixture();w.lock=threading.Lock();w.children=[];w.known={};w.logs=[]
        held=threading.Event();release=threading.Event();finished=threading.Event();errors=[]
        original=w._stop_owned
        def holder():
            with w.lock:held.set();release.wait(8)
        def after_probe():
            thread=threading.Thread(target=holder);thread.start();threads.append(thread)
            if not held.wait(1):raise RuntimeError('test holder did not acquire lock')
            return original()
        def shutdown():
            try:w.stop()
            except BaseException as error:errors.append(error)
            finally:finished.set()
        threads=[];w._stop_owned=after_probe
        thread=threading.Thread(target=shutdown);thread.start()
        try:
            self.assertTrue(finished.wait(3),'stop hung after successful initial lock probe')
            self.assertTrue(errors);self.assertTrue(w.closed_for_launch)
        finally:
            release.set();thread.join(3)
            for child in threads:child.join(3)
        lifecycle=w.launch_cleanup_report()
        self.assertEqual(lifecycle['status'],'UNKNOWN')
        self.assertTrue(lifecycle['cleanupDebt'])
        self.assertIsNone(lifecycle['clockIdentityCleanupDebt'])
        self.assertFalse(lifecycle['cleanupCompleteProven'])
        self.assertIsNotNone(w.launch_cleanup_deadline)
        self.assertLessEqual(w.launch_cleanup_deadline,time.monotonic())
        w2=original_window_fixture();w2.lock=threading.Lock();w2.children=[];w2.logs=[]
        held2=threading.Event();release2=threading.Event()
        def holder2():
            with w2.lock:held2.set();release2.wait(3)
        owner2=threading.Thread(target=holder2);owner2.start();self.assertTrue(held2.wait(1))
        deadline=time.monotonic()+.1;w2.launch_cleanup_deadline=deadline;started=time.monotonic()
        try:
            with self.assertRaisesRegex(RuntimeError,'cleanup lock did not retire'):w2.stop()
            self.assertLess(time.monotonic()-started,.6);self.assertEqual(w2.launch_cleanup_deadline,deadline)
        finally:release2.set();owner2.join(2)

    def test_shutdown_inventory_lock_is_bounded_after_admission(self):
        w=original_window_fixture();w.lock=threading.Lock();w.children=[];w.known={};w.logs=[]
        held=threading.Event();release=threading.Event();finished=threading.Event();errors=[];threads=[]
        original=w._cleanup_inventory
        def holder():
            with w.lock:held.set();release.wait(8)
        def inventory():
            thread=threading.Thread(target=holder);thread.start();threads.append(thread)
            if not held.wait(1):raise RuntimeError('test holder did not acquire lock')
            return original()
        w._cleanup_inventory=inventory
        def shutdown():
            try:w.stop()
            except BaseException as error:errors.append(error)
            finally:finished.set()
        with mock.patch.object(driver.lab.guard,'proc_inventory',return_value=({},None)):
            thread=threading.Thread(target=shutdown);thread.start()
            try:
                self.assertTrue(finished.wait(3),'stop hung acquiring original inventory snapshot')
                self.assertTrue(errors);self.assertTrue(w.closed_for_launch)
            finally:
                release.set();thread.join(3)
                for child in threads:child.join(3)
        lifecycle=w.launch_cleanup_report()
        self.assertEqual(lifecycle['status'],'UNKNOWN');self.assertTrue(lifecycle['cleanupDebt'])
        self.assertIsNone(lifecycle['clockIdentityCleanupDebt'])
        self.assertLessEqual(w.launch_cleanup_deadline,time.monotonic())
        waits=[];anchor=SimpleNamespace(close_bounded=lambda *,timeout:(waits.append(timeout) or True))
        process=SimpleNamespace(poll=lambda:0,stdin=SimpleNamespace(closed=True),
            _ynx_lifecycle_lock=threading.RLock(),_ynx_original_pidfd=anchor)
        self.assertTrue(driver.retire_original_proof_pidfd(process,deadline=w.launch_cleanup_deadline)['closed'])
        self.assertEqual(waits,[0])

    def test_process_receipt_retains_original_cause_when_child_lock_is_held(self):
        w=original_window_fixture();w.lock=threading.RLock()
        proc=SimpleNamespace(pid=12345,returncode=None,poll=lambda:None,wait=lambda timeout=None:None)
        driver.lab.bind_process_lifecycle(proc)
        w.children=[dict(name='original',process=proc,startTicks=44,command=['original'])]
        held=threading.Event();release=threading.Event();finished=threading.Event()
        def holder():
            with proc._ynx_lifecycle_lock:held.set();release.wait(8)
        owner=threading.Thread(target=holder);owner.start();self.assertTrue(held.wait(1))
        result=dict(firstCause='original transaction UNKNOWN',cleanupComplete=True)
        def receipt():
            try:w.process_receipt()
            except RuntimeError:pass
            finally:finished.set()
        worker=threading.Thread(target=receipt);worker.start()
        try:
            self.assertTrue(finished.wait(2),'original process receipt blocked on child lifecycle lock')
            driver.normal.retain_original_process_receipt(result,w)
            self.assertIsNone(result['processes']);self.assertEqual(result['processReceiptStatus'],'UNKNOWN')
            self.assertTrue(result['processReceiptCleanupDebt']);self.assertFalse(result['cleanupComplete'])
            self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
            driver.normal.apply_normal_clean_exit(result)
            self.assertIsNone(result['normalNodeCleanExit']);self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
        finally:release.set();owner.join(3);worker.join(3)

    def test_backend_stop_preserves_cause_when_original_child_lock_is_held(self):
        w=original_window_fixture();w.lock=threading.RLock()
        proc=SimpleNamespace(pid=12345,returncode=None,poll=lambda:None,wait=lambda timeout=None:None)
        driver.lab.bind_process_lifecycle(proc)
        w.children=[dict(name='load-original',process=proc,startTicks=44,command=['original'])]
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.w=w;backend.stop_event=threading.Event();backend.sessions={}
        held=threading.Event();release=threading.Event();finished=threading.Event()
        def holder():
            with proc._ynx_lifecycle_lock:held.set();release.wait(8)
        owner=threading.Thread(target=holder);owner.start();self.assertTrue(held.wait(1))
        result=dict(firstCause='original transaction UNKNOWN')
        def shutdown():
            try:driver.stop_backend_preserving_cause(backend,result)
            finally:finished.set()
        worker=threading.Thread(target=shutdown);worker.start()
        try:
            self.assertTrue(finished.wait(2),'original backend stop blocked on child lifecycle lock')
            self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
            self.assertTrue(result['backendStopError']['cleanupDebt']);self.assertTrue(w.closed_for_launch)
        finally:release.set();owner.join(3);worker.join(3)

    def test_busy_original_locks_refuse_wait_and_pidfd_signal_without_fallback(self):
        proc=SimpleNamespace(pid=12345,returncode=None,poll=lambda:None,wait=lambda timeout=None:None)
        driver.lab.bind_process_lifecycle(proc)
        pidfd=module('pq-experimental-owner-pidfd')
        anchor=pidfd.OriginalOwnerPidfd.__new__(pidfd.OriginalOwnerPidfd)
        anchor.fd=123;anchor.lock=threading.Lock()
        held=threading.Event();release=threading.Event()
        def holder():
            with proc._ynx_lifecycle_lock:
                with anchor.lock:held.set();release.wait(4)
        owner=threading.Thread(target=holder);owner.start();self.assertTrue(held.wait(1))
        try:
            with self.assertRaisesRegex(RuntimeError,'lifecycle lock unavailable'):proc.wait(timeout=.05)
            with mock.patch.object(driver.signal,'pidfd_send_signal',create=True) as send:
                with self.assertRaisesRegex(RuntimeError,'pidfd lock unavailable'):anchor.send(driver.signal.SIGTERM)
                send.assert_not_called()
        finally:release.set();owner.join(3)
        remaining=[]
        proc._ynx_original_pidfd=SimpleNamespace(send=lambda sig,**kwargs:remaining.append(kwargs['timeout']))
        with mock.patch.object(driver.lab.time,'monotonic',side_effect=[100,100.19]):
            driver.lab.signal_original_child(proc,driver.signal.SIGTERM,timeout=.2)
        self.assertAlmostEqual(remaining[0],.01,places=6)

    def test_busy_identity_close_remains_debt_in_owner_and_proof_paths(self):
        handle=SimpleNamespace(close_bounded=lambda **kwargs:False,close=lambda:(_ for _ in ()).throw(AssertionError('unbounded close forbidden')))
        proc=SimpleNamespace(pid=12345,stdin=SimpleNamespace(closed=True),poll=lambda:0,_ynx_original_pidfd=handle,_ynx_lifecycle_lock=threading.RLock())
        s=session(proc,lambda *a:None);s.require_guarded_stream=True
        self.assertEqual(s.retire_identity_after_window()['status'],'ORIGINAL_IDENTITY_CLOSE_UNKNOWN')
        self.assertEqual(driver.retire_original_proof_pidfd(proc),dict(status='ORIGINAL_PROOF_IDENTITY_CLOSE_UNKNOWN',closed=False))

    def test_blocked_child_keeps_error_and_attempts_other_original_child(self):
        w=original_window_fixture();w.lock=threading.RLock();w.logs=[];w.known={}
        signals=[];children=[]
        for index in (1,2):
            process=SimpleNamespace(pid=12340+index,returncode=None,poll=lambda:None,wait=lambda timeout=None:0)
            driver.lab.bind_process_lifecycle(process)
            process._ynx_original_pidfd=SimpleNamespace(send=lambda signum,i=index,**kwargs:signals.append((i,signum)))
            children.append(dict(name='load-original-'+str(index),process=process,startTicks=44+index,command=['original']))
        w.children=children;w._cleanup_inventory=lambda:({},{});
        held=threading.Event();release=threading.Event();finished=threading.Event();errors=[]
        def holder():
            with children[0]['process']._ynx_lifecycle_lock:held.set();release.wait(8)
        owner=threading.Thread(target=holder);owner.start();self.assertTrue(held.wait(1))
        def stop():
            try:w.stop()
            except BaseException as error:errors.append(error)
            finally:finished.set()
        worker=threading.Thread(target=stop);worker.start()
        try:
            self.assertTrue(finished.wait(5),'original cleanup stopped progressing on one child')
            self.assertTrue(errors);self.assertIn('lifecycle lock unavailable',str(errors[0]))
            self.assertIn((2,driver.signal.SIGTERM),signals)
            self.assertEqual(w.direct_cleanup_after_failure[0]['errors'][0]['operation'],'signal')
            self.assertTrue(w.launch_cleanup_failure);self.assertTrue(w.launches_closed)
        finally:release.set();owner.join(3);worker.join(3)

    def test_multiple_busy_children_share_cleanup_deadline_and_try_live_handle(self):
        w=original_window_fixture();w.lock=threading.RLock();w.logs=[];w.known={};signals=[]
        children=[]
        for index in (1,2,3):
            process=SimpleNamespace(pid=12340+index,returncode=None,poll=lambda:None,wait=lambda timeout=None:0)
            driver.lab.bind_process_lifecycle(process)
            process._ynx_original_pidfd=SimpleNamespace(send=lambda signum,i=index,**kwargs:signals.append((i,signum)))
            children.append(dict(name='load-original-'+str(index),process=process,startTicks=44+index,command=['original']))
        w.children=children;w._cleanup_inventory=lambda:({},{});held=threading.Event();release=threading.Event()
        def holder():
            with children[0]['process']._ynx_lifecycle_lock,children[1]['process']._ynx_lifecycle_lock:
                held.set();release.wait(5)
        owner=threading.Thread(target=holder);owner.start();self.assertTrue(held.wait(1))
        w.launch_cleanup_deadline=time.monotonic()+.15;started=time.monotonic()
        try:
            with self.assertRaisesRegex(RuntimeError,'lifecycle lock unavailable'):w.stop()
            self.assertLess(time.monotonic()-started,1)
            self.assertIn((3,driver.signal.SIGTERM),signals)
            self.assertEqual(len(w.direct_cleanup_after_failure),3)
            self.assertTrue(w.launch_cleanup_failure)
        finally:release.set();owner.join(3)

    def test_uncertain_pidfd_close_never_reuses_descriptor_number(self):
        pidfd=module('pq-experimental-owner-pidfd');anchor=pidfd.OriginalOwnerPidfd.__new__(pidfd.OriginalOwnerPidfd)
        anchor.fd=os.open(os.devnull,os.O_RDONLY);anchor.lock=threading.Lock();anchor._close_uncertain=False
        number=anchor.fd;original_close=os.close;replacement=[]
        def ambiguous(fd):
            original_close(fd)
            new=os.open(os.devnull,os.O_RDONLY)
            if new!=fd:os.dup2(new,fd);original_close(new)
            replacement.append(fd)
            raise OSError('controlled close outcome uncertain after release')
        try:
            with mock.patch.object(pidfd.os,'close',side_effect=ambiguous) as close:
                with self.assertRaisesRegex(OSError,'outcome uncertain'):anchor.close_bounded()
                self.assertIsNone(anchor.fd);self.assertFalse(anchor.close_bounded())
                self.assertEqual(anchor._close_error_type,'OSError')
                with self.assertRaisesRegex(RuntimeError,'close unknown'):anchor.close()
                with self.assertRaisesRegex(RuntimeError,'already closed'):anchor.send(driver.signal.SIGTERM)
                proc=SimpleNamespace(pid=12345,returncode=0,poll=lambda:0,stdin=SimpleNamespace(closed=True),
                    _ynx_lifecycle_lock=threading.RLock(),_ynx_original_pidfd=anchor,_ynx_clock_pidfd=anchor)
                s=session(proc,lambda *a:None);s.require_guarded_stream=True
                self.assertEqual(s.retire_identity_after_window()['errorType'],'OSError')
                self.assertEqual(driver.retire_original_proof_pidfd(proc)['errorType'],'OSError')
                w=original_window_fixture();w.lock=threading.RLock();w.children=[dict(name='pq-node-0',process=proc)]
                w._stop_owned=lambda:True
                self.assertFalse(w.stop())
                self.assertEqual(w.launch_cleanup_report()['clockIdentityCloseErrors'],[dict(name='pq-node-0',errorType='OSError')])
                close.assert_called_once_with(number)
            os.fstat(number) # A reused descriptor still belongs to the caller.
        finally:
            for fd in replacement:original_close(fd)

    def test_blocked_shutdown_report_remains_unknown_without_zero_fill(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'public').mkdir()
            w=original_window_fixture()
            w.lock=threading.Lock();w.children=[];w.known={};w.logs=[];w.work=root;w.source=root;w.env={};w.cpus=[0]
            w.sample_stage_totals={'original_hidden_stage':dict(calls=1,timedCalls=1,totalNs=123)}
            w.stopping=False;w.closed_for_launch=False
            backend=driver.NormalBackend.__new__(driver.NormalBackend)
            backend.stop_event=threading.Event();backend.w=w;backend.sessions={}
            held=threading.Event();release=threading.Event()
            def holder():
                with w.lock:held.set();release.wait(6)
            thread=threading.Thread(target=holder);thread.start();self.assertTrue(held.wait(1))
            result=dict(firstCause='original transaction UNKNOWN')
            try:
                driver.stop_backend_preserving_cause(backend,result)
                with self.assertRaisesRegex(RuntimeError,'cleanup lock did not retire'):w.stop()
                self.assertIsNotNone(w.launch_cleanup_deadline)
                self.assertLessEqual(w.launch_cleanup_deadline,time.monotonic())
                waits=[]
                anchor=SimpleNamespace(close_bounded=lambda *,timeout:(waits.append(timeout) or True))
                process=SimpleNamespace(poll=lambda:0,stdin=SimpleNamespace(closed=True),
                    _ynx_lifecycle_lock=threading.RLock(),_ynx_original_pidfd=anchor)
                self.assertTrue(driver.retire_original_proof_pidfd(process,deadline=w.launch_cleanup_deadline)['closed'])
                self.assertEqual(waits,[0])
                report=w.sample_stage_report()
                self.assertEqual(report['status'],'UNKNOWN');self.assertEqual(report['stages'],{})
                self.assertIn('not observed',report['reason']);self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
                self.assertTrue(result['backendStopError']['cleanupDebt']);self.assertTrue(w.closed_for_launch)
                lifecycle=w.launch_cleanup_report()
                self.assertEqual(lifecycle['status'],'UNKNOWN')
                self.assertIsNone(lifecycle['pending']);self.assertIsNone(lifecycle['cleanupDebt'])
                self.assertIsNone(lifecycle['clockIdentityCleanupDebt'])
                self.assertFalse(lifecycle['cleanupCompleteProven'])
                ceremony=SimpleNamespace(w=w)
                ceremony.readiness_report=lambda:driver.normal.Ceremony.readiness_report(ceremony)
                driver.retain_original_readiness(result,ceremony)
                readiness=result['originalReadinessObservations']
                self.assertEqual(readiness['status'],'UNKNOWN')
                self.assertIsNone(readiness['calls']);self.assertIsNone(readiness['records'])
                self.assertEqual(result['firstCause'],'original transaction UNKNOWN')
            finally:release.set();thread.join(2)

if __name__=='__main__':unittest.main()
