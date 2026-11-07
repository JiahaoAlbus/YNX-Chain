"""Exercise actual CI collectors with synthetic JSONL; never run Go or a node.

The backend and consumer tests still execute in their normal Go packages. These
controls only ensure that missing, skipped, duplicated or foreign results cannot
qualify them, and that their DATA receipts do not claim Source or live authority.
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


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/resource-market-ci.yml"
NORMAL_IF = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}"
MODULE = "github.com/JiahaoAlbus/YNX-Chain/"
SPECS = {
    "consumer": (
        "Verify wallet policy checkpoint consumer without granting authority",
        "internal/ynxresourcepolicy", "ynx-wallet-policy-consumer-tests.jsonl",
        "YNX_WALLET_POLICY_CONSUMER_TESTS", "required", [
            "TestResourcePolicyPUBLICOriginalLedgerConsumer",
            "TestResourcePolicyPUBLICReaderRejectionAndNoAuthority",
        ]),
    "reader": (
        "Verify complete state bridge and sponsor continuity",
        "internal/consensus", "ynx-initial-cache-state-tests.jsonl",
        "YNX_WALLET_POLICY_READER_TESTS", "wallet_policy_required", [
            "TestPQWalletPolicyCheckpointRegisteredHistoryAcrossLayouts",
            "TestPQWalletPolicyCheckpointRefusesWrongAnchorAndAuthority",
            "TestPQWalletPolicyCheckpointHeldSourceChangeAndClose",
            "TestPQWalletPolicyCheckpointRuntimeAndSchedulePins",
        ]),
    "cli": (
        "Compile production entry points",
        "cmd/ynx-comet", "ynx-production-entrypoint-tests.jsonl",
        "YNX_WALLET_POLICY_CLI_TESTS", "required", [
            "TestInspectWalletPolicyNormalOriginalCheckpointAndRefusals",
            "TestInspectWalletPolicyNoRegistrationAndArgumentsFailClosed",
        ]),
}
COMMAND_PACKAGES = (
    "cmd/ynx-abci", "cmd/ynx-comet", "cmd/ynx-consensus-keycheck",
    "cmd/ynx-consensus-pq-key-init", "cmd/ynx-consensus-pq-remote-signer",
    "cmd/ynx-consensus-proof-verify",
)
CONSUMER_COMMAND = '          if ! go test -json -p 1 -count=1 -timeout=180s ./internal/ynxresourcepolicy > "$RUNNER_TEMP/ynx-wallet-policy-consumer-tests.jsonl"; then\n'
CLI_COMMAND = ('          if ! go test -json -p 1 -count=1 -timeout=90s '
               + ' '.join('./' + package for package in COMMAND_PACKAGES)
               + ' > "$RUNNER_TEMP/ynx-production-entrypoint-tests.jsonl"; then\n')
CONTROL_COMMAND = "          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_wallet_policy_ci.py' -v\n"


def focused_steps(raw):
    jobs = re.findall(r"(?ms)^  focused-go:\n(.*?)(?=^  [a-zA-Z][a-zA-Z0-9_-]*:\n|\Z)", raw)
    if len(jobs) != 1:
        raise AssertionError("one original focused-go job required")
    return re.split(r"(?m)(?=^      - (?:name|uses):)", jobs[0])[1:]


def step_named(raw, name):
    matches = [step for step in focused_steps(raw)
               if step.startswith("      - name: " + name + "\n")]
    if len(matches) != 1:
        raise AssertionError("one original step required: " + name)
    return matches[0]


def collector(raw, kind):
    step = step_named(raw, SPECS[kind][0])
    programs = re.findall(r"(?ms)^          python3 -B - <<'PY'\n(.*?)^          PY\n", step)
    selected = [textwrap.dedent(program) for program in programs if SPECS[kind][3] in program]
    if len(selected) != 1:
        raise AssertionError("one actual collector required: " + kind)
    return selected[0]


def literal_list(program, name):
    values = None
    for node in ast.parse(program).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id == name:
                if values is not None:
                    raise AssertionError("duplicate required-list assignment")
                values = ast.literal_eval(node.value)
        if isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            if values is None or not isinstance(node.op, ast.Add):
                raise AssertionError("invalid required-list extension")
            values += ast.literal_eval(node.value)
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise AssertionError("literal test names required")
    return values


def assert_contract(raw):
    for event in ("push", "pull_request"):
        blocks = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
        if len(blocks) != 1:
            raise AssertionError("one trigger required")
        for path in ("internal/ynxresourcepolicy/**", "scripts/ops/test_validate_pq_wallet_policy_ci.py"):
            if blocks[0].count("      - '" + path + "'\n") != 1:
                raise AssertionError("normal source trigger missing: " + path)
    controls = step_named(raw, "Verify Linux window controls without starting a node")
    if raw.count(CONTROL_COMMAND) != 1 or controls.count(CONTROL_COMMAND) != 1:
        raise AssertionError("new pure controls must execute once")
    if "if: ${{ !cancelled() && steps.identity.outcome == 'success' }}\n" not in controls:
        raise AssertionError("original controls admission changed")
    for kind, spec in SPECS.items():
        step = step_named(raw, spec[0])
        if re.findall(r"(?m)^        if: (.*)$", step) != [NORMAL_IF]:
            raise AssertionError("normal-only qualification condition changed")
        if "continue-on-error:" in step or "|| true" in step:
            raise AssertionError("test failures must remain terminal")
        program = collector(raw, kind)
        if literal_list(program, spec[4]) != spec[5]:
            raise AssertionError("exact required test names changed")
        if MODULE + spec[1] not in program or spec[2] not in program:
            raise AssertionError("collector must use original package and output")
    consumer = step_named(raw, SPECS["consumer"][0])
    cli = step_named(raw, SPECS["cli"][0])
    if consumer.count(CONSUMER_COMMAND) != 1 or consumer.count("go test ") != 1:
        raise AssertionError("consumer must run its complete package once, without filtering")
    if cli.count(CLI_COMMAND) != 1 or cli.count("go test ") != 5:
        raise AssertionError("all original command packages and invocations must remain")
    for command in (
        "go test -p 1 -count=1 -timeout=90s -run '^$' ./cmd/ynx-chaind ./internal/consensus",
        "go test -p 1 -count=1 -timeout=90s -run '^TestCommittedPQSource' ./internal/consensus",
        "go vet ./internal/consensus",
        "go test -p 1 -count=1 -timeout=90s -run '^(TestExportConsensusState|TestRunNodeConsensusExport|TestConsensusExport)' ./cmd/ynx-chaind",
        "go test -p 1 -count=1 -timeout=90s ./cmd/ynx-consensus-package",
    ):
        if cli.count("          " + command + "\n") != 1:
            raise AssertionError("original command invocation removed")
    for step, filename in ((consumer, SPECS["consumer"][2]), (cli, SPECS["cli"][2])):
        refusal = '            cat "$RUNNER_TEMP/' + filename + '"\n            exit 1\n          fi\n'
        if step.count(refusal) != 1:
            raise AssertionError("original Go failure must print evidence and exit")
    reader = step_named(raw, SPECS["reader"][0])
    commands = re.findall(r"(?m)^          if ! .*go test .+$", reader)
    if len(commands) != 5 or sum('./internal/consensus > ' in line for line in commands) != 4:
        raise AssertionError("reader qualification must reuse the original complete execution")
    # No second focused Go run for any of the eight new cases.
    if re.search(r"go test[^\n]*-(?:run|skip)[^\n]*(?:WalletPolicy|ResourcePolicy)", raw):
        raise AssertionError("new cases must not replace or repeat complete suites")


class WalletPolicyCIControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = WORKFLOW.read_text(encoding="utf-8")

    def rows(self, kind):
        spec = SPECS[kind]
        package = MODULE + spec[1]
        program = collector(self.raw, kind)
        names = literal_list(program, "required")
        if spec[4] != "required":
            names += literal_list(program, spec[4])
        events = []
        for name in names:
            events += [dict(Action="run", Package=package, Test=name),
                       dict(Action="pass", Package=package, Test=name)]
        packages = [MODULE + p for p in COMMAND_PACKAGES] if kind == "cli" else [package]
        if kind == "reader":
            packages *= 4  # Four original bounded processes, not one new run.
        events += [dict(Action="pass", Package=p) for p in packages]
        return events

    def execute(self, kind, events=None, raw_json=None):
        spec = SPECS[kind]
        program = collector(self.raw, kind)
        with tempfile.TemporaryDirectory(prefix="pq-wallet-policy-ci-") as directory:
            path = Path(directory) / spec[2]
            path.write_text(raw_json if raw_json is not None else '\n'.join(json.dumps(row) for row in events), encoding="utf-8")
            output = io.StringIO()
            with patch.dict(os.environ, RUNNER_TEMP=directory, GITHUB_SHA="a" * 40), contextlib.redirect_stdout(output):
                exec(compile(program, "actual-workflow-" + kind, "exec"), {})
            receipts = [json.loads(line[len(spec[3]) + 1:]) for line in output.getvalue().splitlines()
                        if line.startswith(spec[3] + ' ')]
        self.assertEqual(len(receipts), 1)
        return receipts[0]

    def test_normal_source_paths_full_packages_and_unique_controls(self):
        assert_contract(self.raw)

    def test_original_execution_qualifies_only_data(self):
        for kind, spec in SPECS.items():
            with self.subTest(kind=kind):
                receipt = self.execute(kind, self.rows(kind))
                self.assertEqual(receipt["requiredPassed"], spec[5])
                self.assertEqual(receipt["sourceCommit"], "a" * 40)
                self.assertIs(receipt["suitePassed"], True)
                for field in ("sourceQualified", "liveCurrentVerified", "independentFinalityVerified", "nativeGrant"):
                    self.assertIs(receipt[field], False)

    def test_zero_missing_duplicate_foreign_and_unexecuted_cases_refused(self):
        for kind, spec in SPECS.items():
            good = self.rows(kind)
            name = spec[5][0]
            bad_cases = {
                "zero": [],
                "missing": [row for row in good if row.get("Test") != name],
                "no-run": [row for row in good if not (row.get("Test") == name and row["Action"] == "run")],
                "duplicate-pass": good + [dict(Action="pass", Package=MODULE + spec[1], Test=name)],
                "duplicate-run": good + [dict(Action="run", Package=MODULE + spec[1], Test=name)],
                "foreign": [dict(row, Package=MODULE + "wrong") if row.get("Test") == name else row for row in good],
                "foreign-extra": good + [dict(Action="pass", Package=MODULE + "wrong", Test=name)],
            }
            for reason, events in bad_cases.items():
                with self.subTest(kind=kind, reason=reason), self.assertRaises((RuntimeError, AssertionError)):
                    self.execute(kind, events)

    def test_failed_skipped_subcase_and_build_failure_cannot_hide_behind_pass(self):
        for kind, spec in SPECS.items():
            for action in ("fail", "skip", "build-fail"):
                for suffix in ("", "/original-ledger"):
                    row = dict(Action=action, Package=MODULE + spec[1], Test=spec[5][0] + suffix)
                    with self.subTest(kind=kind, action=action, suffix=suffix), self.assertRaises((RuntimeError, AssertionError)):
                        self.execute(kind, self.rows(kind) + [row])

    def test_package_terminal_is_required_and_failures_are_retained(self):
        for kind, spec in SPECS.items():
            good = self.rows(kind)
            package = MODULE + spec[1]
            no_package = [row for row in good if "Test" in row or row["Package"] != package]
            cases = [no_package, good + [dict(Action="fail", Package=package)],
                     good + [dict(Action="skip", Package=package)],
                     good + [dict(Action="build-fail", Package="other/build-dependency")]]
            if kind != "reader":
                cases += [good + [dict(Action="pass", Package=package)]]
            for index, events in enumerate(cases):
                with self.subTest(kind=kind, index=index), self.assertRaises((RuntimeError, AssertionError)):
                    self.execute(kind, events)

    def test_full_consumer_stream_rejects_unlisted_skips_and_foreign_package(self):
        for action in ("skip", "fail"):
            row = dict(Action=action, Package=MODULE + SPECS["consumer"][1], Test="TestFutureCase")
            with self.subTest(action=action), self.assertRaises(RuntimeError):
                self.execute("consumer", self.rows("consumer") + [row])
        with self.assertRaises(RuntimeError):
            self.execute("consumer", self.rows("consumer") + [dict(Action="pass", Package="foreign")])

    def test_original_optin_skips_do_not_qualify_or_disable_reader_checks(self):
        for kind, name in (("reader", "TestPQNetworkOptInOriginal"), ("cli", "TestOriginalOptIn")):
            row = dict(Action="skip", Package=MODULE + SPECS[kind][1], Test=name)
            receipt = self.execute(kind, self.rows(kind) + [row])
            self.assertEqual(receipt["requiredPassed"], SPECS[kind][5])

    def test_malformed_or_empty_jsonl_is_not_success(self):
        for kind in SPECS:
            for raw in ("", "{}\nnot-json", "[]", "null"):
                with self.subTest(kind=kind, raw=raw), self.assertRaises((ValueError, TypeError, AttributeError, RuntimeError, AssertionError, KeyError)):
                    self.execute(kind, raw_json=raw)

    def test_source_mutations_cannot_remove_execution_or_restore_skip(self):
        mutations = [
            self.raw.replace("      - 'internal/ynxresourcepolicy/**'\n", "", 1),
            self.raw.replace("      - 'scripts/ops/test_validate_pq_wallet_policy_ci.py'\n", "", 1),
            self.raw.replace(CONTROL_COMMAND, "", 1),
            self.raw.replace(CONTROL_COMMAND, CONTROL_COMMAND * 2, 1),
            self.raw.replace(CONSUMER_COMMAND, CONSUMER_COMMAND.replace("./internal/ynxresourcepolicy", "-run '^$' ./internal/ynxresourcepolicy"), 1),
            self.raw.replace(CONSUMER_COMMAND, CONSUMER_COMMAND.replace("./internal/ynxresourcepolicy", "-skip '^TestResourcePolicy' ./internal/ynxresourcepolicy"), 1),
            self.raw.replace(CLI_COMMAND, CLI_COMMAND.replace(" ./cmd/ynx-abci", ""), 1),
            self.raw.replace(SPECS["consumer"][5][0], "TestNotTheOriginalConsumer", 1),
            self.raw.replace(SPECS["reader"][5][0], "TestNotTheOriginalReader", 1),
            self.raw.replace(SPECS["cli"][5][0], "TestNotTheOriginalCLI", 1),
        ]
        step = step_named(self.raw, SPECS["consumer"][0])
        mutations += [self.raw.replace(step, step.replace(NORMAL_IF, "${{ false }}"), 1),
                      self.raw.replace(step, step + step, 1),
                      self.raw.replace(step, step.replace("            exit 1\n", "            true\n"), 1),
                      self.raw.replace(step, step.replace("        run: |", "        continue-on-error: true\n        run: |"), 1)]
        for index, raw in enumerate(mutations):
            self.assertNotEqual(raw, self.raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_contract(raw)


if __name__ == "__main__":
    unittest.main()
