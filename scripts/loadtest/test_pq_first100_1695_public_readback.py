"""Public-owner original receipt controls; synthetic fixtures are not a run."""
import importlib.util
from pathlib import Path
import unittest


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('public1695_reader','pq-first100-1695-public-readback.py')
cold=module('public1695_cold_controls','test_pq_first100_1695_cold_readback.py')


def records():
    adapter,receipt=cold.records()
    adapter.update(controllerCommit=m.CONTROLLER,profile='first100-1695-public-owner',senderBackend='public-owner')
    receipt['loadConditions']['senderBackend']='public-owner'
    receipt.update(loadExecuted=True,normalPublicOwnerTransport=dict(schema='YNX-PERF-PUBLIC-OWNER-TRANSPORT/v1',
        clock='parent_monotonic_ns',recordLimit=2048,automaticRetry=False,authorityGranted=False,
        attempted=0,retained=0,omitted=0,records=[]))
    return adapter,receipt


class Public1695Controls(unittest.TestCase):
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
