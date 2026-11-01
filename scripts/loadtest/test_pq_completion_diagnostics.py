"""Pure report controls; no node, signer, network, load window or finality proof.

All reply spans and ledger counts here are unit input data. In particular, the
500-entry controls exercise the configured denominator, not chain performance.
"""

import copy
import importlib.util
import io
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "pq_completion_diagnostics_controls",
    Path(__file__).with_name("pq-independent-load.py"),
)
driver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(driver)


def reply(elapsed_ns=1_000, outcome="REJECTED", kind="sign"):
    """Public protocol-shaped unit metadata, with no business result or proof."""
    value = {
        "code": outcome,
        "timings": {
            "version": "YNX-PQ-LAB-CALLEE-ELAPSED/v1",
            "clock": "monotonic_elapsed_wall_ns",
            "intervalsOverlap": True,
            "stages": {"unit-parent": {"calls": 1, "elapsedNs": elapsed_ns}},
        },
    }
    value["startupElapsedNs" if kind == "startup" else "calleeElapsedNs"] = elapsed_ns
    return value


def result(measurements=None, *, demand=500, qualified=0, submitted=0):
    """Report-shaped input only; passing it does not execute any load."""
    value = {
        "configuredDemand": demand,
        "loadExecuted": True,
        "cleanupComplete": True,
        "firstCause": None,
        "normalLiveCalleeUsed": True,
        "loadResult": {
            "configuredDemand": demand,
            "windowCompleted": True,
            "logicalReleased": demand,
            "notReleased": 0,
            "submitted": submitted,
            "notSubmitted": demand - submitted,
            "qualified": qualified,
            "notQualified": demand - qualified,
            "firstCause": None,
            "firstOperationalFailure": None,
        },
    }
    if measurements is not None:
        value["normalCalleeMeasurements"] = measurements.report()
    return value


