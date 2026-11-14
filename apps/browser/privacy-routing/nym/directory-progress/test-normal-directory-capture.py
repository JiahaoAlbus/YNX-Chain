#!/usr/bin/env python3
"""Scoped DATA-only checks using a previously captured normal directory."""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normal_directory_capture import DirectoryCaptureError, summarize, summarize_terminal

WD = Path("/REDACTED_VOLUME/YNX-large-work")
EXACT_CAPTURE = WD / (
    "coordination-v5-20261031/owners/P05/privacy-routing/supply/nym/"
    "protected-numeric-overlay/directory.1pbZ97/stdout.json"
)
CAPTURE_SHA = "a346a57c2682c5e37aafb383485ea6dcf1a3aa964b6aed6bbafe7f7fceaf5e67"


class NormalDirectoryCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.observed = datetime(2026, 11, 1, 0, 36, 11, 279000, tzinfo=timezone.utc)

    def test_exact_historical_normal_capture_at_original_time(self):
        data = EXACT_CAPTURE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), CAPTURE_SHA)
        result = summarize(data, observed_utc=self.observed)
        self.assertEqual(result.epoch, 34711)
        self.assertEqual(result.rotation, 479)
        self.assertEqual(result.basic_rows, 869)
        self.assertEqual(result.payload_sha256, hashlib.sha256(data[:-1]).hexdigest())
        # The captured payload stays valid historical evidence, but cannot be refreshed by retaining it.
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-stale-epoch"):
            summarize(data, observed_utc=result.epoch_end_utc - timedelta(seconds=300))

    def fixture(self):
        return {
            "schema": "YNX_NYM_DIRECTORY_V1",
            "basic": {
                "metadata": {"status": None, "absolute_epoch_id": 9, "rotation_id": 1,
                             "refreshed_at": "2026-11-01 00:31:18.192459755 +00:00:00"},
                "nodes": {"pagination": {"page": 0, "total": 2, "size": 1},
                          "data": [{"node_id": 11}, {"node_id": 22}]},
            },
            "described": {"pagination": {"page": 0, "total": 1, "size": 1}, "data": [{"node_id": 11}]},
            "epoch": {"total_elapsed_epochs": 9, "current_epoch_start": "2026-11-01T00:26:19Z",
                      "epoch_length": {"secs": 3600, "nanos": 0}},
        }

    def summarize_document(self, value):
        return summarize(json.dumps(value, separators=(",", ":")).encode() + b"\n", observed_utc=self.observed)

    def test_first_page_size_is_not_aggregate_row_count(self):
        result = self.summarize_document(self.fixture())
        self.assertEqual((result.basic_rows, result.described_rows), (2, 1))

    def test_reject_basic_partial_or_duplicate(self):
        value = self.fixture()
        value["basic"]["nodes"]["data"].pop()
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-table-incomplete"):
            self.summarize_document(value)
        value = self.fixture()
        value["basic"]["nodes"]["data"][1]["node_id"] = 11
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-node-id"):
            self.summarize_document(value)

    def test_reject_missing_metadata_status_or_epoch_mix(self):
        value = self.fixture()
        del value["basic"]["metadata"]["status"]
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-metadata"):
            self.summarize_document(value)
        value = self.fixture()
        value["epoch"]["total_elapsed_epochs"] += 1
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-epoch-mismatch"):
            self.summarize_document(value)

    def test_reject_ambiguous_json_or_trailing_payload(self):
        data = json.dumps(self.fixture()).encode()
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-duplicate-field"):
            summarize(b'{"schema":"YNX_NYM_DIRECTORY_V1",' + data[1:] + b"\n",
                      observed_utc=self.observed)
        with self.assertRaisesRegex(DirectoryCaptureError, "directory-output-frame"):
            summarize(data + b"\n\n", observed_utc=self.observed)

    def test_terminal_binding_rejects_missing_wait_or_eof_and_either_expired_clock(self):
        data = json.dumps(self.fixture()).encode() + b"\n"
        state = {
            "process": {"pid": 400, "pgid": 400, "terminalOutcome": "ORIGINAL_POPEN_WAIT",
                        "reaped": True, "exit": 0},
            "stdout_eof": True, "stderr_eof": True, "fds_closed": True, "supervisor_live": True,
            "observed_utc": self.observed, "expires_utc": self.observed + timedelta(seconds=1),
            "now_monotonic_ns": 10, "deadline_monotonic_ns": 11,
        }
        self.assertEqual(summarize_terminal(data, **state).receipt_data()["epoch"], 9)
        checks = (
            ("process", {**state["process"], "exit": False}, "capture-incomplete"),
            ("process", {**state["process"], "reaped": False}, "capture-incomplete"),
            ("stderr_eof", False, "capture-incomplete"),
            ("supervisor_live", False, "capture-incomplete"),
            ("now_monotonic_ns", 11, "capture-expired"),
            ("expires_utc", self.observed, "capture-expired"),
        )
        for field, item, error in checks:
            with self.subTest(field=field), self.assertRaisesRegex(DirectoryCaptureError, error):
                summarize_terminal(data, **{**state, field: item})


if __name__ == "__main__":
    unittest.main(verbosity=2)
