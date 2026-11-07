"""Pure normal-CI controls; mocked supervisor cases grant no runtime evidence.

The actual Auth/Go PUBLIC joint is Darwin-only and uses the archive already
built by its original native job. Synthetic events never qualify a joint run.
"""
import fnmatch
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/resource-market-ci.yml'
RECIPE = 'scripts/verify/account-auth-interop-check.sh'
BUILDER = 'scripts/verify/build-account-auth-interop.py'
COLLECTOR = 'scripts/ops/collect_pq_account_auth_interop_tests.py'
COLLECTOR_TEST = 'scripts/ops/test_collect_pq_account_auth_interop_tests.py'
CONTROL = 'scripts/ops/test_validate_pq_account_auth_interop_ci.py'
FIXTURE = 'internal/consensus/testdata/account_auth_interop'
TRACE = 'scripts/loadtest/fixtures/finalize-1b-public'
STEP = 'Execute original Auth account client against the Go producer on Mac'
UPLOAD = 'Retain only public original Auth account joint evidence'
TOP = 'TestPQCommittedAccountPUBLICAuthFinalR1Joint'
PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
SUBS = ('OriginalClientNotReadyReadyAndReceiptMismatch',
        'OriginalPairedZeroPartialPhysicalDrain',
        'UnmodifiedProductionRoot0RefusesBeforeHost')
REQUIRED = (TOP,) + tuple(TOP + '/' + s for s in SUBS)
TRACES = ('result.json', 'migration.json', 'genesis.json', 'schedule.json',
          'init-chain.pb', 'initial-state.json', 'final-state.json', 'records.jsonl', 'intent.json')
HEADERS = ('auth_source_statement_v2.h', 'registered_n1_verify.h')
OUTPUTS = ('RUN.json', 'WRAPPER.stdout', 'WRAPPER.stderr', 'joint/GO.jsonl',
           'joint/STDERR', 'joint/RESULT.json', 'joint/cpp/BUILD.json')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


wire_ci = module('original_account_wire_ci', ROOT / 'scripts/ops/test_validate_pq_committed_account_wire_ci.py')
collector = module('account_auth_joint_collector', ROOT / COLLECTOR)
def step(raw, name):
    if name not in (STEP, UPLOAD):
        return wire_ci.step(raw, name)
    jobs = re.findall(r'(?ms)^  artifact-release-cabi:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)', raw)
    if len(jobs) != 1:
        raise AssertionError('one original native job required')
    found = re.findall(r'(?ms)^      - name: ' + re.escape(name) + r'\n(.*?)(?=^      - |\Z)', jobs[0])
    if len(found) != 1:
        raise AssertionError('one original native step required: ' + name)
    return found[0]


def wrapper_source(raw):
    body = step(raw, STEP)
    match = re.findall(r"(?ms)^          python3 -B - <<'PY_ACCOUNT_AUTH'\n(.*?)^          PY_ACCOUNT_AUTH$", body)
    if len(match) != 1:
        raise AssertionError('one actual bounded Python supervisor required')
    return ''.join(line[10:] for line in match[0].splitlines(keepends=True))


