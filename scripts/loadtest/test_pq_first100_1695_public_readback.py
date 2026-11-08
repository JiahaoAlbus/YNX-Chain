"""Public-owner original receipt controls; synthetic fixtures are not a run."""
import importlib.util
import hashlib
import json
from pathlib import Path
import unittest


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('public1695_reader','pq-first100-1695-public-readback.py')
cold=module('public1695_cold_controls','test_pq_first100_1695_cold_readback.py')
observation=module('public1695_future_observation','pq-live-request-observation-readback.py')


def records():
    adapter,receipt=cold.records()
    adapter.update(controllerCommit=m.CONTROLLER,profile='first100-1695-public-owner',senderBackend='public-owner')
    receipt['loadConditions']['senderBackend']='public-owner'
    receipt.update(loadExecuted=True,normalPublicOwnerTransport=dict(schema='YNX-PERF-PUBLIC-OWNER-TRANSPORT/v1',
        clock='parent_monotonic_ns',recordLimit=2048,automaticRetry=False,authorityGranted=False,
        attempted=0,retained=0,omitted=0,records=[]))
    return adapter,receipt


class Public1695Controls(unittest.TestCase):
    def observation_line(self, sequence, event, stage='REQUEST', span=1, elapsed=0, reason='', **extra):
        return json.dumps(dict(version=observation.VERSION,sequence=sequence,event=event,stage=stage,
                               span=span,elapsedNs=elapsed,reason=reason,authorityGranted=False,**extra)).encode()+b'\n'

    def split(self, raw):
        return observation.split_original(raw,hashlib.sha256(raw).hexdigest())

    def test_mixed_stdout_stderr_only_removes_validated_observations(self):
        payload=b'{\n "version": "original-result/v1",\n "value": 1\n}\n'
        raw=self.observation_line(1,'BEGIN')+self.observation_line(2,'BEGIN','STATIC_LOAD',2)+self.observation_line(3,'END','STATIC_LOAD',2,100)+self.observation_line(4,'END',elapsed=200)+payload
        result,other=self.split(raw)
        self.assertEqual(other,payload);self.assertEqual(json.loads(other)['value'],1)
        self.assertEqual(result['completedSpans'][0]['elapsedNs'],100)
        self.assertEqual(result['status'],'INTERVALS_RETURNED')
        self.assertFalse(result['businessQualified']);self.assertFalse(result['ordinaryOutputAssumedSafe'])
        legacy=b'original terminal error /private/marker '+observation.VERSION.encode()+b'\n'
        result,other=self.split(raw+legacy)
        self.assertEqual(other,payload+legacy)
        self.assertNotIn('/private/marker',json.dumps(result))

    def test_cancel_partial_and_empty_logs_never_create_end_or_signal_exit(self):
        raw=self.observation_line(1,'BEGIN')+self.observation_line(2,'BEGIN','BOOTSTRAP_VALIDATE',2)+self.observation_line(3,'CANCEL',elapsed=100,reason='SIGTERM')
        result,other=self.split(raw)
        self.assertTrue(result['canceledSignalObserved']);self.assertFalse(result['cleanupCompleteInferred'])
        self.assertFalse(result['signalExitStatusInferred']);self.assertEqual(result['completedSpans'],[])
        self.assertTrue(all(row['elapsedNs'] is None for row in result['unresolvedSpans']))
        partial=b'{"version":"'+observation.VERSION.encode()+b'","sequence":4'
        result,other=self.split(raw+partial)
        self.assertEqual(other,partial);self.assertEqual(len(result['partialRecordPrefixes']),1)
        no_newline=self.observation_line(4,'END',elapsed=200).rstrip(b'\n')
        result,other=self.split(raw+no_newline)
        self.assertEqual(other,no_newline);self.assertEqual(result['completedSpans'],[])
        result,other=self.split(b'')
        self.assertEqual(result['status'],'NOT_OBSERVED');self.assertFalse(result['canceledSignalObserved'])

    def test_closed_observation_vocabulary_and_matching_spans_are_required(self):
        start=self.observation_line(1,'BEGIN')
        for line in [self.observation_line(3,'END',elapsed=1),self.observation_line(2,'END','STATIC_LOAD',2,1),
                     self.observation_line(2,'CANCEL',reason='SIGKILL'),self.observation_line(2,'BEGIN','private-path',2),
                     self.observation_line(2,'BEGIN','STATIC_LOAD',2,path='/private'),
                     self.observation_line(2,'END',elapsed=True)]:
            with self.assertRaises(RuntimeError):self.split(start+line)
        duplicate=start.replace(b'"sequence": 1',b'"sequence": 1,"sequence": 1')
        with self.assertRaises(RuntimeError):self.split(duplicate)
        with self.assertRaises(RuntimeError):observation.split_original(start,'0'*64)

    def test_observation_truncation_does_not_close_active_spans(self):
        raw=self.observation_line(1,'BEGIN')
        for i in range(31):
            raw+=self.observation_line(2+i*2,'BEGIN','STATIC_CURRENT',2+i)
            raw+=self.observation_line(3+i*2,'END','STATIC_CURRENT',2+i,10)
        raw+=self.observation_line(64,'TRUNCATED','OBSERVATION',0,100,'RECORD_BOUND')
        result,other=self.split(raw)
        self.assertTrue(result['truncated']);self.assertEqual(result['unresolvedSpans'],[dict(span=1,stage='REQUEST',elapsedNs=None)])
        with self.assertRaises(RuntimeError):self.split(raw+self.observation_line(65,'END',elapsed=200))

    def test_optional_safe_failure_never_grants_source_or_replay(self):
        value=dict(version='YNX-PQ-LAB-PUBLIC-OWNER-FAILURE/v1',errorClass='CHECKPOINT_REJECTED',
                   failurePhase='SIGN',firstCausePresent=True)
        reply=dict(code='REJECTED',result=None,failure=value)
        out=m.failure_module.readback(reply,'sign')
        self.assertEqual(out['diagnostic'],value)
        self.assertFalse(out['retryAllowed']);self.assertFalse(out['authorityGranted'])
        self.assertFalse(out['upstreamFirstCauseReconstructed'])
        for changed in [dict(value,rawError='/private/secret'),dict(value,errorClass='arbitrary text'),
                        dict(value,failurePhase='CONFIRM'),dict(value,firstCausePresent=False),
                        dict(value,version='future/v2'),dict(value,errorClass='ORIGINAL_UNKNOWN')]:
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):
                m.failure_module.readback(dict(reply,failure=changed),'sign')
        for changed in [dict(reply,code='ORIGINAL_SAVED'),dict(reply,result={}),dict(reply,failure=None)]:
            with self.assertRaises(RuntimeError):m.failure_module.readback(changed,'sign')
        value['errorClass']='ORIGINAL_UNKNOWN'
        self.assertEqual(m.failure_module.readback(dict(reply,code='UNKNOWN'),'sign')['diagnostic'],value)
        self.assertEqual(m.SOURCE,'1695aafd351b3cac7860d3452c555a02498e8350')

    def test_original_replies_preserve_cache_bypass_and_missing_reasons(self):
        row=dict(index=0,ownerIndex=4,operationId='a'*64)
        load=dict(configuredDemand=500,rows=[row,dict(index=1,ownerIndex=5,operationId='b'*64)])
        reply=dict(version='YNX-PQ-LAB-PUBLIC-OWNER-REPLY/v1',ownerIndex=4,operationId='a'*64,
                   code='REJECTED',result=None,staticCache=dict(entries=0,hits=0,bypasses=1),
                   sourceInputs=dict(staticOriginalBytes=70418160,cacheMaxBytes=33554432,
                                     cacheRetained=False,cacheAdmissionReason='BYTE_BOUND'))
        path='public/load-operations/00000/original-sign-reply.json'
        files={path:json.dumps(reply).encode()}
        result=m.original_sign_replies(files,'public/',load)
        self.assertEqual(result['replyCounts'],{'REJECTED':1})
        self.assertEqual(result['missingReplyRows'],1)
        self.assertFalse(result['missingReplyIsRejection'])
        self.assertEqual(result['records'][0]['errorReasonStatus'],'NOT_EMITTED_BY_FROZEN_CLI')
        self.assertEqual(result['records'][0]['sourceInputs']['cacheAdmissionReason'],'BYTE_BOUND')
        self.assertFalse(result['cacheBenefitQualified'])
        reply['operationId']='b'*64;files[path]=json.dumps(reply).encode()
        with self.assertRaises(RuntimeError):m.original_sign_replies(files,'public/',load)

    def test_exact_public_identity_and_report_projection_are_labelled(self):
        adapter,receipt=records();m.identities(adapter,receipt)
        result=m.public_transport(receipt)
        self.assertEqual(result['inputRepresentation'],'RESERIALIZED_ORIGINAL_RECEIPT_SUBOBJECT')
        self.assertEqual(len(result['receiptProjectionSHA256']),64)
        self.assertNotIn('originalSHA256',result)
        self.assertFalse(result['rawParentReportFileSupplied'])
        self.assertIsNone(result['finalConfirmationTPS'])

    def test_cold_identity_cannot_be_relabelled_as_public(self):
        adapter,receipt=cold.records()
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();receipt['loadConditions']['senderBackend']='bounded-cold'
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();adapter['profile']='first100-1695-bounded-cold'
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        adapter,receipt=records();adapter['controllerCommit']='e366c7c0f9cb42c1d2a7ce3568449c2755eab1c4'
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)

    def test_released_window_without_parent_report_is_rejected(self):
        adapter,receipt=records();del receipt['normalPublicOwnerTransport']
        with self.assertRaises(RuntimeError):m.identities(adapter,receipt)
        receipt['loadExecuted']=False;m.identities(adapter,receipt)
        self.assertIsNone(m.public_transport(receipt))

    def test_parent_counts_scope_and_clock_gaps_cannot_be_promoted(self):
        for key,value in [('attempted',1),('authorityGranted',True),('automaticRetry',True),('clock','wall_clock')]:
            adapter,receipt=records();receipt['normalPublicOwnerTransport'][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.identities(adapter,receipt)

    def test_lost_reply_preserves_unknown_and_censors_reply_latency(self):
        _,receipt=records();report=receipt['normalPublicOwnerTransport']
        report.update(attempted=1,retained=1,records=[dict(ownerIndex=4,operationId='a'*64,operation='sign',
            requestedMonotonicNs=100,streamAcquiredMonotonicNs=120,commandRequestedMonotonicNs=150,
            returnedMonotonicNs=250,errorType='EOFError')])
        result=m.public_transport(receipt)
        self.assertTrue(result['records'][0]['outcomeUnknown'])
        self.assertIsNone(result['groups']['sign']['stages']['commandToReply']['fullAttemptP95Ns'])
        self.assertIsNone(result['finalConfirmationTPS'])

    def test_own_source_semantic_and_ci_are_still_required(self):
        for kind in ('source','ci','semantic'):
            adapter,receipt=records()
            if kind=='source':receipt['sameWindowInitializationSourceFunctionalData']['requiredNamedCases']=129
            if kind=='ci':adapter['toolsCI']['head']='0'*40
            if kind=='semantic':adapter['sourceAndSemanticHandoff']['pressureAuthorized']=True
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):m.identities(adapter,receipt)


if __name__=='__main__':unittest.main(verbosity=2)
