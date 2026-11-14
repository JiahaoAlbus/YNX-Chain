"""Pure controls for the actual bounded Current4 CI call and JSONL collector.

Synthetic Go event rows exercise the real workflow Python. They are not Go,
Node.Start, signed trace generation, Current4 execution or Source qualification.
"""
import ast
import copy
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
# Same original tagged invocation; the original Current4 receipt stays three tests.
OBSERVER_ACCOUNT_REQUIRED = ['TestPQObserverAccountLaunchPUBLICOwningConstructorAndCold', 'TestPQObserverAccountLaunchPUBLICRefusalsAndFailurePreservation', 'TestPQObserverAccountLaunchPUBLICParentCloseAndNodeStopDrain', 'TestPQObserverAccountHostPUBLICSameNodeDistinctScopes', 'TestPQObserverAccountHostPUBLICIdentityAndScopeFailures']
SOURCE_PARENT_REQUIRED = ['TestSourceParentFrameBounds', 'TestSourceParentOriginalClockRace', 'TestPQSourceParentPUBLICQualifiedCleanupAndLoss', 'TestPQSourceParentPUBLICOriginalUnnamedSocket', 'TestPQAccountSourceCancelPreservesOriginalCleanupPUBLIC', 'TestPQProtectedSourceParentStableHostScopesPUBLIC', 'TestPQCommittedAccountWirePUBLICCloseDebt', 'TestPQSourceParentPUBLICDirectCleanupRetainsFirstCause']
NORMAL_SOURCE_PARENT_REQUIRED = ['TestPQNormalStartupSeparateProcessAndScopePUBLIC', 'TestPQNormalStartupOriginalRootEmptyAndCustodyPUBLIC', 'TestPQNormalStartupProfileCurrentAndWorkerDrainPUBLIC']
STREAM_REQUIRED = REQUIRED + OBSERVER_ACCOUNT_REQUIRED + SOURCE_PARENT_REQUIRED + NORMAL_SOURCE_PARENT_REQUIRED
SELECTOR = "^(" + "|".join(STREAM_REQUIRED) + ")$"
COMMAND = ('          if ! CGO_ENABLED=1 YNX_PQ_NETWORK_E2E=\'\' YNX_PUBLIC_REGISTERED_OBSERVER_TRACE="$GITHUB_WORKSPACE/' + TRACE
           + '" go test -tags=ynx_public_trace_testsupport -json -p 1 -count=1 -timeout=120s -run '
           + "'" + SELECTOR + "' ./internal/consensus > \"$RUNNER_TEMP/" + OUTPUT + '\"; then\n')
ORIGINAL_SKIP = "^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$|TestProduction|TestPQLab)"
PROOF_STATE_RUN = '^(TestPQLightProof|TestPQTransactionProof|TestPQConsensus(Light|Transaction|MigrationTransaction)ProofPublicFixture$|TestPQWalletPolicy)'
SKIP = ORIGINAL_SKIP[:-1] + "|" + REQUIRED[0] + "$|" + PROOF_STATE_RUN[2:-1] + ")"
FULL_COMMAND = ("          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -skip '"
                + SKIP + "' ./internal/consensus > \"$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl\"; then\n")
