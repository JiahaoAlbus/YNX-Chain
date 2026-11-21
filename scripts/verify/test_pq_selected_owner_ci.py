"""Pure controls for exact source-only selected custody execution."""
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('selected', ROOT / 'scripts/verify/pq-selected-owner-check.py')
selected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selected)


class SelectedCustodyCIControls(unittest.TestCase):
    def test_exact_named_cases_and_original_workflow_hook(self):
        names = [name for group in selected.GROUPS.values() for name in group]
        self.assertEqual(len(names), 8)
        self.assertEqual(len(set(names)), 8)
        for package, cases in selected.GROUPS.items():
            source = '\n'.join(path.read_text() for path in (ROOT / package).glob('*test.go'))
            for name in cases:
                self.assertEqual(source.count('func ' + name + '('), 1)
        workflow = (ROOT / '.github/workflows/chain-core.yml').read_text()
        self.assertEqual(workflow.count('      - name: Verify exact selected owner custody and original recovery\n'), 2)
        for job in ('integration-state-capture', 'verify'):
            blocks = re.findall(r'(?ms)^  ' + job + r':\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)', workflow)
            self.assertEqual(len(blocks), 1)
            hook = '        run: |\n          python3 -B -m unittest discover -s scripts/verify -p test_pq_selected_owner_ci.py -v\n          python3 -B scripts/verify/pq-selected-owner-check.py\n'
            self.assertEqual(blocks[0].count(hook), 1)
            if job == 'verify':
                self.assertIn('        if: ${{ !cancelled() }}\n' + hook, blocks[0])
        for path in ('scripts/verify/pq-selected-owner-check.py', 'scripts/verify/test_pq_selected_owner_ci.py'):
            self.assertEqual(workflow.count('      - "' + path + '"\n'), 2)

    def test_shared_validator_rejects_missing_skipped_repeated_and_foreign_cases(self):
        package = 'internal/ynxbatch'
        identity = 'github.com/JiahaoAlbus/YNX-Chain/' + package
        names = selected.GROUPS[package]
        events = ([{'Action': 'start', 'Package': identity}] +
                  [{'Action': action, 'Package': identity, 'Test': name} for name in names for action in ('run', 'pass')] +
                  [{'Action': 'pass', 'Package': identity}])
        def encode(rows):
            return b''.join((json.dumps(row) + '\n').encode() for row in rows)
        self.assertEqual(selected.original.validate(encode(events), package, names)['testsRun'], 4)
        for changed in (events[:-2] + events[-1:], events + [events[1]],
                        events + [{'Action': 'skip', 'Package': identity, 'Test': names[0]}],
                        events + [{'Action': 'fail', 'Package': identity, 'Test': names[0] + '/late'}],
                        events + [{'Action': 'output', 'Package': 'foreign'}]):
            with self.assertRaises(RuntimeError):
                selected.original.validate(encode(changed), package, names)


if __name__ == '__main__':
    unittest.main()
