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
RESOURCE_WORKFLOW = ROOT / '.github/workflows/resource-market-ci.yml'
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


def validate_go_dependency_triggers(workflow):
    push = workflow.split('\n  push:\n', 1)[1].split('\n  pull_request:\n', 1)[0]
    pull = workflow.split('\n  pull_request:\n', 1)[1].split('\n  workflow_dispatch:', 1)[0]
    for section in (push, pull):
        globs = re.findall(r'^      - "([^"\n]+)"$', section, re.M)
        for path in ('go.mod', 'go.sum', 'third_party/cometbft/go.mod',
                     'third_party/cometbft/go.sum', 'third_party/cometbft/state/execution.go'):
            if not any(fnmatch.fnmatchcase(path, glob) for glob in globs):
                raise AssertionError('Go dependency or fork input does not trigger CI: ' + path)


def validate_resource_dependency_triggers(workflow):
    push = workflow.split('\n  push:\n', 1)[1].split('\n  pull_request:\n', 1)[0]
    pull = workflow.split('\n  pull_request:\n', 1)[1].split('\n  workflow_dispatch:', 1)[0]
    for section in (push, pull):
        globs = re.findall(r"^      - '([^'\n]+)'$", section, re.M)
        for path in ('go.mod', 'go.sum', 'third_party/cometbft/go.mod',
                     '.github/workflows/chain-core.yml',
                     'scripts/ops/test_validate_integration_contract_ci.py'):
            if not any(fnmatch.fnmatchcase(path, glob) for glob in globs):
                raise AssertionError('Resource dependency input does not trigger CI: ' + path)