OLD_COMMANDS = [
    "          if ! go test -json -p 1 -count=1 -timeout=180s -run '^(TestConsensusMigration|TestConsensusSponsor|TestPQHistoryMathCache|TestCombinedDetachedValidatorKeys)' ./internal/chain > \"$RUNNER_TEMP/ynx-native-history-chain-tests.jsonl\"; then\n",
    FULL_COMMAND,
    '          if ! YNX_PQ_NETWORK_E2E=\'\' go test -json -p 1 -count=1 -timeout=180s -run \'^(TestPQLightProof|TestPQTransactionProof|TestPQConsensus(Light|Transaction|MigrationTransaction)ProofPublicFixture$|TestPQWalletPolicy)\' ./internal/consensus > "$RUNNER_TEMP/ynx-proof-wallet-state-tests.jsonl"; then\n',
    "          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -run '^TestProduction' ./internal/consensus > \"$RUNNER_TEMP/ynx-production-operator-state-tests.jsonl\"; then\n",
    "          if ! YNX_PQ_NETWORK_E2E='' go test -json -p 1 -count=1 -timeout=180s -run '^TestPQLab' -skip '^TestPQLab(LiveMaterials(CacheBoundOriginalSetupRequestResult|CaptureObservationRetainsOriginalFailure|CancelledAppReadDrainsOriginal|CaptureKnownCoordinatesNeverRebase|FinalReadOnlyOriginalCommitCrossings|FinalReadKeepsOriginalProofCheckpoint)$|LiveSession(OriginalProofAndHeldScope|LifecycleAndOriginalRefusal)$|Sender|PublicOwner|MultiOwner|OnlineSender|Checkpoint|ProofInputs|Workload)' ./internal/consensus > \"$RUNNER_TEMP/ynx-lab-state-tests.jsonl\"; then\n",
    '          if ! YNX_PQ_NETWORK_E2E=\'\' go test -json -p 1 -count=1 -timeout=180s -run \'^TestPQLab(Sender|PublicOwner|MultiOwner|OnlineSender|Checkpoint|ProofInputs|Workload)\' -skip \'^TestPQLab(SenderPrepareOriginalWitnessAndCurrent|PublicOwnerPrepareBeforeCommands)$\' ./internal/consensus > "$RUNNER_TEMP/ynx-lab-caller-state-tests.jsonl"; then\n',
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
    account_assignments = [ast.literal_eval(node.value) for node in ast.parse(program).body
                           if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "observer_account_required" for target in node.targets)]
    if account_assignments != [OBSERVER_ACCOUNT_REQUIRED] or "stream_required = current4_required + observer_account_required + source_parent_required + normal_source_parent_required" not in program:
        raise AssertionError("the five fixed observer account cases must remain in the original Current4 stream")
    original = step(raw, "Verify complete state bridge and sponsor continuity")
    commands = re.findall(r"(?m)^          if ! .*go test .+\n", original)
    if commands != OLD_COMMANDS or "-tags=" in original:
        raise AssertionError("original full union and every 180s budget must remain; only fixed disjoint proof/wallet and caller/workload cases are repartitioned")
    for name in ("ynx-proof-wallet-state-tests.jsonl", "ynx-production-operator-state-tests.jsonl", "ynx-lab-state-tests.jsonl", "ynx-lab-caller-state-tests.jsonl", "ynx-lab-large-source-tests.jsonl"):
        if original.count('          cat "$RUNNER_TEMP/' + name + '" >> "$RUNNER_TEMP/ynx-initial-cache-state-tests.jsonl"\n') != 1:
            raise AssertionError("original state streams must remain fully merged")
    if OUTPUT in original or (">>" in body and "ynx-initial-cache-state-tests.jsonl" in body):
        raise AssertionError("new qualification must not duplicate original stream terminals")


