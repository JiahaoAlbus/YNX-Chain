"""Source-only counterexamples; never start a fixture, node or compiler."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("supply-linux-window.py")
spec = importlib.util.spec_from_file_location("supply", FILE)
supply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supply)


def manifest(root):
    return dict(purpose="local-ephemeral-consensus-quorum-only-not-for-remote-or-custody",
                migrationPath=str(root / "migration.json"), nodes=[
                    dict(home=str(root / str(i)), abciStatePath=str(root / str(i) / "state.json"),
                         p2pListen=f"tcp://127.0.0.1:{31700+i}", rpcListen=f"tcp://127.0.0.1:{31800+i}",
                         rpcUrl=f"http://127.0.0.1:{31800+i}", abciListen=f"tcp://127.0.0.1:{31900+i}") for i in range(4)])


def report(profile="supply-256x4", pacing="relative"):
    counts = dict.fromkeys(("input", "offered", "submitted", "checkTxAccepted", "includedCodeZero",
                           "effectiveBusinessIncluded", "quorumConfirmed", "finalSubmitted"), 1024)
    counts.update(dict.fromkeys(("checkTxRejected", "checkTxUnverifiedResponses", "executionFailed", "submissionUnknown",
                                "timedOut", "observationFailed", "notSubmitted"), 0))
    phases = {}
    for name in ("completionWait", "offerDecode", "pacingWait", "dispatch", "sign", "encode", "journalAppend"):
        phases[name+"Attempts"], phases[name+"Ns"] = 1, 100
    phases.update(signAttempts=768, encodeAttempts=768, signedSuccessors=768,
                  terminalSinkAttempts=0, terminalSinkNs=0, journalSetupNs=100,
                  journalDurableEnvelopes=1024, journalDurableBytes=100)
    phases.update(completionSupplyWaitAttempts=1, completionSupplyWaitNs=100,
                  completionDrainWaitAttempts=0, completionDrainWaitNs=0,
                  completionFailureWaitAttempts=0, completionFailureWaitNs=0,
                  pacingFutureTargetAttempts=1, pacingAlreadyDueAttempts=0,
                  pacingPositiveRemainingNs=50, pacingWakeLatenessNs=50, pacingMaxWakeLatenessNs=50,
                  pacingCatchupTargets=0, pacingCadenceResets=0, pacingPeakCatchupTargets=0)
    rounds = 4
    if profile == "supply-512x2":
        rounds = 2
        phases.update(signAttempts=512, encodeAttempts=512, signedSuccessors=512)
    tx = dict(status="confirmed", checkTxCode=0, executionCode=0, checkTxIdentityVerified=True,
              quorumVerified=True, transactionProofVerified=True, durableStateVerified=True,
              durableInfoVerified=True, height=2, durableStateHeight=2, durableInfoHeight=2,
              durableSnapshotSha256="a"*64, confirmedObservedAt="2026-10-18T00:00:00Z")
    return dict(roundsRequested=rounds, roundsCompleted=rounds, pacingMode=pacing, senderMode="ready-pool", inclusionMode="block-scan", configuredOfferedRate=512,
                setupErrors=[], summary=counts, readySenders=dict(supply=phases),
                transactions=[dict(tx, index=i) for i in range(1024)])


class SupplySourceTests(unittest.TestCase):
    def test_default_has_no_execution(self):
        raw = subprocess.check_output([sys.executable, "-B", str(FILE)], timeout=5)
        row = json.loads(raw)
        self.assertIs(row["execute"], False)
        self.assertIs(row["nodesStarted"], False)
        self.assertIs(row["requiresSeparateRootGrant"], True)
        self.assertEqual(row["profile"]["activeMs"] + row["profile"]["cleanupMs"], 60000)
        self.assertEqual(supply.native.CAPS["activeMs"], 105000)  # parent module unchanged

    def test_manifest_private_paths_and_loopback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            supply.validate_manifest(manifest(root), root)
            for url in ("http://public.example:31800", "http://127.0.0.1:31800@public.example:31800",
                        "http://127.0.0.1:31800/?next=x", "http://localhost:31800", "http://127.0.0.1"):
                with self.subTest(url=url), self.assertRaises((RuntimeError, ValueError)):
                    supply.endpoint(url)
            for key, value in (("home", str(root.parent)), ("abciStatePath", str(root.parent / "database")),
                               ("rpcUrl", "http://127.0.0.1:12345")):
                m = manifest(root); m["nodes"][0][key] = value
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    supply.validate_manifest(m, root)
            (root / "escape").symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                supply.inside(root / "escape" / "state", root)

    def test_summary_does_not_replace_business_proofs(self):
        supply.validate_report(report())
        for key in ("quorumVerified", "transactionProofVerified", "durableStateVerified", "durableInfoVerified", "checkTxIdentityVerified"):
            row = report(); row["transactions"][35][key] = False
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)
        for key in ("submissionUnknown", "executionFailed", "timedOut"):
            row = report(); row["summary"][key] = 1
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)
        row = report(); row["transactions"][0]["index"] = 1
        with self.assertRaises(RuntimeError):
            supply.validate_report(row)

    def test_supply_initial_signatures_excluded_but_all_journaled(self):
        for key, value in (("signedSuccessors", 1024), ("journalDurableEnvelopes", 768),
                           ("terminalSinkAttempts", 1024), ("signNs", -1), ("completionWaitNs", 0)):
            row = report(); row["readySenders"]["supply"][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row)

    def test_native_resource_refusals_preserve_parent_caps(self):
        baseline = dict(rssBytes=1, threads=1, privateBytes=1, buildBytes=1,
                        freeDiskBytes=10 << 30, availableMemoryBytes=2 << 30)
        supply.native.enforce(baseline, True)
        for key, value in (("rssBytes", (1 << 30)+1), ("threads", 321),
                           ("privateBytes", (32 << 20)+1), ("freeDiskBytes", 1),
                           ("availableMemoryBytes", (1 << 30)+(128 << 20)-1)):
            row = dict(baseline, **{key: value})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.native.enforce(row, True)

    def test_nondarwin_alias_no_start(self):
        with patch.object(supply.sys, "platform", "darwin"), patch.object(supply.subprocess, "Popen") as start:
            with self.assertRaises(RuntimeError):
                supply.run(Path("/source"), Path("/build"), Path("/case"), Path("/receipt"))
            start.assert_not_called()

    def test_redirects_fail_closed(self):
        with self.assertRaises(RuntimeError):
            supply.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_missing_live_rss_is_not_zero(self):
        launcher = supply.os.getpid()
        rows = {launcher: dict(pid=launcher, parent=0, startTicks=1, state="R", threads=1)}
        with patch.object(supply.native, "proc_inventory", return_value=(rows, [])), \
                patch.object(supply.native, "bounded", side_effect=PermissionError("smaps denied")):
            with self.assertRaises(PermissionError):
                supply.native_sample(Path("/case"), Path("/build"), {}, 0)

    def test_owned_pid_overflow_is_not_truncated(self):
        launcher = supply.os.getpid()
        rows = {launcher: dict(pid=launcher, parent=0, startTicks=1)}
        rows.update({launcher+i: dict(pid=launcher+i, parent=launcher, startTicks=i+1) for i in range(1, 11)})
        with patch.object(supply.native, "proc_inventory", return_value=(rows, [])), \
                patch.object(supply.native, "bounded") as read:
            with self.assertRaisesRegex(RuntimeError, "process cap"):
                supply.native_sample(Path("/case"), Path("/build"), {}, 0)
            read.assert_not_called()

    def test_ci_is_opt_in_and_follows_existing_release_gates(self):
        workflow = FILE.parents[2] / ".github/workflows/chain-core.yml"
        text = workflow.read_text()
        start = text.index("      run_linux_supply:")
        self.assertIn("default: false", text[start:text.index("      measure_anchor_validation:", start)])
        step = text.index("      - name: Build and run explicitly scheduled isolated Linux Supply case")
        self.assertGreater(step, text.index("      - run: make secret-scan"))
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.run_linux_supply", text[step:step+250])
        self.assertIn("test_supply_linux_window.py -v", text)

    def test_transport_pair_is_explicit_and_caps_identical(self):
        original, grpc = supply.recipe(), supply.recipe("grpc")
        self.assertEqual(original["abciTransport"], "socket")
        for key in original["profile"]:
            if key != "name":
                self.assertEqual(original["profile"][key], grpc["profile"][key])
        node = manifest(Path("/private"))["nodes"][0]
        app, comet = supply.server_commands(Path("/build"), node, "/private/migration.json", "grpc")
        self.assertEqual(app[app.index("-transport")+1], "grpc")
        self.assertEqual(comet[comet.index("--abci")+1], "grpc")
        self.assertEqual(comet[comet.index("--proxy_app")+1], "127.0.0.1:31900")
        _, original_comet = supply.server_commands(Path("/build"), node, "/private/migration.json", "socket")
        self.assertNotIn("--proxy_app", original_comet)
        self.assertIn("-phase-timing", app)
        self.assertIn("block-journal", app)
        with self.assertRaises(RuntimeError):
            supply.server_commands(Path("/build"), node, "/private/migration.json", "local-unverified")

    def test_actual_deadline_shape_retained_but_cannot_qualify(self):
        row = report()
        row["summary"].update(offered=990, submitted=819, finalSubmitted=734,
                              submissionUnknown=4, timedOut=81, notSubmitted=205)
        row["setupErrors"] = [dict(stage="run", message="context deadline exceeded")]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "failed.json"
            output.write_text(json.dumps(row))
            partial = supply.partial_measurement(output)
            self.assertIs(partial["qualified"], False)
            self.assertEqual(partial["summary"]["submissionUnknown"], 4)
            self.assertEqual(partial["summary"]["timedOut"], 81)
            self.assertEqual(partial["supply"], row["readySenders"]["supply"])
            with self.assertRaises(RuntimeError):
                supply.validate_report(row)

    def test_fixed_512_profile_does_not_raise_resource_or_transaction_caps(self):
        old = supply.recipe("grpc")["profile"]
        new = supply.recipe("grpc", "supply-512x2")["profile"]
        self.assertEqual(new["senders"]*new["rounds"], 1024)
        for key in old:
            if key not in ("name", "senders", "rounds"):
                self.assertEqual(old[key], new[key])
        for name in ("custom", "supply-1024x2", "supply-512x4"):
            with self.assertRaises(RuntimeError):
                supply.recipe("grpc", name)
        with self.assertRaises(RuntimeError):
            supply.recipe("socket", "supply-512x2")

    def test_512_profile_requires_its_actual_round_and_successor_counts(self):
        supply.validate_report(report("supply-512x2"), "supply-512x2")
        for row in (report(), dict(report("supply-512x2"), roundsCompleted=4)):
            with self.assertRaises(RuntimeError):
                supply.validate_report(row, "supply-512x2")
        row = report("supply-512x2")
        row["readySenders"]["supply"]["signedSuccessors"] = 768
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2")

    def test_wait_scope_mismatch_or_failure_cannot_qualify(self):
        for key, value in (("completionSupplyWaitNs", 101), ("completionDrainWaitAttempts", 1),
                           ("completionFailureWaitNs", 1), ("pacingFutureTargetAttempts", 0),
                           ("pacingMaxWakeLatenessNs", 51)):
            row = report("supply-512x2"); row["readySenders"]["supply"][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                supply.validate_report(row, "supply-512x2")
        row = report("supply-512x2")
        del row["readySenders"]["supply"]["completionDrainWaitNs"]
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2")

    def test_bounded_cadence_is_explicit_and_has_no_resource_override(self):
        old = supply.recipe("grpc", "supply-512x2")
        candidate = supply.recipe("grpc", "supply-512x2", "bounded-cadence")
        self.assertEqual(old["pacingMode"], "relative")
        self.assertEqual(candidate["pacingCatchupOfferLimit"], 4)
        self.assertEqual(old["environment"], candidate["environment"])
        for key in old["profile"]:
            if key != "name": self.assertEqual(old["profile"][key], candidate["profile"][key])
        for profile, pacing in (("supply-256x4", "bounded-cadence"), ("supply-512x2", "unbounded")):
            with self.assertRaises(RuntimeError):
                supply.recipe("grpc", profile, pacing)

    def test_selected_pacing_must_match_actual_report_and_burst_cap(self):
        row = report("supply-512x2", "bounded-cadence")
        row["readySenders"]["supply"].update(pacingCatchupTargets=1, pacingPeakCatchupTargets=1)
        supply.validate_report(row, "supply-512x2", "bounded-cadence")
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2", "relative")
        row["readySenders"]["supply"]["pacingPeakCatchupTargets"] = 4
        with self.assertRaises(RuntimeError):
            supply.validate_report(row, "supply-512x2", "bounded-cadence")


if __name__ == "__main__":
    unittest.main()
