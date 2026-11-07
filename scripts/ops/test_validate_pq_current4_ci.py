"""Pure controls for the actual bounded Current4 CI call and JSONL collector.

Synthetic Go event rows exercise the real workflow Python. They are not Go,
Node.Start, signed trace generation, Current4 execution or Source qualification.
"""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import textwrap
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/resource-market-ci.yml"
CONTROL = "scripts/ops/test_validate_pq_current4_ci.py"
CONTROL_COMMAND = "          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_current4_ci.py' -v\n"
STEP = "Verify Current4 original registered observer wire without granting authority"
NORMAL_IF = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}"
PACKAGE = "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
TRACE = "scripts/loadtest/fixtures/finalize-1b-public"
OUTPUT = "ynx-current4-wire-tests.jsonl"
MARKER = "YNX_CURRENT4_WIRE_TESTS"
REQUIRED = [
    "TestPQCurrent4WirePUBLICStrictFramesAndOSPeer",
    "TestPQCurrent4WirePUBLICRegisteredObserverData",
    "TestPQCurrent4WirePUBLICSingleFlightUnknownAndPartialDrain",
]
SELECTOR = "^(" + "|".join(REQUIRED) + ")$"
COMMAND = ('          if ! YNX_PQ_NETWORK_E2E=\'\' YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$GITHUB_WORKSPACE/' + TRACE
           + '" go test -tags=ynx_public_trace_testsupport -json -p 1 -count=1 -timeout=120s -run '
           + "'" + SELECTOR + "' ./internal/consensus > \"$RUNNER_TEMP/" + OUTPUT + '\"; then\n')
ORIGINAL_SKIP = "^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$|TestProduction|TestPQLab)"
SKIP = ORIGINAL_SKIP[:-1] + "|" + REQUIRED[0] + "$)"
FULL_COMMAND = ("          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -skip '"
                + SKIP + "' ./internal/consensus > \"$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl\"; then\n")
OLD_COMMANDS = [
    "          if ! go test -json -p 1 -count=1 -timeout=180s -run '^(TestConsensusMigration|TestConsensusSponsor|TestPQHistoryMathCache)' ./internal/chain > \"$RUNNER_TEMP/ynx-native-history-chain-tests.jsonl\"; then\n",
    FULL_COMMAND,
    "          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -run '^TestProduction' ./internal/consensus > \"$RUNNER_TEMP/ynx-production-operator-state-tests.jsonl\"; then\n",
    "          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -run '^TestPQLab' -skip '^TestPQLabLiveMaterialsCacheBoundOriginalSetupRequestResult$' ./internal/consensus > \"$RUNNER_TEMP/ynx-lab-state-tests.jsonl\"; then\n",
    "          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -run '^TestPQLabLiveMaterialsCacheBoundOriginalSetupRequestResult$' ./internal/consensus > \"$RUNNER_TEMP/ynx-lab-large-source-tests.jsonl\"; then\n",
]
FALSE_FLAGS = ("sourceQualified", "sourceGrant", "nativeGrant", "independentFinalityVerified",
               "producerCurrentClock", "p09CallerConnected", "nodeStarted")


def step(raw, name):
    jobs = re.findall(r"(?ms)^  focused-go:\n(.*?)(?=^  [a-zA-Z][a-zA-Z0-9_-]*:\n|\Z)", raw)
    if len(jobs) != 1:
        raise AssertionError("one original focused-go job required")
    found = re.findall(r"(?ms)^      - name: " + re.escape(name) + r"\n(.*?)(?=^      - |\Z)", jobs[0])
    if len(found) != 1:
        raise AssertionError("one original step required: " + name)
    return found[0]


def collector(raw):
    programs = re.findall(r"(?ms)^          python3 -B - <<'PY'\n(.*?)^          PY\n", step(raw, STEP))
    found = [textwrap.dedent(program) for program in programs if MARKER in program]
    if len(found) != 1:
        raise AssertionError("one actual Current4 collector required")
    return found[0]