def validate_go_pr_security_job(workflow):
    pull = workflow.split('\n  pull_request:\n', 1)[1].split('\n  workflow_dispatch:', 1)[0]
    branches = re.findall(r'^      - ([^\n]+)$', pull.split('    paths:', 1)[0], re.M)
    if branches != ['main', 'codex/ynx-pq-perf-integration']:
        raise AssertionError('PR security job base branches changed')
    marker = '\n  pr-go-security:\n'
    if workflow.count(marker) != 1:
        raise AssertionError('unique PR security job required')
    job = workflow.split(marker, 1)[1].split('\n  contract-tooling:\n', 1)[0]
    required = (
        "if: github.event_name == 'pull_request'", 'ref: ${{ github.sha }}',
        'go-version-file: go.mod', 'persist-credentials: false',
        'SOURCE_SHA: ${{ github.sha }}', 'BASE_SHA: ${{ github.event.pull_request.base.sha }}',
        'HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
        'test "$(git rev-parse HEAD)" = "$SOURCE_SHA"',
        'test "$(git show -s --format=%P "$SOURCE_SHA")" = "$BASE_SHA $HEAD_SHA"',
        'go run golang.org/x/vuln/cmd/govulncheck@v1.1.4',
        './cmd/ynx-abci', './cmd/ynx-comet', './cmd/ynx-bft-gatewayd',
        './cmd/ynx-consensus-pq-remote-signer', './cmd/ynx-consensus-pq-key-init',
        './cmd/ynx-consensus-proof-verify', './cmd/ynx-consensus-package',
        './cmd/ynx-consensus-keycheck',
        'python3 -B scripts/ops/test_validate_integration_contract_ci.py',
        'git diff --exit-code -- go.mod go.sum third_party/cometbft/go.mod third_party/cometbft/go.sum',
        'git diff --cached --exit-code -- go.mod go.sum third_party/cometbft/go.mod third_party/cometbft/go.sum',
        "GOMAXPROCS: '2'", "GOGC: '50'", "GOMEMLIMIT: '1536MiB'",
        "CGO_ENABLED: '0'", 'GOPROXY: https://proxy.golang.org',
        'GOSUMDB: sum.golang.org', 'GOTOOLCHAIN: local',
    )
    if any(job.count(value) != 1 for value in required):
        raise AssertionError('PR security job changed an exact source or scan requirement')
    if any(value in job for value in ('continue-on-error', '||', 'if: always()')):
        raise AssertionError('PR security job cannot soften a failure')
    steps = job.split('    steps:\n', 1)[1]
    headers = re.findall(r'^      - (.+)$', steps, re.M)
    if headers != [
        'uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4',
        'uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v5',
        'name: Bind the exact pull request merge, base and head',
        'name: Check reachable vulnerabilities in the original eight production commands',
        'name: Verify Go dependency controls and unchanged module inputs',
    ] or re.search(r'^ {8,}if:', steps, re.M):
        raise AssertionError('PR security steps must all execute in order')
    binding = steps.split('      - name: Bind the exact pull request merge, base and head\n', 1)[1].split('\n      - name:', 1)[0]
    expected_binding = ('        env:\n'
        '          SOURCE_SHA: ${{ github.sha }}\n'
        '          BASE_SHA: ${{ github.event.pull_request.base.sha }}\n'
        '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n'
        '        run: |\n'
        '          set -euo pipefail\n'
        '          [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ && "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]\n'
        '          test "$(git rev-parse HEAD)" = "$SOURCE_SHA"\n'
        '          test "$(git show -s --format=%P "$SOURCE_SHA")" = "$BASE_SHA $HEAD_SHA"')
    if binding != expected_binding:
        raise AssertionError('PR source binding must execute in full')
    verify = steps.split('      - name: Verify Go dependency controls and unchanged module inputs\n', 1)[1].rstrip('\n')
    if verify != ('        run: |\n'
                  '          set -euo pipefail\n'
                  '          python3 -B scripts/ops/test_validate_integration_contract_ci.py\n'
                  '          git diff --exit-code -- go.mod go.sum third_party/cometbft/go.mod third_party/cometbft/go.sum\n'
                  '          git diff --cached --exit-code -- go.mod go.sum third_party/cometbft/go.mod third_party/cometbft/go.sum'):
        raise AssertionError('PR dependency control must execute in full')
    step = '\n      - name: Check reachable vulnerabilities in the original eight production commands\n'
    if job.count(step) != 1:
        raise AssertionError('unique PR vulnerability scan step required')
    scan = job.split(step, 1)[1].split('\n      - name:', 1)[0]
    command = ('        run: >-\n'
               '          go run golang.org/x/vuln/cmd/govulncheck@v1.1.4\n'
               '          ./cmd/ynx-abci ./cmd/ynx-comet ./cmd/ynx-bft-gatewayd\n'
               '          ./cmd/ynx-consensus-pq-remote-signer ./cmd/ynx-consensus-pq-key-init\n'
               '          ./cmd/ynx-consensus-proof-verify ./cmd/ynx-consensus-package ./cmd/ynx-consensus-keycheck\n')
    if scan != command.rstrip('\n') or re.search(r'^\s+if:', scan, re.M):
        raise AssertionError('PR vulnerability scan must execute the original command without a conditional')


