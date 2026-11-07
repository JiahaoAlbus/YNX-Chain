import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


spec=importlib.util.spec_from_file_location('public_owner_readback',Path(__file__).with_name('pq-public-owner-readback.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RAW=(Path(__file__).with_name('fixtures')/'public-owner-original-go.jsonl').read_bytes()
PIN='57411342e3eaae744cbb3a351a9174b66b6a88d0670e309f0e89ed09e6a88020'


def read(rows):
    raw=b''.join(json.dumps(v,separators=(',',':')).encode()+b'\n' for v in rows)
    return m.readback(raw,hashlib.sha256(raw).hexdigest())


class OriginalReadback(unittest.TestCase):
    def test_actual_go_cold_reuse_and_durable_samples_do_not_become_finality(self):
        result=m.readback(RAW,PIN)
        self.assertEqual(result['returnedReplies'],6)
        self.assertEqual(result['outcomes'],dict(ORIGINAL_SAVED=2,UNKNOWN=1,OWNER_RETIRED=1,ORIGINAL_RECOVERED=1,REJECTED=1))
        first,second=result['records'][0],result['records'][3]
        self.assertEqual((first['ownerIndex'],second['ownerIndex']),(0,1))
        self.assertEqual(first['operationId'],second['operationId'])
        self.assertEqual(first['calleeElapsedNs'],839662500)
        self.assertEqual(second['calleeElapsedNs'],493815583)
        self.assertEqual(first['stages']['lab.bootstrapFullValidation']['calls'],1)
        self.assertNotIn('lab.bootstrapFullValidation',second['stages'])
        self.assertEqual(first['stages']['sender.exclusivePersistenceTotal']['elapsedNs'],720545668)
        self.assertEqual(second['stages']['sender.exclusivePersistenceTotal']['elapsedNs'],395182751)
        self.assertEqual(first['persistenceRoles'],{})
        self.assertIsNone(result['businessQualified'])
        self.assertIsNone(result['finalConfirmationTPS'])
        self.assertEqual(set(result['finalConfirmationPercentilesMs'].values()),{None})

    def test_metadata_missing_stays_unknown_and_new_roles_remain_separate(self):
        rows=[json.loads(v) for v in RAW.splitlines()]
        del rows[1]['timings'];del rows[1]['calleeElapsedNs']
        rows[4]['timings']['stages']['sender.persistence.intent.fileFsync']=dict(calls=1,elapsedNs=120)
        result=read(rows)
        self.assertIsNone(result['records'][0]['stages'])
        self.assertIsNone(result['records'][0]['persistenceRoles'])
        self.assertEqual(result['records'][3]['persistenceRoles'],{'sender.persistence.intent.fileFsync':dict(calls=1,elapsedNs=120)})
        self.assertFalse(result['observationsSummed'])

    def test_owner_scope_authority_and_partial_output_fail_closed(self):
        for change in ('owner','authority','missing-result','ready-warmed','bad-owner-type'):
            rows=[json.loads(v) for v in RAW.splitlines()]
            if change=='owner':rows[1]['ownerIndex']=2
            if change=='authority':rows[1]['result']['authorityGranted']=True
            if change=='missing-result':rows[1]['result']=None
            if change=='ready-warmed':rows[0]['bootstrapLoaded']=True
            if change=='bad-owner-type':rows[1]['ownerIndex']=True
            with self.subTest(change=change),self.assertRaises(RuntimeError):read(rows)
        with self.assertRaises(RuntimeError):m.readback(RAW[:-1],hashlib.sha256(RAW[:-1]).hexdigest())
        with self.assertRaises(RuntimeError):m.readback(RAW,'0'*64)
        raw=RAW.replace(b'"ownerIndex":0',b'"ownerIndex":0,"ownerIndex":1',1)
        with self.assertRaises(RuntimeError):m.readback(raw,hashlib.sha256(raw).hexdigest())


if __name__=='__main__':unittest.main()
