"""Pure metadata negatives and original callee collector integration; no nodes."""
import importlib.util
import hashlib
import json
from pathlib import Path
import unittest


def module(name, file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


m=module('held_input_controls','pq-held-input-footprint.py')
d=module('held_input_collector','pq-independent-load.py')


def footprint(large=False):
    return dict(scope=m.SCOPE,state='INVOCATION_HELD' if large else 'CACHE_ENTRY',
                staticOriginalFiles=12,staticOriginalBytes=(33<<20) if large else 1000,
                activationOriginalFiles=0,activationOriginalBytes=0,cacheRetained=not large,
                cacheAdmissionReason='BYTE_BOUND' if large else 'WITHIN_BOUNDS',
                cacheMaxBytes=32<<20,cacheMaxFiles=16,snapshotOnly=True)


def cache(large=False):
    return dict(scope='YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1',entries=0 if large else 1,
                heldFiles=0 if large else 12,originalBytes=0 if large else 1000,
                hits=0,misses=1,bypasses=int(large),closed=False)


def reply(large=False):
    return dict(code='UNKNOWN',calleeElapsedNs=100,
                timings=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',clock='monotonic_elapsed_wall_ns',
                             intervalsOverlap=True,stages={}),sourceInputs=footprint(large),staticCache=cache(large))


class FootprintControls(unittest.TestCase):
    def test_actual_go_api_original_vectors_read_without_runtime_qualification(self):
        raw=(Path(__file__).with_name('fixtures')/'held-source-inputs-original-go.jsonl').read_bytes()
        self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(950,'72b442d45b2a07a79709c4c2f5173cee401b6338889d1435e6f2c60c34f82d48'))
        original=[json.loads(line) for line in raw.splitlines()]
        observed=[m.inspect(r['sourceInputs'],r['staticCache']) for r in original]
        self.assertEqual([(r['staticOriginalFiles'],r['staticOriginalBytes']) for r in observed],[(12,1833111),(12,36436119)])
        self.assertEqual([r['cacheAdmissionReason'] for r in observed],['WITHIN_BOUNDS','BYTE_BOUND'])
        self.assertTrue(all(r['snapshotOnly'] for r in observed))
    def test_uncached_held_bytes_are_distinct_from_zero_cache_bytes(self):
        value=m.inspect(footprint(True),cache(True))
        self.assertEqual(value['staticOriginalBytes'],33<<20)
        self.assertFalse(value['cacheRetained'])
    def test_closed_or_unloaded_never_claims_a_loaded_footprint(self):
        for state in ('CLOSED','NOT_LOADED'):
            v=footprint();v.update(state=state,staticOriginalFiles=0,staticOriginalBytes=0,
                                  cacheRetained=False,cacheAdmissionReason='NOT_EVALUATED')
            m.inspect(v)
            v['staticOriginalBytes']=1
            with self.assertRaises(RuntimeError):m.inspect(v)
    def test_budget_reason_and_snapshot_authority_cannot_change(self):
        for key,value in [('cacheMaxBytes',64<<20),('cacheMaxFiles',32),('snapshotOnly',False),
                          ('cacheAdmissionReason','WITHIN_BOUNDS'),('cacheRetained',True),
                          ('state','VERIFIED'),('authorityGranted',True)]:
            v=footprint(True);v[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.inspect(v)
    def test_missing_counts_floats_booleans_and_overflow_are_not_observations(self):
        for key,value in [('staticOriginalBytes',None),('staticOriginalBytes',1.0),
                          ('staticOriginalFiles',True),('staticOriginalFiles',17),
                          ('staticOriginalBytes',1<<63),('activationOriginalFiles',5)]:
            v=footprint();v[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.inspect(v)
    def test_cache_disagreement_cannot_turn_held_inputs_into_a_cache_hit(self):
        with self.assertRaises(RuntimeError):m.inspect(footprint(True),cache(False))
        with self.assertRaises(RuntimeError):m.inspect(footprint(False),cache(True))
    def test_observation_is_detached_from_caller_mutation(self):
        value=footprint();saved=m.inspect(value);value['staticOriginalBytes']=2000
        self.assertEqual(saved['staticOriginalBytes'],1000)


class CollectorControls(unittest.TestCase):
    def test_missing_optional_field_preserves_old_report_shape(self):
        c=d.CalleeMeasurements(500,500);v=reply();del v['sourceInputs']
        c.record('sign','operation',v,owner=4)
        self.assertNotIn('lastHeldInputFootprintByOwner',c.report()['groups']['sign'])
    def test_latest_per_owner_snapshots_are_not_summed_as_io_or_business(self):
        c=d.CalleeMeasurements(500,500)
        c.record('sign','first',reply(True),owner=4)
        v=reply(True);c.record('sign','second',v,owner=4)
        v['sourceInputs']['staticOriginalBytes']=0
        g=c.report()['groups']['sign']
        self.assertEqual(g['lastHeldInputFootprintByOwner']['4']['staticOriginalBytes'],33<<20)
        self.assertEqual(len(g['lastHeldInputFootprintByOwner']),1)
        self.assertIsNone(g['calleeElapsed']['fullDemandPercentilesMs']['p95'])
        self.assertNotIn('qualified',c.report())
    def test_bad_metadata_keeps_completed_reply_and_missing_timing_failure(self):
        c=d.CalleeMeasurements(500,500);v=reply();v['sourceInputs']['snapshotOnly']=False
        with self.assertRaises(RuntimeError):c.record('sign','original-reply',v,owner=4)
        g=c.report()['groups']['sign']
        self.assertEqual(g['replyTimingCoverage']['completedReplyObservations'],1)
        self.assertEqual(g['replyTimingCoverage']['timingRecordFailures'],1)
        self.assertEqual(g['calleeElapsed']['observed'],0)
    def test_unknown_or_boolean_owner_cannot_become_a_source_namespace(self):
        for owner in (None,True,'4',1000):
            with self.subTest(owner=owner),self.assertRaises(RuntimeError):
                d.CalleeMeasurements(500,500).record('sign','op',reply(),owner=owner)


if __name__=='__main__':unittest.main()
