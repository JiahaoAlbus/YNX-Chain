"""Stopped read resource/caller controls, plus an actual Linux-only observer."""
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

job=module('test_pq_enrollment_linux_private.py');m=job.m
data=module('test_pq_enrollment_stopped_readback.py')


class StoppedResourceControls(unittest.TestCase):
    def setUp(self):
        self.fixture=data.StoppedEnrollmentControls();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root;self.pid=os.getpid();self.birth=17
        info=self.root.stat()
        self.w=SimpleNamespace(lock=threading.RLock(),closed_for_launch=True,launches_closed=True,
            pending_launches={},launch_cleanup_debt=[],known={self.pid:self.birth},children=[],
            storage_roots=[self.root],work=self.root,started=time.monotonic(),
            _enrollment_storage_identities={str(self.root):(info.st_dev,info.st_ino)},
            sample=mock.Mock(side_effect=AssertionError('stopped Window.sample forbidden')))
        self.lifecycle=SimpleNamespace(process=SimpleNamespace(pid=991,returncode=0),window=self.w,registered=True)
        self.w.children=[dict(name='original-enrollment-handshake',process=self.lifecycle.process)]
        self.out=m.initial_report();self.out.update(cleanupComplete=True)
        self.binaries={role:dict(sha256=pin) for role,pin in
                       [('test',self.fixture.binary_pins['testSHA256']),('cli',self.fixture.binary_pins['cliSHA256'])]}
        self.rows={self.pid:dict(startTicks=self.birth,parent=1,state='S',threads=1)}

    def resources(self,**changes):
        stack=ExitStack()
        stack.enter_context(mock.patch.object(m.sys,'platform','linux'))
        stack.enter_context(mock.patch.object(m.lab.guard,'proc_inventory',side_effect=lambda:(self.rows,[])))
        stack.enter_context(mock.patch.object(m.lab,'owned_rss',**({'return_value':4096}|changes)))
        stack.enter_context(mock.patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=20<<30)))
        return stack

    def finish(self):
        m.finish_stopped_readback(self.w,self.lifecycle,self.out,self.fixture.handshake,self.binaries)
        return self.out

    def test_actual_sqlite_socket_file_join_uses_stopped_scope_without_restarting_window(self):
        with self.resources(),mock.patch('subprocess.Popen',side_effect=AssertionError('no producer')):out=self.finish()
        self.assertTrue(out['stoppedReadback']['bothConfirmationByteBindingsObserved'],out)
        self.assertTrue(out['stoppedReadback']['originalPendingPreserved'])
        observed=out['stoppedReadResources'];self.assertEqual(observed['status'],'OBSERVED')
        self.assertEqual((observed['pid'],observed['startTicks']),(self.pid,self.birth))
        self.assertGreater(observed['samples'],2);self.assertTrue(observed['monitorRetired'])
        self.assertFalse(observed['continuousRSSLimitProven'] or out['nonceReleased']);self.w.sample.assert_not_called()
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.0,0.0))

    def test_missing_original_retirement_identity_or_read_pins_never_read(self):
        with mock.patch.object(m.stopped_reader,'audit_stopped_originals',side_effect=AssertionError('no read')):
            self.out['cleanupComplete']=False;out=self.finish();self.assertTrue(out['stoppedReadback']['missingEvidence'])
            self.out['cleanupComplete']=True;self.lifecycle.process.returncode=None
            out=self.finish();self.assertIn('originalReapedProducerHandle',out['stoppedReadback']['missingEvidence'])
            self.lifecycle.process.returncode=0;self.w.known={}
            with self.resources():out=self.finish()
            self.assertIn('startTicks',out['firstCause']['message'])
            self.w.known={self.pid:self.birth};self.w.children=[]
            self.out=m.initial_report();self.out['cleanupComplete']=True
            with self.resources():out=self.finish()
            self.assertIn('originalReapedProducerHandle',out['stoppedReadback']['missingEvidence'])

    def test_missing_or_excess_rss_preserves_original_error_and_no_complete_join(self):
        for value in (None,4*(1<<30)+1):
            self.out=m.initial_report();self.out['cleanupComplete']=True
            self.out['firstCause']=dict(type='EOFError',message='original ACK uncertain')
            with self.resources(return_value=value):out=self.finish()
            self.assertEqual(out['firstCause']['type'],'EOFError')
            self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])
            self.assertEqual(out['stoppedReadResources']['status'],'UNKNOWN')
            self.assertIsNotNone(out['stoppedReadResources']['firstCauseType'])

    def test_changed_supervisor_or_unretired_descendant_cannot_be_filtered_out(self):
        for rows in ({self.pid:dict(self.rows[self.pid],startTicks=18)},
                     dict(self.rows,**{})|{999:dict(startTicks=20,parent=self.pid,state='S',threads=1)}):
            self.rows=rows;self.out=m.initial_report();self.out['cleanupComplete']=True
            with self.resources():out=self.finish()
            self.assertIsNotNone(out['firstCause']);self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])

    def test_original_storage_inode_allocated_bytes_and_disk_reserve_are_enforced(self):
        original=self.w._enrollment_storage_identities.copy()
        self.w._enrollment_storage_identities[str(self.root)]=(1,2)
        with self.resources():out=self.finish()
        self.assertIn('storage identity',out['firstCause']['message'])
        self.w._enrollment_storage_identities=original
        for kind in ('bytes','reserve'):
            self.out=m.initial_report();self.out['cleanupComplete']=True
            with self.resources(),ExitStack() as stack:
                if kind=='bytes':stack.enter_context(mock.patch.object(m.lab,'private_bytes',return_value=(8<<30)+1))
                else:stack.enter_context(mock.patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=(1<<30)-1)))
                out=self.finish()
            self.assertIsNotNone(out['firstCause']);self.assertEqual(out['stoppedReadResources']['status'],'UNKNOWN')

    def test_actual_alarm_interrupts_stuck_read_without_extending_original_total_deadline(self):
        def stuck(**kwargs):time.sleep(2);raise AssertionError('deadline not active')
        self.w.started=time.monotonic()-m.lab.CAPS['totalSeconds']+1.15
        started=time.monotonic()
        with self.resources(),mock.patch.object(m.stopped_reader,'audit_stopped_originals',side_effect=stuck):out=self.finish()
        self.assertLess(time.monotonic()-started,1)
        self.assertEqual(out['firstCause']['type'],'TimeoutError')
        self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.0,0.0))

    def test_close_after_real_fd_release_reports_debt_and_never_retries_number(self):
        scope=None;closed=[];original_close=os.close;factory=m.StoppedReadScope
        def make(window):
            nonlocal scope
            scope=factory(window);return scope
        def closing(fd):
            if scope is not None and fd in getattr(scope,'test_roots',()):
                closed.append(fd);original_close(fd);raise OSError('UNIT close report unknown')
            original_close(fd)
        original_audit=m.stopped_reader.audit_stopped_originals
        def inspect(**kwargs):
            scope.test_roots=tuple(fd for _,fd,_ in scope.roots)
            return original_audit(**kwargs)
        with self.resources(),mock.patch.object(m,'StoppedReadScope',side_effect=make),\
                mock.patch.object(m.stopped_reader,'audit_stopped_originals',side_effect=inspect),mock.patch.object(m.os,'close',side_effect=closing):
            out=self.finish();scope.close()
        self.assertEqual(len(closed),1);self.assertTrue(out['cleanupDebt']);self.assertFalse(out['cleanupComplete'])
        self.assertEqual(out['firstCause']['type'],'OSError');self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])
        m._READ_SCOPE_DEBT.remove(scope) # No FD remains in this injected closed-after-success control.

    def test_original_audit_error_survives_later_directory_close_error(self):
        factory=m.StoppedReadScope;scope=None;original_close=os.close;owned=[]
        def make(window):
            nonlocal scope
            scope=factory(window);return scope
        def refused(**kwargs):
            owned.extend(fd for _,fd,_ in scope.roots)
            result=m.stopped_reader.report();result.update(firstCauseType='EOFError',firstCauseSHA256='a'*64)
            return result
        def close(fd):
            original_close(fd)
            if fd in owned:raise OSError('UNIT secondary directory close failed')
        with self.resources(),mock.patch.object(m,'StoppedReadScope',side_effect=make),\
                mock.patch.object(m.stopped_reader,'audit_stopped_originals',side_effect=refused),mock.patch.object(m.os,'close',side_effect=close):
            out=self.finish()
        self.assertEqual(out['firstCause']['type'],'EOFError');self.assertTrue(out['cleanupDebt'])
        self.assertEqual(out['stoppedReadResources']['firstCauseType'],'OSError')
        self.assertEqual(out['stoppedReadback']['firstCauseSHA256'],'a'*64)
        m._READ_SCOPE_DEBT.remove(scope)

    def test_close_raising_after_actual_retirement_still_returns_unknown_for_job_retention(self):
        factory=m.StoppedReadScope;scope=None
        def make(window):
            nonlocal scope
            scope=factory(window);close=scope.close
            def failed():close();raise OSError('UNIT close method reported failure after retirement')
            scope.close=failed;return scope
        with self.resources(),mock.patch.object(m,'StoppedReadScope',side_effect=make):out=self.finish()
        self.assertTrue(out['cleanupDebt']);self.assertFalse(out['cleanupComplete'])
        self.assertEqual(out['firstCause']['type'],'OSError')
        self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])
        self.assertFalse(scope.monitor.thread.is_alive());self.assertEqual(scope.roots,[])
        m._READ_SCOPE_DEBT.remove(scope)

    def test_periodic_resource_error_is_latched_while_reader_is_active(self):
        reached=threading.Event()
        def rss(*args):
            if threading.current_thread() is not threading.main_thread():reached.set();raise OSError('UNIT periodic RSS unavailable')
            return 4096
        def reader(**kwargs):
            self.assertTrue(reached.wait(1));kwargs['check_resources']();return m.stopped_reader.report()
        with self.resources(side_effect=rss),mock.patch.object(m.stopped_reader,'audit_stopped_originals',side_effect=reader):out=self.finish()
        self.assertEqual(out['firstCause']['type'],'OSError');self.assertIn('periodic RSS',out['firstCause']['message'])
        self.assertFalse(out['stoppedReadback']['bothConfirmationByteBindingsObserved'])

    def test_busy_observer_close_keeps_fd_custody_and_reports_unknown(self):
        entered=threading.Event();release=threading.Event();scope=None
        def rss(*args):
            if threading.current_thread() is not threading.main_thread():entered.set();release.wait(2)
            return 4096
        with self.resources(side_effect=rss):
            try:
                scope=m.StoppedReadScope(self.w);scope.start();self.assertTrue(entered.wait(1))
                roots=list(scope.roots);started=time.monotonic();scope.close()
                self.assertLess(time.monotonic()-started,.8);self.assertTrue(scope.cleanup_debt)
                self.assertIn(scope,m._READ_SCOPE_DEBT)
                for _,fd,_ in roots:os.fstat(fd)
            finally:
                release.set()
                if scope is not None and scope.monitor is not None:
                    scope.monitor.thread.join(1);self.assertFalse(scope.monitor.thread.is_alive())
                    # Only this control owns these still-open originals; no
                    # close had yet been attempted by the timed-out path.
                    for _,fd,_ in scope.roots:os.close(fd)
                    scope.roots=[]
                    if scope in m._READ_SCOPE_DEBT:m._READ_SCOPE_DEBT.remove(scope)

    def test_original_job_invokes_stopped_continuation_after_stop_and_before_private_retention(self):
        fixture=job.HostedSyntheticReservationControls();fixture.setUp();self.addCleanup(fixture.doCleanups)
        events=fixture.events
        def continuation(window,lifecycle,out,handshake,binaries):
            self.assertEqual(events[-1],'original-window-stop');self.assertTrue(out['cleanupComplete'])
            self.assertIsNotNone(handshake);self.assertEqual(set(binaries),{'test','cli'})
            self.assertIsNotNone(window._enrollment_storage_identities);events.append('stopped-byte-read')
        with fixture.controls(),mock.patch.object(m,'finish_stopped_readback',side_effect=continuation):
            out=m.run(fixture.source,fixture.parent,enabled=True)
        self.assertIsNone(out['firstCause']);self.assertEqual(events[-1],'stopped-byte-read')
        self.assertEqual(events.count('sole-private-callee'),1)
        fixture.parent=fixture.base/'another-controlled-job';fixture.parent.mkdir(mode=0o700)
        with fixture.controls(),mock.patch.object(m,'finish_stopped_readback',side_effect=KeyboardInterrupt('UNIT read cancelled')):
            refused=m.run(fixture.source,fixture.parent,enabled=True)
        self.assertEqual(refused['firstCause']['type'],'KeyboardInterrupt')
        self.assertTrue(refused['cleanupDebt']);self.assertFalse(refused['cleanupComplete'])
        retained=json.loads((fixture.window.work/'.private/readback.json').read_bytes())
        self.assertEqual(retained['firstCause'],refused['firstCause']);self.assertTrue(retained['cleanupDebt'])

    def test_missing_stopped_evidence_prevents_cli_success_and_public_extra_fields(self):
        out=m.initial_report()
        for key in ('normalFixtureTestPassed','localPairReservationObserved','peerAckBytesMatch','bothOutboxRequestBytesMatch','cleanupComplete'):out[key]=True
        with mock.patch.object(m,'run',return_value=out),mock.patch.object(m,'publish'):
            self.assertEqual(m.main(['--execute','--source-directory','/CONTROL','--work-parent','/CONTROL','--public-output','/CONTROL']),2)
        out['stoppedReadback']['unexpectedPrivatePath']='/PRIVATE'
        with self.assertRaisesRegex(ValueError,'closed stopped'):m.public_projection(out)

    def test_stopped_scope_cannot_overwrite_an_existing_alarm_owner(self):
        with self.resources(),mock.patch.object(m.signal,'getitimer',return_value=(1.0,0.0)),\
                mock.patch.object(m.signal,'signal',side_effect=AssertionError('existing timer owner unchanged')):
            out=self.finish()
        self.assertIn('timer already owned',out['firstCause']['message'])

    @unittest.skipUnless(sys.platform=='linux','actual original Linux proc/RSS observer required')
    def test_actual_linux_original_window_stop_then_read_scope_samples_same_pid(self):
        script="""import importlib.util,json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('actual_stopped_scope',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
work=pathlib.Path(sys.argv[2]);(work/'.private').mkdir();(work/'public').mkdir()
w=m.lab.Window(p.parents[2],work)
i=work.stat();w._enrollment_storage_identities={str(work):(i.st_dev,i.st_ino)}
w.sample();assert w.stop() is True
scope=m.StoppedReadScope(w)
try:scope.start();scope.check(final=True)
finally:scope.close()
out=scope.report();assert out['status']=='OBSERVED' and out['monitorRetired'];assert out['pid']==os.getpid();assert out['startTicks']>0
print(json.dumps(out,sort_keys=True))
"""
        work=self.root/'actual-observer';work.mkdir(mode=0o700)
        child=subprocess.Popen([sys.executable,'-B','-c',script,str(Path(m.__file__).resolve()),str(work)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:stdout,stderr=child.communicate(timeout=8)
        except BaseException:
            child.kill();child.wait(timeout=2);raise
        self.assertEqual(child.returncode,0,stderr.decode());observed=json.loads(stdout)
        self.assertEqual(observed['caps']['rssBytes'],4<<30);self.assertFalse(observed['continuousRSSLimitProven'])


if __name__=='__main__':unittest.main(verbosity=2)