def assert_contract(raw):
    for event in ("push", "pull_request"):
        blocks = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
        if len(blocks) != 1:
            raise AssertionError("one original trigger required")
        source = "internal/consensus/**" if event == "push" else "internal/consensus/pq_current4_*.go"
        for path in (CONTROL, TRACE + "/**", source):
            if blocks[0].count("      - '" + path + "'\n") != 1:
                raise AssertionError("Current4 source/fixture/control must trigger normal CI")
        if event == "pull_request" and blocks[0].count("      - 'internal/consensus/pq_wallet_policy_live.go'\n") != 1:
            raise AssertionError("Current4 actual owning live source must trigger normal CI")
    controls = step(raw, "Verify Linux window controls without starting a node")
    if raw.count(CONTROL_COMMAND) != 1 or controls.count(CONTROL_COMMAND) != 1:
        raise AssertionError("pure controls must execute exactly once")
    if "        if: ${{ !cancelled() && steps.identity.outcome == 'success' }}\n" not in controls:
        raise AssertionError("original pure controls admission changed")
    body = step(raw, STEP)
    if re.findall(r"(?m)^        if: (.*)$", body) != [NORMAL_IF] or "        timeout-minutes: 3\n" not in body:
        raise AssertionError("normal-only bounded Current4 step required")
    if "continue-on-error:" in body or "|| true" in body:
        raise AssertionError("Current4 errors cannot be ignored")
    if body.count(COMMAND) != 1 or body.count("go test ") != 1 or raw.count(COMMAND) != 1:
        raise AssertionError("one fixed Current4 tagged 120s call with the original public fixture required")
    if body.count('            cat "$RUNNER_TEMP/' + OUTPUT + '"\n            exit 1\n          fi\n') != 1:
        raise AssertionError("original failed Go output must be retained")
    program = collector(raw)
    assignments = [ast.literal_eval(node.value) for node in ast.parse(program).body
                   if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "current4_required" for target in node.targets)]
    if assignments != [REQUIRED] or PACKAGE not in program or OUTPUT not in program:
        raise AssertionError("all three original Current4 tests and original package/output required")
    original = step(raw, "Verify complete state bridge and sponsor continuity")
    commands = re.findall(r"(?m)^          if ! .*go test .+\n", original)
    if commands != OLD_COMMANDS or "-tags=" in original:
        raise AssertionError("original full union and every 180s budget must remain; only exact new Strict is moved")
    for name in ("ynx-production-operator-state-tests.jsonl", "ynx-lab-state-tests.jsonl", "ynx-lab-large-source-tests.jsonl"):
        if original.count('          cat "$RUNNER_TEMP/' + name + '" >> "$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl"\n') != 1:
            raise AssertionError("original state streams must remain fully merged")
    if OUTPUT in original or (">>" in body and "ynx-initial-cache-state-tests.jsonl" in body):
        raise AssertionError("new qualification must not duplicate original stream terminals")


def rows():
    events = [{"Action": action, "Package": PACKAGE, "Test": name}
              for name in REQUIRED for action in ("run", "pass")]
    return events + [{"Action": "pass", "Package": PACKAGE}]


def execute(raw, events=None, text=None):
    with tempfile.TemporaryDirectory(prefix="pq-current4-ci-") as directory:
        (Path(directory) / OUTPUT).write_text(text if text is not None else "".join(json.dumps(row) + "\n" for row in events))
        output = io.StringIO()
        with patch.dict(os.environ, RUNNER_TEMP=directory, GITHUB_SHA="1" * 40), contextlib.redirect_stdout(output):
            exec(compile(collector(raw), "actual-current4-ci-collector", "exec"), {})
    records = [json.loads(line[len(MARKER) + 1:]) for line in output.getvalue().splitlines() if line.startswith(MARKER + " ")]
    if len(records) != 1:
        raise AssertionError("one actual DATA receipt required")
    return records[0]


