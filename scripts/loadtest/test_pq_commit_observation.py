"""Declared ABI/transport controls, not real Go producer or Commit measurements."""
import copy
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

def declared(pid,height=19):
    # Only the delegated declared JSON ABI. This is NOT captured Go output.
    return dict(version=m.VERSION,processID=pid,chainID='ynx_642399-1',originalGenesisHash='b'*64,independentFinality=False,signerFsyncMeasured=False,allCommitAttemptsCovered=False,replayCoverageComplete=False,unreportedStagesAreUnknown=True,successNotifications=1,errorNotifications=0,droppedSuccessSamples=0,rejectedNotifications=0,lastFailure=None,unobservedLatest=None,heightGaps=[],samples=[dict(height=height,appHash='a'*64,persistence=dict(height=height,storage='atomic-json',durable=True,elapsedNs=12,payloadBytes=1,stagesNs={'encode':3,'sync':5}))])

class CommitObservationDeclaredControls(unittest.TestCase):
    def test_old703_and_unqualified_source_refused_before_source_check_or_start(self):
        args=SimpleNamespace(mode='online',rate=100,accounts=8,per_account=63,seconds=5,tail_seconds=30,proof_timeout=30,source='/NOT-READ',commit=driver.CALLEE_SOURCE,commit_observation=True)
        self.assertIsNone(driver.COMMIT_OBSERVATION_SOURCE)
        with mock.patch.object(driver.lab,'check_source') as checked:
            with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):driver.run(args)
            checked.assert_not_called()
    def test_fresh_private_args_only_no_node_or_listener(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();output=root/'pq-node-0.json';args=m.arguments(output,root)
            self.assertEqual(args,['--commit-observation-output',str(output),'--commit-observation-scope','synthetic-loopback-lab/v1']);self.assertFalse(output.exists())
            output.write_bytes(b'original')
            with self.assertRaisesRegex(RuntimeError,'fresh'):m.arguments(output,root)
    def test_fixed128_overflow_unknowns_and_original_stages_not_summed(self):
        snapshot=declared(123);sample=snapshot['samples'][0];snapshot['samples']=[dict(copy.deepcopy(sample),height=i,persistence=dict(copy.deepcopy(sample['persistence']),height=i)) for i in range(1,129)];snapshot.update(successNotifications=129,droppedSuccessSamples=1)
        self.assertEqual(len(m.validate_declared_contract(snapshot,123,'ynx_642399-1','b'*64)['samples']),128)
        self.assertFalse(snapshot['allCommitAttemptsCovered'] or snapshot['replayCoverageComplete'] or snapshot['independentFinality']);self.assertNotIn('missingStage',snapshot['samples'][0]['persistence']['stagesNs'])
        snapshot['samples'].append(dict(copy.deepcopy(sample),height=129))
        with self.assertRaisesRegex(RuntimeError,'128'):m.validate_declared_contract(snapshot,123,'ynx_642399-1','b'*64)
    def test_missing_counter_false_coverage_or_wrong_identity_never_defaults_zero(self):
        for change in ('missingCounter','boolCounter','whole','pid','chain','genesis','aliasPID','heightMismatch','boolNs'):
            value=declared(123)
            if change=='missingCounter':del value['errorNotifications']
            elif change=='boolCounter':value['successNotifications']=True
            elif change=='whole':value['allCommitAttemptsCovered']=True
            elif change=='pid':value['processID']=124
            elif change=='chain':value['chainID']='public'
            elif change=='genesis':value['originalGenesisHash']='c'*64
            elif change=='aliasPID':value['processId']=value.pop('processID')
            elif change=='heightMismatch':value['samples'][0]['persistence']['height']=18
            else:value['samples'][0]['persistence']['stagesNs']['encode']=True
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.validate_declared_contract(value,123,'ynx_642399-1','b'*64)
    def test_actual_stopped_child_identity_raw_bytes_retained_and_missing_node_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();private=root/'private';private.mkdir();children=[];descriptors=[];originals={}
            for i in range(4):
                proc=subprocess.Popen([sys.executable,'-I','-c','pass']);proc.wait(timeout=5);children.append(dict(name='pq-node-%d'%i,process=proc))
                path=private/('pq-node-%d.json'%i);descriptors.append(dict(node=i,path=str(path),processName='pq-node-%d'%i))
                if i!=3:
                    raw=json.dumps(declared(proc.pid),indent=3).encode();path.write_bytes(raw);path.chmod(0o600);originals[i]=raw
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64)
            self.assertEqual(report['validOriginalNodes'],3);self.assertFalse(report['fourOriginalSnapshotsValid']);self.assertEqual(len(report['errors']),1)
            for i,raw in originals.items():self.assertEqual((root/'public'/('commit-observation-node-%d-original.json'%i)).read_bytes(),raw)
            self.assertFalse(report['allCommitAttemptsCovered'] or report['independentFinality'] or report['signerFsyncMeasured'])
    def test_permission_or_live_producer_never_read_as_stopped_success(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'public').mkdir();path=root/'observed.json';path.write_text(json.dumps(declared(123)));path.chmod(0o644)
            descriptors=[dict(node=i,path=str(path),processName='pq-node-%d'%i) for i in range(4)];children=[dict(name='pq-node-%d'%i,process=SimpleNamespace(pid=123,poll=lambda:None)) for i in range(4)]
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64);self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(list((root/'public').iterdir()),[])
            for child in children:child['process'].poll=lambda:0
            report=m.retain_after_stop(SimpleNamespace(work=root,children=children),descriptors,'ynx_642399-1','b'*64);self.assertEqual(report['validOriginalNodes'],0);self.assertEqual(list((root/'public').iterdir()),[])

if __name__=='__main__':unittest.main()
