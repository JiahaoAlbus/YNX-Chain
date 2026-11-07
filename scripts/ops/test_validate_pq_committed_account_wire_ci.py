"""Pure controls for the existing wire recipe and its normal CI admission.

Event fixtures exercise only the real collector. They create no account proof,
Node, Source grant, keys or signatures and are not Go qualification evidence.
"""
import fnmatch
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
RECIPE = "scripts/verify/committed-account-wire-check.sh"
COLLECTOR = "scripts/ops/collect_pq_committed_account_wire_tests.py"
COLLECTOR_TEST = "scripts/ops/test_collect_pq_committed_account_wire_tests.py"
CONTROL = "scripts/ops/test_validate_pq_committed_account_wire_ci.py"
STEP = "Verify committed account wire PUBLIC DATA and close debt"
UPLOAD = "Retain only public committed account wire evidence"
NORMAL_IF = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}"
COMMAND = ('          timeout --signal=TERM --kill-after=5s 205s bash ' + RECIPE
           + ' "$RUNNER_TEMP/ynx-committed-account-wire"\n')
REQUIRED = ("TestPQCommittedAccountWirePUBLICStrictDATA",
            "TestPQCommittedAccountWirePUBLICContinuousProof",
            "TestPQCommittedAccountWirePUBLICCloseDebt")
SELECTOR = "^(" + "|".join(REQUIRED) + ")$"
PACKAGE = "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
TRACE = "scripts/loadtest/fixtures/finalize-1b-public"
SDK = "internal/consensus/testdata/account_proof_wire_sdk"
FILES = ("RESULT.json", "GO.jsonl", "STDERR")


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


handler_ci = module("original_handler_ci", Path(__file__).with_name("test_validate_pq_committed_account_handler_ci.py"))
account_ci = handler_ci.account_ci
collector = module("account_wire_collector", ROOT / COLLECTOR)
step = account_ci.current4.step