class Current4CIControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = WORKFLOW.read_text(encoding="utf-8")

    def test_normal_tagged_module_and_original_complete_union(self):
        assert_contract(self.raw)
        examples = REQUIRED + ["TestPQCurrent4WirePUBLICStrictFramesAndOSPeerExtra", "TestPQWalletPolicyLiveOriginalNodeCommittedAndPending", "TestABCIOriginal", "TestProofHostOriginal", "TestProductionOriginal", "TestPQLabOriginal"]
        for name in examples:
            with self.subTest(name=name):
                self.assertEqual(bool(re.search(SKIP, name)), bool(re.search(ORIGINAL_SKIP, name)) or name == REQUIRED[0])
                self.assertEqual(bool(re.search(SELECTOR, name)), name in REQUIRED)

    def test_actual_successful_collector_emits_only_data(self):
        events = rows()
        events[1:1] = [{"Action": action, "Package": PACKAGE, "Test": REQUIRED[0] + "/valid-peer"} for action in ("run", "pass")]
        result = execute(self.raw, events)
        self.assertEqual(result["requiredPassed"], REQUIRED)
        self.assertEqual(result["sourceCommit"], "1" * 40)
        self.assertIs(result["suitePassed"], True)
        for flag in FALSE_FLAGS:
            self.assertIs(result[flag], False)

    def test_missing_duplicate_foreign_or_unexecuted_top_is_rejected(self):
        good = rows()
        for name in REQUIRED:
            bad = [[], [row for row in good if row.get("Test") != name],
                   [row for row in good if not (row.get("Test") == name and row["Action"] == "run")],
                   [row for row in good if not (row.get("Test") == name and row["Action"] == "pass")],
                   good + [{"Action": "run", "Package": PACKAGE, "Test": name}],
                   good + [{"Action": "pass", "Package": PACKAGE, "Test": name}],
                   [dict(row, Package="other/package") if row.get("Test") == name else row for row in good]]
            for events in bad:
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    execute(self.raw, events)

    def test_every_nested_skip_failure_and_unknown_stream_action_is_rejected(self):
        for name in REQUIRED:
            for action in ("skip", "fail", "build-fail", "unknown-action"):
                for suffix in ("", "/nested/actual-child"):
                    event = {"Action": action, "Package": PACKAGE, "Test": name + suffix}
                    with self.subTest(name=name, action=action, suffix=suffix), self.assertRaises(RuntimeError):
                        execute(self.raw, rows() + [event])
        for event in ({"Action": "pass", "Package": "other/package"}, {"Action": "pass", "Package": PACKAGE, "Test": "TestDifferentModule"}):
            with self.assertRaises(RuntimeError):
                execute(self.raw, rows() + [event])

    def test_package_must_have_exactly_one_successful_terminal(self):
        for events in (rows()[:-1], rows() + [rows()[-1]], rows() + [{"Action": "fail", "Package": PACKAGE}], rows() + [{"Action": "skip", "Package": PACKAGE}]):
            with self.assertRaises(RuntimeError):
                execute(self.raw, events)

    def test_malformed_or_partial_jsonl_cannot_qualify(self):
        for text in ("", "null\n", "[]\n", "{}\n", "{", "[]\n{}", "not-json"):
            with self.subTest(text=text), self.assertRaises((RuntimeError, ValueError, TypeError)):
                execute(self.raw, text=text)

    def test_source_mutations_cannot_disable_or_expand_the_module(self):
        body = step(self.raw, STEP)
        mutations = [self.raw.replace(COMMAND, "", 1), self.raw.replace(COMMAND, COMMAND * 2, 1),
                     self.raw.replace(COMMAND, COMMAND.replace("-timeout=120s", "-timeout=180s"), 1),
                     self.raw.replace(COMMAND, COMMAND.replace("-tags=ynx_public_trace_testsupport ", ""), 1),
                     self.raw.replace(COMMAND, COMMAND.replace(TRACE, "untrusted-other-input"), 1),
                     self.raw.replace(COMMAND, COMMAND.replace("$GITHUB_WORKSPACE", "$RUNNER_TEMP"), 1),
                     self.raw.replace(COMMAND, COMMAND.replace("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE=", "OTHER_ENV="), 1),
                     self.raw.replace(COMMAND, COMMAND.replace(SELECTOR, "^TestPQCurrent4"), 1),
                     self.raw.replace(body, body.replace(NORMAL_IF, "${{ false }}"), 1),
                     self.raw.replace(body, body.replace("            exit 1\n", "            true\n"), 1),
                     self.raw.replace(body, body.replace("        run: |", "        continue-on-error: true\n        run: |"), 1),
                     self.raw.replace("current4_required = " + repr(REQUIRED), "current4_required = " + repr(REQUIRED[:-1]), 1)]
        for raw in mutations:
            self.assertNotEqual(raw, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(raw)

    def test_original_union_and_source_triggers_cannot_drift(self):
        mutations = [self.raw.replace(FULL_COMMAND, FULL_COMMAND.replace(SKIP, ORIGINAL_SKIP), 1),
                     self.raw.replace(FULL_COMMAND, FULL_COMMAND.replace(REQUIRED[0] + "$", "TestPQCurrent4"), 1),
                     self.raw.replace(FULL_COMMAND, FULL_COMMAND.replace("-timeout=180s", "-timeout=240s"), 1),
                     self.raw.replace(FULL_COMMAND, FULL_COMMAND.replace("go test ", "go test -tags=ynx_public_trace_testsupport "), 1),
                     self.raw.replace(OLD_COMMANDS[2], "", 1),
                     self.raw.replace(CONTROL_COMMAND, "", 1),
                     self.raw.replace(CONTROL_COMMAND, CONTROL_COMMAND * 2, 1)]
        for path in (CONTROL, TRACE + "/**", "internal/consensus/pq_current4_*.go", "internal/consensus/pq_wallet_policy_live.go"):
            mutations.append(self.raw.replace("      - '" + path + "'\n", "", 1))
        for raw in mutations:
            self.assertNotEqual(raw, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(raw)


if __name__ == "__main__":
    unittest.main()
