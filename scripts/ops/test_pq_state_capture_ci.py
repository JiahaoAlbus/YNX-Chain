"""Fail-closed controls for the integration state-capture workflow."""
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/verify/pq-state-capture-check.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def require_workflow(raw):
    for path in ('scripts/verify/pq-state-capture-check.py', 'scripts/ops/test_pq_state_capture_ci.py'):
        if raw.count('      - "' + path + '"\n') != 2:
            raise AssertionError('push and PR must both select the original input')
    jobs = re.findall(r'(?ms)^  integration-state-capture:\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)', raw)
    if len(jobs) != 1:
        raise AssertionError('one integration capture job is required')
    job = jobs[0]
    for part in (
        "(github.event_name == 'push' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration')",
        "(github.event_name == 'pull_request' && github.base_ref == 'codex/ynx-pq-perf-integration')",
        '    runs-on: ubuntu-24.04\n', '    timeout-minutes: 8\n',
        '          ref: ${{ github.sha }}\n', '          persist-credentials: false\n',
        '          go-version-file: go.mod\n',
        '        run: python3 -B -m unittest scripts.ops.test_pq_state_capture_ci -v\n',
        '        run: python3 -B scripts/verify/pq-state-capture-check.py\n',
    ):
        if job.count(part) != 1:
            raise AssertionError('integration capture source, selector, or command changed')
    if job.count('    if:') != 1 or 'continue-on-error:' in job:
        raise AssertionError('integration capture controls may not be skipped or softened')


class CaptureWorkflowControls(unittest.TestCase):
    def test_workflow_pins_and_fails_closed(self):
        raw = (ROOT / '.github/workflows/chain-core.yml').read_text()
        require_workflow(raw)
        for needle in (
            '      - "scripts/verify/pq-state-capture-check.py"\n',
            '      - "scripts/ops/test_pq_state_capture_ci.py"\n',
            "github.ref == 'refs/heads/codex/ynx-pq-perf-integration'",
            '          ref: ${{ github.sha }}\n',
            '        run: python3 -B scripts/verify/pq-state-capture-check.py\n',
        ):
            with self.subTest(needle=needle), self.assertRaises(AssertionError):
                require_workflow(raw.replace(needle, 'altered\n', 1))
        with self.assertRaises(AssertionError):
            require_workflow(raw.replace('  integration-state-capture:\n', '  integration-state-capture:\n    continue-on-error: true\n', 1))

    def test_original_json_events_reject_skip_failure_wrong_package_and_missing_case(self):
        package = 'internal/consensus'
        identity = 'github.com/JiahaoAlbus/YNX-Chain/' + package
        names = ['A', 'B']
        events = ([{'Action': 'start', 'Package': identity}] +
                  [{'Action': action, 'Package': identity, 'Test': name} for name in names for action in ('run', 'pass')] +
                  [{'Action': 'pass', 'Package': identity}])
        def encode(rows):
            return b''.join((json.dumps(row) + '\n').encode() for row in rows)
        self.assertEqual(capture.validate(encode(events), package, names)['testsRun'], 2)
        mutations = [events[:-2] + events[-1:], events + [events[1]],
                     events[:-1] + [{'Action': 'skip', 'Package': identity, 'Test': 'A'}] + events[-1:],
                     events[:-1] + [{'Action': 'fail', 'Package': identity, 'Test': 'A/sub'}] + events[-1:],
                     events + [{'Action': 'output', 'Package': 'foreign/package'}]]
        for index, changed in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                capture.validate(encode(changed), package, names)


if __name__ == '__main__':
    unittest.main()
