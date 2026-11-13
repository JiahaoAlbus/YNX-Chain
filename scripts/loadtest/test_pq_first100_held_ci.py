"""Offline controls for the actual held first100 workflow and fixed plan."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('first100_held_ci', HERE / 'pq-first100-held-ci.py')
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class HeldControllerTests(unittest.TestCase):
    def test_workflow_uses_only_original_dispatch_and_fixed_inputs(self):
        raw = (HERE.parents[1] / entry.WORKFLOW).read_text()
        self.assertIn(entry.PROFILE + ']', raw.split('jobs:', 1)[0])
        self.assertIn("inputs.load_profile != '" + entry.PROFILE + "'", raw.split('    name: Normal original', 1)[0])
        job = raw.split('  ' + entry.PROFILE + ':\n', 1)[1]
        for text in ("github.event_name == 'workflow_dispatch'", 'github.run_attempt == 1',
                     "inputs.load_profile == '" + entry.PROFILE + "'", "inputs.signing_mode == 'online'",
                     "github.ref == '" + entry.REF + "'", 'needs: first100-held-controller-controls',
                     entry.SOURCE, entry.TOOLS, entry.SUPPLIER, entry.GO[2:], '--execute'):
            self.assertIn(text, job)
        self.assertEqual(raw.count('pq-first100-held-ci.py --execute'), 1)
        self.assertIn('pq-independent-load-*/public/', job)
        self.assertNotIn('/.private/', job)

    def test_plan_pin_binds_fixed_cohort_without_runtime_identity(self):
        plan = entry.plan()
        fixed = plan['configuration']
        options = fixed['options']
        self.assertEqual((fixed['nodeCount'], fixed['pressureLevel']), (4, 1))
        self.assertEqual((options['rate'], options['seconds'], options['accounts'],
                          options['tail_seconds'], options['proof_timeout']), (100, 5, 500, 30, 30))
        self.assertFalse(options['execute'])
        self.assertIsNone(plan['runtimePlanSHA256'])
        self.assertEqual(plan['configurationSHA256'], hashlib.sha256(
            json.dumps(fixed, sort_keys=True, separators=(',', ':')).encode()).hexdigest())

    def test_host_rejects_reruns_and_different_routes(self):
        env = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                   GITHUB_REPOSITORY=entry.REPOSITORY, GITHUB_EVENT_NAME='workflow_dispatch',
                   GITHUB_JOB=entry.PROFILE, GITHUB_REF=entry.REF, GITHUB_RUN_ATTEMPT='1',
                   GITHUB_WORKFLOW_REF=f'{entry.REPOSITORY}/{entry.WORKFLOW}@{entry.REF}',
                   GITHUB_SHA='a' * 40, GITHUB_WORKFLOW_SHA='a' * 40)
        entry.host(env, 'linux')
        for key, value in [('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_EVENT_NAME', 'push'),
                           ('GITHUB_REF', 'refs/heads/main'), ('GITHUB_WORKFLOW_SHA', 'b' * 40)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                entry.host(dict(env, **{key: value}), 'linux')


if __name__ == '__main__':
    unittest.main()