class CompletionDiagnosticsControls(unittest.TestCase):
    def setUp(self):
        # These controls must remain pure even if a future refactor accidentally
        # calls an execution helper while computing a report.
        for target in (
            "subprocess.Popen",
            "urllib.request.urlopen",
            "socket.create_connection",
        ):
            patcher = mock.patch(target, side_effect=AssertionError("pure report control attempted external IO"))
            patcher.start()
            self.addCleanup(patcher.stop)

    def assert_incomplete(self, diagnostic):
        self.assertFalse(diagnostic["fullBusinessDemandComplete"])
        self.assertFalse(diagnostic["authorityGranted"])
        self.assertEqual(diagnostic["classification"], "FULL_BUSINESS_DEMAND_INCOMPLETE")

    def assert_censored(self, span, observed, denominator=500):
        self.assertEqual(span["denominator"], denominator)
        self.assertEqual(span["observed"], observed)
        self.assertEqual(span["censoredOrNotReached"], denominator - observed)
        self.assertEqual(span["fullDemandPercentilesMs"], {"p50": None, "p95": None, "p99": None})

    def test_rejected_reply_is_observed_timing_and_never_business_success(self):
        measurements = driver.CalleeMeasurements(500, 8)
        measurements.record("sign", "unit-rejected-sign", reply())
        group = measurements.report()["groups"]["sign"]
        self.assertEqual(group["outcomes"], {"REJECTED": 1})
        self.assertEqual(group["replyTimingCoverage"]["completedReplyObservations"], 1)
        self.assertEqual(group["replyTimingCoverage"]["missingTimingForCompletedReplies"], 0)
        self.assertEqual(group["replyTimingCoverage"]["notReachedOrReplyNotSupplied"], 499)
        self.assertTrue(group["replyTimingCoverage"]["completedRepliesHaveTiming"])
        self.assert_censored(group["calleeElapsed"], 1)
        diagnostic = driver.completion_diagnostics(result(measurements))
        self.assert_incomplete(diagnostic)
        self.assertEqual(diagnostic["qualified"], 0)
        self.assertEqual(diagnostic["notQualified"], 500)
        self.assertEqual(diagnostic["notSubmitted"], 500)
        self.assertEqual(diagnostic["missingTimingForCompletedReplies"], 0)

    def test_received_reply_missing_timing_retains_original_error_and_demand(self):
        measurements = driver.CalleeMeasurements(500, 8)
        bad_reply = reply()
        del bad_reply["timings"]
        with self.assertRaisesRegex(RuntimeError, "exact original callee elapsed schema required") as raised:
            measurements.record("sign", "unit-missing-timing", bad_reply)
        original_error = str(raised.exception)
        value = result(measurements)
        value["firstCause"] = original_error
        value["loadResult"]["firstOperationalFailure"] = {
            "id": "unit-missing-timing", "index": 0, "atNs": 1, "error": original_error,
        }
        before = copy.deepcopy(value)
        diagnostic = driver.completion_diagnostics(value)
        self.assertEqual(value, before)
        self.assert_incomplete(diagnostic)
        self.assertEqual(diagnostic["originalDriverFirstCause"], original_error)
        self.assertEqual(diagnostic["firstOperationalFailure"], before["loadResult"]["firstOperationalFailure"])
        self.assertEqual(diagnostic["missingTimingForCompletedReplies"], 1)
        coverage = diagnostic["replyTimingCoverage"]["sign"]
        self.assertEqual(coverage["completedReplyObservations"], 1)
        self.assertEqual(coverage["timingRecordFailures"], 1)
        self.assertEqual(coverage["missingTimingForCompletedReplies"], 1)
        self.assertEqual(coverage["notReachedOrReplyNotSupplied"], 499)
        self.assertFalse(coverage["completedRepliesHaveTiming"])
        self.assertFalse(coverage["fullDemandTimingComplete"])
        self.assert_censored(value["normalCalleeMeasurements"]["groups"]["sign"]["calleeElapsed"], 0)

    def test_invalid_timing_or_elapsed_is_counted_as_received_not_unreached(self):
        for mutation in ("negative-span", "missing-elapsed", "boolean-elapsed", "foreign-clock"):
            with self.subTest(mutation=mutation):
                measurements = driver.CalleeMeasurements(500, 8)
                bad = reply()
                if mutation == "negative-span":
                    bad["timings"]["stages"]["unit-parent"]["elapsedNs"] = -1
                elif mutation == "missing-elapsed":
                    del bad["calleeElapsedNs"]
                elif mutation == "boolean-elapsed":
                    bad["calleeElapsedNs"] = True
                else:
                    bad["timings"]["clock"] = "realtime_ns"
                with self.assertRaises(RuntimeError):
                    measurements.record("sign", "unit-invalid", bad)
                group = measurements.report()["groups"]["sign"]
                coverage = group["replyTimingCoverage"]
                self.assertEqual(coverage["completedReplyObservations"], 1)
                self.assertEqual(coverage["timingRecordFailures"], 1)
                self.assertEqual(coverage["missingTimingForCompletedReplies"], 1)
                self.assertEqual(coverage["notReachedOrReplyNotSupplied"], 499)
                self.assertEqual(group["outcomes"], {})
                self.assert_censored(group["calleeElapsed"], 0)

    def test_live_helper_missing_timing_is_counted_at_the_real_call_boundary(self):
        for operation, kind in (("request", "live_publish"), ("result", "live_result")):
            with self.subTest(operation=operation):
                measurements = driver.CalleeMeasurements(500, 8)
                backend = object.__new__(driver.NormalBackend)
                backend.c = SimpleNamespace(bins=Path("/UNIT-NOT-AN-EXECUTABLE"), measurements=measurements)
                backend.helper = mock.Mock(return_value={"outcome": "REJECTED"})
                with self.assertRaisesRegex(RuntimeError, "schema"):
                    backend.call("unit-" + operation, ["live-materials", operation, "--synthetic"])
                backend.helper.assert_called_once()
                self.assertEqual(backend.helper.call_args.args[1].count("--timings"), 1)
                coverage = measurements.report()["groups"][kind]["replyTimingCoverage"]
                self.assertEqual(coverage["completedReplyObservations"], 1)
                self.assertEqual(coverage["timingRecordFailures"], 1)
                self.assertEqual(coverage["missingTimingForCompletedReplies"], 1)
                self.assertEqual(coverage["notReachedOrReplyNotSupplied"], 499)

    def test_received_sender_reply_with_bad_startup_echo_is_not_unreached(self):
        measurements = driver.CalleeMeasurements(500, 8)
        session = object.__new__(driver.SenderSession)
        session.c = SimpleNamespace(measurements=measurements)
        session.owner = 4
        session.ready = {"sourceStartupElapsedNs": 100}
        session.startup_snapshot = reply(100, kind="startup")["timings"]
        session.proc = SimpleNamespace(poll=lambda: None, stdin=io.BytesIO())
        returned = reply(outcome="REJECTED")
        returned.update(startupElapsedNs=101, startupTimings=copy.deepcopy(session.startup_snapshot))
        session.receive = mock.Mock(return_value=returned)
        command = driver.normal.sender_command_data("sign", {"operationId": "unit-echo-mismatch"})
        with self.assertRaisesRegex(RuntimeError, "startup echo differs"):
            session.exchange(command, Path("/UNIT-NOT-A-REAL-REPLY"), threading.Event())
        session.receive.assert_called_once()
        coverage = measurements.report()["groups"]["sign"]["replyTimingCoverage"]
        self.assertEqual(coverage["completedReplyObservations"], 1)
        self.assertEqual(coverage["timingRecordFailures"], 1)
        self.assertEqual(coverage["missingTimingForCompletedReplies"], 1)
        self.assertEqual(coverage["notReachedOrReplyNotSupplied"], 499)
        self.assertEqual(measurements.report()["groups"]["sign"]["calleeElapsed"]["observed"], 0)
        self.assertEqual(measurements.report()["groups"]["startup"]["calleeElapsed"]["observed"], 0)

    def test_duplicate_reply_does_not_add_timing_or_rewrite_first_outcome(self):
        measurements = driver.CalleeMeasurements(500, 8)
        measurements.record("sign", "unit-same-identity", reply(1_000, "REJECTED"))
        before = measurements.report()
        with self.assertRaisesRegex(RuntimeError, "duplicate"):
            measurements.record("sign", "unit-same-identity", reply(99_000, "ORIGINAL_SAVED"))
        self.assertEqual(measurements.report(), before)
        self.assertEqual(before["groups"]["sign"]["outcomes"], {"REJECTED": 1})
        self.assertEqual(before["groups"]["sign"]["calleeElapsed"]["totalNs"], 1_000)

    def test_invalid_first_reply_cannot_be_repaired_by_replaying_same_identity(self):
        measurements = driver.CalleeMeasurements(500, 8)
        with self.assertRaisesRegex(RuntimeError, "schema"):
            measurements.record("sign", "unit-retained-invalid", {"code": "UNKNOWN"})
        before = measurements.report()
        with self.assertRaisesRegex(RuntimeError, "duplicate"):
            measurements.record("sign", "unit-retained-invalid", reply())
        self.assertEqual(measurements.report(), before)
        self.assertEqual(before["groups"]["sign"]["replyTimingCoverage"]["missingTimingForCompletedReplies"], 1)

    def test_over_denominator_reply_does_not_inflate_full_coverage(self):
        measurements = driver.CalleeMeasurements(1, 1)
        measurements.record("sign", "unit-first", reply())
        before = measurements.report()
        with self.assertRaisesRegex(RuntimeError, "over-denominator"):
            measurements.record("sign", "unit-extra", reply())
        self.assertEqual(measurements.report(), before)

    def test_zero_replies_have_no_missing_timer_claim_or_percentile(self):
        measurements = driver.CalleeMeasurements(500, 8)
        report = measurements.report()
        expected = {"startup": 8, "live_setup": 4, "sign": 500, "confirm": 500, "live_publish": 500, "live_result": 500}
        self.assertEqual(set(report["groups"]), set(expected))
        for kind, denominator in expected.items():
            with self.subTest(kind=kind):
                group = report["groups"][kind]
                coverage = group["replyTimingCoverage"]
                self.assertEqual(coverage["completedReplyObservations"], 0)
                self.assertEqual(coverage["timingRecordFailures"], 0)
                self.assertEqual(coverage["missingTimingForCompletedReplies"], 0)
                self.assertEqual(coverage["notReachedOrReplyNotSupplied"], denominator)
                self.assertIsNone(coverage["completedRepliesHaveTiming"])
                self.assertFalse(coverage["fullDemandTimingComplete"])
                self.assert_censored(group["calleeElapsed"], 0, denominator)
        diagnostic = driver.completion_diagnostics(result(measurements))
        self.assert_incomplete(diagnostic)
        self.assertEqual(diagnostic["missingTimingForCompletedReplies"], 0)
        self.assertFalse(diagnostic["fullDemandCalleeTimingComplete"])

    def test_partial_reply_coverage_keeps_full500_denominator(self):
        measurements = driver.CalleeMeasurements(500, 8)
        for index in range(8):
            measurements.record("sign", "unit-sign-%d" % index, reply((index + 1) * 1_000, "UNKNOWN"))
        measurements.record("confirm", "unit-confirm-rejected", reply(outcome="REJECTED", kind="confirm"))
        # This is a diagnostic-shaped partial-count fixture, not a replay of any
        # original UNKNOWN transaction or a fabricated normal business receipt.
        value = result(measurements, qualified=1, submitted=8)
        before = copy.deepcopy(value)
        diagnostic = driver.completion_diagnostics(value)
        self.assertEqual(value, before)
        self.assert_incomplete(diagnostic)
        self.assertEqual((diagnostic["configuredDemand"], diagnostic["qualified"], diagnostic["notQualified"], diagnostic["notSubmitted"]), (500, 1, 499, 492))
        groups = value["normalCalleeMeasurements"]["groups"]
        self.assert_censored(groups["sign"]["calleeElapsed"], 8)
        self.assert_censored(groups["confirm"]["calleeElapsed"], 1)
        self.assert_censored(groups["sign"]["stages"]["unit-parent"], 8)
        self.assertEqual(diagnostic["replyTimingCoverage"]["sign"]["notReachedOrReplyNotSupplied"], 492)
        self.assertEqual(diagnostic["replyTimingCoverage"]["confirm"]["notReachedOrReplyNotSupplied"], 499)
        self.assertEqual(diagnostic["missingTimingForCompletedReplies"], 0)

    def test_complete500_timing_of_rejected_replies_never_completes_business(self):
        measurements = driver.CalleeMeasurements(500, 8)
        for kind, count in measurements.denominators.items():
            for index in range(count):
                measurements.record(kind, "unit-%s-%d" % (kind, index), reply((index + 1) * 1_000, "REJECTED", kind))
        value = result(measurements, qualified=499, submitted=500)
        diagnostic = driver.completion_diagnostics(value)
        self.assert_incomplete(diagnostic)
        self.assertTrue(diagnostic["fullDemandCalleeTimingComplete"])
        self.assertEqual(diagnostic["missingTimingForCompletedReplies"], 0)
        self.assertEqual(diagnostic["notQualified"], 1)
        for kind, count in measurements.denominators.items():
            group = value["normalCalleeMeasurements"]["groups"][kind]
            self.assertEqual(group["outcomes"], {"REJECTED": count})
            self.assertTrue(group["replyTimingCoverage"]["fullDemandTimingComplete"])
        self.assertEqual(value["normalCalleeMeasurements"]["groups"]["sign"]["calleeElapsed"]["fullDemandPercentilesMs"], {"p50": 0.25, "p95": 0.475, "p99": 0.495})

    def test_preparation_only_and_absent_load_result_are_not_completed(self):
        for executed, classification in ((False, "PREPARATION_ONLY"), (True, "LOAD_RESULT_NOT_SUPPLIED")):
            with self.subTest(executed=executed):
                value = {"configuredDemand": 500, "loadExecuted": executed, "cleanupComplete": True, "firstCause": "original preparation failure"}
                before = copy.deepcopy(value)
                diagnostic = driver.completion_diagnostics(value)
                self.assertEqual(value, before)
                self.assertEqual(diagnostic["classification"], classification)
                self.assertEqual(diagnostic["configuredDemand"], 500)
                self.assertFalse(diagnostic["fullBusinessDemandComplete"])
                self.assertFalse(diagnostic["fullDemandCalleeTimingComplete"])
                self.assertFalse(diagnostic["authorityGranted"])
                self.assertIsNone(diagnostic["missingTimingForCompletedReplies"])
                self.assertIsNone(diagnostic["qualified"])
                self.assertEqual(diagnostic["originalDriverFirstCause"], "original preparation failure")

    def test_legacy_missing_coverage_is_unknown_not_filled_in(self):
        measurements = driver.CalleeMeasurements(500, 8)
        value = result(measurements)
        for group in value["normalCalleeMeasurements"]["groups"].values():
            del group["replyTimingCoverage"]
        diagnostic = driver.completion_diagnostics(value)
        self.assert_incomplete(diagnostic)
        self.assertFalse(diagnostic["fullDemandCalleeTimingComplete"])
        self.assertIsNone(diagnostic["missingTimingForCompletedReplies"])
        self.assertTrue(all(coverage is None for coverage in diagnostic["replyTimingCoverage"].values()))

    def test_business_completion_does_not_grant_authority(self):
        value = result(qualified=500, submitted=500)
        diagnostic = driver.completion_diagnostics(value)
        self.assertEqual(diagnostic["classification"], "FULL_BUSINESS_DEMAND_COMPLETE")
        self.assertTrue(diagnostic["fullBusinessDemandComplete"])
        self.assertFalse(diagnostic["authorityGranted"])
        self.assertFalse(diagnostic["fullDemandCalleeTimingComplete"])
        self.assertIsNone(diagnostic["missingTimingForCompletedReplies"])

    def test_driver_failure_or_incomplete_window_or_cleanup_blocks_completion(self):
        for change in ("driver-first-cause", "window", "cleanup"):
            with self.subTest(change=change):
                value = result(qualified=500, submitted=500)
                if change == "driver-first-cause":
                    value["firstCause"] = "original durable journal failure"
                elif change == "window":
                    value["loadResult"]["windowCompleted"] = False
                else:
                    value["cleanupComplete"] = False
                before = copy.deepcopy(value)
                diagnostic = driver.completion_diagnostics(value)
                self.assertEqual(value, before)
                self.assert_incomplete(diagnostic)

    def test_nested_first_cause_cannot_be_promoted_when_outer_cause_is_missing(self):
        value = result(qualified=500, submitted=500)
        value["loadResult"]["firstCause"] = "retained original scheduler failure"
        before = copy.deepcopy(value)
        diagnostic = driver.completion_diagnostics(value)
        self.assertEqual(value, before)
        self.assert_incomplete(diagnostic)

    def test_retained_operational_failure_cannot_be_promoted_to_complete(self):
        value = result(qualified=500, submitted=500)
        first_failure = {"id": "unit-original-unknown", "index": 0, "atNs": 1, "error": "UNKNOWN retained"}
        value["loadResult"]["firstOperationalFailure"] = first_failure
        diagnostic = driver.completion_diagnostics(value)
        self.assertEqual(diagnostic["firstOperationalFailure"], first_failure)
        self.assert_incomplete(diagnostic)

    def test_unsubmitted_demand_or_mismatched_denominator_cannot_be_complete(self):
        for change in ("not-submitted", "denominator"):
            with self.subTest(change=change):
                value = result(qualified=500, submitted=500)
                if change == "not-submitted":
                    value["loadResult"].update(submitted=499, notSubmitted=1)
                else:
                    value["loadResult"]["configuredDemand"] = 499
                self.assert_incomplete(driver.completion_diagnostics(value))

    def test_pool_sender_open_groups_read_original_ready_startup_elapsed(self):
        for kind in ("sender_open_sign", "sender_open_confirm"):
            with self.subTest(kind=kind):
                measurements = driver.CalleeMeasurements(500, 500, sender_pool=True)
                # Protocol-shaped PUBLIC timing metadata only. No custody,
                # signing, nonce reservation or business result is performed.
                ready = {
                    "version": "YNX-PQ-LAB-SENDER-READY/v1",
                    "status": "original_custody_opened_imported_writer_lease_held",
                    "ownerIndex": 4,
                    "planSHA256": "a" * 64,
                    "workloadSHA256": "b" * 64,
                    "startupElapsedNs": 123_456,
                    "timings": reply(123_456, kind="startup")["timings"],
                    "syntheticOnly": True,
                    "authorityGranted": False,
                    "signed": False,
                    "nonceReserved": False,
                }
                self.assertNotIn("calleeElapsedNs", ready)
                measurements.record(kind, "UNIT-ORIGINAL-OPEN", ready, owner=4)
                report = measurements.report()
                self.assertNotIn("startup", report["groups"])
                group = report["groups"][kind]
                self.assertEqual(group["calleeElapsed"]["totalNs"], 123_456)
                self.assert_censored(group["calleeElapsed"], 1)
                coverage = group["replyTimingCoverage"]
                self.assertEqual(coverage["completedReplyObservations"], 1)
                self.assertEqual(coverage["timingRecordFailures"], 0)
                self.assertEqual(coverage["missingTimingForCompletedReplies"], 0)
                self.assertEqual(coverage["notReachedOrReplyNotSupplied"], 499)
                self.assertTrue(coverage["completedRepliesHaveTiming"])
                self.assertEqual(report["groups"]["sign"]["calleeElapsed"]["observed"], 0)
                self.assertEqual(report["groups"]["confirm"]["calleeElapsed"]["observed"], 0)
                self.assertNotIn("qualified", report)

    def test_full500_counts_without_normal_live_callee_are_not_complete(self):
        for supplied in (False, None):
            with self.subTest(normalLiveCalleeUsed=supplied):
                value = result(qualified=500, submitted=500)
                if supplied is None:
                    del value["normalLiveCalleeUsed"]
                else:
                    value["normalLiveCalleeUsed"] = supplied
                before = copy.deepcopy(value)
                diagnostic = driver.completion_diagnostics(value)
                self.assertEqual(value, before)
                self.assertEqual(diagnostic["configuredDemand"], 500)
                self.assertEqual(diagnostic["qualified"], 500)
                self.assertEqual(diagnostic["notQualified"], 0)
                self.assert_incomplete(diagnostic)


if __name__ == "__main__":
    unittest.main(verbosity=2)
