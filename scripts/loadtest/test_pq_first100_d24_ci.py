"""Pure fixed-d24 controller tests; no network, workload, signing or deletion."""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2]/'tools/scripts/loadtest'


def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


entry=module('d24_ci_entry',HERE/'pq-first100-d24-ci.py')
space=module('d24_space_entry',HERE/'pq-hosted-initialization-space-ci.py')


def environment():
    return dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',RUNNER_OS='Linux',
                RUNNER_ARCH='X64',ImageOS='ubuntu24',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',
                GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_JOB=entry.PROFILE,GITHUB_REF=entry.REF,
                GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=entry.PROFILE,
                PQ_HOSTED_SPACE_PREPARATION=space.D24_AUTHORIZATION,
                GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,
                GITHUB_SHA='a'*40,GITHUB_WORKFLOW_SHA='a'*40,GITHUB_RUN_ID='123')


def ci_fixture():
    run=dict(id=entry.TOOLS_CI_RUN,run_attempt=1,head_sha=entry.TOOLS,
             head_branch='codex/chain-batch-v01-performance',event='push',
             workflow_id=entry.TOOLS_CI_WORKFLOW,path='.github/workflows/chain-core.yml',
             repository=dict(full_name='JiahaoAlbus/YNX-Chain'),status='completed',conclusion='success')
    names=('Execute original Linux worker affinity limits stdin and cleanup case',
           'Verify fixed d24 original semantic and source readback controls',
           'Verify full first100 cohort counts and censored latency readback',
           'Verify original bounded sender and post-ready checkpoint ordering')
    job=dict(id=entry.TOOLS_CI_JOB,run_id=entry.TOOLS_CI_RUN,head_sha=entry.TOOLS,
             head_branch=run['head_branch'],name='Chain Core source and release gate',
             status='completed',conclusion='success',
             steps=[dict(name=name,status='completed',conclusion='success') for name in names])
    return run,job


