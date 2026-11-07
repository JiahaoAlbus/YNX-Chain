"""Exercise the real observer CI collectors with PUBLIC synthetic JSONL only.

No Go, key generation, Node.Start, transport or package installation runs here.
The original six Go cases retain their normal full streams and fixed fork group.
Five account cases join only the existing tagged PUBLIC Current4 invocation.
"""
import ast
import contextlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import textwrap
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "scripts/ops/test_validate_pq_observer_ci.py"
CONTROL_COMMAND = "          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_observer_ci.py' -v\n"
NORMAL_IF = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}"
CORE = "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
CLI = "github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-comet"
NODE = "github.com/cometbft/cometbft/node"
RPC = "github.com/cometbft/cometbft/rpc/core"
REQUIRED = {
    "CORE": [(CORE, "TestPQObserverPUBLICConstructorAllLayoutsNoValidator"),
             (CORE, "TestPQObserverPUBLICRejectsSignerAndUnboundState")],
    "CLI": [(CLI, "TestObserverCLIPUBLICRealConstructorWithoutStart"),
            (CLI, "TestObserverCLIPUBLICRejectsSignerFlagsAndManagedEscape")],
    "FORK": [(NODE, "TestObserverNodePUBLICExplicitRoleRefusesMissingAuthorityAndRemoteSigner"),
             (RPC, "TestObserverStatusPUBLICNoValidatorKeyRequiresNoMembershipLookup")],
}
FILES = {"CORE": "ynx-initial-cache-state-tests.jsonl", "CLI": "ynx-production-entrypoint-tests.jsonl", "FORK": "ynx-pq-observer-fork-tests.jsonl"}
FORK_SELECTOR = "^(" + "|".join(name for _, name in REQUIRED["FORK"]) + ")$"
FORK_COMMAND = ('          if ! go test -mod=readonly -modfile="$RUNNER_TEMP/wire-observer-test.mod" -json -p 1 -count=1 -timeout=90s -run '
                + "'" + FORK_SELECTOR + "' " + NODE + " " + RPC + ' > "$RUNNER_TEMP/ynx-pq-observer-fork-tests.jsonl"; then\n')
FULL_CLI = '          if ! go test -json -p 1 -count=1 -timeout=90s ./cmd/ynx-abci ./cmd/ynx-comet ./cmd/ynx-consensus-keycheck ./cmd/ynx-consensus-pq-key-init ./cmd/ynx-consensus-pq-remote-signer ./cmd/ynx-consensus-proof-verify > "$RUNNER_TEMP/ynx-production-entrypoint-tests.jsonl"; then\n'
FULL_CORE = '          if ! YNX_PQ_NETWORK_E2E=\'\' go test -json -p 1 -count=1 -timeout=180s -skip \'^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$|TestProduction|TestPQLab|TestPQCurrent4WirePUBLICStrictFramesAndOSPeer$|TestPQLightProof|TestPQTransactionProof|TestPQConsensus(Light|Transaction|MigrationTransaction)ProofPublicFixture$|TestPQWalletPolicy)\' ./internal/consensus > "$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl"; then\n'


def workflows():
    return {name: (ROOT / (".github/workflows/" + filename)).read_text()
            for name, filename in (("chain", "chain-core.yml"), ("resource", "resource-market-ci.yml"))}


def step(raw, name):
    found = re.findall(r"(?ms)^      - name: " + re.escape(name) + r"\n(.*?)(?=^      - |\Z)", raw)
    if len(found) != 1:
        raise AssertionError("one original observer step required: " + name)
    return found[0]


def programs(raw):
    return [textwrap.dedent(program) for program in re.findall(r"(?ms)^          python3 -B - <<'PY'\n(.*?)^          PY\n", raw)]


def collector(raw, kind):
    marker = "YNX_PQ_OBSERVER_" + kind + "_TESTS"
    found = [program for program in programs(raw) if marker in program]
    if len(found) != 1:
        raise AssertionError("one actual collector required: " + marker)
    return found[0]


def setup(raw):
    found = [program for program in programs(raw) if "module, sums = root / 'wire-observer-test.mod'" in program]
    if len(found) != 1:
        raise AssertionError("one original test-only module preparation required")
    return found[0]


