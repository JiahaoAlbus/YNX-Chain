"""Hosted job wiring controls. Controlled builds are NOT normal Core evidence."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import tempfile
import threading
import subprocess
import sys
from types import SimpleNamespace
import unittest
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
                if outer.stop_error:raise outer.stop_error
                return outer.stop_result
        def callee(**kwargs):
            self.events.append('sole-private-callee')
            self.assertEqual(kwargs['source'],m.HOSTED_SYNTHETIC_SOURCE['commit'])
            self.assertEqual(os.fstat(kwargs['credential_fd']).st_size,32)
            self.assertTrue(callable(kwargs['register_process']))
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

    def test_original_workflow_is_opt_in_after_controls_and_uploads_one_public_file(self):
        text=(Path(__file__).parents[2]/'.github/workflows/chain-core.yml').read_text()
        self.assertIn('default: false',text)
        job=text.split('\n  enrollment-private-synthetic:\n',1)[1]
        self.assertIn('needs: verify',job);self.assertIn('inputs.enrollment_private_synthetic == true',job)
        self.assertIn('--source-directory "$GITHUB_WORKSPACE/core"',job)
        self.assertEqual(job.count('actions/upload-artifact@'),1)
        self.assertIn('path: ${{ runner.temp }}/pq-enrollment-public-summary/SUMMARY.json',job)
        self.assertNotIn('path: ${{ runner.temp }}/\n',job)
        self.assertIn("'test_pq_enrollment_linux_private.py': 12",text)
        self.assertIsNone(m.r.NORMAL_RESERVATION_PRODUCER)
        self.assertEqual(m.r.SYNTHETIC_FIXTURE_BINARIES,{})

    @unittest.skipUnless(sys.platform=='linux','real Linux subreaper and /proc required; no Mac substitute')
    def test_real_linux_fast_leader_orphan_is_adopted_then_retired_by_original_window(self):
        # Separate supervisor keeps adoption/affinity/cleanup away from the CI
        # test runner. No node, account, credential or transaction is created.
        script=r'''
import importlib.util,json,os,pathlib,sys,time
source=pathlib.Path(sys.argv[1]);work=pathlib.Path(sys.argv[2])
spec=importlib.util.spec_from_file_location('original_private_job',source/'pq-enrollment-linux-private.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.enable_original_subreaper()
work.mkdir(mode=0o700);(work/'.private').mkdir(mode=0o700);(work/'public').mkdir(mode=0o700)
w=m.lab.Window(source,work);child=None;clean=False
try:
    code="import os,time; p=os.fork(); (time.sleep(30) if p==0 else print(p,flush=True)); os._exit(0)"
    p=w.launch('synthetic-fast-leader',[sys.executable,'-c',code],private_log=True)
    p.wait(timeout=2) # Deliberately no intervening resource sample.
    child=int((work/'.private/synthetic-fast-leader.log').read_text().strip())
    row=m.lab.guard.parse_stat(m.lab.guard.bounded(pathlib.Path('/proc')/str(child)/'stat'),child)
    assert row['parent']==os.getpid(), 'unseen orphan must belong to original subreaper'
    assert child not in w.known, 'control requires no prior sample of orphan'
    clean=w.stop()
    assert clean and not (pathlib.Path('/proc')/str(child)).exists(), 'original adopted child not retired'
    print(json.dumps(dict(adopted=True,cleanupComplete=clean)))
finally:
    if not clean:w.stop()
'''
        proc=subprocess.Popen([sys.executable,'-B','-c',script,str(Path(__file__).parent),str(self.base/'linux-supervisor')],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:stdout,stderr=proc.communicate(timeout=20)
        except BaseException:
            if proc.poll() is None:os.killpg(proc.pid,signal.SIGKILL)
            proc.wait(timeout=2);raise
        self.assertEqual(proc.returncode,0,stderr.decode());self.assertEqual(json.loads(stdout),dict(adopted=True,cleanupComplete=True))


if __name__=='__main__':unittest.main(verbosity=2)
