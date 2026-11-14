"""Finite scheduler controls with structural callbacks, never chain evidence.

No node, signer, RPC, private material or proof verifier is used. The 500-row
case checks demand accounting only; its timings are not transaction benchmarks.
"""

import collections
import copy
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "pq_staged_scheduler_controls",
    Path(__file__).with_name("pq-staged-independent-scheduler.py"),
)
staged = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staged)


def plan(count=8, accounts=8, tail_ns=150_000_000):
    raw = staged.original.make_plan(
        "a" * 64,
        "b" * 64,
        "online",
        [
            {"ownerIndex": 4 + index, "address": "UNIT-ONLY-%d" % index, "nextNonce": 2, "capacity": count}
            for index in range(accounts)
        ],
        1000,
        count * 1_000_000,
        tail_ns,
    )
    return staged.configure(raw)


class Handle:
    """An opaque in-memory unit token; there is no transaction body to replay."""

    def __init__(self, row, account):
        self.row = dict(row)
        self.account = dict(account)
        self.token = object()


class StructuralBackend:
    def __init__(self, *, block=None, unknown_after_post=False, qualified_change=None, omit_event=None, publish_error=None):
        self.block = block
        self.unknown_after_post = unknown_after_post
        self.qualified_change = qualified_change or {}
        self.omit_event = omit_event
        self.publish_error = publish_error
        self.lock = threading.Lock()
        self.calls = {stage: [] for stage in ("publish", "observe", "finalize")}
        self.active = dict.fromkeys(self.calls, 0)
        self.peak = dict.fromkeys(self.calls, 0)
        self.thread_ids = {stage: set() for stage in self.calls}
        self.handles = {}
        self.started = {stage: threading.Event() for stage in self.calls}
        self.stop_calls = 0
        self.owned_stopped = threading.Event()

    def enter(self, stage, row):
        with self.lock:
            self.calls[stage].append(dict(row))
            self.active[stage] += 1
            self.peak[stage] = max(self.peak[stage], self.active[stage])
            self.thread_ids[stage].add(threading.get_ident())
            self.started[stage].set()

    def leave(self, stage):
        with self.lock:
            self.active[stage] -= 1

    def wait_if_blocked(self, stage, stop):
        if self.block == stage:
            stop.wait()
            raise RuntimeError("UNIT original %s interrupted; preserve UNKNOWN" % stage)

    def publish(self, row, account, notify, stop):
        self.enter("publish", row)
        try:
            handle = Handle(row, account)
            with self.lock:
                self.handles[row["index"]] = handle
            notify({"kind": "signed", "hash": format(row["index"] + 1, "064x"), "nativeHash": format(row["index"] + 10001, "064x")})
            if self.omit_event != "submitted":
                notify({"kind": "submitted"})
            if self.publish_error is not None:
                raise self.publish_error
            if self.unknown_after_post:
                raise RuntimeError("UNIT uncertain post; original UNKNOWN is not replayable")
            self.wait_if_blocked("publish", stop)
            return handle
        finally:
            self.leave("publish")

    def observe(self, handle, notify, stop):
        if self.handles[handle.row["index"]] is not handle:
            raise AssertionError("opaque publication handle was replaced")
        self.enter("observe", handle.row)
        try:
            self.wait_if_blocked("observe", stop)
            if self.omit_event != "included":
                notify({"kind": "included"})
            return handle
        finally:
            self.leave("observe")

    def finalize(self, handle, notify, stop):
        if self.handles[handle.row["index"]] is not handle:
            raise AssertionError("opaque observation handle was replaced")
        self.enter("finalize", handle.row)
        try:
            self.wait_if_blocked("finalize", stop)
            # Structural Ledger callback data only, never handed to a normal
            # chain execution entry or represented as a cryptographic proof.
            event = {
                "kind": "qualified",
                "hash": format(handle.row["index"] + 1, "064x"),
                "nativeHash": format(handle.row["index"] + 10001, "064x"),
                "normalVerifierCode": "VERIFIED_TRANSACTION_DATA",
                "executionSuccessful": True,
                "executionCode": "0",
                "transactionType": "pq_transfer",
                "members": 1,
                "nativeGrant": False,
                "normalConfirmCode": "PROOF_CONFIRMED_DATA",
                "proofReference": "UNIT-STRUCTURAL-CALLBACK-NOT-A-PROOF",
            }
            event.update(self.qualified_change)
            if self.omit_event != "qualified":
                notify(event)
        finally:
            self.leave("finalize")

    def stop(self):
        self.stop_calls += 1
        self.owned_stopped.set()


