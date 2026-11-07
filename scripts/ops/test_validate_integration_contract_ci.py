#!/usr/bin/env python3
"""Keep the normal-push integration gate bound to its actual source inputs."""

import fnmatch
import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/chain-core.yml'
CHECKER = ROOT / 'scripts/verify/integration-contract-check.mjs'


def selected_paths(workflow):
    match = re.search(
        r'git diff --name-only "\$BEFORE" "\$AFTER" -- \\\n'
        r'(.*?) > "\$RUNNER_TEMP/integration-contract-changes.txt"',
        workflow, re.S,
    )
    if match is None:
        raise AssertionError('normal integration input selector missing')
    # Start at the nearest diff command: earlier independent selectors also
    # use the same BEFORE/AFTER arguments and must not enter this closure.
    command = match.group(0).split('git diff --name-only')[-1]
    path_text = command.split('-- \\\n', 1)[1].rsplit(' > ', 1)[0]
    return shlex.split(path_text.replace('\\\n', ' '))


class IntegrationContractCI(unittest.TestCase):
    def setUp(self):
        self.workflow = WORKFLOW.read_text()
        self.paths = selected_paths(self.workflow)

    def test_all_actual_checker_inputs_have_one_selected_path(self):
        inputs = re.findall(r'(?:readJSON|readFileSync)\("([^"\n]+)"', CHECKER.read_text())
        expected = {
            '.github/workflows/chain-core.yml',
            'scripts/verify/integration-contract-check.mjs',
            'scripts/ops/test_validate_integration_contract_ci.py',
            *inputs,
        }
        self.assertEqual(len(self.paths), len(set(self.paths)))
        self.assertEqual(set(self.paths), expected)
        for path in self.paths:
            self.assertTrue((ROOT / path).is_file(), path)

    def test_every_selected_input_triggers_the_existing_workflow(self):
        trigger = self.workflow.split('  workflow_dispatch:', 1)[0]
        globs = re.findall(r'^      - "([^"]+)"$', trigger, re.M)
        for path in self.paths:
            self.assertTrue(any(fnmatch.fnmatchcase(path, glob) for glob in globs), path)

    def test_normal_gate_runs_original_checker_without_soft_failure(self):
        job = self.workflow.split('\n  normal-integration-contract:\n', 1)[1].split('\n  verify:\n', 1)[0]
        self.assertIn('needs: contract-tooling-scope', job)
        self.assertIn("if: needs.contract-tooling-scope.outputs.integration_changed == 'true'", job)
        self.assertIn('fetch-depth: 0', job)
        self.assertIn('node-version: "24"', job)
        self.assertEqual(job.count('run: node scripts/verify/integration-contract-check.mjs'), 1)
        self.assertNotIn('continue-on-error', job)
        self.assertNotIn('||', job)
        self.assertNotIn('if: always()', job)
        self.assertIn("printf 'integration_changed=true\\n'", self.workflow)
        self.assertIn("printf 'integration_changed=false\\n'", self.workflow)

    def test_real_git_diff_selects_source_changes_and_ignores_unrelated_files(self):
        with tempfile.TemporaryDirectory(prefix='ynx-integration-scope-') as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

            git('init', '-q')
            git('config', 'user.name', 'Integration scope test')
            git('config', 'user.email', 'scope-test@invalid.example')
            for path in [*self.paths, 'unrelated.txt']:
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('original\n')
            git('add', '.')
            git('commit', '-qm', 'original')
            before = git('rev-parse', 'HEAD')
            for path in self.paths:
                (root / path).write_text('changed source\n')
            git('add', '.')
            git('commit', '-qm', 'changed integration inputs')
            after = git('rev-parse', 'HEAD')
            actual = git('diff', '--name-only', before, after, '--', *self.paths).splitlines()
            self.assertEqual(set(actual), set(self.paths))
            (root / 'unrelated.txt').write_text('unrelated change\n')
            git('add', '.')
            git('commit', '-qm', 'unrelated change')
            self.assertEqual(git('diff', '--name-only', after, 'HEAD', '--', *self.paths), '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
