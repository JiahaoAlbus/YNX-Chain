"""Fixed703 joint-source/profile/storage controls only; no API/Go/node execution."""
import base64,contextlib,copy,hashlib,importlib.util,io,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location("source703_fixed_controls",Path(__file__).with_name("pq-current75-baseline-ci.py"));entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
# Exact already-public source-only archive, not a signature/business fixture.

class FixedC06Controls(unittest.TestCase):
    def test_default_is_inert_and_never_qualifies_or_reads(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execute')),mock.patch.object(entry,'git',side_effect=AssertionError('git')),mock.patch.object(entry,'api_reader',side_effect=AssertionError('API')),contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(entry.main([]),0)
        v=json.loads(out.getvalue());self.assertEqual(v['goSource'],entry.GO_SOURCE);self.assertEqual(v['sourceNamedSupplementRun'],41288482948);self.assertFalse(v['executed'] or v['authorityGranted'] or v['nodeStartAuthorized']);self.assertTrue(v['noOld75Qualification'])
    def test_fixed_source_tools_caps_and_all500_do_not_change(self):
        o=entry.fixed_options(Path('/owned/source'));self.assertEqual((o.commit,o.mode,o.rate,o.seconds,o.accounts,o.per_account,o.tail_seconds,o.proof_timeout),(entry.GO_SOURCE,'online',100,5,8,63,30,30))
        self.assertEqual(entry.GO_SOURCE,'c06b4607247a1fdf7e485337ab03206984baa71c');self.assertEqual(entry.TOOLS,'36d937f45fa9a144aa0d7520633a5654755b454c');self.assertFalse(o.wire_observation);self.assertTrue(o.network_accounting and o.header_hop_capture and o.owned_storage_accounting)
        self.assertEqual(entry.CAPS,dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2));self.assertGreaterEqual(o.accounts*o.per_account,500)
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
        good=self.complete()
        with self.assertRaisesRegex(RuntimeError,"normal Commit"):entry.require_complete(good)
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
                data=runner/'pq-currentc06-source-qualification-123-1.json';self.assertEqual(data.stat().st_mode&0o777,0o600);self.assertNotIn('GH_TOKEN',entry.os.environ);before=data.read_bytes()
                with self.assertRaisesRegex(RuntimeError,'fresh and exclusive'):entry.execute(source,tools)
                self.assertEqual(before,data.read_bytes())
    def test_modified_pinned_module_and_capacity_overrides_never_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'bad.py';p.write_text("raise AssertionError('not executed')")
            with self.assertRaises(RuntimeError):entry.pinned_module('bad',p,'0'*64)
        for args in [['--rate','500'],['--accounts','9'],['--mode','pre-signed'],['--source','a','--source','b']]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(args)

class PublicClosureIntakeControls(unittest.TestCase):
    def ledger(self):return dict(loadResult=dict(configuredDemand=500,rows=[dict(index=i,status="queued") for i in range(500)],qualified=0))
    def test_empty_partial_has_no_fake_closure_or_independent_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            report=entry.intake_original_public_closures(None,self.ledger(),Path(temp))
        self.assertEqual(report['configuredDemand'],500);self.assertEqual(report['retainedCompletePortableClosures'],0);self.assertFalse(report['independentCryptographicReverification'] or report['sourceGrant'] or report['nativeRootAuthorized'])
    def test_missing_rows_or_qualified_count_never_shrink_full500(self):
        for change in ('rows','count'):
            value=self.ledger()
            if change=='rows':value['loadResult']['rows'].pop()
            else:value['loadResult']['qualified']=1
            with self.assertRaisesRegex(RuntimeError,'all500|count differs'):entry.intake_original_public_closures(None,value,Path('/PUBLIC-unit-no-read'))
    def test_qualified_original_path_is_required_before_reader(self):
        value=self.ledger();value['loadResult']['qualified']=1;value['loadResult']['rows'][0].update(status='qualified',proofReference='OTHER-MATERIAL')
        with self.assertRaisesRegex(RuntimeError,'receipt location'):entry.intake_original_public_closures(None,value,Path('/PUBLIC-unit-no-read'))

