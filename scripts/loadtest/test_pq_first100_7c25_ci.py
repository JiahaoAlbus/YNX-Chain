"""Normal7c25 adapter controls; sealed data only, no Go/window/network execution."""
import contextlib,copy,importlib.util,io,json,os,types,unittest,subprocess,tarfile,tempfile
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
TOOLS=os.environ.get('YNX_PROFILE_TEST_TOOLS')
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
entry=module('fixed7c25_controller',HERE/'pq-first100-7c25-ci.py')
def env():
    return dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_JOB=entry.PROFILE,GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=entry.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_WORKFLOW_SHA='a'*40,GITHUB_RUN_ID='123')
def ci():
    run=dict(id=entry.TOOLS_CI_RUN,run_attempt=1,head_sha=entry.TOOLS,head_branch='codex/chain-batch-v01-performance',event='push',workflow_id=entry.TOOLS_CI_WORKFLOW,path='.github/workflows/chain-core.yml',repository=dict(full_name='JiahaoAlbus/YNX-Chain'),status='completed',conclusion='success')
    names=['Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed1695 semantic original transport and process controls','Verify fixed1695 own source originals with explicit opt-in skips','Verify normal public owner stream isolation and lost acknowledgements','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering']
    job=dict(id=entry.TOOLS_CI_JOB,run_id=entry.TOOLS_CI_RUN,head_sha=entry.TOOLS,head_branch=run['head_branch'],name='Chain Core source and release gate',status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in names]);return run,job

def assert_workflow(raw):
    profile='first100-7c25-public-owner'
    if profile not in raw.split('jobs:',1)[0]:raise AssertionError('explicit new dispatch choice missing')
    import re
    marker='\n  '+profile+':\n'
    if marker not in raw:raise AssertionError('normal fixed profile job missing')
    block=re.split(r'\n  [A-Za-z0-9_-]+:\n',raw.split(marker,1)[1],maxsplit=1)[0]
    for literal in ("github.event_name == 'workflow_dispatch'","github.run_attempt == 1", "inputs.load_profile == '"+profile+"'", "inputs.signing_mode == 'online'",entry.GO_SOURCE,entry.TOOLS,'/scripts/verify/wire-live-matching-source-ci.py','--check-tools-ci','pq-first100-7c25-ci.py','--source','--tools','--execute'):
        if literal not in block:raise AssertionError('normal profile source/control missing: '+literal)
    if block.index('--check-tools-ci')>block.rindex('--execute'):raise AssertionError('actual source/tools qualification must precede execution')


