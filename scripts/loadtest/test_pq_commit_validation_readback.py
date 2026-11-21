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


if __name__=='__main__':unittest.main(verbosity=2)
