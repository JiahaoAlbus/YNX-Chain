"""Exact source-only diagnostic controls; no load or finality qualification."""
import importlib.util
from pathlib import Path
import sys
import unittest

CASES = {
    'test_pq_independent_load.py': [
        'IndependentLoadControls.test_cutoff_drain_fences_launch_and_selects_only_original_started_verifiers',
        'IndependentLoadControls.test_cutoff_drain_resource_failure_preserves_guard_and_stop',
        'IndependentLoadControls.test_verifier_deadline_rechecks_after_lock_and_before_popen',
        'IndependentLoadControls.test_verifier_popen_crossing_cutoff_is_stopped_and_retained',
        'IndependentLoadControls.test_diagnostic_mode_never_confirms_even_before_cutoff',
        'IndependentLoadControls.test_verifier_completion_after_stop_cannot_enter_confirm',
        'IndependentLoadControls.test_crossing_original_helper_is_registered_reaped_and_keeps_first_cause',
        'IndependentLoadControls.test_blocked_popen_crossing_actual_deadline_cannot_be_admitted',
        'IndependentLoadControls.test_real_linux_crossing_verifier_is_reaped_under_original_guard',
    ],
    'test_pq_staged_independent_scheduler.py': [
        'StagedIndependentSchedulerControls.test_explicit_post_cutoff_drain_keeps_original_window_censored',
        'StagedIndependentSchedulerControls.test_resource_failure_never_enters_post_cutoff_drain',
    ],
}

if __name__ == '__main__':
    if sys.platform != 'linux':
        raise SystemExit('original Linux subprocess and /proc controls required')
    suite = unittest.TestSuite()
    for index, (file, names) in enumerate(CASES.items()):
        spec = importlib.util.spec_from_file_location('cutoff_controls_%d' % index, Path(__file__).with_name(file))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in names:
            suite.addTests(unittest.defaultTestLoader.loadTestsFromName(name, module))
    if suite.countTestCases() != 11:
        raise SystemExit('all eleven cutoff controls must be selected')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun != 11 or result.skipped or not result.wasSuccessful():
        raise SystemExit('all eleven cutoff controls must execute without skips')