class StagedIndependentSchedulerControls(unittest.TestCase):
    def setUp(self):
        for target in (
            "subprocess.Popen",
            "urllib.request.urlopen",
            "socket.create_connection",
            "os.kill",
            "os.killpg",
        ):
            patcher = mock.patch(target, side_effect=AssertionError("pure scheduler control attempted external process/network action"))
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_control(self, configured, backend, check=lambda: None, ledger_module=None):
        events = []
        stop = threading.Event()
        result = staged.run(configured, backend, events.append, check, stop, ledger_module=staged.original if ledger_module is None else ledger_module)
        self.assertTrue(stop.is_set())
        self.assertEqual(backend.stop_calls, 1)
        self.assertTrue(backend.owned_stopped.is_set())
        self.assertEqual(backend.active, {"publish": 0, "observe": 0, "finalize": 0})
        self.assertTrue(result["pipeline"]["workerThreadsRetired"])
        self.assertEqual(result["stableFinalTPS"], "UNMEASURED")
        self.assertEqual(result["P95FinalConfirmation"], "UNMEASURED")
        self.assertFalse(result["physicalCommitMeasured"])
        return result, events

    def assert_censored(self, result, count):
        self.assertEqual(result["configuredDemand"], count)
        for name in ("endToEndLogicalArrivalToQualified", "submitToQualifiedReceiptObserved"):
            with self.subTest(interval=name):
                interval = result[name]
                self.assertEqual(interval["denominator"], count)
                self.assertLess(interval["observed"], count)
                self.assertEqual(interval["censored"], count - interval["observed"])
                self.assertIsNone(interval["p50Ms"])
                self.assertIsNone(interval["p95Ms"])
                self.assertIsNone(interval["p99Ms"])

    def assert_queue_bounds(self, result):
        pipeline = result["pipeline"]
        self.assertEqual(pipeline["stageWorkers"], {"publish": 2, "observe": 2, "finalize": 4})
        self.assertEqual(pipeline["queueCapacity"], {"publish": 4, "observe": result["configuredDemand"], "finalize": result["configuredDemand"]})
        for stage, capacity in pipeline["queueCapacity"].items():
            with self.subTest(stage=stage):
                self.assertGreaterEqual(pipeline["queuePeak"][stage], 0)
                self.assertLessEqual(pipeline["queuePeak"][stage], capacity)
                self.assertGreaterEqual(pipeline["queueAtCutoff"][stage], 0)
                self.assertLessEqual(pipeline["queueAtCutoff"][stage], capacity)

    def test_owner_prepare_stage_crosses_normal_staged_ledger(self):
        class PreparedBackend(StructuralBackend):
            def publish(self, row, account, notify, stop):
                notify(dict(kind='normal_stage', stage='owner_prepare'))
                notify(dict(kind='normal_stage', stage='sender_ready_checkpoint'))
                return super().publish(row, account, notify, stop)

        result, _ = self.run_control(plan(1, 1), PreparedBackend())
        self.assertIsNone(result['firstCause'])
        self.assertEqual(result['qualified'], 1)
        names = [name for name, _ in result['rows'][0]['stageTimes']]
        self.assertLess(names.index('owner_prepare'), names.index('sender_ready_checkpoint'))
        self.assertIn('owner_prepare', result['completedStageIntervals'])

    def test_configure_deep_copies_demand_and_fixes_eight_worker_bounds(self):
        raw = staged.original.make_plan(
            "a" * 64, "b" * 64, "online",
            [{"ownerIndex": 4, "address": "UNIT-CONFIG", "nextNonce": 2, "capacity": 500}],
            1000, 500_000_000, 150_000_000,
        )
        before = copy.deepcopy(raw)
        configured = staged.configure(raw)
        self.assertEqual(raw, before)
        self.assertEqual(configured["configuredDemand"], 500)
        self.assertEqual(configured["rows"], raw["rows"])
        self.assertEqual(configured["accounts"], raw["accounts"])
        self.assertEqual(configured["outstandingPerAccount"], 1)
        self.assertEqual(configured["workerLimit"], 8)
        self.assertEqual(configured["pipeline"]["stageWorkers"], {"publish": 2, "observe": 2, "finalize": 4})
        self.assertEqual(configured["pipeline"]["queueCapacity"], {"publish": 4, "observe": 500, "finalize": 500})
        configured["rows"][0]["logicalArrivalOffsetNs"] = 999
        configured["accounts"][0]["nextNonce"] = 999
        self.assertEqual(raw, before)

    def test_mutated_queue_or_worker_bounds_fail_before_any_work(self):
        for change in ("worker-total", "proof-workers", "publish-queue", "observe-queue", "finalize-queue"):
            with self.subTest(change=change):
                configured = plan(8, 8)
                if change == "worker-total":
                    configured["workerLimit"] = 9
                elif change == "proof-workers":
                    configured["pipeline"]["stageWorkers"]["finalize"] = 5
                else:
                    configured["pipeline"]["queueCapacity"][change.removesuffix("-queue")] += 1
                backend = StructuralBackend()
                events = []
                check = mock.Mock()
                with self.assertRaisesRegex(ValueError, "exact bounded staged pipeline required"):
                    staged.run(configured, backend, events.append, check, threading.Event())
                self.assertEqual(backend.calls, {"publish": [], "observe": [], "finalize": []})
                self.assertEqual(backend.stop_calls, 0)
                self.assertEqual(events, [])
                check.assert_not_called()

    def test_blocked_proofs_leave_publication_free_and_preserve_full500(self):
        backend = StructuralBackend(block="finalize")
        result, events = self.run_control(plan(500, 8), backend)
        self.assertIsNone(result["firstCause"])
        self.assertEqual(len(backend.calls["publish"]), 8)
        self.assertEqual(len(backend.calls["observe"]), 8)
        self.assertEqual(len(backend.calls["finalize"]), 4)
        self.assertEqual(backend.peak["finalize"], 4)
        self.assertLessEqual(backend.peak["publish"], 2)
        self.assertLessEqual(backend.peak["observe"], 2)
        self.assertTrue(backend.thread_ids["publish"].isdisjoint(backend.thread_ids["finalize"]))
        self.assertEqual(result["logicalReleased"], 500)
        self.assertEqual(result["submitted"], 8)
        self.assertEqual(result["notSubmitted"], 492)
        self.assertEqual(result["qualified"], 0)
        self.assertEqual(result["notQualified"], 500)
        self.assertGreater(result["pipeline"]["queueAtCutoff"]["finalize"], 0)
        self.assertEqual(len([event for event in events if event["kind"] == "submitted"]), 8)
        self.assert_censored(result, 500)
        self.assert_queue_bounds(result)

    def test_sixteen_accounts_publish_and_observe_while_all_four_proofs_block(self):
        class SixteenAccountBackend(StructuralBackend):
            def __init__(self):
                super().__init__(block="finalize")
                self.four_proofs_blocked = threading.Event()
                self.later_publications = []
                self.later_observations = []

            def enter(self, stage, row):
                super().enter(stage, row)
                if stage == "finalize":
                    with self.lock:
                        if self.active["finalize"] == 4:
                            self.four_proofs_blocked.set()

            def record_later_progress(self, row, destination):
                if row["index"] >= 8:
                    if not self.four_proofs_blocked.wait(timeout=0.1):
                        raise AssertionError("four original proof workers never blocked")
                    with self.lock:
                        if self.active["finalize"] != 4:
                            raise AssertionError("later-account progress occurred without four blocked proofs")
                        destination.append(row["index"])

            def publish(self, row, account, notify, stop):
                self.record_later_progress(row, self.later_publications)
                return super().publish(row, account, notify, stop)

            def observe(self, handle, notify, stop):
                self.record_later_progress(handle.row, self.later_observations)
                return super().observe(handle, notify, stop)

        backend = SixteenAccountBackend()
        configured = plan(16, 16)
        result, events = self.run_control(configured, backend)
        self.assertTrue(backend.four_proofs_blocked.is_set())
        self.assertEqual(sorted(backend.later_publications), list(range(8, 16)))
        self.assertEqual(sorted(backend.later_observations), list(range(8, 16)))
        self.assertEqual(len(backend.calls["publish"]), 16)
        self.assertEqual(len(backend.calls["observe"]), 16)
        self.assertEqual(len(backend.calls["finalize"]), 4)
        self.assertEqual(len({row["ownerIndex"] for row in backend.calls["publish"]}), 16)
        self.assertEqual(configured["workerLimit"], 8)
        self.assertEqual(sum(result["pipeline"]["stageWorkers"].values()), 8)
        self.assertLessEqual(len(set().union(*backend.thread_ids.values())), 8)
        self.assertEqual(backend.peak["finalize"], 4)
        self.assertLessEqual(backend.peak["publish"], 2)
        self.assertLessEqual(backend.peak["observe"], 2)
        self.assertEqual(result["submitted"], 16)
        self.assertEqual(result["qualified"], 0)
        self.assertEqual(result["notQualified"], 16)
        self.assertEqual(result["pipeline"]["queueAtCutoff"]["finalize"], 12)
        self.assertEqual(len([event for event in events if event["kind"] == "included"]), 16)
        self.assertFalse(any(event["kind"] == "qualified" for event in events))
        self.assertEqual(len(result["accountState"]), 16)
        self.assertTrue(all(account["pending"] is not None and account["nextNonce"] == 2 and account["quarantined"] for account in result["accountState"]))
        self.assertTrue(all(row["status"] == "unknown" and row["finalNs"] is None for row in result["rows"]))
        self.assert_queue_bounds(result)
        self.assert_censored(result, 16)

    def test_same_account_nonce_advances_only_after_qualified_event(self):
        backend = StructuralBackend()
        result, events = self.run_control(plan(8, 1), backend)
        self.assertIsNone(result["firstCause"])
        self.assertEqual(result["qualified"], 8)
        self.assertEqual(result["notQualified"], 0)
        self.assertEqual([row["nonce"] for row in backend.calls["publish"]], list(range(2, 10)))
        self.assertEqual(len({row["operationId"] for row in backend.calls["publish"]}), 8)
        pending = None
        claims = 0
        for event in events:
            if event["kind"] == "account_claim":
                self.assertIsNone(pending, "same owner was claimed before original qualification")
                pending = event["index"]
                self.assertEqual(int(event["nonce"]), 2 + claims)
                claims += 1
            elif event["kind"] == "qualified":
                self.assertEqual(pending, event["index"])
                pending = None
        self.assertEqual(claims, 8)
        self.assertIsNone(pending)
        self.assertIsNone(result["accountState"][0]["pending"])
        self.assertEqual(result["accountState"][0]["nextNonce"], 10)
        self.assertFalse(result["accountState"][0]["quarantined"])
        self.assert_queue_bounds(result)

    def test_inclusion_alone_never_releases_an_account(self):
        backend = StructuralBackend(block="finalize")
        result, events = self.run_control(plan(8, 1), backend)
        self.assertEqual(len(backend.calls["publish"]), 1)
        self.assertEqual(len(backend.calls["observe"]), 1)
        self.assertEqual(result["submitted"], 1)
        self.assertEqual(result["qualified"], 0)
        self.assertEqual(len([event for event in events if event["kind"] == "included"]), 1)
        self.assertEqual(len([event for event in events if event["kind"] == "account_claim"]), 1)
        account = result["accountState"][0]
        self.assertEqual(account["pending"], 0)
        self.assertEqual(account["nextNonce"], 2)
        self.assertTrue(account["quarantined"])
        self.assertEqual(result["rows"][0]["status"], "unknown")
        self.assert_censored(result, 8)

    def test_unknown_after_post_retains_pending_and_never_resigns(self):
        backend = StructuralBackend(unknown_after_post=True)
        result, events = self.run_control(plan(8, 1), backend)
        self.assertEqual(len(backend.calls["publish"]), 1)
        self.assertEqual(backend.calls["observe"], [])
        self.assertEqual(backend.calls["finalize"], [])
        self.assertEqual(result["rows"][0]["status"], "unknown")
        self.assertIn("original UNKNOWN", result["firstOperationalFailure"]["error"])
        self.assertEqual(result["accountState"][0]["pending"], 0)
        self.assertEqual(result["accountState"][0]["nextNonce"], 2)
        self.assertTrue(result["accountState"][0]["quarantined"])
        self.assertEqual(collections.Counter(event["kind"] for event in events)["signed"], 1)
        self.assertEqual(collections.Counter(event["kind"] for event in events)["submitted"], 1)
        self.assertEqual(result["notSubmitted"], 7)
        self.assert_censored(result, 8)

    def test_stage_queues_are_bounded_and_not_started_after_cutoff(self):
        for blocked, workers in (("publish", 2), ("observe", 2), ("finalize", 4)):
            with self.subTest(blocked=blocked):
                backend = StructuralBackend(block=blocked)
                result, events = self.run_control(plan(20, 20), backend)
                self.assertEqual(backend.peak[blocked], workers)
                self.assertEqual(len(backend.calls[blocked]), workers)
                self.assertGreater(result["pipeline"]["queueAtCutoff"][blocked], 0)
                self.assertEqual(result["qualified"], 0)
                self.assertFalse(any(event["kind"] == "qualified" for event in events))
                self.assertTrue(all(account["nextNonce"] == 2 for account in result["accountState"]))
                if blocked == "publish":
                    self.assertLessEqual(len([event for event in events if event["kind"] == "account_claim"]), 6)
                    self.assertEqual(backend.calls["observe"], [])
                    self.assertEqual(backend.calls["finalize"], [])
                elif blocked == "observe":
                    self.assertEqual(backend.calls["finalize"], [])
                self.assert_queue_bounds(result)
                self.assert_censored(result, 20)

    def test_original_confirmation_gate_survives_stage_adaptation(self):
        backend = StructuralBackend(qualified_change={"normalConfirmCode": "ACK"})
        result, events = self.run_control(plan(8, 1), backend)
        self.assertEqual(result["qualified"], 0)
        self.assertIn("pending confirmation", result["firstCause"])
        self.assertFalse(any(event["kind"] == "qualified" for event in events))
        self.assertEqual(result["accountState"][0]["nextNonce"], 2)
        self.assertEqual(result["accountState"][0]["pending"], 0)
        self.assertTrue(result["accountState"][0]["quarantined"])
        self.assert_censored(result, 8)

    def test_return_without_required_event_cannot_advance_or_release(self):
        for missing, stage in (("submitted", "publish"), ("included", "observe"), ("qualified", "finalize")):
            with self.subTest(missing=missing):
                backend = StructuralBackend(omit_event=missing)
                result, events = self.run_control(plan(8, 1), backend)
                self.assertEqual(result["qualified"], 0)
                self.assertEqual(result["rows"][0]["status"], "unknown")
                self.assertIn("%s returned without required %s event" % (stage, missing), result["firstOperationalFailure"]["error"])
                self.assertEqual(len(backend.calls["publish"]), 1)
                if missing == "submitted":
                    self.assertEqual(backend.calls["observe"], [])
                    self.assertEqual(backend.calls["finalize"], [])
                elif missing == "included":
                    self.assertEqual(backend.calls["finalize"], [])
                self.assertEqual(result["accountState"][0]["pending"], 0)
                self.assertEqual(result["accountState"][0]["nextNonce"], 2)
                self.assertTrue(result["accountState"][0]["quarantined"])
                self.assertFalse(any(event["kind"] == "qualified" for event in events))
                self.assert_censored(result, 8)

    def test_injected_original_known_failure_type_remains_failed_not_unknown(self):
        separate_spec = importlib.util.spec_from_file_location(
            "unit_actual_driver_original_scheduler",
            Path(__file__).with_name("pq-independent-scheduler.py"),
        )
        injected = importlib.util.module_from_spec(separate_spec)
        separate_spec.loader.exec_module(injected)
        self.assertIsNot(injected.KnownFailure, staged.original.KnownFailure)
        backend = StructuralBackend(publish_error=injected.KnownFailure("UNIT identity-bound rejection"))
        result, events = self.run_control(plan(8, 1), backend, ledger_module=injected)
        self.assertEqual(result["rows"][0]["status"], "failed")
        self.assertEqual(result["firstOperationalFailure"]["error"], "UNIT identity-bound rejection")
        self.assertEqual(result["accountState"][0]["pending"], 0)
        self.assertEqual(result["accountState"][0]["nextNonce"], 2)
        self.assertTrue(result["accountState"][0]["quarantined"])
        self.assertEqual(len(backend.calls["publish"]), 1)
        self.assertFalse(any(event["kind"] == "unknown" for event in events))
        self.assert_censored(result, 8)

    def test_actual_queue_objects_are_bounded_and_opaque_handles_stay_private(self):
        original_queue = staged.queue.Queue
        created = []

        class ObservedQueue(original_queue):
            def __init__(self, *args, **kwargs):
                self.observed_peak = 0
                super().__init__(*args, **kwargs)
                created.append(self)

            def _put(self, item):
                super()._put(item)
                self.observed_peak = max(self.observed_peak, self._qsize())

        backend = StructuralBackend(block="finalize")
        with mock.patch.object(staged.queue, "Queue", ObservedQueue):
            result, events = self.run_control(plan(20, 20), backend)
        stage_queues = [item for item in created if item.maxsize <= 20]
        self.assertEqual([item.maxsize for item in stage_queues], [4, 20, 20])
        self.assertTrue(all(0 < item.observed_peak <= item.maxsize for item in stage_queues))
        self.assertGreater(stage_queues[-1].qsize(), 0)
        retained = result["pipeline"]["retainedUnfinishedHandles"]
        self.assertGreaterEqual(len(retained), stage_queues[-1].qsize())
        self.assertEqual(len({item["index"] for item in retained}), len(retained))
        for item in retained:
            row = result["rows"][item["index"]]
            self.assertEqual(row["status"], "unknown")
            self.assertEqual(item["operationId"], row["operationId"])
            self.assertEqual(item["ownerIndex"], row["ownerIndex"])
            self.assertEqual(item["nonce"], row["nonce"])
        # No fallback serializer: exposing the opaque token/handle is a failure.
        json.dumps(events)
        json.dumps(result)
        self.assertFalse(any(event["kind"] == "_phase_done" for event in events))
        self.assertTrue(all("handle" not in event for event in events))
        self.assert_censored(result, 20)

    def test_resource_failure_stops_owned_work_only_and_preserves_first_cause(self):
        backend = StructuralBackend(block="publish")
        unrelated_stop = threading.Event()
        unrelated_started = threading.Event()

        def unrelated_work():
            unrelated_started.set()
            unrelated_stop.wait()

        unrelated = threading.Thread(target=unrelated_work, name="unit-unrelated-owner", daemon=True)
        unrelated.start()
        self.assertTrue(unrelated_started.wait(1))
        try:
            def check():
                if backend.started["publish"].is_set():
                    raise RuntimeError("UNIT original owned resource limit")

            result, _ = self.run_control(plan(20, 8), backend, check)
            self.assertEqual(result["firstCause"], "UNIT original owned resource limit")
            self.assertTrue(unrelated.is_alive())
            self.assertFalse(unrelated_stop.is_set())
            self.assertEqual(result["qualified"], 0)
            self.assertTrue(all(account["nextNonce"] == 2 for account in result["accountState"]))
            self.assert_censored(result, 20)
        finally:
            unrelated_stop.set()
            unrelated.join(timeout=1)
        self.assertFalse(unrelated.is_alive())

    def test_monitor_stop_preserves_guard_failure_before_worker_cleanup_timeout(self):
        stop = threading.Event()
        release_worker = threading.Event()

        class StalledBackend(StructuralBackend):
            def publish(self, row, account, notify, stop_event):
                stop_event.set()
                release_worker.wait(timeout=1)

        backend = StalledBackend()

        def check():
            if stop.is_set():
                raise RuntimeError("owned RSS exceeded 4GiB")

        original_join = threading.Thread.join

        def join(thread, timeout=None):
            if thread.name.startswith('normal-staged-'):
                timeout = min(0.05, timeout)
            return original_join(thread, timeout)

        try:
            with mock.patch.object(threading.Thread, 'join', join):
                result = staged.run(plan(20, 8), backend, lambda event: None, check, stop)
            self.assertEqual(result['firstCause'], 'owned RSS exceeded 4GiB')
            self.assertFalse(result['pipeline']['workerThreadsRetired'])
            timeouts = result['pipeline']['workerRetirementTimeouts']
            stalled = next(row for row in timeouts if row['operationId'] is not None)
            self.assertEqual(stalled['stage'], 'publish')
            self.assertEqual(stalled['operationId'], result['rows'][stalled['index']]['operationId'])
            self.assertEqual(result['qualified'], 0)
        finally:
            release_worker.set()

    def test_resource_failure_before_admission_has_zero_business_hits(self):
        backend = StructuralBackend()

        def check():
            raise RuntimeError("UNIT original admission failed")

        result, events = self.run_control(plan(8, 8), backend, check)
        self.assertEqual(result["firstCause"], "UNIT original admission failed")
        self.assertEqual(result["submitted"], 0)
        self.assertEqual(result["notSubmitted"], 8)
        self.assertEqual(result["qualified"], 0)
        self.assertEqual(backend.calls, {"publish": [], "observe": [], "finalize": []})
        self.assertFalse(any(event["kind"] == "signed" for event in events))
        self.assert_censored(result, 8)

    def test_qualified_only_after_fixed_cutoff_is_retained_without_nonce_release(self):
        class CleanupQualifiedBackend(StructuralBackend):
            def finalize(self, handle, notify, stop):
                stop.wait()
                return super().finalize(handle, notify, stop)

        configured = plan(4, 4)
        backend = CleanupQualifiedBackend()
        result, events = self.run_control(configured, backend)
        self.assertEqual(len(backend.calls["finalize"]), 4)
        self.assertEqual(result["qualified"], 0)
        self.assertEqual(result["notQualified"], 4)
        self.assertFalse(any(event["kind"] == "qualified" for event in events))
        late = result["pipeline"]["lateEvidence"]
        qualified = [event for event in late if event["kind"] == "qualified"]
        self.assertEqual(len(qualified), 4)
        self.assertEqual({event["index"] for event in qualified}, {0, 1, 2, 3})
        for event in qualified:
            row = result["rows"][event["index"]]
            self.assertGreaterEqual(event["atNs"], configured["windowNs"] + configured["tailNs"])
            self.assertEqual(event["id"], row["id"])
            self.assertEqual(event["hash"], row["hash"])
            self.assertEqual(event["nativeHash"], row["nativeHash"])
            self.assertEqual(event["normalConfirmCode"], "PROOF_CONFIRMED_DATA")
            self.assertEqual(row["status"], "unknown")
            self.assertNotIn("without required", row["error"])
        self.assertTrue(all(account["pending"] is not None and account["nextNonce"] == 2 and account["quarantined"] for account in result["accountState"]))
        self.assert_censored(result, 4)

    def test_original_confirmation_failure_after_cutoff_remains_in_late_evidence(self):
        class CleanupRejectedBackend(StructuralBackend):
            def finalize(self, handle, notify, stop):
                stop.wait()
                raise staged.original.KnownFailure("UNIT original Confirm rejected after cutoff")

        configured = plan(4, 4)
        result, events = self.run_control(configured, CleanupRejectedBackend())
        self.assertEqual(result["qualified"], 0)
        self.assertFalse(any(event["kind"] == "qualified" for event in events))
        failed = [event for event in result["pipeline"]["lateEvidence"] if event["kind"] == "failed"]
        self.assertEqual(len(failed), 4)
        for event in failed:
            self.assertGreaterEqual(event["atNs"], configured["windowNs"] + configured["tailNs"])
            self.assertEqual(event["error"], "UNIT original Confirm rejected after cutoff")
            self.assertEqual(event["id"], result["rows"][event["index"]]["id"])
        self.assertTrue(all(account["pending"] is not None and account["nextNonce"] == 2 and account["quarantined"] for account in result["accountState"]))
        self.assert_censored(result, 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
