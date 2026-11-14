"""Actual local processes through the normal validator QA capture caller."""

from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ENTRY = Path(__file__).resolve().with_name("capture-reviewed-directory.py")
spec = importlib.util.spec_from_file_location("normal_directory_supervisor", ENTRY)
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


SCRIPT = r"""
from datetime import datetime, timezone
import json, os, signal, sys, time
mode = sys.argv[1]
now = datetime.now(timezone.utc)
meta = {"status": None, "absolute_epoch_id": 7, "rotation_id": 5,
        "refreshed_at": now.strftime("%Y-%m-%d %H:%M:%S.%f +00:00:00")}
table = {"pagination": {"page":0,"size":1,"total":1},"data":[{"node_id":1,"privateFixture":"UNPUBLISHED_RAW"}]}
obj = {"schema":"YNX_NYM_DIRECTORY_V1","basic":{"metadata":meta,"nodes":table},
       "described":table,"epoch":{"total_elapsed_epochs":7,"epoch_length":{"secs":3600,"nanos":0},
       "current_epoch_start":now.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")}}
if mode == "overflow":
    print("X" * 700000, file=sys.stderr, flush=True)
else:
    if mode == "late-eof":
        child = os.fork()
        if child == 0:
            os.close(1)
            time.sleep(.15)
            os._exit(0)
        os.waitpid(child, 0)
    print(json.dumps(obj), flush=True)
    print("UNPUBLISHED_RAW", file=sys.stderr, flush=True)
    if mode == "error":
        sys.exit(7)
    if mode == "cancel":
        os.kill(os.getppid(), signal.SIGTERM)
        time.sleep(10)
    if mode == "timeout":
        time.sleep(10)
"""


@unittest.skipUnless(sys.platform == "darwin" and supervisor.GUARD_PATH.is_file(),
                     "original macOS process-owner guard not available")
class OwnedCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guard = supervisor.load_guard()

    def call(self, mode, seconds=3):
        with tempfile.TemporaryDirectory(prefix="normal-validator-owned.", dir=supervisor.P05) as folder:
            case = Path(folder)
            began = time.monotonic()
            expiry = datetime.now(timezone.utc) + timedelta(seconds=seconds)
            report = supervisor.process_capture(
                self.guard, case, [sys.executable, "-IB", "-c", SCRIPT, mode], {"PATH": "/usr/bin:/bin"},
                expiry, time.monotonic_ns() + int(seconds * 1e9))
            self.assertLess(time.monotonic() - began, 5)
            self.assertEqual(json.loads((case / "operation.json").read_text()), report)
            child = report["processes"][0]
            self.assertEqual(child["terminalOutcome"], "ORIGINAL_POPEN_WAIT")
            self.assertTrue(child["reaped"])
            self.assertEqual(child["pgid"], child["pid"])
            self.assertEqual(report["remainingOwned"], [])
            self.assertNotIn(child["pid"], self.guard.processes())
            self.assertFalse((case / "stdout.json").exists())
            self.assertFalse((case / "stderr.log").exists())
            self.assertNotIn("UNPUBLISHED_RAW", (case / "operation.json").read_text())
            self.assertEqual((case / "operation.json").stat().st_mode & 0o777, 0o600)
            if mode == "cancel-during-publication":
                self.assertEqual(report["firstFailure"], "directory-cancelled")
                self.assertTrue((case / "withheld-tables").is_dir())
            if report["summary"] is not None:
                tables = Path(report["out"])
                self.assertEqual(tables.stat().st_mode & 0o777, 0o700)
                for name, digest in report["sha256"].items():
                    self.assertEqual(supervisor.sha(tables / (name + ".json")), digest)
            else:
                self.assertFalse((case / "tables").exists())
                if (case / "withheld-tables").is_dir():
                    self.assertEqual((case / "withheld-tables").stat().st_mode & 0o777, 0o700)
                    self.assertEqual({p.name for p in (case / "withheld-tables").iterdir()},
                                     {"basic.json", "described.json", "epoch.json"})
            return report

    def test_true_exit_zero_eof_and_private_output(self):
        report = self.call("success")
        self.assertEqual(report["summary"]["epoch"], 7)
        self.assertEqual(report["processes"][0]["exit"], 0)
        self.assertEqual(report["capturedEOF"], ["stderr", "stdout"])

    def test_nonzero_with_well_formed_data_never_publishes(self):
        report = self.call("error")
        self.assertEqual(report["firstFailure"], "directory-original-exit-7")
        self.assertEqual(report["processes"][0]["exit"], 7)
        self.assertIsNone(report["summary"])

    def test_signal_and_timeout_cleanup_original_child(self):
        cancelled = self.call("cancel")
        self.assertEqual(cancelled["firstFailure"], "directory-cancelled")
        self.assertIn(signal.SIGTERM, cancelled["signals"])
        self.assertLess(cancelled["processes"][0]["exit"], 0)
        timed = self.call("timeout", seconds=0.35)
        self.assertEqual(timed["firstFailure"], "directory-capture-expired")
        self.assertFalse(timed["completeEOFBeforeCleanup"])
        self.assertLess(timed["processes"][0]["exit"], 0)

    def test_overflow_rejected_and_reaped(self):
        result = self.call("overflow")
        self.assertEqual(result["firstFailure"], "directory-output-limit-stderr")
        self.assertIsNone(result["summary"])

    def test_cancel_during_table_rename_retires_export(self):
        rename = Path.rename

        def cancel_after_rename(path, destination):
            result = rename(path, destination)
            if path.name == "private-tables" and Path(destination).name == "tables":
                os.kill(os.getpid(), signal.SIGTERM)
            return result

        # A real successful child and real rename trigger the actual SIGTERM
        # handler before the caller can publish a successful terminal receipt.
        with patch.object(Path, "rename", cancel_after_rename):
            report = self.call("cancel-during-publication")
        self.assertEqual(report["firstFailure"], "directory-cancelled")
        self.assertIsNone(report["out"])


class ScopeControls(unittest.TestCase):
    def test_scope_rejects_expiry_wrong_hash_and_group_writable(self):
        with tempfile.TemporaryDirectory(prefix="normal-validator-scope.") as folder:
            scope = Path(folder) / "scope.json"
            binary = Path(sys.executable).resolve()
            now = int(time.time())
            value = {"schema": "P05_NYM_NORMAL_VALIDATOR_DIRECTORY_QA_V1",
                     "binarySHA256": supervisor.sha(binary), "notBefore": now - 10, "latestStart": now + 30}
            supervisor.write_new(scope, value)
            digest = supervisor.sha(scope)
            self.assertEqual(supervisor.checked_scope(scope, digest, binary), value)
            with self.assertRaisesRegex(RuntimeError, "directory-scope-pin"):
                supervisor.checked_scope(scope, "0" * 64, binary)
            with patch.object(supervisor.time, "time", lambda: value["latestStart"]):
                with self.assertRaisesRegex(RuntimeError, "directory-scope-or-artifact"):
                    supervisor.checked_scope(scope, digest, binary)
            scope.chmod(0o660)
            with self.assertRaisesRegex(RuntimeError, "directory-scope-file"):
                supervisor.checked_scope(scope, digest, binary)


if __name__ == "__main__":
    unittest.main(verbosity=2)
