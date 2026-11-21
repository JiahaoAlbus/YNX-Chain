"""Cancellation controls only; no chain, keys, or synthetic workload."""
import importlib.util
import os
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


def load():
    spec=importlib.util.spec_from_file_location('guarded_original_stdin',Path(__file__).with_name('pq-guarded-original-stdin.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


class GuardedOriginalStdinControls(unittest.TestCase):
    def test_buffered_uncertain_bytes_are_not_flushed_to_original_pipe(self):
        m=load();reader,writer=os.pipe();raw=os.fdopen(writer,'wb');stream=m.GuardedOriginalStdin(raw)
        try:
            stream.write(b'not-yet-sent-unknown')
            result=stream.cut_once(timeout=.1)
            self.assertEqual(result['status'],'CUT_AND_CLOSED');self.assertEqual(os.read(reader,1024),b'')
            self.assertEqual(stream.cut_once(timeout=.1),result)
        finally:os.close(reader)

    def test_blocked_writer_is_bounded_and_never_retried(self):
        m=load();reader,writer=os.pipe();raw=os.fdopen(writer,'wb');stream=m.GuardedOriginalStdin(raw)
        locked=threading.Event();release=threading.Event()
        def holder():
            with stream._lock:locked.set();release.wait(3)
        thread=threading.Thread(target=holder);thread.start();self.assertTrue(locked.wait(1))
        try:
            first=stream.cut_once(timeout=.05)
            self.assertEqual(first['status'],'UNKNOWN');self.assertTrue(first['cleanupDebt'])
            self.assertFalse(raw.closed)
        finally:release.set();thread.join(1)
        self.assertEqual(stream.cut_once(timeout=.1),first)
        self.assertFalse(raw.closed)
        raw.close();os.close(reader)

    def test_real_inflight_write_yields_debt_without_closing_or_retry(self):
        m=load();entered=threading.Event();release=threading.Event()
        class BlockingWriter:
            closed=False
            def write(self,value):entered.set();release.wait(3);return len(value)
        original=BlockingWriter();stream=m.GuardedOriginalStdin(original)
        worker=threading.Thread(target=lambda:stream.write(b'original-partial'));worker.start();self.assertTrue(entered.wait(1))
        try:
            with mock.patch.object(m.os,'dup2',side_effect=AssertionError('must not touch owned fd')):
                outcome=stream.cut_once(timeout=.05)
            self.assertEqual(outcome['status'],'UNKNOWN');self.assertTrue(outcome['cleanupDebt'])
            self.assertFalse(outcome['originalBytesReplayed'])
        finally:release.set();worker.join(2)
        self.assertFalse(worker.is_alive());self.assertEqual(stream.cut_once(timeout=.1),outcome)
        with self.assertRaisesRegex(RuntimeError,'retirement started'):stream.write(b'new-command')

    def test_cut_error_is_unknown_and_never_retried(self):
        m=load();reader,writer=os.pipe();raw=os.fdopen(writer,'wb');stream=m.GuardedOriginalStdin(raw)
        try:
            with mock.patch.object(m.os,'dup2',side_effect=OSError('synthetic refusal')) as cut:
                outcome=stream.cut_once(timeout=.1)
                self.assertEqual(outcome['status'],'UNKNOWN');self.assertTrue(outcome['cleanupDebt'])
                self.assertEqual(outcome['errorType'],'OSError');self.assertEqual(stream.cut_once(timeout=.1),outcome)
                self.assertEqual(cut.call_count,1)
        finally:raw.close();os.close(reader)

    def test_blocked_original_proof_lane_records_debt_and_never_closes(self):
        m=load()
        spec=importlib.util.spec_from_file_location('independent_original',Path(__file__).with_name('pq-independent-load.py'))
        driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
        entered=threading.Event();release=threading.Event()
        class BlockingWriter:
            closed=False
            def write(self,value):entered.set();release.wait(3);return len(value)
        original=BlockingWriter();stream=m.GuardedOriginalStdin(original)
        process=SimpleNamespace(pid=34567,stdin=stream,poll=lambda:None)
        signals=[];process._ynx_original_pidfd=SimpleNamespace(send=lambda signum:signals.append(signum))
        w=SimpleNamespace(lock=threading.Lock(),children=[dict(name='load-live-session-0',process=process)],stopping=False)
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.live_lane_lock=threading.Lock();backend.live_lanes_remaining=1;backend.guarded_shutdown=True
        backend.stop_event=threading.Event();backend.helper_cleanup_debt=[];backend.w=w;backend.sessions={}
        lane=dict(node=0,retired=False,originalProcess=process)
        worker=threading.Thread(target=lambda:stream.write(b'unknown-proof-command'));worker.start();self.assertTrue(entered.wait(1))
        try:
            with mock.patch.object(m.os,'dup2',side_effect=AssertionError('must not touch busy pipe')):
                backend.retire_live_lane(lane)
                self.assertTrue(lane['retired']);self.assertTrue(backend.stop_event.is_set())
                self.assertEqual(len(backend.helper_cleanup_debt),1)
                with self.assertRaisesRegex(RuntimeError,'preserve cleanup debt'):backend.stop()
                self.assertEqual(stream.cut_once(timeout=.05)['status'],'UNKNOWN')
            self.assertFalse(original.closed);self.assertTrue(signals)
        finally:release.set();worker.join(2)
        self.assertFalse(worker.is_alive())

    def test_closed_property_does_not_touch_locked_underlying_buffer(self):
        m=load()
        class FragileWriter:
            allow=True
            @property
            def closed(self):
                if not self.allow:raise AssertionError('blocked original property must not be queried')
                return False
        original=FragileWriter();stream=m.GuardedOriginalStdin(original);original.allow=False
        self.assertFalse(stream.closed)

    def test_proof_lane_missing_guard_remains_unknown_not_unsafe_close(self):
        spec=importlib.util.spec_from_file_location('independent_original_missing',Path(__file__).with_name('pq-independent-load.py'))
        driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
        class UnsafeWriter:
            closed=False
            def close(self):raise AssertionError('unguarded close forbidden')
        process=SimpleNamespace(pid=34567,stdin=UnsafeWriter(),poll=lambda:None)
        process._ynx_original_pidfd=SimpleNamespace(send=lambda signum:None)
        w=SimpleNamespace(lock=threading.Lock(),children=[dict(name='load-live-session-0',process=process)],stopping=False)
        backend=driver.NormalBackend.__new__(driver.NormalBackend);backend.live_lane_lock=threading.Lock()
        backend.live_lanes_remaining=1;backend.guarded_shutdown=True;backend.stop_event=threading.Event()
        backend.helper_cleanup_debt=[];backend.w=w;backend.sessions={}
        lane=dict(node=0,retired=False,originalProcess=process)
        backend.retire_live_lane(lane);self.assertEqual(len(backend.helper_cleanup_debt),1)
        with self.assertRaisesRegex(RuntimeError,'proof stdin guard missing'):backend.stop()

    def test_original_proof_lane_clean_cut_drops_only_unsent_buffer(self):
        m=load();reader,writer=os.pipe();raw=os.fdopen(writer,'wb');stream=m.GuardedOriginalStdin(raw)
        spec=importlib.util.spec_from_file_location('independent_original_clean',Path(__file__).with_name('pq-independent-load.py'))
        driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
        process=SimpleNamespace(pid=34567,stdin=stream,wait=lambda timeout:0)
        retired=[];w=SimpleNamespace(retire_log=lambda p:retired.append(p))
        backend=driver.NormalBackend.__new__(driver.NormalBackend)
        backend.live_lane_lock=threading.Lock();backend.live_lanes_remaining=1;backend.guarded_shutdown=True
        backend.stop_event=threading.Event();backend.helper_cleanup_debt=[];backend.w=w
        lane=dict(node=0,retired=False,originalProcess=process)
        try:
            stream.write(b'uncertain-unsent-proof-frame')
            backend.retire_live_lane(lane)
            self.assertEqual(os.read(reader,1024),b'');self.assertTrue(stream.closed)
            self.assertEqual(retired,[process]);self.assertEqual(backend.helper_cleanup_debt,[])
        finally:os.close(reader)

    def test_blocked_original_owner_records_fd_debt_and_signals_only_its_handle(self):
        m=load()
        spec=importlib.util.spec_from_file_location('owner_original',Path(__file__).with_name('pq-public-owner-transport.py'))
        owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)
        entered=threading.Event();release=threading.Event()
        class BlockingWriter:
            closed=False
            def write(self,value):entered.set();release.wait(3);return len(value)
        raw=BlockingWriter();stream=m.GuardedOriginalStdin(raw)
        class Original:
            pid=12345
            stdin=stream
            code=None
            def poll(self):return self.code
            def wait(self,timeout):return self.code
        proc=Original();signals=[]
        def send(signum):signals.append(signum);proc.code=-signum
        proc._ynx_original_pidfd=SimpleNamespace(send=send)
        Session=owner.session_class(object,None,SimpleNamespace(require=lambda value,message:None))
        session=Session.__new__(Session);session.proc=proc;session.require_guarded_stream=True
        worker=threading.Thread(target=lambda:stream.write(b'unknown-owner-command'));worker.start();self.assertTrue(entered.wait(1))
        try:
            with mock.patch.object(m.os,'dup2',side_effect=AssertionError('busy original must not be cut')):
                report=session.retire_poisoned_original()
            self.assertFalse(report['stdinCut']);self.assertTrue(report['stdinRetirement']['cleanupDebt'])
            self.assertEqual(report['stdinRetirement']['status'],'UNKNOWN')
            self.assertTrue(report['terminateRequested']);self.assertTrue(signals)
            self.assertFalse(report['lateRepliesRead']);self.assertFalse(report['originalOperationReplayed'])
            self.assertFalse(raw.closed)
        finally:release.set();worker.join(2)
        self.assertFalse(worker.is_alive());self.assertEqual(stream.cut_once(timeout=.1)['status'],'UNKNOWN')

if __name__=='__main__':unittest.main()
