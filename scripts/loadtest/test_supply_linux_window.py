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


def report():
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
    tx = dict(status="confirmed", checkTxCode=0, executionCode=0, checkTxIdentityVerified=True,
              quorumVerified=True, transactionProofVerified=True, durableStateVerified=True,
              durableInfoVerified=True, height=2, durableStateHeight=2, durableInfoHeight=2,
              durableSnapshotSha256="a"*64, confirmedObservedAt="2026-10-18T00:00:00Z")
    return dict(roundsCompleted=4, senderMode="ready-pool", inclusionMode="block-scan", configuredOfferedRate=512,
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


if __name__ == "__main__":
    unittest.main()