def assert_contract(raws):
    for name, raw in raws.items():
        if raw.count(CONTROL_COMMAND) != 1 or raw.count(FORK_COMMAND) != 1:
            raise AssertionError("normal controls and bounded fork group must execute once")
        if "git diff --exit-code -- go.mod go.sum" not in raw:
            raise AssertionError("original production descriptors must stay unchanged")
        for event in ("push", "pull_request"):
            block = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
            if len(block) != 1 or len(re.findall(r"^      - ['\"]" + re.escape(CONTROL) + r"['\"]$", block[0], re.M)) != 1:
                raise AssertionError("missing normal control trigger")
        for kind in ("FORK",) if name == "chain" else REQUIRED:
            program = collector(raw, kind)
            values = [ast.literal_eval(node.value) for node in ast.parse(program).body
                      if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "observer_required" for target in node.targets)]
            if values != [REQUIRED[kind]] or FILES[kind] not in program:
                raise AssertionError("collector required package/test identity or original stream changed")
    proof_state_command = '          if ! YNX_PQ_NETWORK_E2E=\'\' go test -json -p 1 -count=1 -timeout=180s -run \'^(TestPQLightProof|TestPQTransactionProof|TestPQConsensus(Light|Transaction|MigrationTransaction)ProofPublicFixture$|TestPQWalletPolicy)\' ./internal/consensus > "$RUNNER_TEMP/ynx-proof-wallet-state-tests.jsonl"; then\n'
    if raws["resource"].count(FULL_CORE) != 1 or raws["resource"].count(FULL_CLI) != 1 or raws["resource"].count(proof_state_command) != 1:
        raise AssertionError("reuse complete original Core and CLI executions")
    role_step = step(raws["resource"], "Verify explicit ordinary observer fork role without starting a node")
    if "        if: " + NORMAL_IF + "\n" not in role_step or "set -euo pipefail" not in role_step:
        raise AssertionError("original focused source admission and failure handling must remain")
    if "CGO_ENABLED: '0'" not in role_step or "GOMEMLIMIT: 1536MiB" not in role_step:
        raise AssertionError("original bounded build environment changed")
    original = setup(raws["chain"])
    if original != setup(raws["resource"]):
        raise AssertionError("one same original test module recipe required")
    for fragment in ("for src, dst in [('go.mod', module), ('go.sum', sums)]", "with dst.open('xb')", "'-require=github.com/stretchr/objx@v0.5.2'", "Path('third_party/cometbft/go.sum')", "if len(lines) != 2", "with sums.open('a')"):
        if fragment not in original:
            raise AssertionError("fixed objx test dependency contract changed")
    if "            " + CONTROL + " \\\n" not in raws["chain"]:
        raise AssertionError("pure control changes must select the original client-observation job")


def good_events(kind):
    result = [{"Action": action, "Package": package, "Test": name}
              for package, name in REQUIRED[kind] for action in ("run", "pass")]
    result += [{"Action": "pass", "Package": package} for package in sorted({p for p, _ in REQUIRED[kind]})]
    return result


def execute(program, kind, rows=None, raw=None):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / FILES[kind]
        path.write_text(raw if raw is not None else "".join(json.dumps(row) + "\n" for row in rows))
        out = io.StringIO()
        with patch.dict(os.environ, RUNNER_TEMP=directory, GITHUB_SHA="1" * 40), contextlib.redirect_stdout(out):
            exec(compile(program, "actual-observer-ci-collector", "exec"), {})
        return out.getvalue()


