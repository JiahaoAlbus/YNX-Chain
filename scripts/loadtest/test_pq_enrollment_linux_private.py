"""Hosted job wiring controls. Controlled builds are NOT normal Core evidence."""
import copy
import gc
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import select
import tempfile
import threading
import subprocess
import sys
from types import SimpleNamespace
import unittest
import weakref
from unittest import mock


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=module('pq-enrollment-linux-private.py')
controls=module('test_pq_enrollment_reservation_transport.py')


class HostedSyntheticReservationControls(unittest.TestCase):
    def setUp(self):
        self.fixture=controls.EnrollmentReservationTransportControls();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.base=self.fixture.base;self.parent=self.base/'job';self.parent.mkdir(mode=0o700)
        self.source=self.base/'source';self.source.mkdir()
        self.events=[];self.fail_step=None;self.stop_error=None;self.failure_snapshot=None
        self.sample_error=None;self.callee_result=None;self.stop_result=True

    def controls(self):
        outer=self
        class Window:
            def __init__(self,source,work):
                self.source,self.work=source,work;self.lock=threading.RLock();self.env={};self.children=[];self.known={}
                self.peak_rss=12;self.peak_bytes=34
                (work/'.private/bin').mkdir();outer.window=self
            def _sample(self):
                if outer.sample_error:raise outer.sample_error
            def sample(self):
                with self.lock:self._sample()
            def launch(self,name,argv,**options):
                outer.events.append(name)
                outer.assertIsNotNone(self._pq_resource_monitor.thread.ident)
                outer.assertTrue(options['thread_safe'] and options['private_log'])
                outer.assertIs(options['stop'],self._pq_resource_monitor.stop_event)
                (self.work/'.private'/ (name+'.log')).write_bytes(b'go1.26.11\n' if name=='original-go-version' else b'PRIVATE CONTROL\n')
                if name in ('original-cli-build','original-test-build'):
                    p=Path(argv[argv.index('-o')+1]);p.write_bytes(b'SYNTHETIC NOT EXECUTABLE');p.chmod(0o700)
                    outer.assertIn('-buildvcs=true',argv);outer.assertIn('-mod=readonly',argv)
                if name=='original-create':
                    root=Path(argv[argv.index('--root')+1]);shutil.copytree(outer.fixture.root,root);root.chmod(0o700)
                    plan=json.loads((root/'network-plan.json').read_bytes());plan['rootDir']=str(root)
                    (root/'network-plan.json').write_bytes(m.r.original.canonical(plan))
                    private=root/'workload/private-senders';private.mkdir(mode=0o700)
                    (private/'recovery.raw').write_bytes(b'C'*32);(private/'recovery.raw').chmod(0o600)
                code=91 if outer.fail_step==name else 0
                proc=SimpleNamespace(pid=999,returncode=code,poll=lambda:code)
                self.children.append(dict(name=name,process=proc));return proc
            def stop(self):
                outer.events.append('original-window-stop')
                outer.assertFalse(self._pq_resource_monitor.thread.is_alive())
                outer.assertIsNotNone(self.launch_cleanup_deadline)
                if outer.stop_error:raise outer.stop_error
                return outer.stop_result
            def process_receipt(self):return [dict(name='CONTROL',pid=999,command=['PRIVATE CONTROL'])]
            def launch_cleanup_report(self):return dict(status='OBSERVED',pending=[],cleanupDebt=[])
            def _cleanup_wait_remaining(self):return 1
        def callee(**kwargs):
            self.events.append('sole-private-callee')
            self.assertEqual(kwargs['source'],m.HOSTED_SYNTHETIC_SOURCE['commit'])
            self.assertEqual(os.fstat(kwargs['credential_fd']).st_size,32)
            self.assertIsInstance(kwargs['launch_lifecycle'],m.PendingFixtureLaunch)
            self.assertEqual(kwargs['binding'].keys(),{'testSHA256','cliSHA256'})
            kwargs['check_resources']()
            return self.callee_result or dict(normalFixtureTestPassed=True,firstCause=None,cleanupDebt=False,
                database=dict(bytes=4096,sha256='a'*64,planSHA256='b'*64),descendantCleanupRequired=True)
        stack=__import__('contextlib').ExitStack()
        stack.enter_context(mock.patch.object(m,'hosted_parent',side_effect=lambda p:p))
        stack.enter_context(mock.patch.object(m,'check_source',return_value={k:m.HOSTED_SYNTHETIC_SOURCE[k] for k in ('commit','tree','forkTree')}))
        stack.enter_context(mock.patch.object(m.lab,'check_source',return_value=dict(commit='1'*40,tree='2'*40,forkTree='3'*40)))
        stack.enter_context(mock.patch.object(m.lab,'git',return_value='1'*40))
        stack.enter_context(mock.patch.dict(os.environ,{'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1'}))
        stack.enter_context(mock.patch.object(m.lab.guard,'proc_inventory',return_value=({},[])))
        stack.enter_context(mock.patch.object(m.lab.guard,'memory_available',return_value=10<<30))
        stack.enter_context(mock.patch.object(m.lab,'heavy_processes',return_value=[]))
        stack.enter_context(mock.patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=20<<30)))
        stack.enter_context(mock.patch.object(m,'enable_original_subreaper'))
        stack.enter_context(mock.patch.object(m.resource,'setrlimit'))
        stack.enter_context(mock.patch.object(m.lab,'Window',Window))
        stack.enter_context(mock.patch.object(m.r,'_run_synthetic_fixture',side_effect=callee))
        stack.enter_context(mock.patch.object(m,'private_audit',return_value=(dict(localPairReservationObserved=True,
            peerAckBytesMatch=True,bothOutboxRequestBytesMatch=True,firstCause=None,cleanupDebt=False),
            dict(bytes=4096,sha256='a'*64,planSHA256='b'*64),{})))
        return stack

    def test_closed_source_refuses_before_private_io_or_process(self):
        with mock.patch.object(m,'HOSTED_SYNTHETIC_SOURCE',None),mock.patch.object(m.os,'open',side_effect=AssertionError('no file')):
            result=m.run('/not-supplied','/not-supplied',enabled=True)
        self.assertEqual(result['status'],'UNKNOWN');self.assertIn('not supplied',result['firstCause']['message'])
        self.assertFalse(result['normalFixtureTestPassed'] or result['cleanupComplete'])

    def test_hosted_original_attempt_and_temp_cannot_be_replaced(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_RUN_ATTEMPT':'1',
             'GITHUB_RUN_ID':'123','RUNNER_TEMP':str(self.parent)}
        with mock.patch.dict(os.environ,env),mock.patch.object(m.sys,'platform','linux'):
            self.assertEqual(m.hosted_parent(self.parent),self.parent)
            with self.assertRaisesRegex(ValueError,'RUNNER_TEMP'):m.hosted_parent(self.base)
            with mock.patch.dict(os.environ,{'GITHUB_RUN_ATTEMPT':'2'}):
                with self.assertRaisesRegex(ValueError,'cannot be rerun'):m.hosted_parent(self.parent)
            with mock.patch.object(m.sys,'platform','darwin'):
                with self.assertRaisesRegex(ValueError,'Linux'):m.hosted_parent(self.parent)

    def test_exact_source_tree_fork_and_all_seven_abi_blobs_required(self):
        fixed=m.identity();self.assertEqual(len(fixed['blobs']),7)
        actual={k:fixed[k] for k in ('commit','tree','forkTree')}
        with mock.patch.object(m.lab,'check_source',return_value=actual),mock.patch.object(m.lab,'git',side_effect=lambda source,cmd,arg:fixed['blobs'][arg[5:]]):
            self.assertEqual(m.check_source(self.source),actual)
        with mock.patch.object(m.lab,'check_source',return_value=dict(actual,tree='f'*40)):
            with self.assertRaisesRegex(ValueError,'tree/fork'):m.check_source(self.source)
        with mock.patch.object(m.lab,'check_source',return_value=actual),mock.patch.object(m.lab,'git',return_value='f'*40):
            with self.assertRaisesRegex(ValueError,'ABI blob'):m.check_source(self.source)

    def test_controlled_full_job_orders_monitor_build_create_one_callee_and_original_cleanup(self):
        with self.controls():result=m.run(self.source,self.parent,enabled=True)
        self.assertIsNone(result['firstCause']);self.assertTrue(result['cleanupComplete'])
        self.assertEqual(self.events,['original-go-version','original-cli-build','original-test-build','original-create',
                                      'sole-private-callee','original-window-stop'])
        self.assertTrue(result['peerAckBytesMatch'] and result['normalFixtureTestPassed'])
        self.assertEqual(result['originalProcessReceipt'][0]['pid'],999)
        self.assertEqual(len(result['privateProcessReceiptSHA256']),64)
        self.assertEqual(result['status'],'UNKNOWN');self.assertFalse(result['nonceReleased'] or result['runtimeAuthorized'])
        self.assertEqual(result['steps'][1]['name'],'original-cli-build')
        self.assertTrue((self.parent/'pq-enrollment-synthetic-once.lock').is_file())

    def test_failed_original_build_cannot_create_custody_or_enter_handshake(self):
        self.fail_step='original-test-build'
        with self.controls():result=m.run(self.source,self.parent,enabled=True)
        self.assertEqual(result['steps'][-1]['returnCode'],91)
        self.assertNotIn('original-create',self.events);self.assertNotIn('sole-private-callee',self.events)
        self.assertTrue(result['cleanupComplete']);self.assertIsNotNone(result['firstCause'])

    def test_initial_resource_refusal_keeps_attempt_and_never_starts_window(self):
        with self.controls(),mock.patch.object(m.lab,'admit',side_effect=RuntimeError('original memory below threshold')):
            result=m.run(self.source,self.parent,enabled=True)
        self.assertEqual(self.events,[]);self.assertFalse(result['cleanupComplete'])
        self.assertTrue((self.parent/'pq-enrollment-synthetic-once.lock').is_file())
        with self.controls():second=m.run(self.source,self.parent,enabled=True)
        self.assertEqual(second['firstCause']['type'],'FileExistsError');self.assertEqual(self.events,[])

    def test_partial_ack_first_cause_survives_audit_and_cleanup_failure(self):
        self.callee_result=dict(normalFixtureTestPassed=False,firstCause=dict(type='EOFError',message='original ACK uncertain'),
                                cleanupDebt=True,database=dict(bytes=4096,sha256='a'*64,planSHA256='b'*64))
        self.stop_error=RuntimeError('secondary original retirement failure')
        with self.controls(),mock.patch.object(m,'private_audit',side_effect=FileNotFoundError('partial outbox')):
            result=m.run(self.source,self.parent,enabled=True)
        self.assertEqual(result['firstCause']['type'],'EOFError');self.assertTrue(result['cleanupDebt'])
        self.assertFalse(result['cleanupComplete'] or result['nonceReleased']);self.assertEqual(self.events.count('sole-private-callee'),1)

    def test_original_window_false_retirement_is_cleanup_debt_and_keeps_first_cause(self):
        self.stop_result=False
        with self.controls():result=m.run(self.source,self.parent,enabled=True)
        self.assertFalse(result['cleanupComplete']);self.assertTrue(result['cleanupDebt'])
        self.assertIn('not fully retired',result['firstCause']['message'])
        self.parent=self.base/'second-job';self.parent.mkdir(mode=0o700);self.fail_step='original-cli-build'
        with self.controls():failed=m.run(self.source,self.parent,enabled=True)
        self.assertTrue(failed['cleanupDebt']);self.assertIn('original-cli-build failed',failed['firstCause']['message'])

    def test_monitor_failure_before_first_launch_preserves_typed_resource_first_cause(self):
        self.sample_error=RuntimeError('original owned RSS exceeded')
        with self.controls():result=m.run(self.source,self.parent,enabled=True)
        self.assertEqual(self.events,['original-window-stop'])
        self.assertEqual(result['resourceFailureType'],'RuntimeError')
        self.assertIn('owned RSS',result['firstCause']['message']);self.assertTrue(result['monitorRetired'])

    def test_public_projection_excludes_paths_payload_error_text_and_process_argv(self):
        value=m.initial_report();secret='PRIVATE-CONTROL-NOT-FOR-PUBLIC'
        value.update(firstCause=dict(type='OSError',message=secret),privateRoot=secret,credential=secret,
            process=dict(argv=[secret]),cleanupErrors=[dict(type='ValueError',message=secret)],
            steps=[dict(name='original-create',returnCode=1,elapsedNs=3,argv=[secret])])
        target=self.base/'public-summary';m.publish(target,value)
        raw=(target/'SUMMARY.json').read_text();self.assertNotIn(secret,raw)
        self.assertEqual(set(p.name for p in target.iterdir()),{'SUMMARY.json'})
        self.assertEqual(json.loads(raw)['firstCauseType'],'OSError')
        with self.assertRaisesRegex(ValueError,'fresh'):m.publish(target,value)

    def test_private_pending_constructor_leaves_resource_lock_free_and_cannot_publish_after_stop(self):
        window=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:1)
        stop=threading.Event();pending=m.PendingFixtureLaunch(window,stop);entered=threading.Event();release=threading.Event()
        errors=[];proc=SimpleNamespace(pid=123,returncode=0,poll=lambda:0,wait=lambda timeout=None:0,
                                      send_signal=lambda sig:None,terminate=lambda:None,kill=lambda:None)
        def constructor():
            try:
                pending.begin();entered.set();release.wait(2)
                pending.publish(proc,['ORIGINAL CONTROL'])
            except BaseException as error:errors.append(error)
            finally:pending.finish(proc)
        with mock.patch.object(m.lab.guard,'bounded',return_value=b'CONTROL'),mock.patch.object(m.lab.guard,'parse_stat',return_value={'startTicks':4}):
            thread=threading.Thread(target=constructor);thread.start()
            try:
                self.assertTrue(entered.wait(1));self.assertTrue(window.lock.acquire(blocking=False));window.lock.release()
                self.assertIsNone(window.pending_launches[pending.token]['process'])
                window.launch_guard_failure=RuntimeError('original pending resource cap');stop.set()
            finally:release.set();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(str(errors[0]),'original pending resource cap')
        self.assertEqual(len(window.children),1);self.assertIs(window.children[0]['process'],proc)
        self.assertFalse(window.pending_launches);self.assertTrue(window.launch_lock.acquire(blocking=False));window.launch_lock.release()

    def test_private_registration_failure_keeps_exact_handle_and_never_rebinds_or_signals(self):
        window=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:1)
        pending=m.PendingFixtureLaunch(window,threading.Event());proc=SimpleNamespace(pid=123,returncode=0,poll=lambda:0)
        pending.begin()
        with mock.patch.object(m.lab,'bind_process_lifecycle',side_effect=RuntimeError('original binding failed')) as bind:
            with self.assertRaisesRegex(RuntimeError,'binding failed'):pending.publish(proc,['ORIGINAL CONTROL'])
            pending.finish(proc)
        bind.assert_called_once_with(proc);self.assertIs(window.children[0]['process'],proc)
        self.assertFalse(window.pending_launches)
        with mock.patch.object(m.lab.os,'kill') as kill,mock.patch.object(m.lab.os,'killpg') as group:
            with self.assertRaisesRegex(RuntimeError,'pidfd missing'):m.lab.signal_original_child(proc,signal.SIGTERM)
            kill.assert_not_called();group.assert_not_called()

    def test_real_child_is_retained_when_publish_and_finish_cannot_acquire_window_lock(self):
        window=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:.05)
        stop=threading.Event();pending=m.PendingFixtureLaunch(window,stop);pending.begin()
        proc=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)'],
                              stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        held=threading.Event();release=threading.Event()
        def holder():
            with window.lock:held.set();release.wait(5)
        thread=threading.Thread(target=holder);thread.start()
        try:
            self.assertTrue(held.wait(1))
            with self.assertRaisesRegex(RuntimeError,'lifecycle lock unavailable'):
                pending.publish(proc,['ORIGINAL CONTROL'])
            with self.assertRaisesRegex(RuntimeError,'lifecycle lock unavailable'):
                pending.finish(proc,['ORIGINAL CONTROL'])
            self.assertIsNone(proc.poll()) # The real child has NOT retired.
            self.assertIs(window.pending_launches[pending.token]['process'],proc)
            self.assertIs(pending.process,proc)
            self.assertTrue(stop.is_set() and window.closed_for_launch)
            self.assertTrue(window.pending_launches[pending.token]['cleanupDebt'])
            self.assertTrue(window.launch_lock.acquire(blocking=False));window.launch_lock.release()
        finally:
            release.set();thread.join(2)
            # Test-owned original handle only; no numeric-PID recovery/replay.
            proc.kill();proc.wait(timeout=2)
            pending.finish(proc,['ORIGINAL CONTROL'])

    def test_process_level_custody_survives_dropped_window_and_gc_until_original_reap(self):
        window=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:.05)
        pending=m.PendingFixtureLaunch(window,threading.Event());pending.begin()
        proc=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)'],
                              stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        pending.retain(proc,['CONTROL']);handle=weakref.ref(proc);owner=weakref.ref(pending);token=pending.token
        del proc,pending,window;gc.collect()
        try:
            self.assertIsNotNone(handle());self.assertIsNotNone(owner())
            self.assertIs(m._CUSTODY['owners'][token],owner());self.assertIsNone(handle().poll())
        finally:
            process=handle();held=owner();process.kill();process.wait(timeout=2);held.finish(process,['CONTROL'])
        self.assertNotIn(token,m._CUSTODY['owners'])
        with self.assertRaisesRegex(ValueError,'cannot be reused'):held.begin()

    def test_window_signals_the_same_attached_identity_without_numeric_fallback(self):
        w=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:.05)
        proc=SimpleNamespace(pid=123,returncode=None,poll=lambda:proc.returncode,wait=lambda timeout=None:proc.returncode,
            send_signal=lambda sig:None,terminate=lambda:None,kill=lambda:None)
        pending=m.PendingFixtureLaunch(w,threading.Event());pending.begin();fd=os.open(os.devnull,os.O_RDONLY)
        # Controlled identity FD only. Actual pidfd handoff is a separate Linux control.
        pending.retain(proc,['CONTROL'],pidfd=fd)
        try:
            with mock.patch.object(m.lab.guard,'bounded',return_value=b'CONTROL'),mock.patch.object(m.lab.guard,'parse_stat',return_value={'startTicks':4}):
                pending.publish(proc,['CONTROL'])
            self.assertFalse(w.pending_launches);self.assertIs(proc._ynx_original_pidfd,pending)
            with mock.patch.object(m.signal,'pidfd_send_signal',create=True) as send, \
                 mock.patch.object(m.lab.os,'killpg',side_effect=AssertionError('numeric group forbidden')), \
                 mock.patch.object(m.lab.os,'kill',side_effect=AssertionError('numeric PID forbidden')):
                m.lab.signal_original_child(proc,signal.SIGTERM)
            send.assert_called_once_with(fd,signal.SIGTERM,None,0)
        finally:
            proc.returncode=0;pending.finish(proc,['CONTROL'])
        self.assertIsNone(pending.pidfd)
        with self.assertRaisesRegex(ValueError,'identity differs'):pending.retain(proc,['CONTROL'],pidfd=fd)

    def test_pidfd_close_error_cannot_close_a_reused_descriptor_on_second_finish(self):
        window=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:.05)
        pending=m.PendingFixtureLaunch(window,threading.Event());pending.begin()
        proc=SimpleNamespace(pid=123,returncode=0,poll=lambda:0)
        # Real descriptor reuse tests close responsibility, not Linux pidfd identity.
        original=os.open(os.devnull,os.O_RDONLY);replacement=[];calls=[];close=os.close
        pending.retain(proc,['CONTROL'],pidfd=original)
        def closed_then_error(fd):
            calls.append(fd);close(fd)
            replacement.append(os.open(os.devnull,os.O_RDONLY))
            self.assertEqual(replacement[0],original)
            raise OSError('CONTROL close result unknown after descriptor released')
        try:
            with mock.patch.object(m.os,'close',side_effect=closed_then_error):
                for _ in range(2):
                    with self.assertRaisesRegex(OSError,'close result unknown'):pending.finish(proc,['CONTROL'])
            self.assertEqual(calls,[original]);os.fstat(replacement[0])
            self.assertIsNone(pending.pidfd);self.assertIsNone(pending.pending['pidfd'])
            self.assertEqual(pending.pending['pidfdCloseStatus'],'UNKNOWN')
            self.assertTrue(pending.pending['cleanupDebt']);self.assertFalse(window.children)
        finally:
            if replacement:close(replacement[0])
            elif pending.pidfd is not None:close(pending.pidfd)

    def test_original_workflow_is_opt_in_after_controls_and_uploads_one_public_file(self):
        text=(Path(__file__).parents[2]/'.github/workflows/chain-core.yml').read_text()
        self.assertIn('default: false',text)
        job=text.split('\n  enrollment-private-synthetic:\n',1)[1]
        self.assertIn('needs: verify',job);self.assertIn('inputs.enrollment_private_synthetic == true',job)
        self.assertIn('--source-directory "$GITHUB_WORKSPACE/core"',job)
        self.assertEqual(job.count('actions/upload-artifact@'),1)
        self.assertIn('path: ${{ runner.temp }}/pq-enrollment-public-summary/SUMMARY.json',job)
        self.assertNotIn('path: ${{ runner.temp }}/\n',job)
        self.assertIn("'test_pq_enrollment_linux_private.py': 22",text)
        self.assertIsNone(m.r.NORMAL_RESERVATION_PRODUCER)
        self.assertEqual(m.r.SYNTHETIC_FIXTURE_BINARIES,{})

    def orphan_case(self,blocked=False):
        script=r'''
import importlib.util,json,os,pathlib,sys,time
source=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2]);blocked=sys.argv[3]=='1'
spec=importlib.util.spec_from_file_location('original_private_job',source/'pq-enrollment-linux-private.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.enable_original_subreaper()
work.mkdir(mode=0o700);(work/'.private').mkdir(mode=0o700);(work/'public').mkdir(mode=0o700)
w=m.lab.Window(source,work);child=None;clean=False
try:
    # Self deadline is only a test resource fuse if the readiness pipe itself
    # fails. It is never counted as Window retirement or a successful assertion.
    code="import os,signal,time; p=os.fork(); (signal.alarm(12),time.sleep(30)) if p==0 else print(p,flush=True); os._exit(0)"
    p=w.launch('synthetic-fast-leader',[sys.executable,'-c',code],private_log=True)
    p.wait(timeout=2)
    child=int((work/'.private/synthetic-fast-leader.log').read_text().strip())
    row=m.lab.guard.parse_stat(m.lab.guard.bounded(pathlib.Path('/proc')/str(child)/'stat'),child)
    assert row['parent']==os.getpid() and child not in w.known
    print(json.dumps(dict(pid=child,startTicks=row['startTicks'])),flush=True)
    if blocked:time.sleep(30)
    clean=w.stop()
    assert clean and not (pathlib.Path('/proc')/str(child)).exists()
    print(json.dumps(dict(adopted=True,cleanupComplete=clean)),flush=True)
finally:
    if not clean:w.stop()
'''
        proc=subprocess.Popen([sys.executable,'-B','-c',script,str(Path(__file__).parent),str(self.base/'linux-supervisor'),str(int(blocked))],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        supervisor_fd=os.pidfd_open(proc.pid,0);child_fd=None
        try:
            self.assertTrue(select.select([proc.stdout],[],[],5)[0],'original readiness not supplied')
            ready=json.loads(proc.stdout.readline(512));self.assertEqual(set(ready),{'pid','startTicks'})
            self.assertIs(type(ready['pid']),int);self.assertIs(type(ready['startTicks']),int)
            def identity():
                value=m.lab.guard.parse_stat(m.lab.guard.bounded(Path('/proc')/str(ready['pid'])/'stat'),ready['pid'])
                self.assertEqual((value['parent'],value['startTicks']),(proc.pid,ready['startTicks']))
            identity();child_fd=os.pidfd_open(ready['pid'],0);identity()
            try:stdout,stderr=proc.communicate(timeout=1 if blocked else 10)
            except subprocess.TimeoutExpired:
                self.assertTrue(blocked,'unexpected original supervisor timeout')
                # Child has its OWN session. Both kernel handles were bound
                # before timeout; no supervisor-only killpg or numeric fallback.
                signal.pidfd_send_signal(child_fd,signal.SIGKILL)
                signal.pidfd_send_signal(supervisor_fd,signal.SIGKILL)
                proc.wait(timeout=2)
                self.assertTrue(select.select([child_fd],[],[],2)[0],'original orphan has not exited')
                return dict(status='UNKNOWN',cleanupDebt=True,firstCause='TimeoutExpired')
            self.assertFalse(blocked,'blocking control unexpectedly completed')
            self.assertEqual(proc.returncode,0,stderr.decode())
            return json.loads(stdout)
        finally:
            for fd in (child_fd,supervisor_fd):
                if fd is not None:
                    try:signal.pidfd_send_signal(fd,signal.SIGKILL)
                    except ProcessLookupError:pass
            proc.wait(timeout=2)
            for fd in (child_fd,supervisor_fd):
                if fd is not None:os.close(fd)

    @unittest.skipUnless(sys.platform=='linux','real Linux subreaper and /proc required; no Mac substitute')
    def test_real_linux_fast_leader_orphan_is_adopted_then_retired_by_original_window(self):
        self.assertEqual(self.orphan_case(),dict(adopted=True,cleanupComplete=True))

    @unittest.skipUnless(sys.platform=='linux','real Linux pidfd timeout cleanup required; no Mac substitute')
    def test_real_linux_orphan_timeout_uses_both_original_handles_and_keeps_debt(self):
        self.assertEqual(self.orphan_case(True),dict(status='UNKNOWN',cleanupDebt=True,firstCause='TimeoutExpired'))

    @unittest.skipUnless(sys.platform=='linux','real Linux callee and Window lifecycle required; no Mac substitute')
    def test_real_private_invoke_publishes_bound_handle_before_original_window_retirement(self):
        script=r'''
import importlib.util,pathlib,sys,threading
source=pathlib.Path(sys.argv[1])
def load(name):
 s=importlib.util.spec_from_file_location(name,source/name);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('pq-enrollment-linux-private.py');t=load('test_pq_enrollment_reservation_driver.py')
x=t.EnrollmentReservationDriverControls();x.setUp();w=None
try:
 work=x.base/'actual-window';work.mkdir();(work/'.private').mkdir();(work/'public').mkdir()
 w=m.lab.Window(x.source,work);binary=x.binary();args=x.args(binary);args.pop('enabled')
 with x.bound(binary):
  binding=t.m.SYNTHETIC_FIXTURE_BINARIES[(t.m.INSPECTED_SYNTHETIC_HANDSHAKE,t.m.original.platform.system(),t.m.original.platform.machine())]
  out=t.m._run_synthetic_fixture(binding=binding,launch_lifecycle=m.PendingFixtureLaunch(w,threading.Event()),**args)
 assert out['firstCause'] is None and out['originalProcess']['processReaped'],out
 assert len(w.children)==1 and '_ynx_lifecycle_lock' in vars(w.children[0]['process'])
 assert not w.pending_launches and w.stop() is True
 print('ORIGINAL_CALLEE_AND_WINDOW_RETIRED')
finally:
 if w is not None:w.stop()
 x.doCleanups()
'''
        result=subprocess.run([sys.executable,'-B','-c',script,str(Path(__file__).parent)],capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        self.assertEqual(result.stdout.strip(),b'ORIGINAL_CALLEE_AND_WINDOW_RETIRED')

    @unittest.skipUnless(sys.platform=='linux','real Linux pidfd and unreaped original child required; no Mac substitute')
    def test_actual_invoke_keeps_pidfd_and_strong_handle_after_both_lock_failures(self):
        t=module('test_pq_enrollment_reservation_driver.py')
        x=t.EnrollmentReservationDriverControls();x.setUp();self.addCleanup(x.doCleanups)
        w=SimpleNamespace(lock=threading.RLock(),launch_lock=threading.Lock(),sample=mock.Mock(),
            closed_for_launch=False,launches_closed=False,launch_cleanup_debt=[],pending_launches={},children=[],known={},
            launch_guard_failure=None,_cleanup_wait_remaining=lambda:.05)
        entered=threading.Event();release=threading.Event();threads=[]
        class LockedPending(m.PendingFixtureLaunch):
            def begin(self):
                super().begin()
                def hold():
                    with w.lock:entered.set();release.wait(10)
                thread=threading.Thread(target=hold);threads.append(thread);thread.start()
                if not entered.wait(1):raise RuntimeError('test lock holder missing')
        pending=LockedPending(w,threading.Event());binary=x.binary(before='import time;time.sleep(30)')
        args=x.args(binary);args.pop('enabled')
        original_signal=signal.pidfd_send_signal
        try:
            with x.bound(binary),mock.patch.object(signal,'pidfd_send_signal',side_effect=PermissionError('CONTROL retirement denied')):
                binding=t.m.SYNTHETIC_FIXTURE_BINARIES[(t.m.INSPECTED_SYNTHETIC_HANDSHAKE,t.m.original.platform.system(),t.m.original.platform.machine())]
                out=t.m._run_synthetic_fixture(binding=binding,launch_lifecycle=pending,**args)
            self.assertFalse(out['normalFixtureTestPassed'] or out['originalProcess']['processReaped'])
            self.assertTrue(out['cleanupDebt']);self.assertEqual(out['firstCause']['type'],'RuntimeError')
            self.assertIn('lifecycle lock unavailable',out['firstCause']['message'])
            self.assertTrue(any(e['type']=='PermissionError' for e in out['originalProcess']['cleanupErrors']))
            self.assertIs(w.pending_launches[pending.token]['process'],pending.process)
            self.assertIsNone(pending.process.poll());self.assertIsNotNone(pending.pidfd)
            self.assertEqual(select.select([pending.pidfd],[],[],0)[0],[]) # Still the LIVE original child.
        finally:
            release.set()
            for thread in threads:thread.join(2)
            if pending.pidfd is not None:
                original_signal(pending.pidfd,signal.SIGKILL);pending.process.wait(timeout=2)
                pending.finish(pending.process)
        self.assertIsNone(pending.pidfd)

    @unittest.skipUnless(sys.platform=='linux','real Linux original callee to Window pidfd handoff required; no Mac substitute')
    def test_unreaped_published_callee_passes_same_pidfd_to_original_window_stop(self):
        t=module('test_pq_enrollment_reservation_driver.py')
        x=t.EnrollmentReservationDriverControls();x.setUp();self.addCleanup(x.doCleanups)
        work=x.base/'actual-owned-window';work.mkdir();(work/'.private').mkdir();(work/'public').mkdir()
        w=m.lab.Window(x.source,work);pending=m.PendingFixtureLaunch(w,threading.Event())
        observed=x.base/'ack-observed';binary=x.binary(after="from pathlib import Path\nPath("+repr(str(observed))+").write_text('ACK')\nimport time;time.sleep(30)\n")
        def guard():
            w.sample()
            if observed.exists():raise RuntimeError('CONTROL original post-ACK resource refusal')
        args=x.args(binary,check_resources=guard);args.pop('enabled');original_signal=signal.pidfd_send_signal;sent=[]
        try:
            with x.bound(binary),mock.patch.object(signal,'pidfd_send_signal',side_effect=PermissionError('CONTROL first retirement denied')):
                binding=t.m.SYNTHETIC_FIXTURE_BINARIES[(t.m.INSPECTED_SYNTHETIC_HANDSHAKE,t.m.original.platform.system(),t.m.original.platform.machine())]
                out=t.m._run_synthetic_fixture(binding=binding,launch_lifecycle=pending,**args)
            self.assertFalse(out['originalProcess']['processReaped']);self.assertTrue(out['cleanupDebt'])
            self.assertIn('post-ACK resource refusal',out['firstCause']['message'])
            anchor=pending.pidfd;self.assertIsNotNone(anchor);self.assertFalse(w.pending_launches)
            self.assertIs(w.children[0]['process']._ynx_original_pidfd,pending)
            def send(fd,signum,info=None,flags=0):
                sent.append((fd,signum));return original_signal(fd,signum,info,flags)
            with mock.patch.object(signal,'pidfd_send_signal',side_effect=send), \
                 mock.patch.object(m.lab.os,'killpg',side_effect=AssertionError('no numeric group fallback')):
                self.assertTrue(w.stop())
            self.assertTrue(sent);self.assertTrue(all(fd==anchor for fd,_ in sent))
            self.assertTrue(pending.close_retired_identity());self.assertIsNone(pending.pidfd)
            self.assertNotIn(pending.token,m._CUSTODY['owners'])
            self.assertTrue(out['cleanupDebt']);self.assertFalse(out['nonceReleased']) # Original failure is not rewritten.
        finally:
            if pending.pidfd is not None:
                try:original_signal(pending.pidfd,signal.SIGKILL)
                except ProcessLookupError:pass
                pending.process.wait(timeout=2);pending.close_retired_identity()
            w.stop()


if __name__=='__main__':unittest.main(verbosity=2)