def rows():
    events = [{"Action": action, "Package": PACKAGE, "Test": name}
              for name in STREAM_REQUIRED for action in ("run", "pass")]
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
        examples = STREAM_REQUIRED + ["TestPQCurrent4WirePUBLICStrictFramesAndOSPeerExtra", "TestPQWalletPolicyLiveOriginalNodeCommittedAndPending", "TestABCIOriginal", "TestProofHostOriginal", "TestProductionOriginal", "TestPQLabOriginal"]
        for name in examples:
            with self.subTest(name=name):
                self.assertEqual(bool(re.search(SKIP, name)), bool(re.search(ORIGINAL_SKIP, name)) or name == REQUIRED[0] or bool(re.search(PROOF_STATE_RUN, name)))
                self.assertEqual(bool(re.search(SELECTOR, name)), name in STREAM_REQUIRED)

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
                     self.raw.replace(OLD_COMMANDS[3], "", 1),
                     self.raw.replace(CONTROL_COMMAND, "", 1),
                     self.raw.replace(CONTROL_COMMAND, CONTROL_COMMAND * 2, 1)]
        for path in (CONTROL, TRACE + "/**", "internal/consensus/pq_current4_*.go", "internal/consensus/pq_wallet_policy_live.go"):
            mutations.append(self.raw.replace("      - '" + path + "'\n", "", 1))
        for raw in mutations:
            self.assertNotEqual(raw, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(raw)



# Joint tests consume the exact original Auth BODY in another process. These
# are pure control checks only; synthetic collector rows grant no authority.
JOINT_STEP = "Verify original Auth r2 cross-process Current4 DATA interoperability"
JOINT_RECIPE = "scripts/verify/current4-auth-r2-interop-check.sh"
JOINT_NAME = "TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop"
CLEANUP_NAME = "TestPQCurrent4WirePUBLICAuthR3CleanupFence"
JOINT_SELECTOR = "^(" + JOINT_NAME + "|" + CLEANUP_NAME + ")$"
JOINT_INPUT = "internal/consensus/testdata/current4_auth_r2"
JOINT_COMMAND = '        run: bash ' + JOINT_RECIPE + ' "$RUNNER_TEMP/ynx-current4-auth-r2-interop"\n'
JOINT_PINS = {
 "Current4WireClient.cpp":"be8b52c00654f325f116d6113158ea4df2ec88c6e65e085337270a669acf6dec",
 "Current4WireClient.hpp":"4dcf71a0e059c0bfcf7393ce38104144f7fd1cd694bf917212774d1bbc28ffaf",
 "network-consent-policy-current-wire-v1.h":"1197965ac26958a39f65b0314c2779f6046bafbe583a9959c78b6a335b460487",
 "network-consent-policy-current-next-private.h":"a4d3f115858235ac8bd7261bb7ac73539a048de2e18278de930542350bd97e70",
 "network_pending_principal_private.h":"f49a03d73ab2947e3962fb2cd6055490cfdd323d1a4ff5da6187309259da69ba",
 "network_pending_native.h":"20ea77e66f672c199acd284ca2bacda1543814fa156b86436c22d3fb41371104",
 "network_resource_native.h":"ff20e2aae706317f83d7055c972906641d7510005f7a64ad607ea4039efcc8da"}


def joint_qualifier(recipe=None):
    recipe = recipe if recipe is not None else (ROOT / JOINT_RECIPE).read_text()
    program = recipe.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    functions = [node for node in ast.parse(program).body if isinstance(node, ast.FunctionDef) and node.name in ("qualify_joint", "qualify_cleanup")]
    if len(functions) != 2:
        raise AssertionError("one actual recipe collector required")
    scope = {"json": json}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "actual-joint-recipe-collector", "exec"), scope)
    return scope["qualify_joint"]


def assert_joint_contract(raw, recipe):
    assert_contract(raw)  # original three tests / full old union stay intact
    body = step(raw, JOINT_STEP)
    if body.count(JOINT_COMMAND) != 1 or raw.count(JOINT_COMMAND) != 1 or "        id: current4authinterop\n" not in body:
        raise AssertionError("one mandatory original cross-process recipe required")
    if re.findall(r"(?m)^        if: (.*)$", body) != [NORMAL_IF] or "        timeout-minutes: 5\n" not in body:
        raise AssertionError("joint normal admission and bounded budget required")
    if "continue-on-error" in body or "|| true" in body or "go test" in body:
        raise AssertionError("joint result cannot be ignored or replaced")
    for event in ("push", "pull_request"):
        block = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:|^concurrency:|^permissions:)", raw)[0]
        for path in (JOINT_RECIPE, JOINT_INPUT + "/**"):
            if block.count("      - '" + path + "'\n") != 1:
                raise AssertionError("joint source/recipe must trigger CI")
    upload = step(raw, "Retain only public Current4 Auth r2 joint evidence")
    files = re.findall(r"(?m)^            \$\{\{ runner.temp \}\}/ynx-current4-auth-r2-interop/(.+)$", upload)
    if files != ["RESULT.json", "FAILURE.json", "COMPILE.result.json", "COMPILE.stdout", "COMPILE.stderr", "GO.result.json", "GO.stdout", "GO.stderr"]:
        raise AssertionError("only exact public joint evidence may upload")
    if "steps.current4authinterop.outcome == 'failure'" not in upload or "if-no-files-found: error" not in upload:
        raise AssertionError("first failure evidence must survive")
    required = ["'-fsanitize=address,undefined'", "'-std=c++17'", "str(inputs/'Current4WireClient.cpp')", "str(inputs/'interop.cpp')", "],60)", "],210)", "'-p','1'", "'-timeout=120s'", "'-tags=ynx_public_trace_testsupport,ynx_current4_auth_interop'", "'" + JOINT_SELECTOR + "'", "GOMEMLIMIT='1536MiB'", "GOMAXPROCS='2'", "GOPROXY='off'", "fixture=repo/'" + TRACE + "'", "receipt=qualify_joint(rows,pin(out/'auth-r2-interop')['sha256'])"]
    if any(value not in recipe for value in required) or recipe.count("run('GO',") != 1 or recipe.count("run('COMPILE',") != 1:
        raise AssertionError("one bounded original Auth compile and actual fourth Go test required")
    joint_qualifier(recipe)


