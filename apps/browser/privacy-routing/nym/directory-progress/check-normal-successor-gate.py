#!/usr/bin/env python3
"""Focused controls for the normal directory gate; no Nym or Cargo invocation."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("build-normal-successor.py")
spec = importlib.util.spec_from_file_location("normal_successor", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class NormalGateControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.body, cls.guard = gate.load_owner()

    def test_complete_source_receipt_and_original_plan(self):
        plan = gate.checked_plan(self.body, self.guard)
        self.assertEqual(gate.read(gate.PLAN), plan)
        self.assertEqual(plan["budgetEachStageAndBuild"]["wholeSeconds"], 465)
        self.assertEqual(plan["budgetEachStageAndBuild"]["workSeconds"], 450)
        self.assertEqual(plan["argv"][-8:], ["build", "--offline", "--release", "--locked",
                                             "-p", "nym-socks5-client", "--jobs", "1"])
        receipt = gate.WORK / "source-receipt.json"
        frozen = gate.confirm_source(self.body, self.guard, self.guard.sha(receipt))
        self.assertEqual(len(frozen), 6612)
        self.assertEqual(frozen, gate.metadata(gate.inventory(self.body, gate.SOURCE)))
        self.assertFalse(any(row[5] & 0o222 for name, row in frozen.items()
                             if name != gate.ENV_BUILD_SCRIPT_REWRITE))
        with self.assertRaisesRegex(RuntimeError, "input-pin"):
            gate.confirm_source(self.body, self.guard, "0" * 64)

    def test_original_build_owner_records_expected_nonzero_and_reaps(self):
        with tempfile.TemporaryDirectory(dir=gate.CASE, prefix="local-normal-gate.") as directory:
            case = Path(directory)
            (case / "source").mkdir()
            raw_guard = self.guard
            with patch.object(raw_guard, "ROOT", case), patch.object(raw_guard, "immutable_source", lambda _: None):
                owner = raw_guard.Build({"requestedLimitsNotYetGranted": {
                    "aggregateSeconds": 1800, "cleanupReserveSeconds": 15}}, case, time.monotonic())
                owner.monitor = lambda: None
                try:
                    gate.observed_step(owner, {"PATH": "/usr/bin:/bin"}, "harmless-negative", ["/usr/bin/false"], 1)
                    self.assertEqual(owner.steps[-1]["terminalOutcome"], "ORIGINAL_POPEN_WAIT")
                    self.assertEqual(owner.steps[-1]["pid"], owner.steps[-1]["pgid"])
                    self.assertEqual(owner.steps[-1]["exit"], 1)
                    self.assertTrue(owner.steps[-1]["reaped"])
                    self.assertEqual(owner.groups, set())
                    with self.assertRaisesRegex(RuntimeError, "COMMAND_FAILED"):
                        gate.observed_step(owner, {"PATH": "/usr/bin:/bin"}, "unexpected-negative", ["/usr/bin/false"])
                finally:
                    self.assertEqual(owner.cleanup(), [])

    def test_current_production_lacks_compiled_progress_symbol(self):
        previous = (gate.P05.parent / "r2-20261107/nym/directory-progress-build-20261107T111959Z-7c5347/nym-socks5-client")
        self.body.require_hashes(self.guard, {previous: "e769b4e3c40a1b729dc0ab803570e93875014c6a80b87e032c53898dfc5949ef"})
        handler = "nym_socks5_client8commands8reviewed3get"
        progress = "nym_socks5_client8commands8reviewed21directory_diagnostics12BodyProgress7advance"
        old = subprocess.check_output(["/usr/bin/nm", gate.OLD_RUNTIME], text=True, timeout=5)
        successor = subprocess.check_output(["/usr/bin/nm", previous], text=True, timeout=5)
        self.assertNotIn(progress, old)
        self.assertIn(handler, successor)
        self.assertIn(progress, successor)

    def test_postbuild_source_metadata_changes_fail_closed(self):
        original = {
            "Cargo.lock": [1, 2, 3, 4, 5, 0o100444],
            gate.ENV_BUILD_SCRIPT_REWRITE: [1, 3, 4, 5, 6, 0o100644],
        }
        altered = deepcopy(original)
        altered[gate.ENV_BUILD_SCRIPT_REWRITE][3] += 1
        self.assertEqual(gate.verify_source_after(original, altered), [gate.ENV_BUILD_SCRIPT_REWRITE])
        altered[gate.ENV_BUILD_SCRIPT_REWRITE][1] += 1
        with self.assertRaisesRegex(RuntimeError, "metadata-drift"):
            gate.verify_source_after(original, altered)
        altered = deepcopy(original)
        altered["Cargo.lock"][3] += 1
        with self.assertRaisesRegex(RuntimeError, "metadata-drift:Cargo.lock"):
            gate.verify_source_after(original, altered)


if __name__ == "__main__":
    unittest.main(verbosity=2)