def assert_contract(raw, recipe, builder):
    # Preserve all original resource/Current4/proof/handler/wire admission.
    wire_ci.assert_contract(raw, (ROOT / wire_ci.RECIPE).read_text())
    for event in ('push', 'pull_request'):
        found = re.findall(r'(?ms)^  ' + event + r':\n(.*?)(?=^  [a-z_]+:\n|\Z)', raw)
        if len(found) != 1:
            raise AssertionError('one original event required')
        for path in (RECIPE, BUILDER, COLLECTOR, COLLECTOR_TEST, CONTROL, FIXTURE + '/**', TRACE + '/**'):
            if found[0].count("      - '" + path + "'\n") != 1:
                raise AssertionError('all original sources must trigger normal CI')
        patterns = re.findall(r"(?m)^      - '([^']+)'$", found[0])
        if not any(fnmatch.fnmatchcase('internal/consensus/pq_committed_account_auth_interop_test.go', p) for p in patterns):
            raise AssertionError('actual tagged Go consumer must trigger CI')
    pure = step(raw, 'Verify Linux window controls without starting a node')
    for path in (COLLECTOR_TEST, CONTROL):
        command = "          python3 -B -m unittest discover -s scripts/ops -p '" + Path(path).name + "' -v\n"
        if pure.count(command) != 1 or raw.count(command) != 1:
            raise AssertionError('normal pure admission must run exactly once')
    jobs = re.findall(r'(?ms)^  artifact-release-cabi:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)', raw)
    if len(jobs) != 1:
        raise AssertionError('original single native job required')
    job = jobs[0]
    for literal in ("runner: [ubuntu-24.04, macos-15]", '    timeout-minutes: 18\n',
                    "      GOMAXPROCS: '2'", "      GOMEMLIMIT: '1536MiB'",
                    "      CGO_ENABLED: '1'", "      GOFLAGS: '-p=1 -trimpath'"):
        if literal not in job:
            raise AssertionError('original job/platform/resource bounds changed')
    body = step(raw, STEP)
    if body not in job or job.index('      - name: Verify the executed original Main arm64 target\n') > job.index('      - name: ' + STEP + '\n'):
        raise AssertionError('joint must follow actual archive and arm64 qualification')
    if re.findall(r'(?m)^        if: (.*)$', body) != ["matrix.runner == 'macos-15'"]:
        raise AssertionError('actual Darwin-only joint must be mandatory on original Mac matrix')
    for literal in ('        id: accountauthinterop\n', '        timeout-minutes: 4\n', '          set -euo pipefail\n', '          umask 077\n'):
        if body.count(literal) != 1:
            raise AssertionError('one bounded fail-closed joint step required')
    w = wrapper_source(raw)
    for literal in ("deadline = started + 205", "deadline + 5 - time.monotonic()",
                    "archive = root / 'ynx-artifact-release-cabi/libynx_artifact_release.a'",
                    "sys.platform != 'darwin'", "0 < archive.stat().st_size <= 134217728",
                    "['nm', '-gU', str(archive)]", "line.split()[-1] == '_YNXAuthSourceStatementVerifyV2'",
                    'if count != 1:', "hashlib.sha256(archive.read_bytes()).hexdigest()",
                    "record['archiveUnchanged']", "if not record['archiveUnchanged']:",
                    "['bash', '" + RECIPE + "',", "str(case / 'joint'), str(archive), digest]",
                    "GOMAXPROCS='2', GOMEMLIMIT='1536MiB'", 'start_new_session=True',
                    'process.wait(timeout=max(0.001, deadline - time.monotonic()))',
                    'os.killpg(process.pid, signal.SIGTERM)', 'os.killpg(process.pid, signal.SIGKILL)',
                    'code = 124', "record.setdefault('firstCause', str(error))", "record['exitCode'] = code",
                    'raise SystemExit(code)', "'normalProtectedHost': False", "'RootAdmission': False",
                    "'linuxQualified': False", "'jointQualification': 'see original strict RESULT.json only'"):
        if literal not in w:
            raise AssertionError('original same-image bounded supervisor changed: ' + literal)
    if w.count('subprocess.Popen(') != 1 or w.count("'" + RECIPE + "'") != 1:
        raise AssertionError('one joint invocation only')
    for name in (*TRACES, *HEADERS):
        if repr(name) not in w:
            raise AssertionError('mandatory original PUBLIC input/header missing')
    for forbidden in ('continue-on-error:', '|| true', 'go build', 'go run', 'go test', '9e8ed48', '/Volumes/', 'core18-producer-r1'):
        if forbidden in body:
            raise AssertionError('no bypass/rebuild/historical archive pin')
    upload = step(raw, UPLOAD)
    expected_if = "${{ !cancelled() && matrix.runner == 'macos-15' && (steps.accountauthinterop.outcome == 'success' || steps.accountauthinterop.outcome == 'failure') }}"
    if re.findall(r'(?m)^        if: (.*)$', upload) != [expected_if]:
        raise AssertionError('Mac success and failure PUBLIC evidence required')
    if '        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n' not in upload:
        raise AssertionError('original pinned uploader required')
    if re.findall(r'(?m)^            (.+)$', upload) != ['${{ runner.temp }}/ynx-account-auth-interop/' + n for n in OUTPUTS]:
        raise AssertionError('closed PUBLIC output list required; no binary/source/private upload')
    if '          if-no-files-found: error\n' not in upload or '          retention-days: 7\n' not in upload:
        raise AssertionError('missing evidence is fatal')
    if tuple(collector.REQUIRED) != REQUIRED or collector.PACKAGE != PACKAGE:
        raise AssertionError('exact one top and three subcases/package required')
    for literal in ('set -euo pipefail', 'umask 077',
                    'YNX_ACCOUNT_AUTH_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"',
                    'YNX_ACCOUNT_AUTH_EVIDENCE="$(cd "$1" && pwd -P)"',
                    'mkdir -m 0700 "$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"',
                    'export TMPDIR="$YNX_ACCOUNT_AUTH_EVIDENCE/tmp" GOTMPDIR="$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"', '[[ $# != 3 || -e "$1" ]]',
                    'python3 -B ' + BUILDER + ' "$YNX_ACCOUNT_AUTH_EVIDENCE/cpp" "$2" "$3"',
                    'export GOMAXPROCS=2 GOMEMLIMIT=1536MiB YNX_PQ_NETWORK_E2E=\'\'',
                    'export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_AUTH_ROOT/' + TRACE + '"',
                    '-tags=ynx_public_trace_testsupport,ynx_account_auth_interop',
                    '-json -p 1 -count=1 -timeout=120s', "-run '^" + TOP + "$' ./internal/consensus",
                    '> "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_AUTH_EVIDENCE/STDERR"',
                    ' exit 1\nfi', 'python3 -B ' + COLLECTOR + ' "$YNX_ACCOUNT_AUTH_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_AUTH_EVIDENCE/RESULT.json"'):
        if literal not in recipe:
            raise AssertionError('exact original fixed-tag recipe changed: ' + literal)
    if recipe.count('go test ') != 1:
        raise AssertionError('exact one tagged invocation required')
    for text in ("sys.platform!='darwin'", "provenance['copied']+provenance['originalLinkDependencies']",
                 "not p['verbatim']", "hashlib.sha256(b).hexdigest()!=p['sha256']",
                 "'-mmacosx-version-min=13.0'", "'archiveBuilt':False", "str(archive),'-Wl,-dead_strip'",
                 'MobileAccountProofClient.cpp', 'MobileRegisteredReceipt.cpp', 'MobileSourceMath.cpp',
                 'compile-unmodified-Root0', 'unrelated-pay-abort.PUBLIC.cpp'):
        if text not in builder:
            raise AssertionError('verbatim actual Auth/single existing math archive required')
    for text in ('go build', 'go run', 'Node.Start', 'KeyGen', '|| true', '-short'):
        if text in recipe or text in builder:
            raise AssertionError('no new archive/provider/key or skipped original group')