class IntegrationContractCI(unittest.TestCase):
    def setUp(self):
        self.workflow = WORKFLOW.read_text()
        self.paths = selected_paths(self.workflow)

    def test_all_actual_checker_inputs_have_one_selected_path(self):
        inputs = re.findall(r'(?:readJSON|readFileSync)\("([^"\n]+)"', CHECKER.read_text())
        expected = {
            '.github/workflows/chain-core.yml',
            '.github/workflows/resource-market-ci.yml',
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

    def test_go_dependency_and_fork_changes_trigger_push_and_pull_request(self):
        validate_go_dependency_triggers(self.workflow)
        for missing in ('go.mod', 'go.sum', 'third_party/cometbft/**'):
            line = f'      - "{missing}"\n'
            self.assertEqual(self.workflow.count(line), 2)
            for occurrence in (1, 2):
                sections = self.workflow.split(line)
                malformed = line.join(sections[:occurrence]) + line.join(sections[occurrence:])
                with self.assertRaises(AssertionError):
                    validate_go_dependency_triggers(malformed)

    def test_resource_dependency_changes_trigger_push_and_pull_request(self):
        workflow = RESOURCE_WORKFLOW.read_text()
        validate_resource_dependency_triggers(workflow)
        self.assertLess(len(workflow.encode()), 512000)
        for missing in ('go.mod', 'go.sum', 'third_party/cometbft/**',
                        '.github/workflows/chain-core.yml',
                        'scripts/ops/test_validate_integration_contract_ci.py'):
            line = f"      - '{missing}'\n"
            self.assertEqual(workflow.count(line), 2)
            for occurrence in (1, 2):
                sections = workflow.split(line)
                malformed = line.join(sections[:occurrence]) + line.join(sections[occurrence:])
                with self.assertRaises(AssertionError):
                    validate_resource_dependency_triggers(malformed)

    def test_pull_request_security_job_executes_the_original_eight_commands(self):
        validate_go_pr_security_job(self.workflow)
        for missing in ('./cmd/ynx-abci', './cmd/ynx-consensus-keycheck',
                        'test "$(git rev-parse HEAD)" = "$SOURCE_SHA"',
                        'go run golang.org/x/vuln/cmd/govulncheck@v1.1.4'):
            malformed = self.workflow.replace(missing, '', 1)
            with self.assertRaises(AssertionError):
                validate_go_pr_security_job(malformed)
        malformed = self.workflow.replace("    if: github.event_name == 'pull_request'\n", "    if: false\n", 1)
        with self.assertRaises(AssertionError):
            validate_go_pr_security_job(malformed)
        marker = '\n  pr-go-security:\n'
        before, remainder = self.workflow.split(marker, 1)
        job, after = remainder.split('\n  contract-tooling:\n', 1)
        for header in (
            '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4\n',
            '      - uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v5\n',
            '      - name: Bind the exact pull request merge, base and head\n',
            '      - name: Check reachable vulnerabilities in the original eight production commands\n',
            '      - name: Verify Go dependency controls and unchanged module inputs\n',
        ):
            self.assertEqual(job.count(header), 1)
            malformed = before + marker + job.replace(header, header + '        if: false\n', 1) + '\n  contract-tooling:\n' + after
            with self.subTest(header=header), self.assertRaises(AssertionError):
                validate_go_pr_security_job(malformed)
        for old, new in (("CGO_ENABLED: '0'", "CGO_ENABLED: '1'"),
                         ('third_party/cometbft/go.sum', 'missing-fork-sum'),
                         ('git diff --cached --exit-code', 'git diff --exit-code')):
            malformed = before + marker + job.replace(old, new, 1) + '\n  contract-tooling:\n' + after
            with self.subTest(old=old), self.assertRaises(AssertionError):
                validate_go_pr_security_job(malformed)
        malformed = self.workflow.replace('        run: >-\n          go run golang.org/x/vuln/cmd/govulncheck@v1.1.4', '        if: false\n        run: >-\n          go run golang.org/x/vuln/cmd/govulncheck@v1.1.4', 1)
        with self.assertRaises(AssertionError):
            validate_go_pr_security_job(malformed)

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

    def test_original_ide_fee_controls_build_the_source_contract_first(self):
        job = self.workflow.split('\n  integration-ide-fee:\n', 1)[1].split('\n  contract-tooling-scope:\n', 1)[0]
        for required in ('ref: ${{ github.sha }}', 'go-version-file: go.mod',
                         'node-version: "24"', 'npm ci', 'npm run hardhat:build',
                         'test -s artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json',
                         'go test -mod=readonly -json -p 1 -count=1 -timeout=120s',
                         'IDE fee test did not uniquely run and pass'):
            self.assertEqual(job.count(required), 1, required)
        self.assertEqual(job.count('TestGatewayCommitsBoundedIDEAndReturnsEVMLogs'), 2)
        self.assertLess(job.index('npm run hardhat:build'), job.index('go test -mod=readonly -json'))
        self.assertNotIn('continue-on-error', job)
        self.assertNotIn('if: false', job)

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
