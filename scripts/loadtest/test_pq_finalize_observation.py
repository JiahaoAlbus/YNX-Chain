"""Finalize projection readback and original Commit binding controls."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('finalize_observation', Path(__file__).with_name('pq-finalize-observation.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class FinalizeObservation(unittest.TestCase):
    def test_four_node_checkpoints_keep_partial_height_and_reject_divergence(self):
        original = {str(node): dict(committed=dict(samples={18: dict(appHash='a'*64)}))
                    for node in range(4)}
        original['0']['committed']['samples'][19] = dict(appHash='b'*64)
        report = reader.four_node_checkpoints(original)
        self.assertEqual(report['common'], [dict(height=18, appHash='a'*64)])
        self.assertEqual(report['partial'], [dict(height=19, observedNodes=['0'])])
        original['1']['committed']['samples'][18]['appHash'] = 'c'*64
        with self.assertRaisesRegex(RuntimeError, 'AppHashes differ at height 18'):
            reader.four_node_checkpoints(original)

    def test_stage_partition_and_original_commit_height(self):
        success = dict(attempt=1, requestPresent=True, height=19, success=True, appHash='a'*64,
                       failedPhase='', elapsedNs=60, phaseNs=dict.fromkeys(reader.PHASES, 10),
                       childrenNs={'seal.fee_materialize': 3}, counts={'requested_transactions': 1})
        failed = dict(attempt=2, requestPresent=False, height=0, success=False, appHash='',
                      failedPhase='preflight', elapsedNs=4, phaseNs={'preflight': 4}, childrenNs={}, counts={})
        projection = dict(version=reader.VERSION, scope='synthetic-loopback-lab/v1',
                          captureBoundary=reader.BOUNDARY, processID=123, chainID='test', originalGenesisHash='b'*64,
                          lockWaitIncluded=False, independentFinality=False, unreportedStagesAreUnknown=True,
                          childrenOverlapParentPhases=True, maxSamples=128, captureComplete=True,
                          observation=dict(attempts=2, dropped=0, samples=[success, failed], latest=copy.deepcopy(failed)))
        identity = dict(pid=123, chain_id='test', genesis_hash='b'*64)
        observed = reader.validate(projection, **identity)
        matched = reader.business_heights(observed, {19, 20}, [dict(height=19, appHash='a'*64)])
        self.assertEqual(matched['samples'][19]['childrenNs'], {'seal.fee_materialize': 3})
        self.assertEqual(matched['missingHeights'], [20])
        self.assertEqual(matched['failedAttempts'], [failed])
        with self.assertRaisesRegex(RuntimeError, 'AppHash'):
            reader.business_heights(observed, {19}, [dict(height=19, appHash='c'*64)])
        success['elapsedNs'] = 63
        with self.assertRaisesRegex(RuntimeError, 'partition'):
            reader.validate(projection, **identity)
        success['elapsedNs'] = 60
        for row in (failed, projection['observation']['latest']):
            row['appHash'] = 'a'*64
        with self.assertRaisesRegex(RuntimeError, 'inherit'):
            reader.validate(projection, **identity)


if __name__ == '__main__':
    unittest.main()