class Fixed7c25(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if TOOLS is not None:
            tools=Path(TOOLS)
        else:
            # The adapter intentionally pins an earlier immutable RuntimeTools.
            # Read that exact Git snapshot, never the changing producer checkout.
            temp=tempfile.TemporaryDirectory();cls.addClassCleanup(temp.cleanup)
            root=Path(temp.name);raw=subprocess.check_output(['git','-C',str(HERE.parents[1]),'archive',entry.TOOLS,'scripts/loadtest'])
            with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
                members=archive.getmembers()
                if len(members)>10000 or sum(m.size for m in members)>256<<20:raise RuntimeError('bounded immutable tools test snapshot required')
                for member in members:
                    path=Path(member.name)
                    if path.is_absolute() or '..' in path.parts or not (member.isdir() or member.isfile()) or not (member.name.startswith('scripts/loadtest') or member.isdir() and member.name=='scripts'):
                        raise RuntimeError('unsafe immutable tools test snapshot')
                    destination=root/path
                    if member.isdir():destination.mkdir(parents=True,exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True,exist_ok=True)
                        with archive.extractfile(member) as source:destination.write_bytes(source.read())
            tools=root/'scripts/loadtest'
        for name,pin in entry.TOOL_PINS.items():entry.pinned_bytes(tools/name,pin)
        cls.driver=entry.pinned_module('fixed7c25_driver',tools/'pq-independent-load.py',entry.TOOL_PINS['pq-independent-load.py'])
    def test_real_source_and_semantic_data_grant_no_window_or_prior_initialization(self):
        data=entry.validate_driver(self.driver)
        self.assertTrue(data['semanticPairConsumed']);self.assertEqual(data['heights'],9)
        self.assertFalse(data['pressureAuthorized'] or data['runtimePermissionGranted'] or data['actual500InitializedOwnersQualified'])
        self.assertEqual(entry.source_prerequisites()['retainedHeights'],9)
        with mock.patch.object(entry,'SEMANTIC_READBACK_BYTES',b'{}'),self.assertRaises(RuntimeError):entry.source_prerequisites()
    def test_same_original_full_cohort_and_resource_caps_with_new_observer(self):
        self.assertEqual(entry.PROFILES,{'first100-7c25-public-owner':'public-owner'})
        self.assertIn('scripts/verify/wire-live-matching-source-ci.py',entry.SOURCE_PINS)
        options=entry.fixed_options(Path('/source'));self.assertEqual(self.driver.validate_options(options),500)
        self.assertEqual((options.first_trial_profile,options.sender_backend),('7c25','public-owner'))
        self.assertEqual((options.rate,options.seconds,options.accounts,options.per_account,options.tail_seconds,options.proof_timeout),(100,5,500,1,30,30))
        self.assertEqual(self.driver.lab.CAPS,entry.CAPS);self.assertEqual(self.driver.lab.guard.CAPS['ownedProcesses'],16)
        self.assertTrue(self.driver.load_conditions(options)['requestStageObservation'])
        self.assertFalse(entry.prepared_data()['higher500Or1000Permission'])
        self.assertFalse(entry.prepared_data()['matchedBeforeAfterComparisonExecuted'])
    def test_every_original_observer_and_preload_boundary_remains_required(self):
        for name in ('wire_observation','network_accounting','owned_storage_accounting','commit_observation','startup_timings','initialize_before_load'):
            options=entry.fixed_options(Path('/source'));setattr(options,name,False)
            with self.subTest(name=name),self.assertRaises(Exception):self.driver.validate_options(options)
    def test_only_fixed_host_profile_first_attempt_and_workflow_can_execute(self):
        good=env()
        with mock.patch.object(entry.sys,'platform','linux'):
            entry.validate_host(good)
            for key,value in [('GITHUB_JOB','first100-1695-public-owner'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','push'),('GITHUB_REF','refs/heads/main'),('GITHUB_WORKFLOW_SHA','b'*40),('RUNNER_ENVIRONMENT','self-hosted'),('PQ_BASELINE_PROFILE','other')]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_host(dict(good,**{key:value}))
    def test_actual_tools_ci_must_be_same_immutable_commit_and_required_steps(self):
        run,job=ci();self.assertEqual(entry.validate_tools_ci(run,job)['head'],entry.TOOLS)
        for key,value in [('head_sha','b'*40),('run_attempt',2),('conclusion','failure'),('status','in_progress')]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_tools_ci(dict(run,**{key:value}),job)
        bad=copy.deepcopy(job);bad['steps'][0]['conclusion']='skipped'
        with self.assertRaises(RuntimeError):entry.validate_tools_ci(run,bad)
    def test_default_preparation_has_no_window_network_or_permission(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execution')),mock.patch.object(entry,'read_tools_ci',side_effect=AssertionError('network')),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(entry.main([]),0)
        value=json.loads(out.getvalue());self.assertFalse(value['executed'] or value['pressureAuthorized'] or value['nodeStartAuthorized'])
        for argv in (['--rate','1000'],['--backend','public-owner'],['--execute','--execute'],['--source','/source']):
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(argv)
    def test_missing_or_partial_cohort_is_never_complete_or_retryable(self):
        with self.assertRaises(RuntimeError):entry.validate_result(self.driver,{},entry.validate_driver(self.driver))
    def test_only_one_original_window_with_counted_nonoverlapping_roots(self):
        with __import__('tempfile').TemporaryDirectory() as temp:
            root=Path(temp).resolve();public=root/'public';public.mkdir()
            def original(source,work,additional_storage=()):return types.SimpleNamespace(storage_roots=list(additional_storage))
            def write(path,value):path.write_text(json.dumps(value))
            driver=types.SimpleNamespace(lab=types.SimpleNamespace(Window=original,write_new=write))
            intake=types.SimpleNamespace(nonoverlapping_roots=lambda rows:list(dict.fromkeys(rows)))
            old,calls=entry.install_counted_window(driver,intake,(root,),{})
            try:
                driver.lab.Window(root,root)
                self.assertEqual(len(calls),1)
                with self.assertRaises(RuntimeError):driver.lab.Window(root,root)
            finally:driver.lab.Window=old
            self.assertTrue((public/'FIRST100-7C25-CI.json').is_file())

if __name__=='__main__':
    import sys
    if '--workflow' in sys.argv:
        i=sys.argv.index('--workflow');assert_workflow(Path(sys.argv[i+1]).read_text());del sys.argv[i:i+2]
    unittest.main(verbosity=2)