class D24ControllerControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for name,pin in entry.TOOL_PINS.items():
            entry.pinned_bytes(TOOLS/name,pin)
        cls.driver=entry.pinned_module('fixed_d24_driver',TOOLS/'pq-independent-load.py',entry.TOOL_PINS['pq-independent-load.py'])

    def test_default_inert_and_no_caller_selected_profile(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execute')),mock.patch.object(entry,'read_tools_ci',side_effect=AssertionError('network')),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(entry.main([]),0)
        data=json.loads(out.getvalue());self.assertFalse(data['executed'] or data['pressureAuthorized'])
        for argv in (['--profile','own1b'],['--rate','500'],['--accounts','4'],['--execute','--execute'],['--check-tools-ci','--execute'],['--source','/source']):
            with self.subTest(argv=argv),contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):
                entry.main(argv)

    def test_explicit_d24_full_original_conditions_and_caps(self):
        options=entry.fixed_options(Path('/source'))
        self.assertEqual(self.driver.validate_options(options),500)
        self.assertEqual(options.first_trial_profile,'d24')
        self.assertEqual((options.mode,options.rate,options.seconds,options.accounts,options.per_account,options.tail_seconds,options.proof_timeout),('online',100,5,500,1,30,30))
        self.assertEqual(entry.CAPS,self.driver.lab.CAPS)
        self.assertEqual((entry.CAPS['totalSeconds'],entry.CAPS['cleanupSeconds'],entry.CAPS['initialDiskBytes'],entry.CAPS['initialMemoryBytes']),(900,15,16<<30,6<<30))
        self.assertEqual(self.driver.lab.guard.CAPS['ownedProcesses'],16)
        for field in ('wire_observation','network_accounting','owned_storage_accounting','commit_observation','startup_timings'):
            changed=copy.copy(options);setattr(changed,field,False)
            with self.subTest(field=field),self.assertRaises(Exception):self.driver.validate_options(changed)

    def test_original109_pins_and_actual_d24_reader_nine_streams(self):
        self.assertEqual(len(entry.TOOL_PINS),109);self.assertEqual(len(entry.SOURCE_PINS),12)
        self.assertEqual(sum(name.startswith('fixtures/d24-source/') for name in entry.TOOL_PINS),10)
        data=entry.validate_driver(self.driver)
        self.assertEqual(data['rawFlowsRead'],9);self.assertEqual(data['startup']['startupCollectorCases'],6)
        self.assertTrue(data['sourceOnlyQualified'])
        for name in ('runtimePermissionGranted','pressureAuthorized','actual500InitializedOwnersQualified','semanticPairConsumed'):
            self.assertFalse(data[name])
        value=entry.source_prerequisites();self.assertEqual(value['retainedHeights'],9)
        self.assertFalse(value['runtimePermissionGranted'] or value['semanticReplayReexecuted'])

    def test_wrong_source_and_old_profile_cannot_be_qualified(self):
        with mock.patch.object(self.driver.first_trial_d24_source,'SOURCE',self.driver.first_trial_source.SOURCE),self.assertRaises(RuntimeError):
            entry.validate_driver(self.driver)
        bad=bytearray(entry.SOURCE_HANDOFF_BYTES);bad[-2]^=1
        with mock.patch.object(entry,'SOURCE_HANDOFF_BYTES',bytes(bad)),self.assertRaises(RuntimeError):entry.source_prerequisites()

    def test_host_namespace_attempt_and_unknown_ref_fail_before_ci(self):
        with mock.patch.object(entry.sys,'platform','linux'):
            entry.validate_host(environment())
            for key,value in [('GITHUB_EVENT_NAME','push'),('GITHUB_JOB',space.PROFILE),('GITHUB_RUN_ATTEMPT','2'),('PQ_BASELINE_PROFILE',space.PROFILE),('GITHUB_REF','refs/heads/main'),('GITHUB_WORKFLOW_SHA','b'*40),('RUNNER_ENVIRONMENT','self-hosted')]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_host(dict(environment(),**{key:value}))
        with mock.patch.object(entry.sys,'platform','darwin'),mock.patch.object(entry,'read_tools_ci') as read,self.assertRaises(RuntimeError):
            entry.execute(Path('/source'),Path('/tools'))
        read.assert_not_called()

    def test_tools_ci_exact_run_job_step_required_not_merely_source_bool(self):
        run,job=ci_fixture();self.assertEqual(entry.validate_tools_ci(run,job)['runID'],entry.TOOLS_CI_RUN)
        changes={'status':'in_progress','conclusion':'failure','head_sha':entry.GO_SOURCE,'id':1,'run_attempt':2,'event':'workflow_dispatch','workflow_id':1,'path':'.github/workflows/resource-market-ci.yml','head_branch':'main'}
        for key,value in changes.items():
            with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_tools_ci(dict(run,**{key:value}),job)
        for key,value in [('run_id',1),('head_sha',entry.GO_SOURCE),('id',1),('status','in_progress'),('conclusion','cancelled')]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_tools_ci(run,dict(job,**{key:value}))
        for steps in (job['steps'][:-1],job['steps']+[job['steps'][0]],[dict(s,conclusion='skipped') for s in job['steps']]):
            with self.assertRaises(RuntimeError):entry.validate_tools_ci(run,dict(job,steps=steps))

    def test_tools_ci_incomplete_refuses_before_source_or_window(self):
        with mock.patch.object(entry,'validate_host'),mock.patch.object(entry,'read_tools_ci',side_effect=RuntimeError('own CI incomplete')),mock.patch.object(entry,'checked_source') as check,mock.patch.object(entry,'install_counted_window') as window,self.assertRaisesRegex(RuntimeError,'own CI incomplete'):
            entry.execute(Path('/source'),Path('/tools'))
        check.assert_not_called();window.assert_not_called()

    def test_bounded_strict_metadata_no_duplicate_or_trailing(self):
        for raw in (b'{"id":1,"id":2}',b'{}{}',b'{"id":NaN}',b'\xff',b' '*(1<<20)+b'{}'):
            with self.subTest(size=len(raw)),self.assertRaises((RuntimeError,ValueError,UnicodeError)):entry.strict_json(raw)
        self.assertEqual(entry.strict_json(b'{"id":1}'),{'id':1})

    def test_reader_metadata_fixed_endpoint_no_redirect_or_retry(self):
        run,job=ci_fixture();responses=[]
        class Response(io.BytesIO):
            status=200
        def opened(request,timeout):
            self.assertEqual(timeout,15)
            value=run if not responses else job
            self.assertEqual(request.full_url,'https://api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/'+('runs/42365120777' if not responses else 'jobs/128382053748'))
            response=Response(json.dumps(value).encode());response.url=request.full_url;responses.append(response);return response
        opener=types.SimpleNamespace(open=opened)
        with mock.patch.object(entry.urllib.request,'build_opener',return_value=opener) as build:
            value=entry.read_tools_ci()
        self.assertEqual(len(value['metadata']),2)
        redirect=build.call_args.args[0]()
        with self.assertRaises(RuntimeError):redirect.redirect_request(None,None,302,None,None,'https://elsewhere')
        with mock.patch.object(entry.urllib.request,'build_opener',return_value=types.SimpleNamespace(open=mock.Mock(side_effect=OSError('transport')))) as build,self.assertRaises(OSError):entry.read_tools_ci()
        self.assertEqual(build.return_value.open.call_count,1)

    def test_mutated_original_or_symlink_never_executes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'input.py';source.write_bytes(b'raise AssertionError("must not execute")')
            for path in (source,root/'alias.py'):
                if path!=source:path.symlink_to(source)
                with self.assertRaises(RuntimeError):entry.pinned_module('invalid',path,'0'*64)

    def test_old_jobs_and_1b_wrapper_are_unchanged_new_job_is_dispatch_only(self):
        workflow=(HERE.parents[1]/'.github/workflows/pq-normal-process.yml').read_text()
        workflow=workflow.replace(', first100-held-public-owner]',']',1).replace(" && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-held-public-owner')",'',1)
        original=workflow.split('jobs:\n',1)[1].split('\n  first100-d24-controller-controls:',1)[0]
        # The exact new-only guard cannot change any existing profile route.
        original=original.replace("    if: github.ref != 'refs/heads/codex/ynx-pq-current75-baseline-20261101' && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-own1b-initialize-before-load') && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-7c25-public-owner')\n","    if: github.ref != 'refs/heads/codex/ynx-pq-current75-baseline-20261101' && (github.event_name != 'workflow_dispatch' || inputs.load_profile != 'first100-own1b-initialize-before-load')\n",1)
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),'83bf4b2d9fdcba0b73abf264867288e70079891d674f76d364411d0a8cad0334')
        self.assertEqual(hashlib.sha256((HERE/'pq-current75-baseline-ci.py').read_bytes()).hexdigest(),'a9aef92484c840da2a2e6eca39c98573ee5850547a98257316668e0db0e4cbd2')
        runtime=workflow.split('\n  first100-d24-initialize-before-load:',1)[1]
        # Later profiles carry different pins; restrict this assertion to D24's job.
        runtime=re.split(r'(?m)^  [A-Za-z0-9_-]+:[ \t]*$',runtime,maxsplit=1)[0]
        refs=dict((name,ref) for ref,name in re.findall(r'(?m)^          ref: ([^\n]+)\n          path: (controller|source|tools)$',runtime))
        self.assertEqual(refs,dict(controller='${{ github.sha }}',source=entry.GO_SOURCE,tools=entry.TOOLS))
        self.assertEqual(space.fixed_profile(environment())[2:],(refs['source'],refs['tools']))
        for literal in ("github.event_name == 'workflow_dispatch'","github.run_attempt == 1","inputs.load_profile == '"+entry.PROFILE+"'","inputs.signing_mode == 'online'",'needs: first100-d24-controller-controls','timeout-minutes: 18',entry.GO_SOURCE,entry.TOOLS,'--check-tools-ci',space.D24_AUTHORIZATION,'pq-first100-d24-tools-ci.json'):
            self.assertIn(literal,runtime)
        self.assertLess(runtime.index('--check-tools-ci'),runtime.index('Prepare only explicitly'))
        self.assertLess(runtime.index('Prepare only explicitly'),runtime.index('Execute sole'))
        self.assertEqual(runtime.count(' --execute'),2)
        self.assertIn('first100-d24-initialize-before-load-${{ github.run_id }}',runtime)

    def test_android_fixed_d24_and_original_tuple_only(self):
        self.assertEqual(space.fixed_profile(environment()),(entry.PROFILE,space.D24_AUTHORIZATION,entry.GO_SOURCE,entry.TOOLS))
        old=dict(environment(),PQ_BASELINE_PROFILE=space.PROFILE,GITHUB_JOB=space.PROFILE,PQ_HOSTED_SPACE_PREPARATION=space.AUTHORIZATION)
        self.assertEqual(space.fixed_profile(old),(space.PROFILE,space.AUTHORIZATION,space.GO_SOURCE,space.TOOLS_SOURCE))
        with mock.patch.object(space.sys,'platform','linux'),mock.patch.object(space.platform,'machine',return_value='x86_64'),mock.patch.object(space.os,'geteuid',return_value=1001):
            space.validate_host(environment());space.validate_host(old)
            for key,value in [('GITHUB_JOB',space.PROFILE),('PQ_HOSTED_SPACE_PREPARATION',space.AUTHORIZATION),('PQ_BASELINE_PROFILE','anything'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_RUN_ATTEMPT','2')]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):space.validate_host(dict(environment(),**{key:value}))
        self.assertEqual(str(space.TARGET),'/usr/local/lib/android');self.assertEqual((space.DISK_FLOOR,space.MEMORY_FLOOR),(16<<30,6<<30))

    def test_android_d24_wrong_tools_and_existing_unknown_fail_before_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();workspace=root/'work'
            for name in ('controller','source','tools'):(workspace/name).mkdir(parents=True)
            for name in ('temp','home','toolcache'):(root/name).mkdir()
            helper=workspace/'controller'/space.SCRIPT;helper.parent.mkdir(parents=True);helper.write_bytes(b'PUBLIC helper')
            env=dict(environment(),GITHUB_WORKSPACE=str(workspace),RUNNER_TEMP=str(root/'temp'),HOME=str(root/'home'),RUNNER_TOOL_CACHE=str(root/'toolcache'))
            pins={'controller':env['GITHUB_SHA'],'source':entry.GO_SOURCE,'tools':entry.TOOLS}
            def command(argv,**kw):return '' if 'status' in argv else pins[Path(argv[argv.index('-C')+1]).name]
            original_read,original_exists=Path.read_text,Path.exists
            with mock.patch.object(space,'__file__',str(helper)),mock.patch.object(space,'command',side_effect=command),mock.patch.object(space.subprocess,'check_output',return_value=helper.read_bytes()),mock.patch.object(Path,'read_text',lambda p,*a,**k:'ID=ubuntu\nVERSION_ID="24.04"\n' if str(p)=='/etc/os-release' else original_read(p,*a,**k)),mock.patch.object(Path,'exists',lambda p:False if str(p)=='/.dockerenv' else original_exists(p)):
                value=space.checked_layout(env);self.assertIn('-d24-',value.output.name)
                pins['tools']=space.TOOLS_SOURCE
                with self.assertRaises(RuntimeError):space.checked_layout(env)
                pins['tools']=entry.TOOLS;value.output.mkdir();original=value.output/'UNKNOWN';original.write_bytes(b'original')
                with self.assertRaises(RuntimeError):space.checked_layout(env)
                self.assertEqual(original.read_bytes(),b'original')

    def test_android_d24_original_before_firstcause_floors_and_no_retry(self):
        original=module('space_existing_controls',HERE/'test_pq_hosted_initialization_space_ci.py')
        names=('test_simulated_insufficient_disk_prepares_once_then_never_grants_admission','test_disk_already_sufficient_never_deletes','test_low_memory_never_deletes_to_pretend_capacity','test_removal_failure_preserves_before_intent_after_and_unknown_first_cause')
        with mock.patch.object(original,'environment',return_value=environment()):
            for name in names:
                case=original.HostedSpaceFlowControls(name)
                with self.subTest(name=name):
                    case.setUp()
                    try:getattr(case,name)()
                    finally:case.tearDown()

    def result_fixture(self):
        census=dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',configuredLoadAccounts=500,completeFourNodeAccountReadback=True,normalGoStaticOrCryptoQualification=False,signCommandsIssued=0,businessPOSTsIssued=0,sourceGrant=False,nodes=[dict(node=i,height=14,appHash='a'*64,matchingOriginalLoadAccounts=500,snapshotBytes=1024,snapshotSHA256='b'*64) for i in range(4)])
        processes=[dict(name=f'{phase}-node-{i}',pid=10+j*4+i,startTicks=str(100+j*4+i),exited=phase=='bootstrap',rawReturnCode=0 if phase=='bootstrap' else None,exitCode=0 if phase=='bootstrap' else None,signal=None) for j,phase in enumerate(('bootstrap','pq')) for i in range(4)]
        preload=self.driver.preload_initialization.validate(census,processes,[],35,5,30)
        final=copy.deepcopy(processes)
        for row in final:row.update(exited=True,rawReturnCode=0,exitCode=0)
        return dict(source=dict(commit=entry.GO_SOURCE,tree=entry.GO_TREE),toolIdentity=dict(commit=entry.TOOLS,tree=entry.TOOLS_TREE),caps=copy.deepcopy(entry.CAPS),sameWindowInitializationSourceFunctionalData={'test':'source-only'},loadConditions=self.driver.load_conditions(entry.fixed_options(Path('/source'))),firstCause=None,cleanupComplete=True,loadExecuted=True,normalLiveCalleeUsed=True,initializationOnlyRequested=False,preloadInitialization=preload,initializedAccountReadback=census,preparationUnconfirmedOwners=[],processes=final,normalNodeCleanExit=self.driver.normal.normal_node_clean_exit(final),loadResult=dict(firstCause=None,windowCompleted=True,configuredDemand=500,requestedOfferedTPS=100,releasedWithinWindow=500,qualified=500,notReleased=0,notSubmitted=0,lateSubmitted=0,notQualified=0))

    def test_full_denominator_natural_eight_and_unknown_are_not_relaxed(self):
        value=self.result_fixture();saved=copy.deepcopy(value)
        self.assertIs(entry.validate_result(self.driver,value,{'test':'source-only'}),value);self.assertEqual(value,saved)
        for mutate in (lambda r:r.update(firstCause='original UNKNOWN'),lambda r:r['loadResult'].update(qualified=2,notQualified=498),lambda r:r['loadResult'].update(releasedWithinWindow=499),lambda r:r['loadResult'].update(lateSubmitted=1),lambda r:r['loadConditions'].update(firstTrialProfile='own1b'),lambda r:r['preloadInitialization'].update(remainingOriginalActiveSeconds=34.99),lambda r:r['processes'][0].update(rawReturnCode=-9,exitCode=None,signal=9),lambda r:r['processes'][7].update(pid=999),lambda r:r['initializedAccountReadback']['nodes'][2].update(matchingOriginalLoadAccounts=499),lambda r:r['preparationUnconfirmedOwners'].append(4)):
            value=self.result_fixture();mutate(value)
            with self.assertRaises(RuntimeError):entry.validate_result(self.driver,value,{'test':'source-only'})

    def test_only_one_original_window_distinct_public_namespace(self):
        fake=types.SimpleNamespace(lab=types.SimpleNamespace())
        fake.lab.Window=mock.Mock(side_effect=lambda source,work,additional_storage:types.SimpleNamespace(storage_roots=list(additional_storage)))
        fake.lab.write_new=mock.Mock()
        intake=types.SimpleNamespace(nonoverlapping_roots=lambda roots:list(dict.fromkeys(roots)))
        original,calls=entry.install_counted_window(fake,intake,(Path('/workspace'),Path('/temp')),dict(scope='CONTROL_ONLY'))
        fake.lab.Window(Path('/source'),Path('/temp/case'))
        self.assertEqual(len(calls),1);original.assert_called_once()
        with self.assertRaises(RuntimeError):fake.lab.Window(Path('/source'),Path('/temp/case2'))
        self.assertEqual(fake.lab.write_new.call_args.args[0],Path('/temp/case/public/FIRST100-D24-CI.json'))

    def test_execute_restores_original_window_firstcause_and_strips_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();workspace=root/'workspace';parent=root/'temp';parent.mkdir()
            for name in ('controller','source','tools'):(workspace/name).mkdir(parents=True)
            helper=workspace/'controller/scripts/loadtest/pq-first100-d24-ci.py';helper.parent.mkdir(parents=True);helper.write_bytes(Path(entry.__file__).read_bytes())
            env=dict(environment(),GITHUB_WORKSPACE=str(workspace),RUNNER_TEMP=str(parent),GH_TOKEN='PUBLIC-test-token',GITHUB_TOKEN='PUBLIC-test-token')
            original=mock.Mock(side_effect=lambda *args,**kw:types.SimpleNamespace(storage_roots=list(kw['additional_storage'])))
            intake=types.SimpleNamespace(nonoverlapping_roots=lambda roots:list(dict.fromkeys(roots)))
            def run(options):
                self.assertEqual(vars(options),vars(entry.fixed_options(workspace/'source')))
                self.assertNotIn('GH_TOKEN',entry.os.environ);self.assertNotIn('GITHUB_TOKEN',entry.os.environ)
                self.driver.lab.Window(workspace/'source',parent/'CONTROL_ONLY')
                raise RuntimeError('original first failure UNKNOWN')
            def git(path,*args):
                if args==('rev-parse','HEAD:third_party/cometbft'):return entry.FORK_TREE
                return env['GITHUB_SHA'] if args==('rev-parse','HEAD') else ''
            with mock.patch.dict(entry.os.environ,env,clear=True),mock.patch.object(entry.sys,'platform','linux'),mock.patch.object(entry,'__file__',str(helper)),mock.patch.object(entry,'read_tools_ci',return_value={'syntheticCI':True}),mock.patch.object(entry,'git',side_effect=git),mock.patch.object(entry,'checked_source'),mock.patch.object(entry,'verify_tools'),mock.patch.object(entry,'pinned_bytes'),mock.patch.object(entry,'pinned_module',side_effect=lambda name,*args:self.driver if name=='normal_initialization_driver' else intake),mock.patch.object(entry.shutil,'which',return_value='/usr/bin/true'),mock.patch.object(self.driver.lab,'Window',original),mock.patch.object(self.driver.lab,'write_new'),mock.patch.object(self.driver,'run',side_effect=run),self.assertRaisesRegex(RuntimeError,'original first failure UNKNOWN'):
                try:entry.execute(workspace/'source',workspace/'tools')
                finally:self.assertIs(self.driver.lab.Window,original)
            original.assert_called_once()


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(D24ControllerControls)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun!=17 or result.skipped or not result.wasSuccessful():raise SystemExit(1)
    print(json.dumps(dict(kind='FIXED_D24_PURE_CONTROLLER',passed=17,skipped=0,network=False,nodeStarted=False,windowExecuted=False)))
