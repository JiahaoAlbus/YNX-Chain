"""Synthetic producer ABI and original held entry controls, no window."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

existing=module('original_commit_controls','test_pq_commit_observation.py')
m=existing.m;driver=existing.driver
stage_summary=module('validation_stage_summary','pq-first100-stage-summary.py')
held_reader=module('validation_business_stage_reader','pq-first100-7c25-readback.py')


class CommitValidationReadbackControls(unittest.TestCase):
    def sample(self):
        value=existing.declared(123);phases={name:0 for name in m.VALIDATION_PHASES}
        phases['anchor']=2;phases['app_hash']=5
        value['samples'][0]['validation']=dict(version='YNX-COMET-COMMIT-VALIDATION/v1',height=value['samples'][0]['height'],
            elapsedNs=7,phaseNs=phases,hashDocumentNs=2,hashEncodeDigestNs=3)
        return value

    def test_old_v1_without_detail_and_new_same_height_detail(self):
        old=existing.declared(123)
        self.assertIs(m.validate_declared_contract(old,123,'ynx_642399-1','b'*64,False),old)
        self.assertNotIn('validationDetail',m.persistence_stage_summary(old)['byStorage']['atomic-json'])
        value=self.sample();m.validate_declared_contract(value,123,'ynx_642399-1','b'*64,False)
        result=m.persistence_stage_summary(value)['byStorage']['atomic-json']['validationDetail']
        self.assertEqual((result['retainedOriginalCommits'],result['observed'],result['missingRetainedCommits']),(1,1,0))
        self.assertEqual(result['phases']['app_hash']['medianNs'],5)
        self.assertTrue(result['childrenOverlapParent']);self.assertFalse(result['stagesAdded'] or result['independentFinality'])

    def test_missing_unknown_sum_height_and_hash_children_refuse(self):
        for case in ('missing','unknown','sum','height','children','outer','bool'):
            with self.subTest(case=case):
                value=self.sample();detail=value['samples'][0]['validation']
                if case=='missing':detail['phaseNs'].pop('app_hash');detail['hashDocumentNs']=detail['hashEncodeDigestNs']=0
                elif case=='unknown':detail['phaseNs']['invented']=detail['phaseNs'].pop('anchor')
                elif case=='sum':detail['phaseNs']['anchor']=1
                elif case=='height':detail['height']+=1
                elif case=='children':detail['hashEncodeDigestNs']=4
                elif case=='outer':detail['elapsedNs']=20
                else:detail['phaseNs']['anchor']=True
                with self.assertRaises(RuntimeError):m.validate_declared_contract(value,123,'ynx_642399-1','b'*64,False)

    def test_default_source_gate_refuses_before_original_work(self):
        self.assertIsNone(driver.COMMIT_VALIDATION_ABI_SOURCE)
        args=SimpleNamespace(first_trial_profile=driver.HELD_TRIAL_PROFILE,commit_validation_observation=True,
                             commit_observation=True,commit=driver.HELD_TRIAL_SOURCE)
        with self.assertRaisesRegex(RuntimeError,'source/CI NOT_SUPPLIED'):driver.validate_options(args)

    def test_commit_clock_default_gate_refuses_before_original_work(self):
        self.assertIsNone(driver.commit_clock.COMMIT_CLOCK_SOURCE)
        args=SimpleNamespace(first_trial_profile=driver.HELD_TRIAL_PROFILE,commit_clock_observation=True,
                             commit_observation=True,commit=driver.HELD_TRIAL_SOURCE)
        with self.assertRaisesRegex(RuntimeError,'clock source/CI NOT_SUPPLIED'):driver.validate_options(args)

    def test_post_clock_resource_refusal_preserves_first_cause_and_new_peak(self):
        from unittest import mock
        for cause in (None,'earlier original failure'):
            result=dict(firstCause=cause);window=SimpleNamespace(peak_rss=7,peak_bytes=8,samples=[],peak_rss_sample=dict(rssBytes=7),
                sample=mock.Mock(side_effect=RuntimeError('owned RSS exceeded 4GiB')),
                sample_stage_report=lambda:dict(status='OBSERVED',failedCalls=1))
            with mock.patch.object(driver,'original_commit_clock_readback',return_value=dict(status='OBSERVED_OR_CENSORED')):
                driver.finish_commit_clock_readback(result,window,Path('/synthetic'),Path('/synthetic/private'),'a'*40,500)
            self.assertEqual(result['firstCause'],cause or 'owned RSS exceeded 4GiB')
            self.assertEqual((result['peakRSSBytes'],result['peakRSSSample']['rssBytes'],result['resourceGuardStageElapsed']['failedCalls']),(7,7,1))
            self.assertEqual((result['commitClockReadback']['status'],result['commitClockReadback']['censored']),('NOT_SUPPLIED',500))

    def test_business_height_reducer_keeps_missing_detail_censored(self):
        value=self.sample();second=copy.deepcopy(value['samples'][0]);second['height']+=1
        second['persistence']['height']+=1;second.pop('validation');value['samples'].append(second)
        data=dict(originalCommitCopies=dict(records=[dict(node=0,sha256='1'*64,producerReportedUsable=True,originalSnapshot=value)]))
        all_rows=stage_summary.commit_stages(data)['nodes']['0']['byStorage']['atomic-json']['validationDetail']
        self.assertEqual((all_rows['denominator'],all_rows['observed']),(2,1))
        self.assertEqual(all_rows['phases']['app_hash']['missingOrCensored'],1)
        self.assertIsNone(all_rows['phases']['app_hash']['retainedSampleP95Ns'])
        selected=held_reader.business_commit_stages(data,dict(records=[dict(height=str(value['samples'][0]['height']))]),stage_summary)
        chosen=selected['nodes']['0']['byStorage']['atomic-json']['validationDetail']
        self.assertEqual((chosen['denominator'],chosen['observed']),(1,1))
        self.assertEqual(selected['selectedHeights'],[value['samples'][0]['height']])
        self.assertFalse(selected['perTransactionCostInferred'])

    def test_four_original_node_argument_opt_in_is_explicit_and_default_off(self):
        for enabled in (False,True):
            with self.subTest(enabled=enabled),tempfile.TemporaryDirectory() as temp:
                root=Path(temp).resolve();(root/'.private').mkdir()
                policies=[];nodes=[]
                for node in range(4):
                    path=root/('policy-%d'%node);path.write_bytes(('synthetic-%d'%node).encode())
                    policies.append(path);nodes.append(dict(index=node,args=['original-%d'%node]))
                owner=driver.LoadCeremony.__new__(driver.LoadCeremony);owner.w=SimpleNamespace(work=root);owner.root=root
                owner.operations=500;owner.proof_timeout=30;owner.pin='1'*64;owner.activation_pin='2'*64
                owner.measurements=SimpleNamespace(record=lambda *args:None)
                owner.live=[];owner.commit_observation_enabled=True;owner.commit_validation_observation_enabled=enabled
                owner.finalize_observation_enabled=False;owner.commit_observation_descriptors=[]
                def setup(name,args):
                    node=int(name.rsplit('-',1)[1]);path=policies[node];digest=hashlib.sha256(path.read_bytes()).hexdigest()
                    return dict(version='YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1',syntheticOnly=True,nodeStarted=False,authorityGranted=False,
                        policy=dict(path=str(path),sha256=digest),nodeArguments=[*nodes[node]['args'],'--proof-host-live-policy',str(path),'--proof-host-live-policy-sha256',digest])
                owner.call=setup
                result=owner.activation_startup(dict(nodes=copy.deepcopy(nodes)))
                for node in result['nodes']:
                    self.assertEqual('--commit-validation-observation' in node['args'],enabled)
                    self.assertEqual(node['args'].count('--commit-validation-observation'),int(enabled))

    def test_commit_clock_adds_exactly_four_distinct_original_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'.private').mkdir();nodes=[];policies=[]
            for node in range(4):
                path=root/('policy-%d'%node);path.write_bytes(('synthetic-%d'%node).encode())
                policies.append(path);nodes.append(dict(index=node,args=['original-%d'%node]))
            owner=driver.LoadCeremony.__new__(driver.LoadCeremony);owner.w=SimpleNamespace(work=root);owner.root=root
            owner.operations=500;owner.proof_timeout=30;owner.pin='1'*64;owner.activation_pin='2'*64
            owner.measurements=SimpleNamespace(record=lambda *args:None);owner.live=[]
            owner.commit_observation_enabled=True;owner.commit_validation_observation_enabled=False
            owner.commit_clock_observation_enabled=True;owner.commit_clock_descriptors=[]
            owner.finalize_observation_enabled=False;owner.commit_observation_descriptors=[]
            def setup(name,args):
                node=int(name.rsplit('-',1)[1]);path=policies[node];digest=hashlib.sha256(path.read_bytes()).hexdigest()
                return dict(version='YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1',syntheticOnly=True,nodeStarted=False,authorityGranted=False,
                    policy=dict(path=str(path),sha256=digest),nodeArguments=[*nodes[node]['args'],'--proof-host-live-policy',str(path),'--proof-host-live-policy-sha256',digest])
            owner.call=setup;result=owner.activation_startup(dict(nodes=copy.deepcopy(nodes)))
            self.assertEqual(len(owner.commit_clock_descriptors),4)
            for node,descriptor in zip(result['nodes'],owner.commit_clock_descriptors):
                self.assertEqual(node['args'].count('--commit-monotonic-output'),1)
                self.assertEqual(node['args'][node['args'].index('--commit-monotonic-output')+1],descriptor['path'])
            self.assertEqual(len({row['path'] for row in owner.commit_clock_descriptors}),4)

    def test_actual_original_node_start_requests_unpublished_pidfd_only_when_opted_in(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();rows=[]
            for index in range(4):
                path=root/('credential-%d'%index);path.write_bytes(b'x'*32);path.chmod(0o600)
                rows.append(dict(index=index,recoveryCredentialFile=str(path)))
            activation=dict(nodes=[dict(index=i,recoveryFD=3,recoveryCredentialFile=row['recoveryCredentialFile'],args=[]) for i,row in enumerate(rows)])
            for enabled in (False,True):
                calls=[];owner=driver.normal.Ceremony.__new__(driver.normal.Ceremony)
                owner.w=SimpleNamespace(stopping=False,launch=lambda *a,**kw:calls.append((a,kw)) or object())
                owner.plan=dict(nodes=rows);owner.bins=root;owner.nodes=[];owner.observe_wire=False
                owner.commit_clock_observation_enabled=enabled
                owner.start(activation)
                self.assertEqual(len(calls),4)
                self.assertEqual([kw.get('original_pidfd_node',False) for _,kw in calls],[enabled]*4)


if __name__=='__main__':unittest.main(verbosity=2)