class DiagnosticC06Controls(unittest.TestCase):
    def test_finite_receiver_import_uses_only_exact_owned_tools_file_and_pin(self):
        sentinel=object()
        with mock.patch.dict(entry.os.environ,{'GITHUB_WORKSPACE':'/UNIT-workspace'}),mock.patch.object(entry,'pinned_module',return_value=sentinel) as load:
            self.assertIs(entry.c06_qualification(),sentinel)
        self.assertEqual(load.call_args.args[1],Path('/UNIT-workspace/tools/scripts/loadtest/pq-c06-source-qualification.py'))
        self.assertEqual(load.call_args.args[2],entry.TOOL_PINS['pq-c06-source-qualification.py'])
    def test_current_diagnostic_baseline_cannot_claim_before_after_or_new_authority(self):
        data=entry.prepared_data()
        self.assertEqual(data['measurementScope'],'current-c06-diagnostic-baseline')
        self.assertFalse(data['comparisonEligible'] or data['performanceSourcePairQualified'] or data['nodeStartAuthorized'])
        self.assertIsNone(entry.PERFORMANCE_SOURCE_PAIR_QUALIFICATION)
    def test_explicit_header_network_pin_contract_is_not_performance_qualification(self):
        options=entry.fixed_options(Path('/PUBLIC-unit-source'))
        self.assertTrue(options.network_accounting and options.header_hop_capture)
        for name in ('owned-tcp-accounting.py','network-layer-accounting.py','pq-network-window.py','pq-hop-byte-accounting.py','pq-owned-header-capture.py','test_pq_owned_header_capture.py'):
            self.assertRegex(entry.TOOL_PINS[name],r'^[0-9a-f]{64}$')
        self.assertEqual(entry.SOURCE_EQUIVALENCE_QUALIFICATION['after'],entry.GO_SOURCE);self.assertIsNone(entry.PERFORMANCE_SOURCE_PAIR_QUALIFICATION)
        workflow=(Path(__file__).parents[2]/'.github/workflows/pq-normal-process.yml').read_text()
        self.assertIn('test_pq_c06_source_qualification.py -v',workflow)
        self.assertIn('test_pq_owned_storage_window.py -v',workflow)
    def test_old703_cannot_silently_become_new_consumer_or_state_equivalence(self):
        self.assertTrue(entry.fixed_options(Path('/PUBLIC-unit-source')).commit_observation)
        self.assertEqual(entry.SOURCE_EQUIVALENCE_QUALIFICATION['after'],entry.GO_SOURCE);self.assertIsNone(entry.PERFORMANCE_SOURCE_PAIR_QUALIFICATION)

class RequestedCommitHeightControls(unittest.TestCase):
    def no_points(self):
        value=FixedC06Controls().complete()
        value['normalCommitObservation']=dict(fourOriginalSnapshotsValid=True,expectedNodes=4,validOriginalNodes=4,independentFinality=False,signerFsyncMeasured=False,allCommitAttemptsCovered=False,replayCoverageComplete=False,unreportedStagesAreUnknown=True,originalSnapshots=[dict(usable=True,rawOriginalObservation=dict(sampleOverflow=False,latestTimingAvailable=True,droppedSuccessSamples=0,rejectedNotifications={},errorNotifications=0,lastFailure=None,unobservedLatest=None,samples=[])) for _ in range(4)])
        return value
    def test_file_count_does_not_replace_all500_proof_height_binding(self):
        with self.assertRaisesRegex(RuntimeError,'all500 original proof heights'):entry.require_complete(self.no_points())
    def test_missing_h_or_hplus1_commit_sample_is_never_zero_filled(self):
        value=self.no_points();value['publicProofClosureIntake']=dict(qualifiedOriginalRows=500,retainedCompletePortableClosures=500,requiredCommitHeights=[19,20],expectedCommitAppHashByHeight={'19':'a'*64})
        with self.assertRaisesRegex(RuntimeError,'sample missing'):entry.require_complete(value)
    def test_same_height_apphash_conflict_is_refused(self):
        value=self.no_points();value['publicProofClosureIntake']=dict(qualifiedOriginalRows=500,retainedCompletePortableClosures=500,requiredCommitHeights=[19,20],expectedCommitAppHashByHeight={'19':'a'*64})
        for node in value['normalCommitObservation']['originalSnapshots']:node['rawOriginalObservation']['samples']=[dict(height=19,appHash='b'*64),dict(height=20,appHash='c'*64)]
        with self.assertRaisesRegex(RuntimeError,'AppHash differs'):entry.require_complete(value)

if __name__=='__main__':unittest.main()
