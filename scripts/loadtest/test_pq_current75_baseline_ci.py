"""Fixed703 joint-source/profile/storage controls only; no API/Go/node execution."""
import base64,contextlib,copy,hashlib,importlib.util,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location("source703_fixed_controls",Path(__file__).with_name("pq-current75-baseline-ci.py"));entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
# Exact already-public source-only archive, not a signature/business fixture.
PUBLIC_ARCHIVE=base64.b64decode("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")

class Fixed703Controls(unittest.TestCase):
    def qualification(self):
        with entry.zipfile.ZipFile(io.BytesIO(PUBLIC_ARCHIVE)) as z:receipt=json.loads(z.read('CONTINUATION-RECEIPT.json'))
        def run(identity,head,end,path,branch):return dict(id=identity,head_sha=head,run_attempt=1,event='push',status='completed',conclusion=end,path=path,head_branch=branch,workflow_id=402774607)
        prior=run(41272858949,entry.GO_SOURCE,'cancelled','.github/workflows/resource-market-ci.yml','codex/ynx-pq-perf-integration')
        chain=run(41272858825,entry.GO_SOURCE,'success','.github/workflows/chain-core.yml','codex/ynx-pq-perf-integration')
        tail=run(entry.CONTINUATION_RUN,entry.CONTINUATION_CONTROLLER,'success',entry.WORKFLOW,entry.CONTINUATION_BRANCH)
        # Public metadata seams are deliberately not called original executions.
        oldjob=dict(id=124749016396,run_id=41272858949,head_sha=entry.GO_SOURCE,run_attempt=1,name='focused-go',status='completed',conclusion='cancelled',started_at='2026-11-01T00:00:00Z',completed_at='2026-11-01T00:15:00Z',steps=[dict(number=n,name=name,conclusion=end) for n,name,end in entry.JOINT_SPEC['priorPrefix']]+[dict(number=48,name=entry.JOINT_SPEC['steps'][0]['name'],conclusion='cancelled')])
        tailjob=dict(id=entry.CONTINUATION_JOB,run_id=entry.CONTINUATION_RUN,head_sha=entry.CONTINUATION_CONTROLLER,run_attempt=1,name='source703-continuation',status='completed',conclusion='success',steps=[v['actual'] for v in receipt['tailSteps']]+[receipt['dependencyActual']])
        artifact=dict(id=entry.ARTIFACT,name='ynx-source703-continuation-'+entry.CONTINUATION_CONTROLLER+'-'+str(entry.CONTINUATION_RUN),size_in_bytes=entry.ARTIFACT_BYTES,expired=False,digest='sha256:'+entry.ARTIFACT_SHA256,workflow_run=dict(id=entry.CONTINUATION_RUN,head_sha=entry.CONTINUATION_CONTROLLER,head_branch=entry.CONTINUATION_BRANCH,repository_id=1285041796,head_repository_id=1285041796))
        data={'actions/runs/41272858949':prior,'actions/jobs/124749016396':oldjob,'actions/runs/41272858825':chain,'actions/runs/41278568036':tail,'actions/jobs/124765630747':tailjob,'check-runs/124749016396/annotations?per_page=100':[dict(annotation_level='failure',message='The job has exceeded the maximum execution time of 15m0s')],'git/commits/'+entry.GO_SOURCE:dict(sha=entry.GO_SOURCE,tree=dict(sha=entry.GO_TREE)),'git/commits/'+entry.CONTINUATION_CONTROLLER:dict(sha=entry.CONTINUATION_CONTROLLER,tree=dict(sha=entry.CONTINUATION_TREE),parents=[dict(sha=entry.GO_SOURCE)]),'actions/runs/41278568036/attempts/1/jobs?per_page=100&page=1':dict(total_count=1,jobs=[tailjob]),'actions/artifacts/13072721720':artifact,'actions/artifacts/13072721720/zip':PUBLIC_ARCHIVE}
        return data
    def qualify(self,data):return entry.prior_source_data(lambda path,binary=False:copy.deepcopy(data[path]))
    def test_default_is_inert_and_never_qualifies_or_reads(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execute')),mock.patch.object(entry,'git',side_effect=AssertionError('git')),mock.patch.object(entry,'api_reader',side_effect=AssertionError('API')),contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(entry.main([]),0)
        v=json.loads(out.getvalue());self.assertEqual(v['goSource'],entry.GO_SOURCE);self.assertEqual(v['sourceQualificationContinuation'],41278568036);self.assertFalse(v['executed'] or v['authorityGranted'] or v['nodeStartAuthorized']);self.assertTrue(v['noOld75Qualification'])
    def test_fixed_source_tools_caps_and_all500_do_not_change(self):
        o=entry.fixed_options(Path('/owned/source'));self.assertEqual((o.commit,o.mode,o.rate,o.seconds,o.accounts,o.per_account,o.tail_seconds,o.proof_timeout),(entry.GO_SOURCE,'online',100,5,8,63,30,30))
        self.assertEqual(entry.GO_SOURCE,'7037966eb2ce7a7167f02a09ee1f3bc0eebd1026');self.assertEqual(entry.TOOLS,'5f8ce5afb17364f5db10b8b17fa375ac23653174');self.assertFalse(o.wire_observation or o.network_accounting)
        self.assertEqual(entry.CAPS,dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2));self.assertGreaterEqual(o.accounts*o.per_account,500)
    def test_finite_joint_prefix_plus7_is_data_not_whole_green_or_authority(self):
        v=self.qualify(self.qualification());self.assertEqual(v['sourceCommit'],entry.GO_SOURCE);self.assertTrue(v['source703PrefixAndSevenTailScopePassed']);self.assertEqual(v['priorResourceConclusion'],'cancelled')
        for key in ['originalResourceWholeSuccess','actual500Window','currentControllerRemoteGatePassed','nodeStartAuthorized','authorityGranted','publicNetwork']:self.assertFalse(v[key])
    def test_refuse_wrong_source_attempt_terminal_prefix_and_original_timeout(self):
        cases=[('actions/runs/41272858949','head_sha','17fbbf7f30530b6b92e7eb103e6af13efbfd72df'),('actions/runs/41272858949','conclusion','success'),('actions/runs/41278568036','head_sha',entry.GO_SOURCE),('actions/runs/41278568036','run_attempt',2),('actions/jobs/124765630747','run_attempt',True),('actions/jobs/124765630747','status','in_progress')]
        for path,key,value in cases:
            with self.subTest(path=path,key=key):
                data=self.qualification();data[path][key]=value
                with self.assertRaises(RuntimeError):self.qualify(data)
        data=self.qualification();data['actions/jobs/124749016396']['steps'][33]['conclusion']='skipped'
        with self.assertRaises(RuntimeError):self.qualify(data)
        data=self.qualification();data['check-runs/124749016396/annotations?per_page=100']=[]
        with self.assertRaises(RuntimeError):self.qualify(data)
    def test_refuse_missing_duplicate_skipped_or_different_tail_scope(self):
        for kind in ['missing','duplicate','skipped','foreign-number']:
            data=self.qualification();steps=data['actions/jobs/124765630747']['steps']
            if kind=='missing':steps.pop(0)
            elif kind=='duplicate':steps.append(copy.deepcopy(steps[0]))
            elif kind=='skipped':steps[0]['conclusion']='skipped'
            else:steps[0]['number']=99
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):self.qualify(data)
        data=self.qualification();data['actions/runs/41278568036/attempts/1/jobs?per_page=100&page=1']['total_count']=2
        with self.assertRaises(RuntimeError):self.qualify(data)
    def test_archive_source_artifact_and_graph_pins_cannot_be_replaced(self):
        for field,value in [('expired',True),('id',False),('size_in_bytes',6256),('digest','sha256:'+'0'*64)]:
            data=self.qualification();data['actions/artifacts/13072721720'][field]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):self.qualify(data)
        data=self.qualification();data['actions/artifacts/13072721720/zip']=b'x'*6255
        with self.assertRaisesRegex(RuntimeError,'SHA256'):self.qualify(data)
        data=self.qualification();data['git/commits/'+entry.GO_SOURCE]['tree']['sha']='a'*40
        with self.assertRaises(RuntimeError):self.qualify(data)
    def test_qualification_reconciles_original_attempt_again_before_execution(self):
        data=self.qualification();counts={}
        def fetch(path,binary=False):
            counts[path]=counts.get(path,0)+1;value=copy.deepcopy(data[path])
            if path=='actions/runs/41272858949' and counts[path]>1:value['run_attempt']=2
            return value
        with self.assertRaises(RuntimeError):entry.prior_source_data(fetch)
    def test_only_original_first_attempt_branch_and_profile_can_execute(self):
        env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='push',GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=entry.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_RUN_ID='123')
        with mock.patch.object(entry.sys,'platform','linux'):
            entry.validate_host(env)
            for key,value in [('GITHUB_REF','refs/heads/main'),('PQ_BASELINE_PROFILE','current75-online-100x5'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_SHA','0'*40),('GITHUB_EVENT_NAME','schedule')]:
                with self.subTest(key=key),self.assertRaises(RuntimeError):entry.validate_host(dict(env,**{key:value}))
        raw=(Path(__file__).parents[2]/'.github/workflows/pq-normal-process.yml').read_text();self.assertIn('ref: '+entry.GO_SOURCE,raw);self.assertIn('ref: '+entry.TOOLS,raw);self.assertIn('/.github/workflows/resource-market-ci.yml',raw);self.assertNotIn('test_pq_backend_modes.py -v',raw);self.assertIn('no39/41/old8 groups rerun',raw)
    def test_counted_window_is_original_and_counts_all_roots_once(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp);original=mock.Mock(return_value=types.SimpleNamespace(storage_roots=[p]));writes=mock.Mock();driver=types.SimpleNamespace(lab=types.SimpleNamespace(Window=original,write_new=writes));intake=types.SimpleNamespace(nonoverlapping_roots=lambda roots:list(roots))
            old,calls=entry.install_counted_window(driver,intake,(p,),{});self.assertIs(old,original);self.assertIs(driver.lab.Window(p,p),calls[0]);self.assertTrue(writes.call_args.args[1]['onlyStorageRootAdapter'])
            with self.assertRaises(RuntimeError):driver.lab.Window(p,p)
    def complete(self):
        groups={k:dict(calleeElapsed=dict(denominator=n,observed=n,censoredOrNotReached=0)) for k,n in [('startup',8),('live_setup',4),('sign',500),('confirm',500),('live_publish',500),('live_result',500)]}
        return dict(source=dict(commit=entry.GO_SOURCE),caps=entry.CAPS,senderPoolPreparation=dict(readyCount=8,signed=False,nonceReserved=False,sourceGrant=False,loadClockStarted=False),normalCalleeMeasurements=dict(source=entry.GO_SOURCE,groups=groups),firstCause=None,cleanupComplete=True,loadExecuted=True,normalLiveCalleeUsed=True,configuredDemand=500,requestedOfferedTPS=100,loadResult=dict(windowCompleted=True,configuredDemand=500,notQualified=0))
    def test_full_completion_requires_actual_ready_metrics_and_full_denominators(self):
        good=self.complete();entry.require_complete(good)
        for key,value in [('cleanupComplete',False),('firstCause','original'),('loadExecuted',False),('configuredDemand',499)]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):entry.require_complete(dict(good,**{key:value}))
        bad=copy.deepcopy(good);bad['normalCalleeMeasurements']['groups']['confirm']['calleeElapsed']['observed']=499
        with self.assertRaises(RuntimeError):entry.require_complete(bad)
        bad=copy.deepcopy(good);bad['senderPoolPreparation']['readyCount']=7
        with self.assertRaises(RuntimeError):entry.require_complete(bad)
        bad=copy.deepcopy(good);bad['loadResult']['notQualified']=1
        with self.assertRaises(RuntimeError):entry.require_complete(bad)
    def test_source_data_exclusive_before_driver_and_token_not_inherited(self):
        class StopBeforeDriver(RuntimeError):pass
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();workspace=root/'workspace';runner=root/'runner';controller=workspace/'controller';source=workspace/'source';tools=workspace/'tools';script=controller/'scripts/loadtest/pq-current75-baseline-ci.py';script.parent.mkdir(parents=True)
            for p in [runner,source,tools]:p.mkdir(parents=True)
            script.write_text('# metadata fixture only')
            env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='push',GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=entry.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_RUN_ID='123',GITHUB_WORKSPACE=str(workspace),RUNNER_TEMP=str(runner),GH_TOKEN='PUBLIC-unit-read-only-seam')
            def git(root,*args):return '' if args[0]=='status' else (entry.FORK_TREE if 'HEAD:third_party/cometbft' in args else 'a'*40)
            with mock.patch.dict(entry.os.environ,env,clear=True),mock.patch.object(entry.sys,'platform','linux'),mock.patch.object(entry,'__file__',str(script)),mock.patch.object(entry,'git',side_effect=git),mock.patch.object(entry,'checked_source'),mock.patch.object(entry,'pinned_bytes'),mock.patch.object(entry,'api_reader'),mock.patch.object(entry,'prior_source_data',return_value={'classification':'data'}),mock.patch.object(entry,'pinned_module',side_effect=StopBeforeDriver('no Go/signing')):
                with self.assertRaises(StopBeforeDriver):entry.execute(source,tools)
                data=runner/'pq-current703-source-qualification-123-1.json';self.assertEqual(data.stat().st_mode&0o777,0o600);self.assertNotIn('GH_TOKEN',entry.os.environ);before=data.read_bytes()
                with self.assertRaisesRegex(RuntimeError,'fresh and exclusive'):entry.execute(source,tools)
                self.assertEqual(before,data.read_bytes())
    def test_modified_pinned_module_and_capacity_overrides_never_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'bad.py';p.write_text("raise AssertionError('not executed')")
            with self.assertRaises(RuntimeError):entry.pinned_module('bad',p,'0'*64)
        for args in [['--rate','500'],['--accounts','9'],['--mode','pre-signed'],['--source','a','--source','b']]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(args)

if __name__=='__main__':unittest.main()