def valid_events():
    return ([dict(Package=PACKAGE, Action='start')]
            + [dict(Package=PACKAGE, Action=a, Test=n) for n in REQUIRED for a in ('run', 'pass')]
            + [dict(Package=PACKAGE, Action='pass')])


class AccountAuthInteropCI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = WORKFLOW.read_text()
        cls.recipe = (ROOT / RECIPE).read_text()
        cls.builder = (ROOT / BUILDER).read_text()

    def test_actual_contract_and_verbatim_dependencies(self):
        assert_contract(self.raw, self.recipe, self.builder)
        fixture = ROOT / FIXTURE
        p = json.loads((fixture / 'PROVENANCE.json').read_text())
        self.assertEqual(p['AuthFinalH']['sha256'], 'ff6bf6bc34fc0e82665ab7399da900dea816a680a6c30f4b1f48a2e3e949b987')
        self.assertEqual((len(p['copied']), len(p['originalLinkDependencies'])), (33, 6))
        for row in p['copied'] + p['originalLinkDependencies']:
            b = (fixture / row['path']).read_bytes()
            self.assertTrue(row['verbatim'])
            self.assertEqual((len(b), hashlib.sha256(b).hexdigest()), (row['bytes'], row['sha256']))
        source = (ROOT / 'internal/consensus/pq_committed_account_auth_interop_test.go').read_text()
        self.assertEqual(source.splitlines()[0], '//go:build darwin && ynx_public_trace_testsupport && ynx_account_auth_interop')
        self.assertNotIn('t.Skip', source)
        self.assertIn('committedAccountFixture(t, "atomic-json", 10)', source)
        self.assertIn('t.Fatal("explicit original Auth test binary required", key)', source)
        self.assertEqual(set(TRACES), {p.name for p in (ROOT / TRACE).iterdir() if p.is_file()})

    def test_path_and_pure_removal_or_duplication_rejected(self):
        for path in (RECIPE, BUILDER, COLLECTOR, COLLECTOR_TEST, CONTROL, FIXTURE + '/**'):
            old = "      - '" + path + "'\n"
            for new in ('', old * 2):
                with self.subTest(path=path), self.assertRaises(AssertionError):
                    assert_contract(self.raw.replace(old, new, 1), self.recipe, self.builder)
        for name in (Path(COLLECTOR_TEST).name, Path(CONTROL).name):
            old = "          python3 -B -m unittest discover -s scripts/ops -p '" + name + "' -v\n"
            with self.assertRaises(AssertionError):
                assert_contract(self.raw.replace(old, '', 1), self.recipe, self.builder)

    def test_platform_budget_archive_and_public_upload_mutations_rejected(self):
        body, upload = step(self.raw, STEP), step(self.raw, UPLOAD)
        changes = [(body, body.replace("matrix.runner == 'macos-15'", 'false')),
                   (body, body.replace('timeout-minutes: 4', 'timeout-minutes: 5')),
                   (body, body.replace('        run: |', '        continue-on-error: true\n        run: |')),
                   (body, body.replace('started + 205', 'started + 210')),
                   (body, body.replace('deadline + 5', 'deadline + 15')),
                   (body, body.replace('ynx-artifact-release-cabi/libynx_artifact_release.a', 'old/archive.a')),
                   (body, body.replace('if count != 1:', 'if count < 1:')),
                   (body, body.replace("'_YNXAuthSourceStatementVerifyV2'", "'_Other'")),
                   (body, body.replace('raise SystemExit(code)', 'raise SystemExit(0)')),
                   (body, body.replace("'init-chain.pb'", "'init-chain.json'")),
                   (body, body.replace('start_new_session=True', 'start_new_session=False')),
                   (upload, upload.replace(" || steps.accountauthinterop.outcome == 'failure'", '')),
                   (upload, upload.replace('/joint/cpp/BUILD.json', '/**')),
                   (upload, upload.replace('if-no-files-found: error', 'if-no-files-found: warn'))]
        for old, new in changes:
            with self.subTest(new=new), self.assertRaises(AssertionError):
                assert_contract(self.raw.replace(old, new, 1), self.recipe, self.builder)

    def test_exact_recipe_and_original_builder_rejections(self):
        for old, new in (("'^" + TOP + "$'", "'^TestPQ'"), ('-timeout=120s', '-timeout=180s'),
                         ('-p 1', '-p 2'), ('ynx_public_trace_testsupport,ynx_account_auth_interop', 'ynx_public_trace_testsupport'),
                         (' exit 1\nfi', ' exit 0\nfi'), (TRACE, 'other-trace')):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe.replace(old, new, 1), self.builder)
        for old, new in (("sys.platform!='darwin'", 'False'), ("not p['verbatim']", 'False'),
                         ('MobileAccountProofClient.cpp', 'stub.cpp'), ("str(archive),'-Wl,-dead_strip'", "'other.a'")):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe, self.builder.replace(old, new, 1))

    def test_actual_recipe_prelude_uses_owned_physical_tmp_for_go_and_cpp(self):
        prelude = self.recipe.split('# Original Auth PUBLIC platform body', 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            real = Path(directory).resolve() / 'real'
            real.mkdir()
            alias = real.parent / 'alias'
            alias.symlink_to(real, target_is_directory=True)
            output = alias / 'case'
            command = prelude + "printf '%s\\0' \"$YNX_ACCOUNT_AUTH_ROOT\" \"$YNX_ACCOUNT_AUTH_EVIDENCE\" \"$TMPDIR\" \"$GOTMPDIR\"\n"
            result = subprocess.run(['bash', '-c', command, str(ROOT / RECIPE), str(output), '/PUBLIC/archive', 'PUBLIC-pin'], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            fields = result.stdout.decode().split('\0')[:-1]
            self.assertEqual(fields, [str(ROOT.resolve()), str(output.resolve()), str(output.resolve() / 'tmp'), str(output.resolve() / 'tmp')])
            self.assertEqual((output / 'tmp').stat().st_mode & 0o777, 0o700)
            self.assertFalse((output / 'tmp').is_symlink())
            repeated = subprocess.run(['bash', '-c', command, str(ROOT / RECIPE), str(output), '/PUBLIC/archive', 'PUBLIC-pin'], capture_output=True, timeout=5)
            self.assertEqual(repeated.returncode, 2)

    def test_case_owned_tmp_contract_cannot_be_removed_or_alias_reintroduced(self):
        for old, new in (('&& pwd -P)', '&& pwd)'),
                         ('mkdir -m 0700 "$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"', 'mkdir -m 0777 "$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"'),
                         (' GOTMPDIR="$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"', ''),
                         ('export TMPDIR="$YNX_ACCOUNT_AUTH_EVIDENCE/tmp"', 'export TMPDIR=/tmp')):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe.replace(old, new), self.builder)

    def test_collector_requires_original_top_three_children_and_package(self):
        self.assertTrue(collector.qualify(valid_events())['jointPUBLICPassed'])
        cases = [[], valid_events()[:-1], valid_events() + valid_events()[-1:]]
        for name in REQUIRED:
            cases += [[e for e in valid_events() if e.get('Test') != name],
                      valid_events() + [dict(Package=PACKAGE, Action='run', Test=name)],
                      valid_events() + [dict(Package=PACKAGE, Action='pass', Test=name)]]
        for action in ('fail', 'skip', 'build-fail', 'unknown'):
            cases.append(valid_events() + [dict(Package=PACKAGE, Action=action, Test=REQUIRED[1])])
        cases += [valid_events() + [dict(Package='foreign', Action='pass')],
                  valid_events() + [dict(Package=PACKAGE, Action='pass', Test=TOP + '/extra')]]
        for events in cases:
            with self.subTest(events=events), self.assertRaises(ValueError):
                collector.qualify(events)

    def supervisor(self, mode='success', symbols=1, missing=None):
        # Execute the actual workflow Python body; subprocesses are mocks only.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'ynx-artifact-release-cabi/libynx_artifact_release.a'
            archive.parent.mkdir()
            archive.write_bytes(b'PUBLIC mock archive for supervisor controls only')
            for name in TRACES:
                p = root / TRACE / name
                p.parent.mkdir(parents=True, exist_ok=True)
                if name != missing:
                    p.write_bytes(b'PUBLIC control')
            for name in HEADERS:
                p = root / 'cmd/ynx-artifact-release-cabi' / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b'PUBLIC header control')
            clock, waits, signals, calls = [0.0], [], [], []
            class Child:
                pid = 777777  # Mock only; os.killpg is always intercepted below.
                done = False
                def wait(self, timeout=None):
                    waits.append(timeout)
                    if mode == 'timeout' and timeout is not None:
                        clock[0] += timeout
                        raise subprocess.TimeoutExpired('PUBLIC mock only', timeout)
                    self.done = True
                    if mode == 'changed':
                        archive.write_bytes(b'changed')
                    return 9 if mode == 'failure' else 0
                def poll(self):
                    return 0 if self.done else None
            child = Child()
            def popen(args, **kw):
                calls.append((args, kw))
                return child
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ, {'RUNNER_TEMP': str(root), 'GITHUB_SHA': 'PUBLIC-only'}), \
                     patch.object(sys, 'platform', 'darwin'), \
                     patch('subprocess.check_output', return_value=('0 T _YNXAuthSourceStatementVerifyV2\n' * symbols)) as nm, \
                     patch('subprocess.Popen', side_effect=popen), \
                     patch('time.monotonic', side_effect=lambda: clock[0]), \
                     patch('os.killpg', side_effect=lambda pid, sig: signals.append((pid, sig))), \
                     patch('builtins.print'):
                    with self.assertRaises(SystemExit) as exited:
                        exec(compile(wrapper_source(self.raw), '<actual-CI-supervisor>', 'exec'), {})
                result = json.loads((root / 'ynx-account-auth-interop/RUN.json').read_text())
            finally:
                os.chdir(old_cwd)
            return exited.exception.code, result, waits, signals, calls, nm.call_args

    def test_actual_supervisor_preserves_success_failure_and_single_archive(self):
        for mode, code in (('success', 0), ('failure', 9)):
            actual, result, waits, signals, calls, nm = self.supervisor(mode)
            self.assertEqual(actual, code)
            self.assertEqual(result['exitCode'], code)
            self.assertEqual(result['recipeExitCode'], code)
            self.assertTrue(result['archiveUnchanged'])
            self.assertFalse(result['RootAdmission'])
            self.assertFalse(result['normalProtectedHost'])
            self.assertEqual(len(calls), 1)
            args, kw = calls[0]
            self.assertEqual(args[:2], ['bash', RECIPE])
            self.assertEqual(args[4], result['archive']['sha256'])
            self.assertTrue(kw['start_new_session'])
            self.assertEqual(kw['env']['GOMAXPROCS'], '2')
            self.assertEqual(kw['env']['GOMEMLIMIT'], '1536MiB')
            self.assertEqual(waits, [205.0])
            self.assertFalse(signals)
            self.assertEqual(nm.args[0][:2], ['nm', '-gU'])

    def test_actual_supervisor_owns_205_plus_5_second_termination(self):
        code, result, waits, signals, calls, _ = self.supervisor('timeout')
        self.assertEqual(code, 124)
        self.assertTrue(result['timedOut'])
        self.assertEqual(waits, [205.0, 5.0, None])
        self.assertEqual(signals, [(777777, signal.SIGTERM), (777777, signal.SIGKILL)])
        self.assertEqual(result['elapsedSeconds'], 210.0)
        self.assertEqual(len(calls), 1)

    def test_actual_supervisor_rejects_missing_trace_symbol_drift_and_archive_mutation(self):
        for count in (0, 2):
            code, result, _, _, calls, _ = self.supervisor(symbols=count)
            self.assertEqual(code, 1)
            self.assertIn('exactly one', result['firstCause'])
            self.assertFalse(calls)
        for name in TRACES:
            code, result, _, _, calls, _ = self.supervisor(missing=name)
            self.assertEqual(code, 1)
            self.assertIn('mandatory original PUBLIC trace missing', result['firstCause'])
            self.assertFalse(calls)
        code, result, _, _, _, _ = self.supervisor('changed')
        self.assertEqual(code, 1)
        self.assertIn('archive changed', result['firstCause'])
        self.assertFalse(result['archiveUnchanged'])


if __name__ == '__main__':
    unittest.main()