def assert_joint_originals(directory):
    import hashlib
    manifest = json.loads((directory / "PROVENANCE.json").read_text())
    entries = manifest["foreignSources"]
    if manifest.get("activeAuthRevision") != "r3" or manifest.get("authHSHA256") != "52488824f04819023067605d87b1ed20c8a1182c6567cdb76ad1a13372f2918c":
        raise AssertionError("active Auth r3 source handoff required")
    if len(entries) != 7 or {e["file"] for e in entries} != set(JOINT_PINS):
        raise AssertionError("closed seven original Auth/SDK files required")
    if {p.name for p in directory.iterdir()} != set(JOINT_PINS) | {"PROVENANCE.json", "interop.cpp"}:
        raise AssertionError("joint test source catalogue differs")
    for entry in entries:
        raw = (directory / entry["file"]).read_bytes()
        if entry["verbatim"] is not True or len(raw) != entry["bytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"] or entry["sha256"] != JOINT_PINS[entry["file"]]:
            raise AssertionError("original foreign BODY/header changed")


def joint_rows(receipt=None):
    if receipt is None:
        receipt = dict(activeAuthRevision="r3", PUBLIC=True, distinctProcesses=True, RootQualifiedPeer=False, NativeCurrent=False, formalP09Slot=False, positiveAndPartialCleanupAcknowledged=True, parentPID=12, cppPID=13, positiveOps=6, deniedOps=4, sourceNodesStarted=0, policyBytes=5631, policySHA256="b" * 64, executionHeight="13", cppSHA256="a" * 64)
    return [dict(Action="run", Package=PACKAGE, Test=JOINT_NAME),
            dict(Action="output", Package=PACKAGE, Test=JOINT_NAME, Output="YNX_CURRENT4_AUTH_R2_PUBLIC_INTEROP " + json.dumps(receipt) + "\n"),
            dict(Action="pass", Package=PACKAGE, Test=JOINT_NAME),
            *cleanup_rows()[:-1], dict(Action="pass", Package=PACKAGE)]


def cleanup_rows(receipt=None):
    if receipt is None:
        receipt=dict(activeAuthRevision="r3",PUBLIC=True,distinctProcesses=True,cleanupAcknowledged=True,sameParentAfterCleanup=True,RootQualifiedPeer=False,NativeCurrent=False,formalP09Slot=False,parentPID=12,cppPID=13,cppSHA256="a"*64,coreOps=4,clientProducingCallsDenied=4,sourceNodesStarted=0)
    return [dict(Action="run",Package=PACKAGE,Test=CLEANUP_NAME),dict(Action="output",Package=PACKAGE,Test=CLEANUP_NAME,Output="YNX_CURRENT4_AUTH_R3_CLEANUP_INTEROP "+json.dumps(receipt)+"\n"),dict(Action="pass",Package=PACKAGE,Test=CLEANUP_NAME),dict(Action="pass",Package=PACKAGE)]