class ObserverCIControls(unittest.TestCase):
    def test_original_normal_wiring_and_all_six_real_source_names(self):
        raw = workflows()
        assert_contract(raw)
        folders = {CORE: "internal/consensus", CLI: "cmd/ynx-comet", NODE: "third_party/cometbft/node", RPC: "third_party/cometbft/rpc/core"}
        for pairs in REQUIRED.values():
            for package, name in pairs:
                count = sum(len(re.findall(r"^func " + name + r"\(t \*testing.T\)", path.read_text(), re.M)) for path in (ROOT / folders[package]).glob("*test.go"))
                self.assertEqual(count, 1, name)

    def test_actual_collectors_require_unique_run_pass_and_return_only_constructor_data(self):
        for workflow, raw in workflows().items():
            for kind in ("FORK",) if workflow == "chain" else REQUIRED:
                with self.subTest(workflow=workflow, kind=kind):
                    output = execute(collector(raw, kind), kind, rows=good_events(kind))
                    result = json.loads(output.split(" ", 1)[1])
                    self.assertEqual(result["requiredPassed"], [list(pair) for pair in REQUIRED[kind]])
                    for flag in ("nodeStarted", "liveSyncVerified", "independentFinalityVerified", "nativeGrant"):
                        self.assertIs(result[flag], False)

    def test_missing_duplicate_and_foreign_runs_or_terminal_never_qualify(self):
        raw = workflows()["resource"]
        for kind in REQUIRED:
            program = collector(raw, kind)
            events = good_events(kind)
            variants = [events[1:], events[:1] + events[2:], events + [events[0]], events + [events[1]],
                        [dict(row, Package="foreign/package") if row.get("Test") == REQUIRED[kind][0][1] else row for row in events]]
            for rows in variants:
                with self.subTest(kind=kind, rows=rows), self.assertRaises(RuntimeError):
                    execute(program, kind, rows=rows)

    def test_child_skip_global_failure_and_package_failure_remain_terminal(self):
        for kind in REQUIRED:
            program = collector(workflows()["resource"], kind)
            package, name = REQUIRED[kind][0]
            for extra in [dict(Action="skip", Package=package, Test=name + "/real-child"),
                          dict(Action="fail", Package=package, Test="UnrelatedOriginalTest"),
                          dict(Action="build-fail", Package=package),
                          dict(Action="fail", Package=package)]:
                with self.subTest(kind=kind, extra=extra), self.assertRaises(RuntimeError):
                    execute(program, kind, rows=good_events(kind) + [extra])
            for action in ("fail", "skip"):
                rows = [dict(row, Action=action) if row.get("Test") == name and row["Action"] == "pass" else row for row in good_events(kind)]
                with self.subTest(kind=kind, action=action), self.assertRaises(RuntimeError):
                    execute(program, kind, rows=rows)

    def test_malformed_empty_and_missing_package_cannot_claim_execution(self):
        for kind in REQUIRED:
            program = collector(workflows()["resource"], kind)
            for body in ("", "not json\n", "{}\n"):
                with self.subTest(kind=kind, body=body), self.assertRaises((RuntimeError, json.JSONDecodeError)):
                    execute(program, kind, raw=body)
            with self.assertRaises(RuntimeError):
                execute(program, kind, rows=[row for row in good_events(kind) if "Test" in row])

    def test_original_unrelated_optin_skip_does_not_stand_in_for_observer(self):
        # Preserve original opt-in test policy; its skip cannot supply a required
        # observer result, and any actual failure still rejects the full stream.
        program = collector(workflows()["resource"], "CORE")
        rows = good_events("CORE") + [dict(Action="skip", Package=CORE, Test="TestPQNetworkOptInOnly")]
        execute(program, "CORE", rows=rows)
        with self.assertRaises(RuntimeError):
            execute(program, "CORE", rows=rows[1:])

    def test_fixed_commands_triggers_and_dependency_pins_cannot_drift(self):
        original = workflows()
        for name in original:
            variants = [original[name].replace(FORK_COMMAND, FORK_COMMAND.replace("-mod=readonly", "-mod=mod")),
                        original[name].replace(CONTROL_COMMAND, ""),
                        original[name].replace("github.com/stretchr/objx@v0.5.2", "github.com/stretchr/objx@latest"),
                        original[name].replace(CONTROL, "not-the-original-control.py", 1)]
            if name == "resource":
                variants += [original[name].replace(FULL_CORE, FULL_CORE.replace("-skip '", "-skip '^TestPQObserver|")),
                             original[name].replace(FULL_CLI, FULL_CLI.replace(" -json ", " -run '^$' -json "))]
            for changed in variants:
                with self.subTest(workflow=name), self.assertRaises(AssertionError):
                    assert_contract(dict(original, **{name: changed}))

    def test_actual_temporary_module_recipe_never_mutates_original_descriptors(self):
        program = setup(workflows()["resource"])
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for folder in ("workspace", "tmp"):
                (base / folder).mkdir()
            workspace = base / "workspace"
            (workspace / "third_party/cometbft").mkdir(parents=True)
            original_mod, original_sum = b"module original-production\n", b"original-production-sum\n"
            (workspace / "go.mod").write_bytes(original_mod)
            (workspace / "go.sum").write_bytes(original_sum)
            pair = "github.com/stretchr/objx v0.5.2 h1:test\ngithub.com/stretchr/objx v0.5.2/go.mod h1:testmod\n"
            (workspace / "third_party/cometbft/go.sum").write_text(pair)
            calls = []
            def edit(argv, check):
                expected = ["go", "mod", "edit", "-modfile=" + str(base / "tmp/wire-observer-test.mod"), "-require=github.com/stretchr/objx@v0.5.2"]
                self.assertEqual(argv, expected)
                self.assertTrue(check)
                calls.append(argv)
            previous = Path.cwd()
            try:
                os.chdir(workspace)
                with patch.dict(os.environ, RUNNER_TEMP=str(base / "tmp")), patch("subprocess.run", side_effect=edit):
                    exec(compile(program, "actual-testmod-setup", "exec"), {})
                self.assertEqual(len(calls), 1)
                self.assertEqual((workspace / "go.mod").read_bytes(), original_mod)
                self.assertEqual((workspace / "go.sum").read_bytes(), original_sum)
                self.assertEqual((base / "tmp/wire-observer-test.sum").read_text(), original_sum.decode() + pair)
                with patch.dict(os.environ, RUNNER_TEMP=str(base / "tmp")), patch("subprocess.run", side_effect=edit), self.assertRaises(FileExistsError):
                    exec(compile(program, "actual-testmod-setup", "exec"), {})
                self.assertEqual(len(calls), 1)
            finally:
                os.chdir(previous)

    def test_current_leak_counterexample_keeps_observer_api_and_original_evidence(self):
        body = step(workflows()["resource"], "Reproduce and repair same-directory database ownership without starting nodes")
        found = re.findall(r"(?ms)^          python3 -B - \"\$YNX_DB_CASE\" <<'PY'\n(.*?)^          PY\n", body)
        self.assertEqual(len(found), 1)
        program = textwrap.dedent(found[0])
        parsed = ast.parse(program)
        target = [ast.literal_eval(node.value) for node in parsed.body if isinstance(node, ast.Assign) and any(isinstance(item, ast.Name) and item.id == "missing_close" for item in node.targets)]
        self.assertEqual(len(target), 1)
        target = target[0]
        original = (ROOT / "third_party/cometbft/node/node.go").read_bytes()
        self.assertEqual(original.count(target), 1)
        self.assertIn("grep -F 'tx_index underlying Close calls = 0, want exactly one'", body)
        self.assertIn("-run '^TestNodeOwnedDatabaseSameDirectoryReopen$'", body)
        self.assertEqual(body.count('cp "$YNX_DB_CASE/fixed-node.go" third_party/cometbft/node/node.go'), 2)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixed = root / "fixed-node.go"
            fixed.write_bytes(original)
            historical = root / "original-node-upstream.go"
            historical.write_bytes(b"original retained historical source")
            output = root / "missing-owner-close-node.go"
            with patch("sys.argv", ["actual-leak-control", directory]):
                exec(compile(program, "actual-leak-control", "exec"), {})
                self.assertEqual(output.read_bytes(), original.replace(target, b"", 1))
                self.assertIn(b"func NewObserverNodeWithConsensusAuthority(", output.read_bytes())
                self.assertEqual(fixed.read_bytes(), original)
                self.assertEqual(historical.read_bytes(), b"original retained historical source")
                with self.assertRaises(FileExistsError):
                    exec(compile(program, "actual-leak-control", "exec"), {})
                self.assertEqual(output.read_bytes(), original.replace(target, b"", 1))
            for invalid in (original.replace(target, b"", 1), original + target,
                            original.replace(b"func NewObserverNodeWithConsensusAuthority(", b"func missingOriginalObserverAPI(")):
                fixed.write_bytes(invalid)
                with patch("sys.argv", ["actual-leak-control", directory]), self.assertRaises(RuntimeError):
                    exec(compile(program, "actual-leak-control", "exec"), {})
                self.assertEqual(output.read_bytes(), original.replace(target, b"", 1))


