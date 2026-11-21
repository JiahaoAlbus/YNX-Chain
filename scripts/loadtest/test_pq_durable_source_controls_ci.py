"""Source-only guard controls: no node, Go build, original account or dispatch."""
import ast
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('original315_source_ci',Path(__file__).with_name('pq-durable-source-controls-ci.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SourceControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.source=Path(__file__).resolve().parents[2]
        patch=mock.patch.object(m,'FD_CLOSE_ERRORS',[]);patch.start();self.addCleanup(patch.stop)
    def identity(self,path):
        s=path.stat();return s.st_dev,s.st_ino
    def test_original315_is_exact_existing_workflow_body_not_a_new_selection(self):
        body=m.original_script(self.source);tree=ast.parse(body)
        required=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign)
                      and any(isinstance(t,ast.Name) and t.id=='required' for t in n.targets))
        self.assertEqual(sum(required.values()),315);self.assertEqual(required['test_pq_serial_verifier_admission.py'],21)
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(),m.ORIGINAL_SHA256)
        with mock.patch.object(Path,'read_text',return_value=(self.source/'.github/workflows/chain-core.yml').read_text().replace('declaredTotal=315','declaredTotal=314')):
            with self.assertRaisesRegex(RuntimeError,'script changed'):m.original_script(self.source)
    def test_push_identity_is_exact_and_cannot_become_dispatch_or_retry(self):
        env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_EVENT_NAME='push',
                 GITHUB_REF=m.BRANCH,GITHUB_RUN_ATTEMPT='1',GITHUB_RUN_ID='123',GITHUB_SHA='a'*40,RUNNER_TEMP=str(self.root))
        self.assertEqual(m.hosted_identity(env,'linux',self.root)['commit'],'a'*40)
        for key,value in [('GITHUB_EVENT_NAME','workflow_dispatch'),('GITHUB_REF','refs/heads/main'),
                          ('GITHUB_RUN_ATTEMPT','2'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_SHA','bad')]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.hosted_identity(dict(env,**{key:value}),'linux',self.root)
        with self.assertRaises(RuntimeError):m.hosted_identity(env,'darwin',self.root)
    def test_workflow_is_push_only_isolated_and_uploads_closed_public_files(self):
        raw=(self.source/'.github/workflows/pq-durable-python-source.yml').read_text()
        self.assertNotIn('\n  workflow_dispatch:',raw);self.assertNotIn('go build',raw);self.assertNotIn('go test',raw)
        self.assertIn('group: pq-durable-python-source-${{ github.ref }}',raw)
        self.assertNotIn('group: chain-core-',raw)
        paths=raw.split('          path: |\n',1)[1].split('          if-no-files-found:',1)[0]
        self.assertEqual([s.strip().split('/')[-1] for s in paths.splitlines() if s.strip()],['SUMMARY.json','RESULT.json','original-controls.log'])
    def test_lstat_fixture_domain_does_not_follow_symlinks_and_counts_fifo(self):
        fixture=self.root/'fixtures';fixture.mkdir();outside=self.root/'outside';outside.mkdir()
        (outside/'large').write_bytes(b'x'*(1<<20));(fixture/'escape').symlink_to(outside,target_is_directory=True)
        os.mkfifo(fixture/'fifo')
        value=m.fixture_bytes(fixture,self.identity(fixture))
        expected=sum(max(p.lstat().st_size,p.lstat().st_blocks*512) for p in [fixture,fixture/'escape',fixture/'fifo'])
        self.assertEqual(value,expected);self.assertLess(value,1<<20)
    def test_hardlink_inode_is_counted_once_and_new_regular_file_is_not_omitted(self):
        (self.root/'data').write_bytes(b'x'*8192);os.link(self.root/'data',self.root/'alias')
        before=m.fixture_bytes(self.root,self.identity(self.root));info=(self.root/'data').stat();directory=self.root.stat()
        self.assertEqual(before,max(info.st_size,info.st_blocks*512)+max(directory.st_size,directory.st_blocks*512))
        (self.root/'new').write_bytes(b'y'*16384)
        self.assertGreaterEqual(m.fixture_bytes(self.root,self.identity(self.root)),before+16384)
    def test_inventory_bound_and_scandir_error_fail_closed(self):
        (self.root/'a').touch();(self.root/'b').touch()
        with self.assertRaisesRegex(RuntimeError,'no truncation'):m.fixture_bytes(self.root,self.identity(self.root),entry_limit=1)
        error=OSError('UNIT inaccessible inode domain')
        with mock.patch.object(m.os,'scandir',side_effect=error):
            with self.assertRaises(OSError) as caught:m.fixture_bytes(self.root,self.identity(self.root))
        self.assertIs(caught.exception,error)
    def test_root_and_nested_directory_replacement_are_rejected(self):
        fixture=self.root/'fixture';fixture.mkdir();old=self.identity(fixture)
        fixture.rename(self.root/'old');fixture.mkdir()
        with self.assertRaisesRegex(RuntimeError,'identity changed'):m.fixture_bytes(fixture,old)
        sub=fixture/'sub';sub.mkdir();original_stat=m.os.stat
        def changed(path,*args,**kwargs):
            if path=='sub' and kwargs.get('dir_fd') is not None:
                sub.rename(fixture/'prior');sub.mkdir()
            return original_stat(path,*args,**kwargs)
        with mock.patch.object(m.os,'stat',side_effect=changed):
            with self.assertRaisesRegex(RuntimeError,'replaced during sample'):m.fixture_bytes(fixture,self.identity(fixture))
    def test_original_pid_rss_guard_is_first_and_combined_storage_keeps_same_cap(self):
        events=[];w=SimpleNamespace(_sample=lambda:events.append('original'),storage_bytes=80,peak_bytes=80)
        lab=SimpleNamespace(CAPS={'newBytes':100})
        with mock.patch.object(m,'fixture_bytes',side_effect=lambda *a:events.append('fixture') or 21):
            m.cover_fixture_storage(w,self.root,lab)
            with self.assertRaisesRegex(RuntimeError,'original8GiB'):w._sample()
        self.assertEqual(events,['original','fixture']);self.assertEqual(w.peak_bytes,101)
        original=OSError('UNIT original RSS first');w=SimpleNamespace(_sample=mock.Mock(side_effect=original))
        with mock.patch.object(m,'fixture_bytes') as fixture:
            m.cover_fixture_storage(w,self.root,lab)
            with self.assertRaises(OSError) as caught:w._sample()
        self.assertIs(caught.exception,original);fixture.assert_not_called()
    def test_bounded_output_rejects_link_hardlink_and_oversize(self):
        folder=self.root/'pq-durable-driver-controls';folder.mkdir()
        file=folder/'RESULT.json';file.write_bytes(b'original');pins=dict(root=self.root,root_identity=self.identity(self.root))
        self.assertEqual(m.bounded_original(file,16,**pins),b'original')
        with self.assertRaises(RuntimeError):m.bounded_original(file,1,**pins)
        alias=folder/'original-controls.log';alias.symlink_to(file)
        with self.assertRaises(OSError):m.bounded_original(alias,16,**pins)
        alias.unlink();os.link(file,alias)
        with self.assertRaises(RuntimeError):m.bounded_original(file,16,**pins)
    def test_result_requires_original_source_log_digest_and_all315(self):
        public=self.root/'public';public.mkdir();root=self.root/'original';root.mkdir()
        original=root/'pq-durable-driver-controls';original.mkdir();pins=dict(root_identity=self.identity(root))
        log=b'CONTROL TEST LOG\n';(original/'original-controls.log').write_bytes(log)
        result=dict(sourceCommit='a'*40,runID='123',platform='linux',declaredTotal=315,
                    allDeclaredActuallyPassedWithoutSkip=True,logSHA256=hashlib.sha256(log).hexdigest())
        (original/'RESULT.json').write_text(json.dumps(result))
        observed=m.observe_result(root,public,dict(commit='a'*40,runID='123'),**pins);self.assertEqual(observed['declaredTotal'],315)
        for index,change in enumerate((dict(sourceCommit='b'*40),dict(allDeclaredActuallyPassedWithoutSkip=False),dict(declaredTotal=314),dict(logSHA256='0'*64))):
            target=self.root/str(index);target.mkdir();(original/'RESULT.json').write_text(json.dumps(dict(result,**change)))
            with self.assertRaisesRegex(RuntimeError,'not fully passed'):m.observe_result(root,target,dict(commit='a'*40,runID='123'),**pins)
            self.assertTrue((target/'original-controls.log').exists())
    def test_secondary_cleanup_failure_preserves_original_first_cause(self):
        out=dict(firstCause=None,cleanupDebt=False,cleanupErrors=[])
        m.record_failure(out,ValueError('UNIT original'));m.record_failure(out,OSError('UNIT close'),cleanup=True)
        self.assertEqual(out['firstCause']['type'],'ValueError');self.assertTrue(out['cleanupDebt'])
        self.assertEqual(out['cleanupErrors'][0]['type'],'OSError')
    def test_public_summary_never_copies_private_error_text_or_paths(self):
        fields=('schema','status','source','runID','runAttempt','originalScriptSHA256','controls','caps',
            'observedPeakRSSBytes','observedPeakStorageBytes','monitorRetired','cleanupComplete','cleanupDebt',
            'runtimeAuthorized','fullToolsCIQualified','pressureAuthorized','nodeStarted','businessLoadExecuted')
        out={k:None for k in fields};out.update(firstCause={'type':'OSError','message':'PRIVATE-CONTROL-PATH'},
            cleanupErrors=[],privateRoot='PRIVATE-ROOT',credential='CONTROL-NOT-A-REAL-KEY')
        result=json.dumps(m.public_summary(out));self.assertNotIn('PRIVATE-',result);self.assertNotIn('credential',result)
    def controlled_run(self,*,clean=True,sample_error=None,monitor_error=None,retention_error=False):
        events=[]
        class Window:
            def __init__(self,*args,**kwargs):
                self.env={};self.storage_bytes=0;self.peak_bytes=0;self.peak_rss=123
            def _sample(self):events.append('original-sample')
            def sample(self):self._sample()
            def launch(self,*args,**kwargs):
                events.append('launch');self.argv=args[1]
                assert kwargs['private_log'] and kwargs['thread_safe']
                return SimpleNamespace(poll=lambda:0,returncode=0)
            def stop(self):events.append('window-stop');return clean
        def monitor(window,stop):
            return SimpleNamespace(thread=SimpleNamespace(start=lambda:events.append('monitor-start')),check=lambda:None)
        def retire(mon,out):
            events.append('monitor-close')
            if monitor_error:raise monitor_error
            out['monitorRetired']=True
        caps=dict(newBytes=8<<30,rssBytes=4<<30)
        lab=SimpleNamespace(CAPS=caps,guard=SimpleNamespace(CAPS={'ownedProcesses':16},proc_inventory=lambda:([],None),
                memory_available=lambda:8<<30),check_source=lambda *args:{'commit':'a'*40},
                admit=lambda *args:events.append('host-admit'),heavy_processes=lambda _:[],Window=Window)
        private=SimpleNamespace(lab=lab,driver=SimpleNamespace(Monitor=monitor),fcntl=fcntl,
            enable_original_subreaper=lambda:events.append('subreaper'),retire_original_job_monitor=retire)
        old_mask=os.umask(0o077)
        try:
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.dict(os.environ,{'RUNNER_TEMP':str(self.root)}))
                stack.enter_context(mock.patch.object(m,'hosted_identity',return_value={'commit':'a'*40,'runID':'123','runAttempt':1}))
                stack.enter_context(mock.patch.object(m,'module',return_value=private))
                stack.enter_context(mock.patch.object(m.resource,'setrlimit'))
                stack.enter_context(mock.patch.object(m,'observe_result',return_value={'CONTROL_ONLY':True}))
                if sample_error:stack.enter_context(mock.patch.object(m,'fixture_bytes',side_effect=sample_error))
                if retention_error:stack.enter_context(mock.patch.object(m,'retain',side_effect=OSError('UNIT summary retention failed')))
                code=m.run()
        finally:os.umask(old_mask)
        path=self.root/'pq-durable-source-controls-public/SUMMARY.json'
        return code,events,None if not path.exists() else json.loads(path.read_bytes())
    def test_actual_run_orders_monitor_before_launch_and_stop_false_is_debt(self):
        code,events,out=self.controlled_run(clean=False)
        self.assertEqual(code,1);self.assertLess(events.index('monitor-start'),events.index('launch'))
        self.assertLess(events.index('monitor-close'),events.index('window-stop'))
        self.assertTrue(out['cleanupDebt']);self.assertFalse(out['cleanupComplete']);self.assertEqual(out['status'],'UNKNOWN')
        self.assertFalse(out['runtimeAuthorized']);self.assertFalse(out['fullToolsCIQualified'])
    def test_actual_run_sampling_failure_prevents_launch_and_monitor_failure_does_not_replace_first(self):
        code,events,out=self.controlled_run(sample_error=OSError('UNIT original fixture sample failed'),monitor_error=ValueError('UNIT later close failed'))
        self.assertEqual(code,1);self.assertNotIn('launch',events);self.assertIn('window-stop',events)
        self.assertEqual(out['firstCause']['type'],'OSError');self.assertEqual(out['cleanupErrors'][0]['type'],'ValueError')
        self.assertTrue(out['cleanupDebt']);self.assertFalse(out['cleanupComplete'])
    def test_actual_run_artifact_failure_keeps_first_cause_in_public_log_without_retry(self):
        import io
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            code,events,out=self.controlled_run(sample_error=ValueError('UNIT original'),retention_error=True)
        self.assertEqual(code,1);self.assertIsNone(out);self.assertIn('window-stop',events)
        public=json.loads(output.getvalue());self.assertEqual(public['firstCause']['type'],'ValueError')
        self.assertTrue(public['cleanupDebt']);self.assertEqual(public['status'],'UNKNOWN')
    def test_actual_run_surrogate_first_cause_still_retains_summary(self):
        code,events,out=self.controlled_run(sample_error=ValueError('UNIT original \udcff'))
        self.assertEqual(code,1);self.assertEqual(out['firstCause']['type'],'ValueError')
        self.assertIn('window-stop',events);self.assertEqual(out['status'],'UNKNOWN')
        self.assertEqual(out['firstCause']['messageSHA256'],hashlib.sha256('UNIT original \udcff'.encode('utf-8','surrogatepass')).hexdigest())
    def test_real_fifo_output_without_writer_is_bounded_and_refused(self):
        folder=self.root/'pq-durable-driver-controls';folder.mkdir();fifo=folder/'RESULT.json';os.mkfifo(fifo)
        script="""import importlib.util,sys,pathlib
s=importlib.util.spec_from_file_location('fifo_control',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=pathlib.Path(sys.argv[2]);root=p.parent.parent;s=root.stat()
try:m.bounded_original(p,4096,root=root,root_identity=(s.st_dev,s.st_ino))
except RuntimeError:raise SystemExit(0)
raise SystemExit(2)
"""
        # The original CONTROL Popen is owned solely by subprocess.run; its
        # timeout kills/waits that same child, never an external operation.
        result=subprocess.run([sys.executable,'-I','-B','-c',script,str(Path(m.__file__).resolve()),str(fifo)],
                              capture_output=True,timeout=.5)
        self.assertEqual(result.returncode,0,result.stderr)
    def test_original_output_parent_link_and_mid_read_replacement_are_refused(self):
        folder=self.root/'pq-durable-driver-controls';folder.mkdir();file=folder/'RESULT.json';file.write_bytes(b'ORIGINAL')
        pin=self.identity(self.root);folder.rename(self.root/'saved');folder.symlink_to(self.root/'saved',target_is_directory=True)
        with mock.patch.object(m.os,'read',side_effect=AssertionError('must not read outside original parent')):
            with self.assertRaises(OSError):m.bounded_original(file,32,root=self.root,root_identity=pin)
        folder.unlink();(self.root/'saved').rename(folder);read=os.read;changed=False
        def replace(fd,size):
            nonlocal changed
            data=read(fd,size)
            if not changed:
                changed=True;folder.rename(self.root/'saved');folder.mkdir()
            return data
        with mock.patch.object(m.os,'read',side_effect=replace):
            with self.assertRaisesRegex(RuntimeError,'parent replaced'):m.bounded_original(file,32,root=self.root,root_identity=pin)
    def test_scandir_first_cause_survives_one_original_directory_close_error(self):
        original=ValueError('UNIT first scan failure');close=os.close;calls=[]
        def uncertain(fd):
            calls.append(fd);close(fd);raise OSError('UNIT later directory close error')
        with mock.patch.object(m.os,'scandir',side_effect=original),mock.patch.object(m.os,'close',side_effect=uncertain):
            with self.assertRaises(ValueError) as caught:m.fixture_bytes(self.root,self.identity(self.root))
        self.assertIs(caught.exception,original);self.assertEqual(len(calls),1)
        self.assertEqual(m.FD_CLOSE_ERRORS[0]['type'],'OSError')
    def test_read_first_cause_survives_consumed_file_close_error_without_retry(self):
        folder=self.root/'pq-durable-driver-controls';folder.mkdir();file=folder/'RESULT.json';file.write_bytes(b'ORIGINAL')
        original=ValueError('UNIT first read failure');close=os.close;calls=[]
        def uncertain(fd):
            calls.append(fd);close(fd)
            if len(calls)==1:raise OSError('UNIT later leaf close error')
        with mock.patch.object(m.os,'read',side_effect=original),mock.patch.object(m.os,'close',side_effect=uncertain):
            with self.assertRaises(ValueError) as caught:m.bounded_original(file,32,root=self.root,root_identity=self.identity(self.root))
        self.assertIs(caught.exception,original);self.assertEqual(len(calls),len(set(calls)))
        self.assertEqual(len(calls),3);self.assertEqual(m.FD_CLOSE_ERRORS[0]['type'],'OSError')


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(SourceControls)
    assert suite.countTestCases()==20,'exact source-wrapper control count differs'
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.testsRun==20 and not result.skipped and result.wasSuccessful() else 1)
