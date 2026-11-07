"""Height visibility binding controls, not signed transaction execution."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


spec=importlib.util.spec_from_file_location('successor_controls',Path(__file__).with_name('pq-successor-availability-readback.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def fixture():
    tx=b'original RPC fixture bytes';digest=hashlib.sha256(tx).hexdigest()
    row=dict(index=0,id='logical',operationId='operation',ownerIndex=4,nonce=2,hash=digest,
             submittedNs=5,includedNs=8,terminalNs=20,finalNs=None,status='unknown',
             stageTimes=[['successor_availability',9],['live_publish',15]])
    receipt=dict(loadResult=dict(configuredDemand=1,originMonotonicNs='100',qualified=0,rows=[row]))
    base='load-operations/00000/'
    values={base+'submission-intent.json':dict(id='logical',operationId='operation',owner=4,nonce='2',
               transactionHash=digest,submissionAttempts=1,qualifiedFinal=False),
            base+'four-node-inclusion.json':dict(qualifiedFinal=False,rows=[dict(height='9',hash=digest.upper(),tx_result=dict(code=0),tx=base64.b64encode(tx).decode()) for _ in range(4)]),
            base+'successor-availability.json':dict(transactionHeight=9,minimumSuccessorHeight=10,
               observations=[dict(node=n,engineHeight=10,applicationHeight=10) for n in range(4)],
               observedMonotonicNs=112,qualifiedFinal=False)}
    return receipt,values


def inspect(receipt,values):
    return m.inspect({k:json.dumps(v).encode() for k,v in values.items()},'',receipt)


class SuccessorControls(unittest.TestCase):
    def test_height_visibility_and_proof_queue_are_separate_from_finality(self):
        receipt,values=fixture();result=inspect(receipt,values);row=result['records'][0]
        self.assertEqual((row['submitToHeightVisibleNs'],row['inclusionToHeightVisibleNs'],row['heightVisibleToLivePublishNs']),(7,4,3))
        self.assertEqual(row['originalTerminalStatus'],'unknown')
        self.assertIsNone(row['originalFinalNs']);self.assertIsNone(result['finalityPercentilesMs'])
        self.assertFalse(result['independentFinality']);self.assertEqual(result['originalQualified'],0)

    def test_missing_availability_is_unobserved_not_zero_latency(self):
        receipt,values=fixture();del values['load-operations/00000/successor-availability.json']
        result=inspect(receipt,values)
        self.assertEqual((result['observed'],result['notObserved']),(0,1));self.assertEqual(result['records'],[])

    def test_wrong_hash_owner_height_clock_and_finality_claim_are_rejected(self):
        for mutation in ('hash','bytes','owner','node','height','clock','finality','origin','early-proof'):
            receipt,values=fixture();base='load-operations/00000/'
            if mutation=='hash':values[base+'four-node-inclusion.json']['rows'][0]['hash']='0'*64
            if mutation=='bytes':values[base+'four-node-inclusion.json']['rows'][0]['tx']=base64.b64encode(b'other').decode()
            if mutation=='owner':values[base+'submission-intent.json']['owner']=5
            if mutation=='node':values[base+'successor-availability.json']['observations'][0]['node']=1
            if mutation=='height':values[base+'successor-availability.json']['observations'][0]['applicationHeight']=9
            if mutation=='clock':values[base+'successor-availability.json']['observedMonotonicNs']=107
            if mutation=='finality':values[base+'successor-availability.json']['qualifiedFinal']=True
            if mutation=='origin':receipt['loadResult']['originMonotonicNs']='0100'
            if mutation=='early-proof':receipt['loadResult']['rows'][0]['stageTimes'][-1][1]=11
            with self.subTest(mutation=mutation),self.assertRaises(RuntimeError):inspect(receipt,values)


if __name__=='__main__':unittest.main()
