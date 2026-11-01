"""Finite initialization telemetry/readback controls. No Go/nodes/network."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
spec=importlib.util.spec_from_file_location('initialization_controls',Path(__file__).with_name('pq-initialization-measurements.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class StageBoundaryControls(unittest.TestCase):
    def test_failure_is_original_and_nested_intervals_are_not_summed(self):
        counter=iter([10,12,18,25]);s=m.InitializationStages(clock=lambda:next(counter));error=RuntimeError('PRIVATE_ERROR_SENTINEL')
        def fail():raise error
        with self.assertRaises(RuntimeError) as caught:s.run('prepare_network',None,lambda:s.run('call','activate-original',fail))
        self.assertIs(caught.exception,error);r=s.report();self.assertEqual([x['elapsedNs'] for x in r['records']],[15,6]);self.assertTrue(r['intervalsOverlap']);self.assertEqual(r['records'][0]['outcome'],'FAILED')
        self.assertEqual(r['records'][1]['errorType'],'RuntimeError');self.assertNotIn('PRIVATE_ERROR_SENTINEL',json.dumps(r))
    def test_sealed_load_calls_not_added_and_report_cannot_mutate_records(self):
        s=m.InitializationStages();value=object();self.assertIs(s.run('quiet',None,lambda:value),value);r=s.report();r['records'][0]['outcome']='forged';s.seal();self.assertIs(s.run('quiet',None,lambda:value),value);self.assertEqual(s.report()['attempted'],1);self.assertEqual(s.report()['records'][0]['outcome'],'RETURNED')
    def test_bounded_omissions_are_visible_without_failing_original_operation(self):
        s=m.InitializationStages(limit=1);self.assertEqual(s.run('call','one',lambda:1),1);self.assertEqual(s.run('call','two',lambda:2),2);self.assertEqual((s.report()['retained'],s.report()['omitted']),(1,1))
    def test_inherited_original_flow_and_nested_calls_keep_original_arguments(self):
        class Original:
            def __init__(self):self.calls=[]
            def prepare_network(self):return self.start(activation={'public':True})
            def start(self,*args,**kwargs):self.calls.append((args,kwargs));return 42
            def quiet(self):pass
            def call(self):pass
            def transfer(self):pass
            def traffic(self):pass
            def post_once(self):pass
            def sender_command(self):pass
            def halt_post(self):pass
            def activation_startup(self):pass
        s=m.InitializationStages();obj=m.instrumented_ceremony_class(Original)(initialization_stages=s);self.assertEqual(obj.prepare_network(),42);self.assertEqual(obj.calls,[((),{'activation':{'public':True}})]);self.assertEqual([x['stage'] for x in s.report()['records']],['prepare_network','start']);self.assertEqual(s.report()['records'][1]['identity'],'pq')

class CompleteAccountCensusControls(unittest.TestCase):
    def fixture(self,root,n=500):
        owners=[dict(index=i+4,owner='owner%d'%i,initialNonce='1',initialBalance='1') for i in range(n)];cp=dict(height=21,appHash='ab'*32);state=dict(initialized=True,**cp,accounts=[dict(address=o['owner'],nonce=1,balance=1) for o in owners]);nodes=[]
        for i in range(4):
            p=root/str(i)/'application.json';p.parent.mkdir();p.write_text(json.dumps(state));nodes.append(dict(index=i,statePath=str(p)))
        return owners,cp,state,nodes
    def test_full500_four_states_match_without_signing_or_claiming_crypto(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=self.fixture(root);r=m.complete_account_readback(nodes,owners,cp,root)
            self.assertTrue(r['completeFourNodeAccountReadback']);self.assertEqual([v['matchingOriginalLoadAccounts'] for v in r['nodes']],[500]*4);self.assertFalse(r['normalGoStaticOrCryptoQualification']);self.assertEqual((r['signCommandsIssued'],r['businessPOSTsIssued']),(0,0))
    def test_missing_nonce_balance_duplicate_checkpoint_or_uninitialized_refused(self):
        changes=[lambda s:s['accounts'].pop(),lambda s:s['accounts'][0].update(nonce=2),lambda s:s['accounts'][0].update(balance=0),lambda s:s['accounts'].append(dict(s['accounts'][0])),lambda s:s.update(height=22),lambda s:s.update(initialized=False)]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=self.fixture(root)
            for index,change in enumerate(changes):
                bad=copy.deepcopy(state);change(bad);Path(nodes[3]['statePath']).write_text(json.dumps(bad))
                with self.subTest(index=index),self.assertRaises(RuntimeError):m.complete_account_readback(nodes,owners,cp,root)
    def test_manifest_duplicates_gaps_or_bad_canonical_nonce_do_not_reduce_denominator(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=self.fixture(root)
            for mutation in [('owner',owners[0]['owner']),('index',4),('initialNonce','01')]:
                bad=copy.deepcopy(owners);bad[-1][mutation[0]]=mutation[1]
                with self.subTest(mutation=mutation),self.assertRaises(RuntimeError):m.complete_account_readback(nodes,bad,cp,root)
    def test_state_bound_and_symlink_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=self.fixture(root)
            with self.assertRaises(RuntimeError):m.complete_account_readback(nodes,owners,cp,root,read_limit=1)
            p=Path(nodes[-1]['statePath']);p.unlink();p.symlink_to(nodes[0]['statePath'])
            with self.assertRaises(RuntimeError):m.complete_account_readback(nodes,owners,cp,root)
    def test_atomic_replacement_during_read_is_not_retried_or_reinterpreted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=self.fixture(root);real=m.os.stat;calls=[]
            def replaced(path,*args,**kwargs):
                calls.append(path)
                p=Path(path);new=p.with_suffix('.replacement');new.write_text(json.dumps(state));new.replace(p);return real(path,*args,**kwargs)
            with mock.patch.object(m.os,'stat',side_effect=replaced):
                # Path.resolve also stats; restrict simulated replacement to the
                # explicit no-follow snapshot identity check.
                def checked(path,*args,**kwargs):return replaced(path,*args,**kwargs) if kwargs.get('follow_symlinks') is False else real(path,*args,**kwargs)
                with mock.patch.object(m.os,'stat',side_effect=checked),self.assertRaisesRegex(RuntimeError,'changed during'):m.complete_account_readback(nodes,owners,cp,root)
            self.assertEqual(len(calls),1)


class OriginalDriverInitializationControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('original_init_driver',Path(__file__).with_name('pq-independent-load.py'));cls.driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.driver)
    def args(self):
        from types import SimpleNamespace
        return SimpleNamespace(mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,staged_publication=True,initialization_only=True,execute=True,commit=self.driver.STAGED_CALLEE_SOURCE,source='/not-read-before-gate',wire_observation=False,network_accounting=False,commit_observation=False,owned_storage_accounting=False)
    def test_fixed500_init_profile_cannot_reduce_accounts_or_enable_presigned(self):
        d=self.driver;a=self.args();self.assertEqual(d.validate_options(a),500)
        for key,value in [('accounts',499),('per_account',2),('seconds',1),('mode','pre-signed'),('staged_publication',False)]:
            bad=copy.copy(a);setattr(bad,key,value)
            with self.subTest(key=key),self.assertRaises(RuntimeError):d.validate_options(bad)
    def test_old_c4b_cannot_reuse_new_live_source_or_previous_initialization_data(self):
        d=self.driver;a=self.args();a.commit='c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e'
        with mock.patch.object(d.lab,'check_source') as checked,self.assertRaisesRegex(RuntimeError,'exact staged normal consumer'):d.run(a)
        checked.assert_not_called()
        with mock.patch.object(d.initialization,'SOURCE_FUNCTIONAL_SHA256',None),self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):d.initialization.source_functional_data()
    def test_source_receipt_pin_is_checked_before_source_or_runtime(self):
        d=self.driver
        with mock.patch.object(d.initialization,'source_functional_data',side_effect=RuntimeError('receipt differs')),mock.patch.object(d.lab,'check_source') as checked,mock.patch.object(d.lab,'Window') as window:
            with self.assertRaisesRegex(RuntimeError,'receipt differs'):d.run(self.args())
            checked.assert_not_called();window.assert_not_called()
    def test_source_functional_prerequisite_cannot_qualify_pressure(self):
        d=self.driver;data=d.initialization.source_functional_data();self.assertFalse(data['actual500OwnerInputPreviouslyQualified'] or data['pressureAuthorized']);self.assertIsNone(d.STAGED_SOURCE_QUALIFICATION)
        a=self.args();a.initialization_only=False
        with mock.patch.object(d.lab,'check_source') as checked,self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):d.run(a)
        checked.assert_not_called()
    def mocked_initialization(self,census_error=None,cleanup=True):
        from types import SimpleNamespace
        import contextlib,io
        d=self.driver
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp).resolve();source=parent/'source';source.mkdir();args=self.args();args.source=str(source)
            work_holder={};c=SimpleNamespace(commit_observation_enabled=False,measurements=SimpleNamespace(report=lambda:{}),wire_readback=lambda:{},prepare_network=lambda:{'original':'activation'},pending_owners=set(range(4)),live=[],pin='a'*64,workload_pin='b'*64,root=None)
            owners=[dict(index=i,owner='owner%d'%i,initialNonce='1',initialBalance='1',memberCapacity='1') for i in range(504)]
            c.workload=dict(owners=owners,batchSize='1',outstandingPerOwner='1',batchWaitNanoseconds='0');c.quiet=lambda:dict(height=21,appHash='ab'*32)
            def window(source,work,additional_storage=()):
                work_holder['path']=work;c.root=work/'.private/network';c.root.mkdir()
                nodes=[];state=dict(initialized=True,height=21,appHash='ab'*32,accounts=[dict(address=o['owner'],nonce=1,balance=1) for o in owners])
                for i in range(4):
                    p=c.root/str(i)/'application.json';p.parent.mkdir();p.write_text(json.dumps(state));nodes.append(dict(index=i,statePath=str(p)))
                c.plan=dict(nodes=nodes)
                w=SimpleNamespace(storage_roots=[],started=d.time.monotonic(),peak_rss=1,peak_bytes=1,samples=[dict(processes=1,rssBytes=1,newBytes=1)],retired_samples=[],rss_fallback_samples=[],process_receipt=lambda:[],sample=mock.Mock(),stop=mock.Mock(return_value=cleanup),wait=mock.Mock())
                def launch(name,*a,**k):
                    if name=='create-original':(work/'public/create-original.log').write_text('{}')
                    return object()
                w.launch=launch;work_holder['window']=w;return w
            def instrumented(base):
                def construct(*args,**kwargs):
                    stages=kwargs['initialization_stages'];original=c.prepare_network
                    c.prepare_network=lambda:stages.run('prepare_network',None,original)
                    return c
                return construct
            original_journal=d.Journal
            def only_initialization_journal(path):
                if Path(path).stem!='initialization-events':raise AssertionError('business journal')
                return original_journal(path)
            env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',RUNNER_TEMP=str(parent))
            with contextlib.ExitStack() as stack:
                for obj,name,value in [(d.lab,'check_source',mock.Mock(return_value=dict(commit=args.commit,tree=d.STAGED_CALLEE_TREE))),(d.lab,'git',mock.Mock(return_value='')),(d.subprocess,'check_output',mock.Mock(return_value=b'live-materials')),(d.lab.guard,'proc_inventory',mock.Mock(return_value=({},None))),(d.lab.guard,'memory_available',mock.Mock(return_value=7<<30)),(d.shutil,'disk_usage',mock.Mock(return_value=SimpleNamespace(free=20<<30))),(d.lab,'heavy_processes',mock.Mock(return_value=[])),(d.lab,'admit',mock.Mock()),(d.lab,'ports_available',mock.Mock()),(d.ctypes,'CDLL',mock.Mock(return_value=SimpleNamespace(prctl=lambda *a:0))),(d.lab,'Window',window),(d.lab.guard,'digest',mock.Mock(return_value='a'*64)),(d.initialization,'instrumented_ceremony_class',instrumented),(d,'NormalBackend',mock.Mock(side_effect=AssertionError('business backend'))),(d,'Journal',only_initialization_journal),(d,'Monitor',mock.Mock(side_effect=AssertionError('business monitor')))]:stack.enter_context(mock.patch.object(obj,name,value))
                if census_error is not None:stack.enter_context(mock.patch.object(d.initialization,'complete_account_readback',side_effect=census_error))
                stack.enter_context(mock.patch.object(d.sys,'platform','linux'));stack.enter_context(mock.patch.dict(d.os.environ,env));stack.enter_context(contextlib.redirect_stdout(io.StringIO()));r=d.run(args)
            result=copy.deepcopy(r)
            work_holder['window'].stop.assert_called_once();self.assertTrue((work_holder['path']/'public/receipt.json').is_file())
            return result
    def test_full_mocked_original_driver_initializes_then_cleans_without_business_lanes(self):
            r=self.mocked_initialization()
            self.assertIsNone(r['firstCause']);self.assertTrue(r['initializationOnlyComplete'] and r['cleanupComplete']);self.assertFalse(r['loadExecuted']);self.assertNotIn('loadResult',r);self.assertEqual(r['initializedAccountReadback']['configuredLoadAccounts'],500);self.assertEqual(r['preparationOnlyDemandAccounting']['notReleased'],500)

    def test_failed_census_preserves_original_failure_cleans_and_never_qualifies(self):
        r=self.mocked_initialization(RuntimeError('original missing owner499'))
        self.assertEqual(r['firstCause'],'original missing owner499');self.assertTrue(r['cleanupComplete']);self.assertNotIn('initializationOnlyComplete',r);self.assertFalse(r['loadExecuted']);self.assertNotIn('loadResult',r);self.assertEqual(r['preparationOnlyDemandAccounting']['notQualified'],500)
    def test_successful_census_with_cleanup_debt_cannot_be_accepted(self):
        r=self.mocked_initialization(cleanup=False)
        self.assertFalse(r['cleanupComplete']);self.assertFalse(r['loadExecuted']);self.assertEqual(r['preparationOnlyDemandAccounting']['notReleased'],500)

    def test_finite_receipt_rejects_partial_accounts_caps_missing_spans_and_business_load(self):
        good=self.mocked_initialization();self.assertTrue(m.require_complete_initialization(good)['completeNormalInitializationObserved'])
        mutations=[lambda r:r['initializedAccountReadback']['nodes'][3].update(matchingOriginalLoadAccounts=499),lambda r:r.update(cleanupComplete=False),lambda r:r.update(loadExecuted=True),lambda r:r['preparationOnlyDemandAccounting'].update(notReleased=499),lambda r:r.update(resourceSamples=[]),lambda r:r['freshResourceAdmission'].update(availableMemoryBytes=1),lambda r:r['initializationStages'].update(omitted=1),lambda r:r['initializationStages']['records'][0].update(outcome='FAILED'),lambda r:r['caps'].update(cpus=3),lambda r:r['source'].update(commit='0'*40)]
        for i,mutate in enumerate(mutations):
            bad=copy.deepcopy(good);mutate(bad)
            with self.subTest(i=i),self.assertRaises(RuntimeError):m.require_complete_initialization(bad)

class CensusResourceBoundaryControls(unittest.TestCase):
    def test_original_guard_observes_live_raw_and_decoded_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=CompleteAccountCensusControls().fixture(root);check=mock.Mock()
            m.complete_account_readback(nodes,owners,cp,root,check=check)
            self.assertEqual(check.call_count,16)
    def test_guard_failure_preserves_original_error_and_stops_before_next_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();owners,cp,state,nodes=CompleteAccountCensusControls().fixture(root);failure=RuntimeError('original RSS cap');check=mock.Mock(side_effect=[None,None,failure])
            with self.assertRaises(RuntimeError) as caught:m.complete_account_readback(nodes,owners,cp,root,check=check)
            self.assertIs(caught.exception,failure);self.assertEqual(check.call_count,3)

class InitializationJournalControls(unittest.TestCase):
    def test_requested_and_returned_events_separate_fsync_cost_and_original_span(self):
        clock=iter([10,13,23]);events=[];s=m.InitializationStages(clock=lambda:next(clock),on_event=events.append)
        self.assertEqual(s.run('create_original','all504',lambda:42),42)
        self.assertEqual([e['kind'] for e in events],['initialization_stage_requested','initialization_stage_returned']);self.assertIsNone(events[0]['elapsedNs']);self.assertTrue(events[0]['missingReturnIsUnknown']);self.assertEqual((events[1]['requestJournalElapsedNs'],events[1]['elapsedNs']),(3,10));self.assertEqual(s.report()['journalErrors'],[])
    def test_request_journal_failure_never_starts_original_operation(self):
        operation=mock.Mock();error=OSError('journal')
        def sink(event):
            if event['kind']=='initialization_stage_requested':raise error
        s=m.InitializationStages(on_event=sink)
        with self.assertRaises(OSError) as caught:s.run('create_original',None,operation)
        self.assertIs(caught.exception,error);operation.assert_not_called();row=s.report()['records'][0];self.assertIsNone(row['elapsedNs']);self.assertEqual(row['outcome'],'NOT_STARTED');self.assertEqual(s.report()['journalErrors'][0]['phase'],'request')
    def test_original_failure_not_replaced_by_return_journal_failure(self):
        original=RuntimeError('original-first-cause')
        def operation():raise original
        def sink(event):
            if event['kind']=='initialization_stage_returned':raise OSError('journal-second')
        s=m.InitializationStages(on_event=sink)
        with self.assertRaises(RuntimeError) as caught:s.run('call',None,operation)
        self.assertIs(caught.exception,original);self.assertEqual(s.report()['records'][0]['outcome'],'FAILED');self.assertEqual(s.report()['journalErrors'][0]['phase'],'return')
    def test_successful_original_with_failed_return_journal_cannot_qualify(self):
        def sink(event):
            if event['kind']=='initialization_stage_returned':raise OSError('return-journal')
        s=m.InitializationStages(on_event=sink)
        with self.assertRaisesRegex(OSError,'return-journal'):s.run('call',None,lambda:42)
        self.assertEqual(s.report()['records'][0]['outcome'],'RETURNED');self.assertEqual(len(s.report()['journalErrors']),1)

class PreparationCalleeControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver=OriginalDriverInitializationControls.driver if hasattr(OriginalDriverInitializationControls,'driver') else None
        if cls.driver is None:OriginalDriverInitializationControls.setUpClass();cls.driver=OriginalDriverInitializationControls.driver
    def test_original_fd3_command_includes_only_existing_timings_flag_and_retains_cold_cost(self):
        from types import SimpleNamespace
        import os
        d=self.driver
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();(root/'.private').mkdir();(root/'public').mkdir();private=root/'network/workload/private-senders';private.mkdir(parents=True);credential=private/'recovery.raw';credential.write_bytes(bytes(32));credential.chmod(0o600)
            obj=object.__new__(d.LoadCeremony);obj.root=root/'network';obj.bins=root/'bin';obj.pin='a'*64;obj.activation_pin='b'*64;obj.workload_pin='c'*64;obj.consumer_source=d.STAGED_CALLEE_SOURCE;obj.preparation_sender_arguments=('--timings',);obj.preparation_sender_measurements=[]
            snapshot=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',clock='monotonic_elapsed_wall_ns',intervalsOverlap=True,stages={'checkpoint.loadTotal':dict(calls=1,elapsedNs=11)})
            reply=dict(version='YNX-PQ-LAB-SENDER-REPLY/v1',code='ORIGINAL_SAVED',calleeElapsedNs=20,startupElapsedNs=30,timings=snapshot,startupTimings=snapshot,result={'unchanged':'original'})
            commands=[]
            def launch(name,argv,**kwargs):
                commands.append(argv);self.assertEqual(len(kwargs['pass_fds']),1);self.assertEqual(os.fstat(kwargs['pass_fds'][0]).st_size,32);(root/'public'/(name+'.log')).write_text(json.dumps(reply));return object()
            obj.w=SimpleNamespace(work=root,launch=launch,wait=lambda proc:None)
            returned=obj.sender_command('halt-traffic-original-sign',0,{'operation':'sign'})
            self.assertEqual(returned,reply);self.assertEqual(commands[0].count('--timings'),1);self.assertEqual(commands[0][-2:],['--credential-fd','3']);self.assertNotIn(str(credential),commands[0]);row=obj.preparation_sender_measurements[0];self.assertEqual((row['calleeElapsedNs'],row['startupElapsedNs']),(20,30));self.assertTrue(row['startupNotAddedToCallee']);self.assertNotIn('result',row)
    def test_missing_original_preparation_timing_is_rejected_without_synthetic_spans(self):
        d=self.driver;obj=object.__new__(d.LoadCeremony);obj.preparation_sender_measurements=[]
        with mock.patch.object(d.normal.Ceremony,'sender_command',return_value={'code':'ORIGINAL_SAVED'}),self.assertRaisesRegex(RuntimeError,'callee elapsed schema'):obj.sender_command('original',0,{'operation':'sign'})
        self.assertEqual(obj.preparation_sender_measurements,[])

class OriginalFailedCalleeControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OriginalDriverInitializationControls.setUpClass();cls.driver=OriginalDriverInitializationControls.driver
        cls.raw=(Path(__file__).with_name('fixtures')/'init500-live-setup0-original-failure.txt').read_bytes()
    def test_actual_retained_failed_go_metrics_are_not_successful_reply_or_zero(self):
        r=self.driver.original_failed_callee_timing(self.raw)
        self.assertEqual(r['calleeElapsedNs'],5448072916);self.assertEqual(r['timings']['stages']['live.configLoadTotal']['elapsedNs'],873289);self.assertFalse(r['businessSuccess'] or r['sourceGrant']);self.assertEqual(r['outcome'],'REFUSED_OR_UNKNOWN_NO_RETRY')
    def test_missing_duplicate_or_relabelled_failed_metrics_are_refused(self):
        encoded=json.loads(self.raw.rsplit(b'; elapsed=',1)[1]);duplicate=self.raw.replace(b'"CalleeElapsedNS":5448072916',b'"CalleeElapsedNS":1,"CalleeElapsedNS":5448072916')
        for raw in [b'ordinary error without timing',duplicate,self.raw.replace(b'REFUSED_OR_UNKNOWN_NO_RETRY',b'ORIGINAL_SAVED')]:
            with self.subTest(raw=raw[:40]),self.assertRaises((RuntimeError,ValueError)):self.driver.original_failed_callee_timing(raw)
    def test_original_call_failure_is_preserved_when_original_failure_metric_is_retained(self):
        from types import SimpleNamespace
        d=self.driver
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();(root/'public').mkdir();(root/'public/live-setup-0.log').write_bytes(self.raw)
            obj=object.__new__(d.LoadCeremony);obj.w=SimpleNamespace(work=root);obj.consumer_source=d.STAGED_CALLEE_SOURCE;obj.failed_callee_attempts=0;obj.failed_callee_measurements=[];original=RuntimeError('original live-setup error')
            with mock.patch.object(d.normal.Ceremony,'call',side_effect=original),self.assertRaises(RuntimeError) as caught:obj.call('live-setup-0',[])
            self.assertIs(caught.exception,original);self.assertEqual(obj.failed_callee_measurements[0]['status'],'ORIGINAL_FAILURE_TIMING_OBSERVED');self.assertFalse(obj.failed_callee_measurements[0]['successfulReply']);self.assertEqual(obj.failed_callee_measurements[0]['originalFailureTiming']['calleeElapsedNs'],5448072916)
    def test_missing_original_log_never_replaces_original_error_or_invents_timing(self):
        from types import SimpleNamespace
        d=self.driver
        with tempfile.TemporaryDirectory() as tmp:
            obj=object.__new__(d.LoadCeremony);obj.w=SimpleNamespace(work=Path(tmp));obj.consumer_source=d.STAGED_CALLEE_SOURCE;obj.failed_callee_attempts=0;obj.failed_callee_measurements=[];original=RuntimeError('first')
            with mock.patch.object(d.normal.Ceremony,'call',side_effect=original),self.assertRaises(RuntimeError) as caught:obj.call('live-setup-0',[])
            self.assertIs(caught.exception,original);row=obj.failed_callee_measurements[0];self.assertEqual(row['status'],'NOT_SUPPLIED');self.assertNotIn('originalFailureTiming',row)

if __name__=='__main__':unittest.main()
