"""Declared ABI/transport controls, not real Go producer or Commit measurements."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=module('commit_declared_transport','pq-commit-observation.py');driver=module('commit_guard_driver','pq-independent-load.py')

FIXTURE=Path(__file__).with_name('fixtures')/'commit-observation-public-schema.json'

def declared(pid,height=19):
    # Exact Go-marshaled schema specimen, adapted identity/one sample only for
    # transport unit controls. PUBLIC capture boundary is kept, never runtime.
    raw=FIXTURE.read_bytes();assert hashlib.sha256(raw).hexdigest()=='9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06'
    value=copy.deepcopy(json.loads(raw)['cases']['gap-and-overflow']);value.update(processID=pid,originalGenesisHash='b'*64,successNotifications=1,droppedSuccessSamples=0,sampleOverflow=False,unobservedLatest=None)
    value['coverage']['observedHeightGaps']=[];value['samples'][0].update(height=height);value['samples'][0]['persistence']['height']=height
    return value

class CommitObservationDeclaredControls(unittest.TestCase):
    def test_c06_original_output_ceiling_rejects_oversize_before_parse_or_copy(self):
        self.assertEqual(m.MAX_BYTES,524288)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();p=root/'oversize.json';p.write_bytes(b'x'*(m.MAX_BYTES+1));p.chmod(0o600)
            descriptors=[dict(node=i,path=str(p),processName='pq-node-%d'%i) for i in range(4)]
            children=[dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123,poll=lambda:0)) for i in range(4)]
            with mock.patch.object(m,'strict',side_effect=AssertionError('oversize never parsed')):report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'chain','b'*64)
            self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(len(report['errors']),4);self.assertEqual(list((root/'public').iterdir()),[])
    def test_actual_go_marshal_schema_cases_are_not_runtime_evidence(self):
        original=json.loads(FIXTURE.read_bytes());self.assertEqual(original['classification'],'PUBLIC_TEST_FIXTURE');self.assertTrue(original['notRuntimeEvidence'])
        for name,value in original['cases'].items():
            with self.subTest(case=name):
                self.assertIs(m.validate_declared_contract(value,value['processID'],value['chainID'],value['originalGenesisHash'],False),value)
                with self.assertRaisesRegex(RuntimeError,'not normal runtime'):m.validate_declared_contract(value,value['processID'],value['chainID'],value['originalGenesisHash'])
        missing=original['cases']['missing-failure-timing'];self.assertIsNone(missing['lastFailure']['timing']);self.assertIsNone(missing['lastFailure']['attemptAppHash'])
        overflow=original['cases']['gap-and-overflow'];self.assertEqual(overflow['samples'][0]['persistence']['stagesNs']['json_encode'],20);self.assertEqual(overflow['droppedSuccessSamples'],2)

    def test_old703_and_unqualified_source_refused_before_source_check_or_start(self):
        args=SimpleNamespace(mode='online',rate=100,accounts=8,per_account=63,seconds=5,tail_seconds=30,proof_timeout=30,source='/NOT-READ',commit='7037966eb2ce7a7167f02a09ee1f3bc0eebd1026',commit_observation=True)
        self.assertEqual(driver.COMMIT_OBSERVATION_SOURCE,'c06b4607247a1fdf7e485337ab03206984baa71c')
        with mock.patch.object(driver.lab,'check_source') as checked:
            with self.assertRaisesRegex(RuntimeError,'exact c06'):driver.run(args)
            checked.assert_not_called()
    def test_fresh_private_args_only_no_node_or_listener(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();output=root/'pq-node-0.json';args=m.arguments(output,root)
            self.assertEqual(args,['--commit-observation-output',str(output),'--commit-observation-scope','synthetic-loopback-lab/v1']);self.assertFalse(output.exists())
            output.write_bytes(b'original')
            with self.assertRaisesRegex(RuntimeError,'fresh'):m.arguments(output,root)
    def test_fixed128_overflow_unknowns_and_original_stages_not_summed(self):
        snapshot=declared(123);sample=snapshot['samples'][0];snapshot['samples']=[dict(copy.deepcopy(sample),height=i,persistence=dict(copy.deepcopy(sample['persistence']),height=i)) for i in range(1,129)];snapshot.update(successNotifications=129,droppedSuccessSamples=1,sampleOverflow=True)
        self.assertEqual(len(m.validate_declared_contract(snapshot,123,'ynx_642399-1','b'*64,False)['samples']),128)
        self.assertFalse(snapshot['coverage']['allCommitAttemptsCovered'] or snapshot['coverage']['replayCoverageComplete'] or snapshot['independentFinality']);self.assertNotIn('missingStage',snapshot['samples'][0]['persistence']['stagesNs'])
        snapshot['samples'].append(dict(copy.deepcopy(sample),height=129))
        with self.assertRaisesRegex(RuntimeError,'128'):m.validate_declared_contract(snapshot,123,'ynx_642399-1','b'*64,False)
    def test_missing_counter_false_coverage_or_wrong_identity_never_defaults_zero(self):
        for change in ('missingCounter','boolCounter','whole','pid','chain','genesis','aliasPID','heightMismatch','boolNs'):
            value=declared(123)
            if change=='missingCounter':del value['errorNotifications']
            elif change=='boolCounter':value['successNotifications']=True
            elif change=='whole':value['coverage']['allCommitAttemptsCovered']=True
            elif change=='pid':value['processID']=124
            elif change=='chain':value['chainID']='public'
            elif change=='genesis':value['originalGenesisHash']='c'*64
            elif change=='aliasPID':value['processId']=value.pop('processID')
            elif change=='heightMismatch':value['samples'][0]['persistence']['height']=18
            else:value['samples'][0]['persistence']['stagesNs']['json_encode']=True
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.validate_declared_contract(value,123,'ynx_642399-1','b'*64,False)
    def test_actual_stopped_child_identity_raw_bytes_retained_and_missing_node_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();private=root/'private';private.mkdir();children=[];descriptors=[];originals={}
            for i in range(4):
                proc=subprocess.Popen([sys.executable,'-I','-c','pass']);proc.wait(timeout=5);children.append(dict(name='pq-node-%d'%i,process=proc))
                path=private/('pq-node-%d.json'%i);descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i))
                if i!=3:
                    raw=json.dumps(declared(proc.pid),indent=3).encode();path.write_bytes(raw);path.chmod(0o600);originals[i]=raw
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64)
            self.assertEqual(report['validOriginalNodes'],0);self.assertFalse(report['fourOriginalSnapshotsValid']);self.assertEqual(len(report['errors']),4);self.assertEqual(len(report['originalSnapshots']),3)
            for i,raw in originals.items():self.assertEqual((root/'public'/('commit-observation-node-%d-original.json'%i)).read_bytes(),raw)
            self.assertFalse(report['allCommitAttemptsCovered'] or report['independentFinality'] or report['signerFsyncMeasured'])
    def test_permission_or_live_producer_never_read_as_stopped_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();path=root/'observed.json';path.write_text(json.dumps(declared(123)));path.chmod(0o644)
            descriptors=[dict(node=i,path=str(path),processName='pq-node-%d'%i) for i in range(4)];children=[dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123,poll=lambda:None)) for i in range(4)]
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64);self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(list((root/'public').iterdir()),[])
            for child in children:child['process'].poll=lambda:0
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64);self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(list((root/'public').iterdir()),[])

class CommitStageSummaryControls(unittest.TestCase):
    def test_missing_stage_never_zero_filled_or_added_and_storage_not_pooled(self):
        value=declared(123);first=value['samples'][0]
        second=copy.deepcopy(first);second.update(height=20);second['persistence'].update(height=20,elapsedNs=200,stagesNs={'file_sync':80})
        third=copy.deepcopy(second);third.update(height=21);third['persistence'].update(height=21,storage='block-journal-v2',stagesNs={'delta_encode':7})
        value['samples'] += [second,third];value['successNotifications']=3
        report=m.persistence_stage_summary(value);atomic=report['byStorage']['atomic-json']
        self.assertEqual(atomic['stages']['json_encode']['count'],1);self.assertEqual(atomic['stages']['json_encode']['missingRetainedSamples'],1)
        self.assertEqual(atomic['stages']['json_encode']['minNs'],20);self.assertEqual(atomic['persistenceElapsed']['medianNs'],150)
        self.assertIsNone(atomic['persistenceElapsed']['retainedSampleP95Ns']);self.assertEqual(report['byStorage']['block-journal-v2']['retainedSuccessCount'],1)
        self.assertFalse(report['stagesAdded']);self.assertIsNone(report['businessTPS'])
    def test_overflow_latest_and_failure_not_success_samples(self):
        original=json.loads(FIXTURE.read_bytes())['cases']['gap-and-overflow'];before=copy.deepcopy(original)
        report=m.persistence_stage_summary(original)
        self.assertEqual(report['retainedSuccessCount'],1);self.assertEqual(report['droppedSuccessSamples'],2);self.assertTrue(report['sampleOverflow']);self.assertTrue(report['unobservedLatestExcluded'])
        self.assertEqual(report['observedHeightGaps'],[dict(afterHeight=9,beforeHeight=11)]);self.assertEqual(original,before)
        failed=json.loads(FIXTURE.read_bytes())['cases']['missing-failure-timing'];report=m.persistence_stage_summary(failed)
        self.assertEqual(report['byStorage'],{});self.assertEqual(report['errorNotifications'],1);self.assertFalse(report['lastFailureTimingAvailable'])
    def test_retained_percentile_exact_nearest_rank_is_not_business_latency(self):
        value=declared(123);first=value['samples'][0];value['samples']=[]
        for height in range(1,21):
            item=copy.deepcopy(first);item.update(height=height);item['persistence'].update(height=height,elapsedNs=height*100);value['samples'].append(item)
        value['successNotifications']=20;report=m.persistence_stage_summary(value)
        self.assertEqual(report['byStorage']['atomic-json']['persistenceElapsed']['retainedSampleP95Ns'],1900)
        self.assertIsNone(report['inclusionLatency']);self.assertIsNone(report['finalConfirmationLatency']);self.assertFalse(report['allCommitAttemptsCovered'])
    def test_runtime_readback_attaches_summary_only_after_original_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();descriptors=[];children=[]
            for i in range(4):
                path=root/('node%d.json'%i);snapshot=declared(123+i);snapshot['captureBoundary']=m.CAPTURE_BOUNDARY
                path.write_text(json.dumps(snapshot));path.chmod(0o600)
                descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i));children.append(dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123+i,poll=lambda:0)))
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64)
            self.assertTrue(report['fourOriginalSnapshotsValid']);self.assertEqual([r['retainedPersistenceStages']['retainedSuccessCount'] for r in report['originalSnapshots']],[1]*4)

def detailed(pid=123,height=19):
    # Python ABI control only; never relabel this as an actual Go sample.
    value=declared(pid,height);value['captureBoundary']=m.CAPTURE_BOUNDARY
    sample=value['samples'][0];sample['persistence']['stagesNs']['validate']=90
    sample['validation']=dict(version=m.VALIDATION_VERSION,height=height,elapsedNs=80,
                              phaseNs={'accounts':40,'app_hash':30},hashDocumentNs=20,hashEncodeDigestNs=15)
    return value

class CommitValidationControls(unittest.TestCase):
    def validate(self,value):return m.validate_declared_contract(value,123,'ynx_642399-1','b'*64)

    def test_exact_optional_shape_and_nested_overlapping_spans(self):
        value=detailed();before=copy.deepcopy(value);self.assertIs(self.validate(value),value)
        summary=m.validation_stage_summary(value,source_commit=m.VALIDATION_SOURCE)
        self.assertEqual(summary['observedCount'],1);self.assertEqual(summary['samples'][0]['height'],19)
        self.assertEqual(summary['samples'][0]['validation']['hashDocumentNs'],20)
        self.assertFalse(summary['stagesAdded']);self.assertTrue(summary['childSpansOverlapParents'])
        # 20 + 15 > parent app_hash 30 is valid: child spans are not summed.
        self.assertEqual(value,before);self.assertIsNone(summary['businessTPS'])

    def test_malformed_or_cross_height_validation_never_accepted(self):
        changes={
            'null':lambda s:s.update(validation=None),
            'extra':lambda s:s['validation'].update(privatePath='untrusted'),
            'missing':lambda s:s['validation'].pop('hashDocumentNs'),
            'version':lambda s:s['validation'].update(version='unknown'),
            'height':lambda s:s['validation'].update(height=20),
            'boolHeight':lambda s:s['validation'].update(height=True),
            'elapsed':lambda s:s['validation'].update(elapsedNs=91),
            'missingParent':lambda s:s['persistence']['stagesNs'].pop('validate'),
            'float':lambda s:s['validation'].update(elapsedNs=80.0),
            'negative':lambda s:s['validation'].update(hashDocumentNs=-1),
            'child':lambda s:s['validation'].update(hashEncodeDigestNs=31),
            'emptyPhases':lambda s:s['validation'].update(phaseNs={}),
            'tooMany':lambda s:s['validation'].update(phaseNs={str(i):1 for i in range(65)}),
            'badPhase':lambda s:s['validation']['phaseNs'].update({'../path':1}),
            'boolNs':lambda s:s['validation']['phaseNs'].update(accounts=True),
            'phaseElapsed':lambda s:s['validation']['phaseNs'].update(accounts=81),
            'overflow':lambda s:s['validation'].update(hashDocumentNs=1<<63),
        }
        for name,change in changes.items():
            value=detailed();change(value['samples'][0])
            with self.subTest(name=name),self.assertRaises(RuntimeError):self.validate(value)

    def test_json_duplicates_and_nonfinite_numbers_refused(self):
        for raw in (b'{"phaseNs":{"accounts":1,"accounts":2}}',b'{"elapsedNs":NaN}',b'{"elapsedNs":Infinity}',b'{"elapsedNs":-Infinity}'):
            with self.subTest(raw=raw),self.assertRaises(RuntimeError):m.strict(raw)

    def test_old_samples_missing_detail_and_heights_remain_unknown(self):
        value=declared(123);summary=m.validation_stage_summary(value,source_commit='c'*40,heights={19,20})
        self.assertEqual(summary['status'],'UNKNOWN');self.assertEqual(summary['observedCount'],0)
        self.assertEqual(summary['missingRetainedSamples'],1);self.assertIsNone(summary['samples'][0]['validation'])
        self.assertEqual(summary['missingRequestedHeights'],[20])
        value=detailed();value['unobservedLatest']=copy.deepcopy(value['samples'][0]);value['samples']=[]
        self.assertEqual(m.validation_stage_summary(value,source_commit=m.VALIDATION_SOURCE)['observedCount'],0)
        value=detailed();value['samples'][0]['validation']['phaseNs'].pop('app_hash')
        value['samples'][0]['validation'].update(hashDocumentNs=0,hashEncodeDigestNs=0)
        self.validate(value) # Match Go absent-map lookup without inventing app_hash.
        self.assertNotIn('app_hash',m.validation_stage_summary(value,source_commit=m.VALIDATION_SOURCE)['samples'][0]['validation']['phaseNs'])

    def test_opt_in_needs_parent_observer_and_exact_source_before_source_access(self):
        for source,parent,requested in [('c'*40,True,True),(m.VALIDATION_SOURCE,False,True),(m.VALIDATION_SOURCE,True,1)]:
            args=SimpleNamespace(commit=source,commit_observation=parent,commit_validation_observation=requested)
            with self.subTest(source=source,parent=parent,requested=requested),mock.patch.object(driver.lab,'check_source') as checked, self.assertRaises(RuntimeError):
                driver.run(args)
            checked.assert_not_called()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();out=root/'node.json'
            baseline=m.arguments(out,root)
            self.assertNotIn('--commit-validation-observation',baseline)
            self.assertEqual(m.arguments(out,root,validation=True,source_commit=m.VALIDATION_SOURCE),baseline+['--commit-validation-observation'])
        with self.assertRaisesRegex(RuntimeError,'exact Commit validation'):
            m.validation_stage_summary(detailed(),source_commit='c'*40)
        args=SimpleNamespace(mode='online',accounts=500,per_account=2,seconds=5,tail_seconds=30,proof_timeout=30,sender_backend='bounded-cold',staged_publication=True)
        baseline=driver.load_conditions(args);self.assertNotIn('commit_validation_observation',baseline)
        args.commit_validation_observation=False;self.assertEqual(driver.load_conditions(args),baseline)
        args.commit_validation_observation=True;changed=driver.load_conditions(args)
        self.assertTrue(changed.pop('commit_validation_observation'));self.assertEqual(changed,baseline)

    def test_driver_wires_four_original_arguments_without_mutating_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'.private').mkdir();policy=root/'policy';policy.write_bytes(b'control')
            pin=hashlib.sha256(policy.read_bytes()).hexdigest()
            activation={'nodes':[{'args':['original',str(n)]} for n in range(4)]};before=copy.deepcopy(activation)
            ceremony=driver.LoadCeremony.__new__(driver.LoadCeremony)
            ceremony.w=SimpleNamespace(work=root);ceremony.root=root;ceremony.pin='p';ceremony.activation_pin='a';ceremony.operations=500;ceremony.proof_timeout=30
            ceremony.live=[];ceremony.measurements=SimpleNamespace(record=lambda *args:None)
            ceremony.commit_observation_enabled=True;ceremony.commit_validation_observation_enabled=True;ceremony.consumer_source=m.VALIDATION_SOURCE
            ceremony.commit_observation_descriptors=[];ceremony.finalize_observation_enabled=False
            def call(name,args):
                n=int(name.rsplit('-',1)[1])
                return dict(version='YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1',syntheticOnly=True,nodeStarted=False,authorityGranted=False,
                            policy=dict(path=str(policy),sha256=pin),nodeArguments=activation['nodes'][n]['args']+['--proof-host-live-policy',str(policy),'--proof-host-live-policy-sha256',pin])
            ceremony.call=call
            result=ceremony.activation_startup(activation)
            self.assertEqual(activation,before);self.assertEqual(len(ceremony.commit_observation_descriptors),4)
            for node in result['nodes']:self.assertEqual(node['args'].count('--commit-validation-observation'),1)
            activation['nodes'][0]['args'].append('--commit-validation-observation=false')
            with self.assertRaisesRegex(RuntimeError,'duplicate'):ceremony.activation_startup(activation)

    def test_existing_fixed_namespaces_and_actual_constructor_default_stay_off(self):
        adapter=module('original_fixed_commit_options','pq-first100-7c25-ci.py')
        class SourceProbe(RuntimeError):pass
        with mock.patch.object(adapter,'PROFILE','first100-7c25-public-owner'):
            fixed=adapter.fixed_options(Path('/NOT-READ'))
        self.assertFalse(hasattr(fixed,'commit_validation_observation'))
        for profile,source in [('7c25',driver.first_trial_7c25_source.SOURCE),(driver.HELD_TRIAL_PROFILE,driver.HELD_TRIAL_SOURCE)]:
            args=copy.copy(fixed);args.first_trial_profile=profile;args.commit=source
            with self.subTest(profile=profile),mock.patch.object(driver.first_trial_7c25_source,'qualification',return_value={}),mock.patch.object(driver.lab,'check_source',side_effect=SourceProbe('configuration accepted')) as checked,mock.patch.object(driver.lab,'Window') as window:
                with self.assertRaisesRegex(SourceProbe,'configuration accepted'):driver.run(args)
                checked.assert_called_once_with(Path('/NOT-READ'),source);window.assert_not_called()
                self.assertNotIn('commit_validation_observation',driver.load_conditions(args))
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'ynx-consensus-proof-verify').write_bytes(b'not executable; hash control only')
            def original_base(instance,*args,**kwargs):
                instance.workload={'owners':list(range(8))};instance.mode='online';instance.bins=root
            with mock.patch.object(driver.normal.Ceremony,'__init__',new=original_base):
                ceremony=driver.LoadCeremony(operations=1,proof_timeout=30,commit_observation=True)
            self.assertFalse(ceremony.commit_validation_observation_enabled)
            self.assertEqual(ceremony.consumer_source,driver.CALLEE_SOURCE)

    def archive_control(self,root,*,detail=True):
        (root/'public').mkdir();descriptors=[];children=[];originals={}
        for i in range(4):
            snapshot=detailed(123+i,19+i) if detail else declared(123+i,19+i)
            snapshot['captureBoundary']=m.CAPTURE_BOUNDARY
            raw=json.dumps(snapshot,indent=3).encode();path=root/('node%d.json'%i);path.write_bytes(raw);path.chmod(0o600)
            originals[i]=raw;descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i))
            children.append(dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123+i,poll=lambda:0)))
        source=m.VALIDATION_SOURCE if detail else 'c'*40
        report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64,source_commit=source,validation_requested=detail)
        receipt=dict(source=dict(commit=source),normalCommitObservation=report,
                     processes=[dict(name='pq-node-%d'%i,pid=123+i,startTicks=100+i,exited=True,rawReturnCode=0) for i in range(4)])
        files={'public/commit-observation-node-%d-original.json'%i:raw for i,raw in originals.items()}
        return files,receipt

    def read_control(self,files,receipt):
        return m.original_validation_readback(files,'public/',receipt,source_commit=receipt['source']['commit'],
                                              chain_id='ynx_642399-1',genesis_hash='b'*64,business_heights={19,22})

    def test_stopped_copy_original_sha_source_pid_height_and_storage_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            files,receipt=self.archive_control(Path(temp).resolve());report=self.read_control(files,receipt)
            self.assertTrue(receipt['normalCommitObservation']['fourOriginalSnapshotsValid']);self.assertEqual(report['observedNodes'],4)
            for i in range(4):
                node=report['nodes'][str(i)];raw=files['public/commit-observation-node-%d-original.json'%i]
                self.assertEqual(node['originalFile']['sha256'],hashlib.sha256(raw).hexdigest())
                self.assertEqual(node['producer']['pid'],123+i);self.assertEqual(node['producer']['startTicks'],100+i)
                sample=node['allRetained']['samples'][0];self.assertEqual(sample['height'],19+i)
                self.assertEqual(sample['storage'],'atomic-json')
                self.assertEqual(node['business']['observedCount'],1 if i in (0,3) else 0)

    def test_archive_tampering_fails_closed_per_node_without_erasing_other_nodes(self):
        with tempfile.TemporaryDirectory() as temp:
            files,receipt=self.archive_control(Path(temp).resolve())
            changes={
                'sha':lambda f,r:f.__setitem__('public/commit-observation-node-0-original.json',b'{}'),
                'pid':lambda f,r:r['processes'][0].update(pid=999),
                'ticks':lambda f,r:r['processes'][0].update(startTicks=0),
                'live':lambda f,r:r['processes'][0].update(exited=False),
                'exit':lambda f,r:r['processes'][0].update(rawReturnCode=None),
                'source':lambda f,r:r['normalCommitObservation']['originalSnapshots'][0].update(sourceCommit='c'*40),
                'sourcePayload':lambda f,r:r['normalCommitObservation']['originalSnapshots'][0].update(sourceCommit={'privatePath':'SYNTHETIC_UNTRUSTED_VALUE'}),
                'copy':lambda f,r:r['normalCommitObservation']['originalSnapshots'][0]['rawOriginalObservation']['samples'][0].update(height=99),
            }
            for name,change in changes.items():
                f,r=copy.deepcopy(files),copy.deepcopy(receipt);change(f,r)
                with self.subTest(name=name):
                    report=self.read_control(f,r);self.assertEqual(report['nodes']['0']['status'],'INVALID_ORIGINAL')
                    self.assertIsNone(report['nodes']['0']['allRetained']);self.assertEqual(report['observedNodes'],3)
                    self.assertNotIn('SYNTHETIC_UNTRUSTED_VALUE',json.dumps(report))
            for change in ('truncated','snapshotPID'):
                f,r=copy.deepcopy(files),copy.deepcopy(receipt);name='public/commit-observation-node-0-original.json'
                snapshot=json.loads(f[name]);snapshot['processID']=999 if change=='snapshotPID' else 123
                f[name]=json.dumps(snapshot).encode()
                if change=='truncated':f[name]=f[name][:-1]
                r['normalCommitObservation']['originalSnapshots'][0].update(bytes=len(f[name]),sha256=hashlib.sha256(f[name]).hexdigest(),rawOriginalObservation=snapshot)
                with self.subTest(change=change):
                    report=self.read_control(f,r);self.assertEqual(report['nodes']['0']['status'],'INVALID_ORIGINAL')
                    self.assertEqual(report['nodes']['0']['errorType'],'JSONDecodeError' if change=='truncated' else 'RuntimeError')
                    self.assertEqual(report['observedNodes'],3)
            with self.assertRaisesRegex(RuntimeError,'receipt/source'):
                m.original_validation_readback(files,'public/',receipt,source_commit='c'*40,chain_id='ynx_642399-1',genesis_hash='b'*64)

    def test_legacy_single_arm_and_missing_node_do_not_gain_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            files,receipt=self.archive_control(Path(temp).resolve(),detail=False)
            report=self.read_control(files,receipt);self.assertEqual(report['observedNodes'],0)
            self.assertEqual(report['nodes']['0']['allRetained']['missingRetainedSamples'],1)
            self.assertNotIn('validationRequested',receipt['normalCommitObservation'])
            receipt['normalCommitObservation']['originalSnapshots'].pop()
            report=self.read_control(files,receipt);self.assertEqual(report['nodes']['3']['status'],'UNKNOWN')
            self.assertIsNone(report['nodes']['3']['allRetained'])

    def test_unrequested_detail_keeps_raw_original_but_is_not_usable(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();descriptors=[];children=[]
            for i in range(4):
                path=root/('node%d.json'%i);path.write_text(json.dumps(detailed(123+i)));path.chmod(0o600)
                descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i));children.append(dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123+i,poll=lambda:0)))
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64)
            self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(len(report['originalSnapshots']),4)
            self.assertEqual(len(list((root/'public').iterdir())),4)
            self.assertTrue(all('unrequested' in e['reason'] for e in report['errors']))
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();descriptors=[];children=[];raw=json.dumps(detailed()).encode()[:-1]
            for i in range(4):
                path=root/('node%d.json'%i);path.write_bytes(raw);path.chmod(0o600)
                descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i));children.append(dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123+i,poll=lambda:0)))
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64,source_commit=m.VALIDATION_SOURCE,validation_requested=True)
            self.assertEqual(report['validOriginalNodes'],0)
            self.assertEqual([e['errorType'] for e in report['errors']],['JSONDecodeError']*4)
            for ref in report['originalSnapshots']:
                self.assertEqual((root/'public'/ref['path']).read_bytes(),raw)
                self.assertEqual(ref['sha256'],hashlib.sha256(raw).hexdigest());self.assertFalse(ref['usable'])

if __name__=='__main__':unittest.main()
