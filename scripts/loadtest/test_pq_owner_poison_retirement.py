"""Experimental one-process retirement; no nodes, no external authority."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

from types import SimpleNamespace


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

transport=module('pq-public-owner-transport')
normal=module('pq-normal-process-lab')
driver=module('pq-independent-load')
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
        child._ynx_original_pidfd=SimpleNamespace(send=lambda signum:(_ for _ in ()).throw(OSError('no signal')))
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
        child._ynx_original_pidfd=SimpleNamespace(send=lambda signum:child.kill() if signum==driver.signal.SIGKILL else child.terminate())
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
        s=session(process,lambda *a:None)
        window=SimpleNamespace(stopping=False,lock=threading.Lock(),children=[dict(name='load-public-owners',process=process)])
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.stop_event=threading.Event();backend.w=window;backend.sessions={0:s}
        s.lock.acquire()
        try:
            with mock.patch.object(driver.os,'killpg'):
                started=__import__('time').monotonic();backend.stop();elapsed=__import__('time').monotonic()-started
            self.assertLess(elapsed,1);self.assertFalse(process.stdin.touched)
            self.assertTrue(s.stopStreamLockDeferred)
        finally:s.lock.release()

    def test_cutoff_uses_same_poison_retirement_once(self):
        process=SimpleNamespace(pid=12345,stdin=None,poll=lambda:None)
        s=session(process,lambda *a:None);s.poisoned=True
        s.poison_retirement_report=dict(returnCode=None,wipeProven=False)
        window=SimpleNamespace(stopping=False,lock=threading.Lock(),children=[dict(name='load-public-owners',process=process)])
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.stop_event=threading.Event();backend.w=window;backend.sessions={0:s}
        with mock.patch.object(driver.os,'killpg'),mock.patch.object(s,'retire_poisoned_original',side_effect=AssertionError('must not retry cleanup')):
            backend.stop()
        self.assertIsNone(s.poison_retirement_report['returnCode'])

    def test_reaped_pid_reuse_never_receives_a_numeric_signal(self):
        proc=SimpleNamespace(pid=12345)
        calls=[]
        proc._ynx_original_pidfd=SimpleNamespace(send=lambda signum:calls.append(signum))
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
        proc=SimpleNamespace(pid=12345,stdin=None,poll=lambda:0)
        proc._ynx_original_pidfd=SimpleNamespace(close=lambda:closed.append(True))
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

if __name__=='__main__':unittest.main()
