#!/usr/bin/env python3
"""New historical-result reuse gate controls; all fixtures are UNIT DATA."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('established_source_controls', Path(__file__).with_name('root-source-established.py'))
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
base = gate.base_module()


def fixture():
    names = ['actual-go-version', 'prepare-original-source', 'verify-original-eight-public',
             'original-source-entry', 'verify-actual-source-public', 'original-full-state-compare']
    record = dict(scope='b8', runId=str(gate.RUN), workflowCommit=gate.WORKFLOW, sourceCommit=base.B,
                  toolsCommit=base.B8_TOOLS, comparisonComplete=True, cleanupComplete=True, firstCause=None,
                  processes=[dict(name=n, exited=True, exitCode=0, rawReturnCode=0, signal=None) for n in names],
                  configuration=dict(performanceComparisonQualified=False, reason='original-before-hardware-NOT_SUPPLIED'))
    result = dict(inputSha256=base.B8_INPUT, receipt=dict(sourceCommit=base.B, inputSha256=base.B8_INPUT,
                  sourceMatrixComplete=True, cleanupComplete=True, testExitCode=0, firstCause=None,
                  completedCases=base.cases('original')))
    files = {name: b'UNIT CONTROL DATA ONLY\n' for name in gate.CATALOG}
    files['SOURCE-COMPARE-CONTROLLER.json'] = json.dumps(record).encode()
    files['verify-actual-source-public.log'] = json.dumps(result).encode()
    return files, record, result


class EstablishedResultControls(unittest.TestCase):
    def test_complete_original_result_reused_without_speedup_or_chain_upgrade(self):
        files, _, _ = fixture()
        result = gate.verified_b8(base, files)
        self.assertEqual(result['fullAfterArtifact']['artifactId'], 13049084193)
        self.assertEqual(result['inputSha256'], base.B8_INPUT)
        self.assertFalse(result['configuration']['performanceComparisonQualified'])
        self.assertEqual(result['chainMetrics'], 'UNMEASURED')

    def test_partial_failed_or_wrong_run_controller_cannot_be_reused(self):
        for change in [dict(comparisonComplete=False), dict(cleanupComplete=False), dict(firstCause='failure'),
                       dict(sourceCommit=base.FDC), dict(toolsCommit=base.MULTI_TOOLS), dict(runId='41219087378')]:
            with self.subTest(change=change):
                files, record, _ = fixture(); record.update(change)
                files['SOURCE-COMPARE-CONTROLLER.json'] = json.dumps(record).encode()
                with self.assertRaises(base.Refused): gate.verified_b8(base, files)

    def test_original_full_compare_nonzero_exit_blocks_reuse(self):
        files, record, _ = fixture(); record['processes'][-1]['exitCode'] = 1
        files['SOURCE-COMPARE-CONTROLLER.json'] = json.dumps(record).encode()
        with self.assertRaises(base.Refused): gate.verified_b8(base, files)

    def test_wrong_input_or_missing_original_case_blocks_reuse(self):
        for field, value in [('inputSha256', '0' * 64), ('completedCases', base.cases('original')[:-1])]:
            files, _, result = fixture(); result['receipt'][field] = value
            files['verify-actual-source-public.log'] = json.dumps(result).encode()
            with self.assertRaises(base.Refused): gate.verified_b8(base, files)

    def test_unlisted_or_missing_controller_member_blocks_reuse(self):
        files, _, _ = fixture(); files['unlisted.data'] = b'UNIT'
        with self.assertRaises(base.Refused): gate.verified_b8(base, files)
        del files['unlisted.data']; del files['original-full-state-compare.log']
        with self.assertRaises(base.Refused): gate.verified_b8(base, files)

    def test_local_or_nonhosted_cleanup_is_rejected_before_mutation(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(gate.shutil, 'rmtree') as remove:
            with self.assertRaisesRegex(RuntimeError, 'only the disposable'):
                gate.freshen(Path('/MUST-NOT-BE-CREATED'))
        remove.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