def assert_contract(raw, recipe):
    # Keep proof four-top, handler two-top, Current4/Auth and complete untagged
    # union contracts. Wire is its own invocation with the original DATA driver.
    handler_ci.assert_contract(raw, (ROOT / handler_ci.RECIPE).read_text())
    for event in ("push", "pull_request"):
        found = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
        if len(found) != 1:
            raise AssertionError("one original trigger required")
        for path in (RECIPE, COLLECTOR, COLLECTOR_TEST, CONTROL, TRACE + "/**", SDK + "/**"):
            if found[0].count("      - '" + path + "'\n") != 1:
                raise AssertionError("wire source dependencies must trigger normal CI")
        patterns = re.findall(r"(?m)^      - '([^']+)'$", found[0])
        for name in ("internal/consensus/pq_committed_account_wire.go", "internal/consensus/pq_committed_account_wire_test.go"):
            if not any(fnmatch.fnmatchcase(name, pattern) for pattern in patterns):
                raise AssertionError("real wire source/test must trigger CI")
    pure = step(raw, "Verify Linux window controls without starting a node")
    for path in (COLLECTOR_TEST, CONTROL):
        command = "          python3 -B -m unittest discover -s scripts/ops -p '" + Path(path).name + "' -v\n"
        if raw.count(command) != 1 or pure.count(command) != 1:
            raise AssertionError("each wire pure group must run once")
    body = step(raw, STEP)
    if re.findall(r"(?m)^        if: (.*)$", body) != [NORMAL_IF]:
        raise AssertionError("original normal identity admission required")
    if "        id: committedaccountwire\n" not in body or "        timeout-minutes: 4\n" not in body:
        raise AssertionError("independent bounded wire step required")
    if body.count(COMMAND) != 1 or raw.count(COMMAND) != 1:
        raise AssertionError("one fixed original recipe with 210s total outer bound required")
    if any(word in body for word in ("continue-on-error:", "|| true", "go test", "exit 0", "if [", "if test")):
        raise AssertionError("wire failure cannot be ignored or duplicate Go run")
    upload = step(raw, UPLOAD)
    expected_if = "${{ !cancelled() && (steps.committedaccountwire.outcome == 'success' || steps.committedaccountwire.outcome == 'failure') }}"
    if re.findall(r"(?m)^        if: (.*)$", upload) != [expected_if]:
        raise AssertionError("original success/failure evidence both retained")
    if "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n" not in upload:
        raise AssertionError("original pinned upload action required")
    if re.findall(r"(?m)^            (.+)$", upload) != ["${{ runner.temp }}/ynx-committed-account-wire/" + name for name in FILES]:
        raise AssertionError("only closed three-file PUBLIC wire evidence")
    if "          if-no-files-found: error\n" not in upload or "          retention-days: 7\n" not in upload:
        raise AssertionError("missing original evidence cannot be skipped")
    if tuple(collector.REQUIRED) != REQUIRED or collector.PACKAGE != PACKAGE:
        raise AssertionError("exact normal wire symbols/package required")
    if recipe.count("go test ") != 1 or ("-run '" + SELECTOR + "'") not in recipe:
        raise AssertionError("only the exact three original wire tops may execute")
    for literal in ("set -euo pipefail", "umask 077", "export GOMAXPROCS=2 GOMEMLIMIT=1536MiB",
                    'YNX_ACCOUNT_WIRE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"',
                    'export YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$YNX_ACCOUNT_WIRE_ROOT/' + TRACE + '"',
                    "export YNX_PQ_NETWORK_E2E=''", "-tags=ynx_public_trace_testsupport",
                    "-json -p 1 -count=1 -timeout=120s", "./internal/consensus",
                    '> "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl" 2> "$YNX_ACCOUNT_WIRE_EVIDENCE/STDERR"',
                    ' cat "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl"',
                    ' cat "$YNX_ACCOUNT_WIRE_EVIDENCE/STDERR" >&2', " exit 1\nfi",
                    'python3 -B ' + COLLECTOR + ' "$YNX_ACCOUNT_WIRE_EVIDENCE/GO.jsonl" "$YNX_ACCOUNT_WIRE_EVIDENCE/RESULT.json"'):
        if literal not in recipe:
            raise AssertionError("original bounded fail-closed PUBLIC recipe changed: " + literal)
    for literal in ('python3 -B ' + COLLECTOR_TEST,
                    '"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror',
                    SDK + '/data_check.cpp',
                    '-o "$YNX_ACCOUNT_WIRE_EVIDENCE/sdk-data-check"',
                    'export YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER="$YNX_ACCOUNT_WIRE_EVIDENCE/sdk-data-check"'):
        if recipe.count(literal) != 1:
            raise AssertionError("the sole pinned SDK DATA consumer is mandatory: " + literal)
    if recipe.index('python3 -B ' + COLLECTOR_TEST) > recipe.index('"${CXX:-c++}"'):
        raise AssertionError("check original SDK header pins before compiling the consumer")
    if recipe.index('export YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER=') > recipe.index('if ! go test '):
        raise AssertionError("the actual driver must be ready before the three Go tests")
    if any(word in recipe for word in ("|| true", "-short", "go run", "go build", "Node.Start")):
        raise AssertionError("recipe cannot bypass original Go checks or start another execution")


def rows():
    return ([dict(Package=PACKAGE, Action="start")]
            + [dict(Package=PACKAGE, Action=action, Test=name) for name in REQUIRED for action in ("run", "pass")]
            + [dict(Package=PACKAGE, Action="pass")])


class CommittedAccountWireCIControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = WORKFLOW.read_text()
        cls.recipe = (ROOT / RECIPE).read_text()

    def test_original_bounded_recipe_and_tagged_exclusion(self):
        assert_contract(self.raw, self.recipe)
        source = (ROOT / "internal/consensus/pq_committed_account_wire_test.go").read_text()
        self.assertEqual(source.splitlines()[0], "//go:build (linux || darwin) && ynx_public_trace_testsupport")
        self.assertNotIn("t.Skip", source)
        self.assertIn('os.Getenv("YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER")', source)
        self.assertIn('t.Fatal("mandatory sole SDK DATA driver missing")', source)
        self.assertIn('exec.CommandContext(ctx, driver, p)', source)
        for name in (*REQUIRED, "TestPQCommittedAccountWireOther", REQUIRED[0] + "Other", *account_ci.REQUIRED, *handler_ci.REQUIRED):
            self.assertEqual(bool(re.search(SELECTOR, name)), name in REQUIRED)

    def test_trigger_and_pure_control_removal_is_rejected(self):
        for path in (RECIPE, COLLECTOR, COLLECTOR_TEST, CONTROL, TRACE + "/**", SDK + "/**", "internal/consensus/pq_committed_account*.go"):
            changed = self.raw.replace("      - '" + path + "'\n", "", 1)
            with self.subTest(path=path), self.assertRaises(AssertionError):
                assert_contract(changed, self.recipe)
        for path in (COLLECTOR_TEST, CONTROL):
            command = "          python3 -B -m unittest discover -s scripts/ops -p '" + Path(path).name + "' -v\n"
            for replacement in ("", command * 2):
                with self.assertRaises(AssertionError):
                    assert_contract(self.raw.replace(command, replacement), self.recipe)

    def test_budget_admission_and_public_evidence_cannot_drift(self):
        body, upload = step(self.raw, STEP), step(self.raw, UPLOAD)
        replacements = [(body, body.replace(NORMAL_IF, "${{ false }}")),
                        (body, body.replace("timeout-minutes: 4", "timeout-minutes: 5")),
                        (body, body.replace("        run: |", "        continue-on-error: true\n        run: |")),
                        (COMMAND, COMMAND.replace("205s", "210s")),
                        (COMMAND, COMMAND.replace("--kill-after=5s", "--kill-after=15s")),
                        (COMMAND, ""), (COMMAND, COMMAND * 2), (COMMAND, COMMAND.rstrip() + " || true\n"),
                        (upload, upload.replace(" || steps.committedaccountwire.outcome == 'failure'", "")),
                        (upload, upload.replace("if-no-files-found: error", "if-no-files-found: warn")),
                        (upload, upload.replace("/STDERR", "/**"))]
        for old, new in replacements:
            with self.subTest(replacement=new), self.assertRaises(AssertionError):
                assert_contract(self.raw.replace(old, new, 1), self.recipe)

    def test_recipe_cannot_weaken_the_original_three_top_checks(self):
        for old, new in ((SELECTOR, "^TestPQCommittedAccountWire"), (SELECTOR, "^" + REQUIRED[0] + "$"),
                         ("-timeout=120s", "-timeout=180s"), ("-p 1", "-p 2"), ("-tags=ynx_public_trace_testsupport", ""),
                         ("$YNX_ACCOUNT_WIRE_ROOT/" + TRACE, "$RUNNER_TEMP/trace"),
                         (" exit 1\nfi", " exit 0\nfi"), ("export YNX_PQ_NETWORK_E2E=''", "export YNX_PQ_NETWORK_E2E=authorized"),
                         ('2> "$YNX_ACCOUNT_WIRE_EVIDENCE/STDERR"', "2>&1")):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe.replace(old, new, 1))

    def test_original_sdk_consumer_and_pin_preflight_cannot_be_bypassed(self):
        for old, new in (('python3 -B ' + COLLECTOR_TEST, 'true'),
                         (SDK + '/data_check.cpp', '/tmp/other-data.cpp'),
                         ('-std=c++17 -Wall -Wextra -Werror', '-std=c++17'),
                         ('export YNX_ACCOUNT_PROOF_SDK_DATA_DRIVER=', 'export OTHER_DRIVER=')):
            with self.subTest(old=old), self.assertRaises(AssertionError):
                assert_contract(self.raw, self.recipe.replace(old, new, 1))

    def test_nested_fail_skip_and_duplicate_test_or_package_are_rejected(self):
        for name in REQUIRED:
            for action in ("fail", "skip", "build-fail", "unknown"):
                with self.subTest(name=name, action=action), self.assertRaises(ValueError):
                    collector.qualify(rows() + [dict(Package=PACKAGE, Action=action, Test=name + "/nested")])
            for action in ("run", "pass"):
                with self.assertRaises(ValueError):
                    collector.qualify(rows() + [dict(Package=PACKAGE, Action=action, Test=name)])
        for bad in (rows()[:-1], rows() + [rows()[-1]], [e for e in rows() if e.get("Test") != REQUIRED[1]]):
            with self.assertRaises(ValueError):
                collector.qualify(bad)

    def test_actual_collector_cli_is_public_only_and_exclusive(self):
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
            self.assertTrue(value["suitePassed"])
            for flag in account_ci.FALSE_FLAGS:
                self.assertIs(value[flag], False)
            second = subprocess.run(argv, env=environment, capture_output=True, timeout=10)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(result.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