# Reuse the actual original Current4 collector and immutable PUBLIC trace guard.
# This remains a pure source/event check, never a second Go invocation.
def peer_control(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / ("scripts/ops/" + name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


current4_ci = peer_control("test_validate_pq_current4_ci")
wallet_ci = peer_control("test_validate_pq_wallet_policy_ci")
ACCOUNT_REQUIRED = ['TestPQObserverAccountLaunchPUBLICOwningConstructorAndCold', 'TestPQObserverAccountLaunchPUBLICRefusalsAndFailurePreservation', 'TestPQObserverAccountLaunchPUBLICParentCloseAndNodeStopDrain', 'TestPQObserverAccountHostPUBLICSameNodeDistinctScopes', 'TestPQObserverAccountHostPUBLICIdentityAndScopeFailures']
ACCOUNT_MARKER = "YNX_PQ_OBSERVER_ACCOUNT_TESTS"
ACCOUNT_SOURCE = "internal/consensus/pq_observer_account_*.go"


def assert_account_contract(raws):
    assert_contract(raws)  # All original six observer cases and full streams stay.
    raw = raws["resource"]
    current4_ci.assert_contract(raw)  # Keep the original Current4 three and joint.
    if current4_ci.OBSERVER_ACCOUNT_REQUIRED != ACCOUNT_REQUIRED:
        raise AssertionError("fixed five observer account test names required")
    for event in ("push", "pull_request"):
        block = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)[0]
        source = "internal/consensus/**" if event == "push" else ACCOUNT_SOURCE
        for path in (source, wallet_ci.TRACE_PATH + "/**", CONTROL):
            if block.count("      - '" + path + "'\n") != 1:
                raise AssertionError("account source, PUBLIC trace and original control must trigger CI")
    program = current4_ci.collector(raw)
    values = [ast.literal_eval(node.value) for node in ast.parse(program).body
              if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "observer_account_required" for target in node.targets)]
    if values != [ACCOUNT_REQUIRED] or program.count(ACCOUNT_MARKER) != 1:
        raise AssertionError("one closed observer account list and DATA receipt required")
    required = ("for name in stream_required:", "if len(runs) != 1 or outcomes != ['pass']:",
                "if outcomes != ['pass']:", "event['Test'].split('/')[0] not in stream_required",
                "event.get('Package') != package", "('start', 'run', 'pause', 'cont', 'output', 'pass')")
    if any(value not in program for value in required):
        raise AssertionError("unique original package/top/child execution cannot be weakened")


