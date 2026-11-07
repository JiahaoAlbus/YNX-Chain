"""Pure controls for the original committed-account proof CI recipe.

Synthetic event rows test the real collector, not Go, a Node, account proof or
Source qualification. The fixed PUBLIC trace is consumed only by normal Go CI.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/resource-market-ci.yml"
RECIPE = "scripts/verify/committed-account-proof-check.sh"
COLLECTOR = "scripts/ops/collect_pq_committed_account_tests.py"
COLLECTOR_TEST = "scripts/ops/test_collect_pq_committed_account_tests.py"
CONTROL = "scripts/ops/test_validate_pq_committed_account_ci.py"
TRACE = "scripts/loadtest/fixtures/finalize-1b-public"
STEP = "Verify committed account PUBLIC proof and original engine lifecycle"
UPLOAD = "Retain only public committed account proof evidence"
NORMAL_IF = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}"
COMMAND = ('          timeout --signal=TERM --kill-after=5s 205s bash ' + RECIPE
           + ' "$RUNNER_TEMP/ynx-committed-account-proof"\n')
REQUIRED = (
    "TestPQCommittedAccountPUBLICContinuousEngineLayouts",
    "TestPQCommittedAccountPUBLICLifecycleAndDebt",
    "TestPQCommittedAccountPUBLICAppBeforeStoreRefused",
    "TestPQCommittedAccountPUBLICSignedEvidenceRefusals",
)
SELECTOR = "^(" + "|".join(REQUIRED) + ")$"
PACKAGE = "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
FILES = ("RESULT.json", "GO.jsonl", "STDERR")
FALSE_FLAGS = ("nodeStarted", "keysGenerated", "newSignaturesCreated", "rootSelected",
               "nativeReceipt", "walletAccountAuthorized", "publicNetwork")


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


collector = module("account_collector", ROOT / COLLECTOR)
current4 = module("original_current4_contract", Path(__file__).with_name("test_validate_pq_current4_ci.py"))


def assert_contract(raw, recipe):
    # The existing three Current4 tests and full untagged state union remain
    # separate; reuse their original contract rather than inventing a new union.
    current4.assert_contract(raw)
    for event in ("push", "pull_request"):
        found = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
        if len(found) != 1:
            raise AssertionError("one original trigger required")
        source = "internal/consensus/**" if event == "push" else "internal/consensus/pq_committed_account*.go"
        for path in (RECIPE, COLLECTOR, COLLECTOR_TEST, CONTROL, TRACE + "/**", source):
            if found[0].count("      - '" + path + "'\n") != 1:
                raise AssertionError("account source/recipe/collector/fixture must trigger normal CI")
    pure = current4.step(raw, "Verify Linux window controls without starting a node")
    for path in (COLLECTOR_TEST, CONTROL):
        command = "          python3 -B -m unittest discover -s scripts/ops -p '" + Path(path).name + "' -v\n"
        if raw.count(command) != 1 or pure.count(command) != 1:
            raise AssertionError("account pure controls must execute exactly once")
    body = current4.step(raw, STEP)
    if re.findall(r"(?m)^        if: (.*)$", body) != [NORMAL_IF]:
        raise AssertionError("only original normal identity admission allowed")
    if "        id: committedaccountproof\n" not in body or "        timeout-minutes: 4\n" not in body:
        raise AssertionError("bounded independent account step required")
    if body.count(COMMAND) != 1 or raw.count(COMMAND) != 1:
        raise AssertionError("one original recipe with total 210s outer bound required")
    if any(word in body for word in ("continue-on-error:", "|| true", "go test", "exit 0", "if [", "if test")):
        raise AssertionError("no bypass or duplicate Go invocation")
    archive = current4.step(raw, UPLOAD)
    expected_if = "${{ !cancelled() && (steps.committedaccountproof.outcome == 'success' || steps.committedaccountproof.outcome == 'failure') }}"
    if re.findall(r"(?m)^        if: (.*)$", archive) != [expected_if]:
        raise AssertionError("both success and failure original evidence must be retained")
    if "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n" not in archive:
        raise AssertionError("original pinned artifact action required")
    paths = re.findall(r"(?m)^            (.+)$", archive)
    if paths != ["${{ runner.temp }}/ynx-committed-account-proof/" + name for name in FILES]:
        raise AssertionError("only the three PUBLIC originals may be uploaded")
    if "          if-no-files-found: error\n" not in archive or "          retention-days: 7\n" not in archive:
        raise AssertionError("missing original evidence is fatal")
    if tuple(collector.REQUIRED) != REQUIRED or collector.PACKAGE != PACKAGE:
        raise AssertionError("original exact four-top collector required")
    if recipe.count("go test ") != 1 or ("-run '" + SELECTOR + "'") not in recipe:
        raise AssertionError("exact account selector required, without other tagged tests")
    for literal in ("set -euo pipefail", "umask 077", "export GOMAXPROCS=2 GOMEMLIMIT=1536MiB",
                    'YNX_ACCOUNT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"',
                    'export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_ROOT/' + TRACE + '"',
                    "export YNX_PQ_NETWORK_E2E=''", "-tags=ynx_public_trace_testsupport",
                    "-json -p 1 -count=1 -timeout=120s", "./internal/consensus",
                    '> "$YNX_ACCOUNT_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_EVIDENCE/STDERR"',
                    '  cat "$YNX_ACCOUNT_EVIDENCE/GO.jsonl"',
                    '  cat "$YNX_ACCOUNT_EVIDENCE/STDERR" >&2', "  exit 1\nfi",
                    'python3 -B ' + COLLECTOR + ' "$YNX_ACCOUNT_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_EVIDENCE/RESULT.json"'):
        if literal not in recipe:
            raise AssertionError("original bounded fail-closed PUBLIC recipe changed: " + literal)
    if any(word in recipe for word in ("|| true", "-short", "go run", "go build", "Node.Start")):
        raise AssertionError("recipe cannot bypass or start other execution")
    joint = current4.step(raw, "Verify original Auth r2 cross-process Current4 DATA interoperability")
    if ('        run: bash scripts/verify/current4-auth-r2-interop-check.sh "$RUNNER_TEMP/ynx-current4-auth-r2-interop"\n' not in joint
            or "        timeout-minutes: 5\n" not in joint or "continue-on-error:" in joint):
        raise AssertionError("original fourth C++ joint qualification must remain")


def rows():
    return ([dict(Package=PACKAGE, Action="start")]
            + [dict(Package=PACKAGE, Action=action, Test=name) for name in REQUIRED for action in ("run", "pass")]
            + [dict(Package=PACKAGE, Action="pass")])


class CommittedAccountCIControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = WORKFLOW.read_text()
        cls.recipe = (ROOT / RECIPE).read_text()

    def test_original_recipe_is_independent_and_keeps_existing_union(self):
        assert_contract(self.raw, self.recipe)
        for leaf in ("pq_committed_account_test.go", "pq_committed_account_trace_test.go"):
            source = (ROOT / "internal/consensus" / leaf).read_text()
            self.assertEqual(source.splitlines()[0], "//go:build (linux || darwin) && ynx_public_trace_testsupport")
            self.assertNotIn("t.Skip", source)
        for name in (*REQUIRED, "TestPQCommittedAccountPUBLICOther", REQUIRED[0] + "Other", "TestPQCurrent4WirePUBLICRegisteredObserverData"):
            self.assertEqual(bool(re.search(SELECTOR, name)), name in REQUIRED)

    def test_source_trigger_and_pure_control_removal_is_rejected(self):
        for path in (RECIPE, COLLECTOR, COLLECTOR_TEST, CONTROL, TRACE + "/**", "internal/consensus/pq_committed_account*.go"):
            changed = self.raw.replace("      - '" + path + "'\n", "", 1)
            with self.subTest(path=path), self.assertRaises(AssertionError):
                assert_contract(changed, self.recipe)
        for name in (Path(COLLECTOR_TEST).name, Path(CONTROL).name):
            command = "          python3 -B -m unittest discover -s scripts/ops -p '" + name + "' -v\n"
            for replacement in ("", command * 2):
                with self.assertRaises(AssertionError):
                    assert_contract(self.raw.replace(command, replacement), self.recipe)

    def test_budget_admission_and_evidence_cannot_be_weakened(self):
        body = current4.step(self.raw, STEP)
        archive = current4.step(self.raw, UPLOAD)
        replacements = [(body, body.replace(NORMAL_IF, "${{ false }}")),
                        (body, body.replace("timeout-minutes: 4", "timeout-minutes: 5")),
                        (body, body.replace("        run: |", "        continue-on-error: true\n        run: |")),
                        (COMMAND, COMMAND.replace("205s", "210s")),
                        (COMMAND, COMMAND.replace("--kill-after=5s", "--kill-after=15s")),
                        (COMMAND, COMMAND.rstrip() + " || true\n"), (COMMAND, ""), (COMMAND, COMMAND * 2),
                        (archive, archive.replace(" || steps.committedaccountproof.outcome == 'failure'", "")),
                        (archive, archive.replace("if-no-files-found: error", "if-no-files-found: warn")),
                        (archive, archive.replace("/STDERR", "/**"))]
        for old, new in replacements:
            with self.subTest(replacement=new), self.assertRaises(AssertionError):
                assert_contract(self.raw.replace(old, new, 1), self.recipe)

    def test_recipe_cannot_select_other_tests_or_skip_missing_originals(self):
        for old, new in ((SELECTOR, "^TestPQCommittedAccount"), (SELECTOR, "^(" + "|".join(REQUIRED[:-1]) + ")$"),
                         ("-timeout=120s", "-timeout=180s"), ("-p 1", "-p 2"),
                         ("-tags=ynx_public_trace_testsupport", ""), ("$YNX_ACCOUNT_ROOT/" + TRACE, "$RUNNER_TEMP/trace"),
                         ("  exit 1\nfi", "  exit 0\nfi"), ("export YNX_PQ_NETWORK_E2E=''", "export YNX_PQ_NETWORK_E2E=authorized"),
                         ('2> "$YNX_ACCOUNT_EVIDENCE/STDERR"', "2>&1")):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe.replace(old, new, 1))

    def test_every_nested_failure_skip_foreign_and_duplicate_is_rejected(self):
        for name in REQUIRED:
            for action in ("fail", "skip", "build-fail", "unknown"):
                with self.subTest(name=name, action=action), self.assertRaises(ValueError):
                    collector.qualify(rows() + [dict(Package=PACKAGE, Action=action, Test=name + "/nested")])
            for action in ("run", "pass"):
                with self.assertRaises(ValueError):
                    collector.qualify(rows() + [dict(Package=PACKAGE, Action=action, Test=name)])
        for event in (dict(Package="foreign", Action="pass"), dict(Package=PACKAGE, Action="pass", Test="TestForeign/nested")):
            with self.assertRaises(ValueError):
                collector.qualify(rows() + [event])

    def test_actual_collector_cli_is_exclusive_and_data_only(self):
        with tempfile.TemporaryDirectory() as directory:
            source, result = Path(directory) / "GO.jsonl", Path(directory) / "RESULT.json"
            source.write_text("".join(json.dumps(row) + "\n" for row in rows()))
            environment = dict(os.environ, GITHUB_SHA="1" * 40)
            argv = [sys.executable, "-B", str(ROOT / COLLECTOR), str(source), str(result)]
            first = subprocess.run(argv, env=environment, capture_output=True, timeout=10)
            self.assertEqual(first.returncode, 0, first.stderr)
            original = result.read_bytes()
            value = json.loads(original)
            self.assertEqual(value["requiredPassed"], list(REQUIRED))
            self.assertEqual(value["sourceCommit"], "1" * 40)
            for flag in FALSE_FLAGS:
                self.assertIs(value[flag], False)
            self.assertTrue(value["suitePassed"])
            second = subprocess.run(argv, env=environment, capture_output=True, timeout=10)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(result.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