class Current4AuthR2JointCIControls(unittest.TestCase):
    def test_normal_joint_step_is_separate_from_all_original_groups(self):
        assert_joint_contract(WORKFLOW.read_text(), (ROOT / JOINT_RECIPE).read_text())

    def test_exact_foreign_bodies_and_missing_or_changed_header_refused(self):
        import shutil
        assert_joint_originals(ROOT / JOINT_INPUT)
        for name in JOINT_PINS:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="current4-foreign-") as temp:
                directory = Path(temp) / "foreign"
                shutil.copytree(ROOT / JOINT_INPUT, directory)
                path = directory / name
                raw = path.read_bytes()
                path.write_bytes(raw + b"\n")
                with self.assertRaises(AssertionError):
                    assert_joint_originals(directory)
                path.unlink()
                with self.assertRaises((AssertionError, FileNotFoundError)):
                    assert_joint_originals(directory)

    def test_actual_recipe_collector_qualifies_only_joint_data(self):
        receipt = joint_qualifier()(joint_rows(), "a" * 64)
        self.assertEqual(receipt["positiveOps"], 6)
        self.assertEqual(receipt["deniedOps"], 4)
        for key in ("RootQualifiedPeer", "NativeCurrent", "formalP09Slot"):
            self.assertIs(receipt[key], False)

    def test_actual_recipe_missing_duplicate_foreign_or_failed_stream_refused(self):
        good = joint_rows()
        bad = [[], good[1:], good[:-1], good + [good[-1]], good + [good[0]], good + [good[1]], good + [good[2]],
               [dict(e, Package="foreign") for e in good], [dict(e, Test="WrongTest") for e in good]]
        bad += [good + [dict(Action=a, Package=PACKAGE, Test=JOINT_NAME + "/nested")] for a in ("skip", "fail", "build-fail", "unknown")]
        for rows in bad:
            with self.assertRaises((RuntimeError, ValueError, TypeError)):
                joint_qualifier()(rows, "a" * 64)

    def test_joint_receipt_cannot_claim_authority_or_false_process_and_operation_counts(self):
        good = joint_qualifier()(joint_rows(), "a" * 64)
        mutations = {"RootQualifiedPeer": True, "NativeCurrent": True, "formalP09Slot": True,
                     "PUBLIC": 1, "distinctProcesses": False, "parentPID": 13, "cppPID": 0,
                     "positiveOps": 5, "deniedOps": 6, "sourceNodesStarted": False,
                     "policyBytes": 8388609, "executionHeight": "013", "cppSHA256": "c" * 64,
                     "policySHA256": "B" * 64, "positiveAndPartialCleanupAcknowledged": False}
        for key, value in mutations.items():
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                joint_qualifier()(joint_rows(dict(good, **{key: value})), "a" * 64)
        with self.assertRaises(RuntimeError):
            joint_qualifier()(joint_rows(dict(good, SourceGrant=True)), "a" * 64)

    def test_source_mutations_cannot_skip_joint_or_widen_recipe_and_upload(self):
        raw, recipe = WORKFLOW.read_text(), (ROOT / JOINT_RECIPE).read_text()
        body = step(raw, JOINT_STEP)
        for changed in [raw.replace(JOINT_COMMAND, "", 1), raw.replace(JOINT_COMMAND, JOINT_COMMAND * 2, 1),
                        raw.replace(body, body.replace(NORMAL_IF, "${{ false }}"), 1),
                        raw.replace(body, body.replace("timeout-minutes: 5", "timeout-minutes: 6"), 1),
                        raw.replace("/ynx-current4-auth-r2-interop/GO.stderr", "/ynx-current4-auth-r2-interop/**", 1),
                        raw.replace("      - '" + JOINT_INPUT + "/**'\n", "", 1)]:
            with self.assertRaises(AssertionError):
                assert_joint_contract(changed, recipe)
        for old, new in [("-timeout=120s", "-timeout=180s"), ("-fsanitize=address,undefined", "-O0"),
                         (JOINT_SELECTOR, "^TestPQCurrent4"), ("],210)", "],300)"),
                         ("str(inputs/'Current4WireClient.cpp')", "'fake-client.cpp'"),
                         ("GOMEMLIMIT='1536MiB'", "GOMEMLIMIT='4096MiB'")]:
            with self.assertRaises(AssertionError):
                assert_joint_contract(raw, recipe.replace(old, new, 1))

    def test_active_r3_cleanup_receipt_cannot_be_omitted_or_claim_extra_producing_ops(self):
        good=joint_rows()
        without=[e for e in good if e.get("Test")!=CLEANUP_NAME]
        with self.assertRaises(RuntimeError):joint_qualifier()(without,"a"*64)
        for field,value in {"activeAuthRevision":"r2","coreOps":5,"clientProducingCallsDenied":3,"cleanupAcknowledged":False,"sameParentAfterCleanup":False,"RootQualifiedPeer":True,"cppPID":12,"cppSHA256":"c"*64,"sourceNodesStarted":False}.items():
            with self.subTest(field=field):
                changed=copy.deepcopy(good)
                for event in changed:
                    if event.get("Test")==CLEANUP_NAME and event["Action"]=="output":
                        marker="YNX_CURRENT4_AUTH_R3_CLEANUP_INTEROP "
                        receipt=json.loads(event["Output"].split(marker,1)[1]);receipt[field]=value;event["Output"]=marker+json.dumps(receipt)
                with self.assertRaises(RuntimeError):joint_qualifier()(changed,"a"*64)


if __name__ == "__main__":
    unittest.main()
