"""Fixed first100 controller pure controls. No Go/nodes/network/admission."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

spec=importlib.util.spec_from_file_location('first100_ci',Path(__file__).with_name('pq-current75-baseline-ci.py'))
entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
TOOLS_ROOT=Path(__file__).resolve().parents[3]/'tools'


def environment():
    return dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',GITHUB_JOB=entry.PROFILE,PQ_BASELINE_PROFILE=entry.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_WORKFLOW_SHA='a'*40,GITHUB_RUN_ID='123')


class InitializationControllerControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver=entry.pinned_module('first100_original_driver',TOOLS_ROOT/'scripts/loadtest/pq-independent-load.py',entry.TOOL_PINS['pq-independent-load.py'])
        cls.source_data=entry.validate_driver(cls.driver)

    def test_default_inert_and_full500_not_assumed(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execute')),mock.patch.object(entry,'git',side_effect=AssertionError('git')),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(entry.main([]),0)
        d=json.loads(out.getvalue())
        self.assertFalse(d['executed'] or d['pressureAuthorized'] or d['actual500InitializationQualified'] or d['businessLoadAuthorized'] or d['higher500Or1000Permission'])
        self.assertEqual((d['configuredBusinessDemand'],d['requiredRemainingActiveSeconds']),(500,35))

    def test_fixed_source_caps_exact500_and_preload_before_business(self):
        a=entry.fixed_options(Path('/source'))
        self.assertEqual((a.accounts,a.per_account,a.rate,a.seconds,a.tail_seconds,a.proof_timeout),(500,1,100,5,30,30))
        self.assertTrue(a.initialize_before_load and a.startup_timings and a.staged_publication and a.commit_observation and a.network_accounting and a.wire_observation and a.owned_storage_accounting)
        self.assertFalse(a.initialization_only or a.header_hop_capture)
        self.assertEqual(entry.GO_SOURCE,'1b0ea548aca6b5260a9824d0edd3012d52e53521')
        self.assertEqual(entry.CAPS,dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2))
        self.assertEqual(self.driver.validate_options(a),500)

    def test_workflow_uses_exact_dispatch_only_and_push_only_pure_controls(self):
        raw=(Path(__file__).parents[2]/entry.WORKFLOW).read_text()
        job=raw.split('\n  '+entry.PROFILE+':\n',1)[1]
        gate=next(line for line in job.splitlines() if line.startswith('    if:'))
        self.assertIn("github.event_name == 'workflow_dispatch'",gate)
        self.assertNotIn("'push'",gate)
        self.assertIn("inputs.signing_mode == 'online'",gate)
        self.assertIn("inputs.load_profile == '"+entry.PROFILE+"'",gate)
        self.assertIn('needs: first100-controller-controls',job)
        pure=raw.split('\n  first100-controller-controls:\n',1)[1].split('\n  '+entry.PROFILE+':\n',1)[0]
        self.assertNotIn('--execute',pure)
        self.assertNotIn('setup-go@',pure)
        self.assertIn('pq-staged-harness-controls.py --run',pure)
        self.assertIn('module.verify_tools',pure)
        self.assertIn('test_linux_owned_rss.py',pure)
        for pin in (entry.GO_SOURCE,entry.TOOLS):self.assertIn('ref: '+pin,job)
        self.assertNotIn('current9081-measured-initialize500-only',raw)
        self.assertIn("github.ref != '"+entry.REF+"'",raw)
        self.assertIn('default: functional',raw)

    def test_nonhosted_or_wrong_profile_ref_attempt_refused_before_runtime(self):
        with mock.patch.object(entry.sys,'platform','darwin'),mock.patch.object(entry,'git') as git:
            with self.assertRaises(RuntimeError):entry.execute(Path('/source'),Path('/tools'))
            git.assert_not_called()
        with mock.patch.object(entry.sys,'platform','linux'):
            entry.validate_host(environment())
            for k,v in [('GITHUB_EVENT_NAME','push'),('PQ_BASELINE_PROFILE','current9081-measured-initialize500-only'),('GITHUB_JOB','functional'),('GITHUB_REF','refs/heads/main'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_WORKFLOW_SHA','b'*40),('GITHUB_SHA','0'*40)]:
                with self.subTest(k=k),self.assertRaises(RuntimeError):entry.validate_host(dict(environment(),**{k:v}))

    def test_modified_pinned_python_not_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'bad.py';p.write_text("raise AssertionError('must not execute')")
            with self.assertRaises(RuntimeError):entry.pinned_module('bad',p,'0'*64)

    def test_no_rate_account_or_duplicate_cli_override(self):
        for args in [['--rate','1000'],['--rate','500'],['--accounts','8'],['--source','a','--source','b'],['--initialize-before-load'],['--startup-timings']]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(args)

    def test_actual_95_tool_pins_and_nine_source_fixtures_are_closed(self):
        self.assertEqual(len(entry.TOOL_PINS),95)
        self.assertEqual(len([p for p in entry.TOOL_PINS if p.startswith('fixtures/1b-source/')]),9)
        with mock.patch.object(entry,'checked_source') as check:
            entry.verify_tools(TOOLS_ROOT)
        check.assert_called_once_with(TOOLS_ROOT,entry.TOOLS,entry.TOOLS_TREE)
        self.assertEqual(self.source_data['source'],entry.GO_SOURCE)
        self.assertEqual([f['actualNamedRunPass'] for f in self.source_data['separateOriginalJSONLFlows']],[7,22,24,4,10,6,3])
        self.assertFalse(self.source_data['runtimePermissionGranted'] or self.source_data['actual500InitializedOwnersQualified'])
        spec=importlib.util.spec_from_file_location('first100_hook_inventory',TOOLS_ROOT/'scripts/loadtest/pq-staged-harness-controls.py')
        hook=importlib.util.module_from_spec(spec);spec.loader.exec_module(hook)
        self.assertEqual(sum(count for _,_,count in hook.GROUPS),284)

    def test_old_and_higher_profiles_cannot_inherit_first100_selection(self):
        self.assertEqual(self.driver.STAGED_CALLEE_SOURCE,'9081f14654a48f4fe14e57696ec33527869da353')
        self.assertIsNone(self.driver.STAGED_SOURCE_QUALIFICATION)
        for key,value in [('rate',500),('rate',1000),('accounts',499),('per_account',2),('seconds',4),('tail_seconds',60),('proof_timeout',60),('startup_timings',False),('wire_observation',False),('network_accounting',False),('initialization_only',True)]:
            a=entry.fixed_options(Path('/source'));setattr(a,key,value)
            with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):self.driver.validate_options(a)
        a=entry.fixed_options(Path('/source'));a.initialize_before_load=False
        with mock.patch.object(self.driver.lab,'Window') as window,self.assertRaisesRegex(RuntimeError,'exact staged normal consumer source'):
            self.driver.run(a)
        window.assert_not_called()

    def complete_result(self,pending=()):
        census=dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',configuredLoadAccounts=500,completeFourNodeAccountReadback=True,normalGoStaticOrCryptoQualification=False,signCommandsIssued=0,businessPOSTsIssued=0,sourceGrant=False,nodes=[dict(node=i,height=14,appHash='a'*64,matchingOriginalLoadAccounts=500,snapshotBytes=1024,snapshotSHA256='b'*64) for i in range(4)])
        initial=[dict(name=f'{phase}-node-{i}',pid=10+j*4+i,startTicks=str(100+j*4+i),exited=phase=='bootstrap',rawReturnCode=0 if phase=='bootstrap' else None,exitCode=0 if phase=='bootstrap' else None,signal=None) for j,phase in enumerate(('bootstrap','pq')) for i in range(4)]
        preload=self.driver.preload_initialization.validate(census,initial,list(pending),35,5,30)
        final=copy.deepcopy(initial)
        for row in final:row.update(exited=True,rawReturnCode=0,exitCode=0)
        return dict(source=dict(commit=entry.GO_SOURCE,tree=entry.GO_TREE),toolIdentity=dict(commit=entry.TOOLS,tree=entry.TOOLS_TREE),caps=copy.deepcopy(entry.CAPS),sameWindowInitializationSourceFunctionalData=copy.deepcopy(self.source_data),loadConditions=self.driver.load_conditions(entry.fixed_options(Path('/source'))),firstCause=None,cleanupComplete=True,loadExecuted=True,normalLiveCalleeUsed=True,initializationOnlyRequested=False,preloadInitialization=preload,initializedAccountReadback=census,preparationUnconfirmedOwners=list(pending),processes=final,normalNodeCleanExit=self.driver.normal.normal_node_clean_exit(final),loadResult=dict(firstCause=None,windowCompleted=True,configuredDemand=500,requestedOfferedTPS=100,releasedWithinWindow=500,qualified=500,notReleased=0,notSubmitted=0,lateSubmitted=0,notQualified=0))

    def test_result_rechecks_preload_and_all_eight_natural_exits_separately(self):
        r=self.complete_result();saved=copy.deepcopy(r)
        self.assertIs(entry.validate_result(self.driver,r,self.source_data),r)
        self.assertEqual(r,saved)
        for mutate in (lambda r:r.pop('preloadInitialization'),lambda r:r['preloadInitialization'].update(remainingOriginalActiveSeconds=34.999),lambda r:r['preloadInitialization']['originalProcesses'][4].update(exited=True,rawReturnCode=0,exitCode=0),lambda r:r['initializedAccountReadback']['nodes'][3].update(matchingOriginalLoadAccounts=499),lambda r:r['preparationUnconfirmedOwners'].append(4),lambda r:r['processes'][7].update(rawReturnCode=-9,exitCode=None,signal=9),lambda r:r['processes'][7].update(pid=999)):
            r=self.complete_result();mutate(r)
            with self.assertRaises(RuntimeError):entry.validate_result(self.driver,r,self.source_data)

    def test_reserved_preparation_pending_does_not_block_or_become_business_finality(self):
        r=self.complete_result([0,1,2,3]);saved=copy.deepcopy(r)
        self.assertIs(entry.validate_result(self.driver,r,self.source_data),r)
        self.assertEqual(r,saved)
        self.assertEqual(r['preloadInitialization']['unconfirmedReservedPreparationOwners'],[0,1,2,3])
        self.assertFalse(r['preloadInitialization']['preparationFinalityQualified'])
        self.assertEqual(r['loadResult']['qualified'],500)
        for pending in ([4],[-1],[True],[0,0],[0,1,2,3,4]):
            r=self.complete_result();r['preparationUnconfirmedOwners']=pending
            with self.subTest(pending=pending),self.assertRaises(RuntimeError):
                entry.validate_result(self.driver,r,self.source_data)

    def test_partial_unknown_wrong_source_or_incomplete_proofs_never_success(self):
        for mutate in (lambda r:r.update(firstCause='original UNKNOWN'),lambda r:r.update(cleanupComplete=False),lambda r:r.update(loadExecuted=False),lambda r:r.update(initializationOnlyRequested=True),lambda r:r['source'].update(commit='9081f14654a48f4fe14e57696ec33527869da353'),lambda r:r['toolIdentity'].update(tree='0'*40),lambda r:r['caps'].update(totalSeconds=901),lambda r:r['loadResult'].update(notQualified=1,qualified=499),lambda r:r['loadResult'].update(lateSubmitted=1),lambda r:r['loadConditions'].update(startup_timings=False)):
            r=self.complete_result();mutate(r)
            with self.assertRaises(RuntimeError):entry.validate_result(self.driver,r,self.source_data)

    def test_only_one_original_window_and_no_resource_root_bypass(self):
        fake=SimpleNamespace(lab=SimpleNamespace())
        fake.lab.Window=mock.Mock(side_effect=lambda source,work,additional_storage:SimpleNamespace(storage_roots=list(additional_storage)))
        fake.lab.write_new=mock.Mock()
        intake=SimpleNamespace(nonoverlapping_roots=lambda roots:list(dict.fromkeys(roots)))
        original,calls=entry.install_counted_window(fake,intake,(Path('/workspace'),Path('/temp')),dict(scope='CONTROL_ONLY'))
        fake.lab.Window(Path('/source'),Path('/temp/case'))
        self.assertEqual(len(calls),1)
        original.assert_called_once()
        with self.assertRaises(RuntimeError):fake.lab.Window(Path('/source'),Path('/temp/case2'))
        self.assertEqual(fake.lab.write_new.call_args.args[0],Path('/temp/case/public/FIRST100-OWN1B-CI.json'))

    def test_execute_calls_one_original_driver_and_restores_window_on_failure(self):
        # Real controller orchestration and original validators; replace only
        # external checkouts and Window/run so no build/key/node can start.
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();workspace=root/'workspace';parent=root/'temp'
            parent.mkdir()
            for name in ('controller','source','tools'):(workspace/name).mkdir(parents=True)
            helper=workspace/'controller/scripts/loadtest/pq-current75-baseline-ci.py'
            helper.parent.mkdir(parents=True)
            helper.write_bytes(Path(entry.__file__).read_bytes())
            env=dict(environment(),GITHUB_WORKSPACE=str(workspace),RUNNER_TEMP=str(parent))
            original=mock.Mock(side_effect=lambda *args,**kwargs:SimpleNamespace(storage_roots=list(kwargs['additional_storage'])))
            intake=SimpleNamespace(nonoverlapping_roots=lambda roots:list(dict.fromkeys(roots)))
            calls=[]
            def run(options):
                self.assertEqual(vars(options),vars(entry.fixed_options(workspace/'source')))
                self.driver.lab.Window(workspace/'source',parent/'CONTROL_ONLY')
                calls.append(options)
                return self.complete_result()
            def git(path,*args):
                if args==('rev-parse','HEAD:third_party/cometbft'):return entry.FORK_TREE
                if args==('rev-parse','HEAD'):return env['GITHUB_SHA']
                return ''
            with mock.patch.dict(entry.os.environ,env,clear=True),mock.patch.object(entry.sys,'platform','linux'),mock.patch.object(entry,'__file__',str(helper)),mock.patch.object(entry,'git',side_effect=git),mock.patch.object(entry,'checked_source'),mock.patch.object(entry,'verify_tools'),mock.patch.object(entry,'pinned_bytes'),mock.patch.object(entry,'pinned_module',side_effect=lambda name,*args:self.driver if name=='normal_initialization_driver' else intake),mock.patch.object(entry.shutil,'which',return_value='/usr/bin/true'),mock.patch.object(self.driver.lab,'Window',original),mock.patch.object(self.driver.lab,'write_new'),mock.patch.object(self.driver,'run',side_effect=run) as runner:
                entry.execute(workspace/'source',workspace/'tools')
                self.assertEqual(len(calls),1);self.assertIs(self.driver.lab.Window,original)
                runner.side_effect=RuntimeError('original first failure')
                with self.assertRaisesRegex(RuntimeError,'original first failure'):
                    entry.execute(workspace/'source',workspace/'tools')
                self.assertIs(self.driver.lab.Window,original)
                self.assertEqual(original.call_count,1)

    def test_wrong_driver_source_or_caps_refuse_without_any_window(self):
        for owner,key,value in ((self.driver.first_trial_source,'SOURCE','0'*40),(self.driver.first_trial_source,'H_SHA','0'*64),(self.driver,'STAGED_SOURCE_QUALIFICATION',{}),(self.driver.lab,'CAPS',dict(entry.CAPS,totalSeconds=901))):
            with mock.patch.object(owner,key,value),mock.patch.object(self.driver.lab,'Window') as window,self.assertRaises(RuntimeError):entry.validate_driver(self.driver)
            window.assert_not_called()


if __name__=='__main__':unittest.main()
