"""Exercise the real observer CI collectors with PUBLIC synthetic JSONL only.

No Go, key generation, Node.Start, transport or package installation runs here.
The six real Go cases execute in the normal full streams and fixed fork group.
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
FULL_CORE = '          if ! YNX_PQ_NETWORK_E2E=\'\' go test -json -p 1 -count=1 -timeout=180s -skip \'^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$|TestProduction|TestPQLab)\' ./internal/consensus > "$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl"; then\n'


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
    if raws["resource"].count(FULL_CORE) != 1 or raws["resource"].count(FULL_CLI) != 1:
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


if __name__ == "__main__":
    unittest.main()