def execute_account(raw, rows):
    with tempfile.TemporaryDirectory(prefix="observer-account-ci-") as directory:
        (Path(directory) / current4_ci.OUTPUT).write_text("".join(json.dumps(row) + "\n" for row in rows))
        output = io.StringIO()
        with patch.dict(os.environ, RUNNER_TEMP=directory, GITHUB_SHA="1" * 40), contextlib.redirect_stdout(output):
            exec(compile(current4_ci.collector(raw), "actual-observer-account-collector", "exec"), {})
    records = {}
    for line in output.getvalue().splitlines():
        marker, data = line.split(" ", 1)
        if marker in records:
            raise AssertionError("duplicate PUBLIC DATA receipt")
        records[marker] = json.loads(data)
    if set(records) != {current4_ci.MARKER, ACCOUNT_MARKER, "YNX_PQ_SOURCE_PARENT_TESTS"}:
        raise AssertionError("only distinct Current4, observer account and Source-parent DATA receipts required")
    return records


class ObserverAccountCIControls(unittest.TestCase):
    def test_account_cases_join_only_original_tagged_call_and_keep_all_old_cases(self):
        raws = workflows()
        assert_account_contract(raws)
        self.assertEqual(current4_ci.REQUIRED, ["TestPQCurrent4WirePUBLICStrictFramesAndOSPeer",
            "TestPQCurrent4WirePUBLICRegisteredObserverData", "TestPQCurrent4WirePUBLICSingleFlightUnknownAndPartialDrain"])
        for name in ACCOUNT_REQUIRED:
            found = [path for path in (ROOT / "internal/consensus").glob("pq_observer_account_*test.go")
                     if re.search(r"^func " + name + r"\(t \*testing.T\)", path.read_text(), re.M)]
            self.assertEqual(len(found), 1, name)
            self.assertIn("//go:build (linux || darwin) && ynx_public_trace_testsupport", found[0].read_text())
        self.assertEqual(current4_ci.STREAM_REQUIRED, current4_ci.REQUIRED + ACCOUNT_REQUIRED + current4_ci.SOURCE_PARENT_REQUIRED)
        self.assertEqual(len(current4_ci.STREAM_REQUIRED), 16)

    def test_actual_combined_collector_emits_separate_data_without_authority(self):
        records = execute_account(workflows()["resource"], current4_ci.rows())
        self.assertEqual(records[current4_ci.MARKER]["requiredPassed"], current4_ci.REQUIRED)
        self.assertEqual(records[ACCOUNT_MARKER]["requiredPassed"], ACCOUNT_REQUIRED)
        for record in records.values():
            self.assertEqual(record["sourceCommit"], "1" * 40)
            self.assertIs(record["suitePassed"], True)
            for flag in current4_ci.FALSE_FLAGS:
                self.assertIs(record[flag], False)

    def test_each_account_top_requires_unique_run_pass_in_original_package(self):
        raw = workflows()["resource"]
        good = current4_ci.rows()
        for name in ACCOUNT_REQUIRED:
            variants = [[event for event in good if event.get("Test") != name]]
            for action in ("run", "pass"):
                variants += [[event for event in good if not (event.get("Test") == name and event["Action"] == action)],
                             good + [dict(Action=action, Package=CORE, Test=name)]]
            variants += [[dict(event, Package="foreign/package") if event.get("Test") == name else event for event in good]]
            for rows in variants:
                with self.subTest(name=name, rows=rows), self.assertRaises(RuntimeError):
                    execute_account(raw, rows)

    def test_account_child_fail_skip_and_partial_or_merged_streams_never_qualify(self):
        raw = workflows()["resource"]
        good = current4_ci.rows()
        for name in ACCOUNT_REQUIRED:
            for action in ("skip", "fail", "build-fail", "unknown"):
                with self.subTest(name=name, action=action), self.assertRaises(RuntimeError):
                    execute_account(raw, good + [dict(Action=action, Package=CORE, Test=name + "/child")])
        # Real source owners executed Launch(2), Launch(1), Host(2) separately.
        # Each full original stream remains partial for this new eight-top CI;
        # concatenation retains its multiple package terminals and must reject.
        groups = [current4_ci.REQUIRED, ACCOUNT_REQUIRED[:2], ACCOUNT_REQUIRED[2:3], ACCOUNT_REQUIRED[3:]]
        partials = [[event for event in good if "Test" not in event or event["Test"] in group] for group in groups]
        variants = partials + [sum(partials, []), good[:-1], good + [good[-1]],
                              good + [dict(Action="pass", Package="other/package")],
                              good + [dict(Action="pass", Package=CORE, Test="TestPQObserverAccountUnapproved")]]
        for rows in variants:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                execute_account(raw, rows)

    def test_fixed_selector_trigger_budget_and_collector_cannot_drift(self):
        original = workflows()
        raw = original["resource"]
        command = current4_ci.COMMAND
        variants = []
        for name in ACCOUNT_REQUIRED:
            variants.append(raw.replace(command, command.replace("|" + name, ""), 1))
            variants.append(raw.replace("observer_account_required = " + repr(ACCOUNT_REQUIRED),
                                        "observer_account_required = " + repr([item for item in ACCOUNT_REQUIRED if item != name]), 1))
        for before, after in (("-timeout=120s", "-timeout=180s"),
                              ("-tags=ynx_public_trace_testsupport ", ""),
                              (current4_ci.SELECTOR, "^TestPQObserver"),
                              ("$GITHUB_WORKSPACE/" + wallet_ci.TRACE_PATH, "$RUNNER_TEMP/other")):
            variants.append(raw.replace(command, command.replace(before, after), 1))
        variants += [raw.replace(command, command * 2, 1),
                     raw.replace("      - '" + ACCOUNT_SOURCE + "'\n", "", 1),
                     raw.replace(current4_ci.step(raw, current4_ci.STEP), current4_ci.step(raw, current4_ci.STEP).replace("for name in stream_required:", "for name in current4_required:", 1), 1),
                     raw.replace(current4_ci.step(raw, current4_ci.STEP), current4_ci.step(raw, current4_ci.STEP).replace("if len(runs) != 1 or outcomes != ['pass']:", "if False:", 1), 1)]
        for changed in variants:
            self.assertNotEqual(changed, raw)
            with self.assertRaises(AssertionError):
                assert_account_contract(dict(original, resource=changed))

    def test_original_nine_public_inputs_remain_exact_and_missing_is_not_skip(self):
        import shutil
        wallet_ci.assert_public_trace(wallet_ci.TRACE_ROOT)
        self.assertEqual(len(wallet_ci.TRACE_FILES), 9)
        with tempfile.TemporaryDirectory(prefix="observer-account-public-") as directory:
            copy = Path(directory) / "trace"
            shutil.copytree(wallet_ci.TRACE_ROOT, copy)
            for name in wallet_ci.TRACE_FILES:
                path = copy / name
                original = path.read_bytes()
                path.unlink()
                with self.subTest(missing=name), self.assertRaises((AssertionError, FileNotFoundError)):
                    wallet_ci.assert_public_trace(copy)
                path.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
