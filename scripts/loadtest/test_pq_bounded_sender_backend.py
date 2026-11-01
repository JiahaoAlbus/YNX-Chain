"""Pure sender transport/lease controls; no real child, custody or chain proof.

The normal command codec and backend base are used, but Window and Session are
in-memory lifecycle doubles. Their replies are never business success evidence.
"""

import concurrent.futures
import copy
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


driver = module("bounded_sender_driver_controls", "pq-independent-load.py")
bounded = module("bounded_sender_lease_controls", "pq-bounded-sender-backend.py")


class ConstructorFailure(RuntimeError):
    pass


class ExchangeFailure(RuntimeError):
    pass


class CleanupFailure(RuntimeError):
    pass


class MemoryPipe:
    def __init__(self, proc):
        self.proc = proc
        self.closed = False

    def close(self):
        self.closed = True
        if self.proc.eof_retires and self.proc.returncode is None:
            self.proc.returncode = 0


class MemoryProcess:
    def __init__(self, pid, eof_retires):
        self.pid = pid
        self.eof_retires = eof_retires
        self.returncode = None
        self.stdin = MemoryPipe(self)

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is None:
            raise subprocess.TimeoutExpired("UNIT-NOT-A-PROCESS", timeout)
        return self.returncode


class MemoryWindow:
    def __init__(self, behavior):
        self.behavior = behavior
        self.work = Path("/UNIT-NOT-A-REAL-WORKSPACE")
        self.lock = threading.Lock()
        self.condition = threading.Condition()
        self.children = []
        self.constructor_calls = []
        self.sessions = []
        self.exchanges = []
        self.lifecycle = []
        self.retired = []
        self.signals = []
        self.peak = 0
        self.stopping = False

    def register(self, name):
        with self.lock:
            proc = MemoryProcess(901_000_000 + len(self.children), self.behavior.get("eof_retires", True))
            self.children.append({"name": name, "process": proc})
            self.peak = max(self.peak, sum(child["process"].poll() is None for child in self.children))
        return proc

    def sample(self):
        self.lifecycle.append("resource-check")

    def wait(self, proc):
        if self.behavior.get("wait_error") is not None:
            raise self.behavior["wait_error"]
        if proc.wait(timeout=0) != 0:
            raise CleanupFailure("UNIT original sender nonzero exit")

    def retire_log(self, proc):
        if self.behavior.get("retire_error") is not None:
            raise self.behavior["retire_error"]
        self.retired.append(proc.pid)

    def killpg(self, pid, sig):
        # This is an in-memory signal observation, never an OS signal.
        matches = [child for child in self.children if child["process"].pid == pid]
        if len(matches) != 1 or sig != signal.SIGTERM:
            raise AssertionError("cleanup targeted a foreign process identity")
        self.signals.append((pid, sig))
        if self.behavior.get("kill_error") is not None:
            raise self.behavior["kill_error"]
        if self.behavior.get("terminate_retires", True):
            matches[0]["process"].returncode = -sig

    def wait_for_exchanges(self, count):
        with self.condition:
            return self.condition.wait_for(lambda: len(self.exchanges) >= count, timeout=2)


def session_type(window):
    class MemorySession:
        def __init__(self, ceremony, owner, **kwargs):
            self.c = ceremony
            self.owner = owner
            self.kwargs = dict(kwargs)
            self.ready = False
            window.constructor_calls.append({"owner": owner, **kwargs})
            error = window.behavior.get("constructor_error")
            if error is not None and not window.behavior.get("register_before_error"):
                raise error
            self.proc = window.register(kwargs["name"])
            if error is not None:
                raise error
            window.sessions.append(self)

        def wait_ready(self, stop, deadline, check):
            check()
            window.lifecycle.append((self.kwargs["name"], "ready"))
            if stop.is_set():
                raise RuntimeError("UNIT original ready canceled")
            if window.behavior.get("ready_error") is not None:
                raise window.behavior["ready_error"]
            self.ready = True
            return {"unitTransportReadyBoundaryOnly": True}

        def exchange(self, command, path, stop):
            if not self.ready:
                raise AssertionError("command sent before DATA-ready boundary")
            with window.condition:
                window.exchanges.append({"owner": self.owner, "command": copy.deepcopy(command), "path": path, "pid": self.proc.pid})
                window.condition.notify_all()
            window.lifecycle.append((self.kwargs["name"], command["operation"]))
            gate = window.behavior.get("exchange_gate")
            if gate is not None and not gate.wait(timeout=2):
                raise AssertionError("unit transport release was not supplied")
            if window.behavior.get("exchange_error") is not None:
                raise window.behavior["exchange_error"]
            return copy.deepcopy(window.behavior.get("reply", {"code": "UNIT_TRANSPORT_ONLY", "result": None}))

    return MemorySession


def available_slots(slots):
    count = 0
    while count < 32 and slots.acquire(blocking=False):
        count += 1
    for _ in range(count):
        slots.release()
    return count


class BoundedSenderBackendControls(unittest.TestCase):
    def setUp(self):
        for target in ("subprocess.Popen", "urllib.request.urlopen", "socket.create_connection", "os.kill", "os.killpg"):
            patcher = mock.patch(target, side_effect=AssertionError("pure lease control attempted external IO or signal"))
            patcher.start()
            self.addCleanup(patcher.stop)

    def backend(self, owner_count=8, **behavior):
        window = MemoryWindow(behavior)
        ceremony = SimpleNamespace(
            w=window, mode="online", live=[{} for _ in range(4)],
            workload={"transactions": None}, proof_timeout=1,
            root=Path("/UNIT-NOT-A-REAL-NETWORK"),
        )
        owners = [{"ownerIndex": 4 + index, "nextNonce": 2, "capacity": 1} for index in range(owner_count)]
        cls = bounded.backend_class(driver.NormalBackend, session_type(window), driver.normal, driver.lab)
        return cls(ceremony, owners, threading.Event())

    def operation(self, index=0):
        row = {"index": index, "ownerIndex": 4 + index, "operationId": "UNIT-ORIGINAL-OP-%d" % index, "nonce": 2}
        request = {"version": "YNX-PQ-LAB-SENDER-REQUEST/v1", "operationId": row["operationId"], "ownerIndex": row["ownerIndex"], "firstNonce": "2", "members": 1}
        return row, request

    def sign(self, backend, index=0, notify=lambda event: None):
        row, request = self.operation(index)
        return backend.sign_original(row, request, {"height": 7, "appHash": "a" * 64}, Path("/UNIT-CASE"), notify, backend.stop_event)

    def confirm(self, backend, index=0):
        row, request = self.operation(index)
        proof = {"materials": {"path": "UNIT-materials.json", "sha256": "b" * 64}, "proof": {"path": "UNIT-proof.json"}}
        return backend.confirm_original(row, request, proof, Path("/UNIT-CASE"), lambda event: None, backend.stop_event)

    def test_500_initialized_owners_open_no_process_and_do_not_fabricate_ready(self):
        backend = self.backend(500)
        checked = mock.Mock()
        prepared = backend.prepare(checked)
        checked.assert_called_once()
        self.assertEqual(backend.w.children, [])
        self.assertEqual(backend.w.constructor_calls, [])
        self.assertEqual(backend.sessions, {})
        self.assertEqual(prepared["readyCount"], 0)
        self.assertEqual(prepared["originalInitializedAccountCount"], 500)
        self.assertEqual(prepared["readyMode"], "DEFERRED_ORIGINAL_PER_OPERATION_DATA_READY")
        self.assertEqual(prepared["maximumOwnedRuntimePIDs"], 10)
        self.assertEqual(prepared["originalOwnedPIDLimit"], 16)
        self.assertFalse(prepared["signed"])
        self.assertFalse(prepared["nonceReserved"])
        self.assertFalse(prepared["sourceGrant"])
        self.assertFalse(prepared["loadClockStarted"])
        self.assertEqual(backend.cold_sender_report()["attempted"], 0)

    def test_original_sign_and_confirm_commands_reopen_same_operation_after_eof(self):
        backend = self.backend()
        row, request = self.operation()
        before = copy.deepcopy((row, request))
        sign_reply = self.sign(backend)
        self.assertEqual(sign_reply["code"], "UNIT_TRANSPORT_ONLY")
        self.assertEqual(backend.w.children[0]["process"].poll(), 0)
        self.assertTrue(backend.w.children[0]["process"].stdin.closed)
        confirm_reply = self.confirm(backend)
        self.assertEqual(confirm_reply["code"], "UNIT_TRANSPORT_ONLY")
        self.assertEqual((row, request), before)
        self.assertEqual(len(backend.w.sessions), 2)
        sign_call, confirm_call = backend.w.exchanges
        self.assertNotEqual(sign_call["pid"], confirm_call["pid"])
        self.assertEqual(sign_call["owner"], confirm_call["owner"])
        expected_sign = {"version": "YNX-PQ-LAB-SENDER-COMMAND/v1", "operation": "sign", "request": request, "checkpointHeight": "7", "checkpointAppHash": "a" * 64, "materialsFile": "", "materialsSHA256": "", "proofFile": ""}
        expected_confirm = {"version": "YNX-PQ-LAB-SENDER-COMMAND/v1", "operation": "confirm", "request": request, "checkpointHeight": "0", "checkpointAppHash": "", "materialsFile": "UNIT-materials.json", "materialsSHA256": "b" * 64, "proofFile": "UNIT-proof.json"}
        self.assertEqual(json.dumps(sign_call["command"], separators=(",", ":")), json.dumps(expected_sign, separators=(",", ":")))
        self.assertEqual(json.dumps(confirm_call["command"], separators=(",", ":")), json.dumps(expected_confirm, separators=(",", ":")))
        self.assertEqual(sign_call["path"].name, "original-sign-reply.json")
        self.assertEqual(confirm_call["path"].name, "original-confirm-reply.json")
        for call, phase in zip(backend.w.constructor_calls, ("sign", "confirm")):
            self.assertFalse(call["persistent"])
            self.assertEqual(call["startup_kind"], "sender_open_" + phase)
            self.assertEqual(call["startup_identity"], request["operationId"])
        report = backend.cold_sender_report()
        self.assertEqual(report["attempted"], 2)
        self.assertTrue(all(record["closedByNormalEOF"] and record["producerRetired"] for record in report["records"]))
        self.assertEqual(report["cleanupDebt"], [])
        self.assertFalse(report["accountPendingReleasedByProcessClose"])
        self.assertFalse(report["automaticReSign"])
        self.assertEqual(available_slots(backend.sign_slots), 2)
        self.assertEqual(available_slots(backend.helper_slots), 3)

    def test_eof_and_confirm_transport_do_not_release_original_ledger_pending(self):
        backend = self.backend(1)
        raw = driver.scheduler.make_plan("a" * 64, "b" * 64, "online", [{"ownerIndex": 4, "address": "UNIT-OWNER", "nextNonce": 2, "capacity": 1}], 1000, 1_000_000, 1_000_000)
        ledger = driver.scheduler.Ledger(raw, lambda event: None)
        ledger.release(0)
        row, _ = ledger.reserve(0)
        request = {"version": "YNX-PQ-LAB-SENDER-REQUEST/v1", "operationId": row["operationId"], "ownerIndex": 4, "firstNonce": "2", "members": 1}
        before = copy.deepcopy(ledger.accounts)
        backend.sign_original(row, request, {"height": 7, "appHash": "a" * 64}, Path("/UNIT-CASE"), lambda event: None, backend.stop_event)
        backend.confirm_original(row, request, {"materials": {"path": "UNIT-materials", "sha256": "b" * 64}, "proof": {"path": "UNIT-proof"}}, Path("/UNIT-CASE"), lambda event: None, backend.stop_event)
        self.assertEqual(ledger.accounts, before)
        self.assertEqual(ledger.accounts[4]["pending"], 0)
        self.assertEqual(ledger.accounts[4]["nextNonce"], 2)
        self.assertEqual(ledger.rows[0]["status"], "reserved")
        self.assertTrue(all(child["process"].poll() == 0 for child in backend.w.children))

    def test_mismatched_account_operation_nonce_or_members_never_opens_session(self):
        backend = self.backend()
        for field, value in (("ownerIndex", 5), ("operationId", "replacement"), ("firstNonce", "3"), ("members", 2)):
            with self.subTest(field=field):
                row, request = self.operation()
                request[field] = value
                with self.assertRaisesRegex(RuntimeError, "same original account/operation/nonce"):
                    backend.sign_original(row, request, {"height": 7, "appHash": "a" * 64}, Path("/UNIT-CASE"), lambda event: None, backend.stop_event)
        self.assertEqual(backend.w.constructor_calls, [])
        self.assertEqual(backend.cold_sender_report()["attempted"], 0)

    def test_data_ready_failure_cannot_issue_a_command(self):
        error = ExchangeFailure("UNIT original DATA-ready not supplied")
        backend = self.backend(ready_error=error)
        with self.assertRaises(ExchangeFailure) as raised:
            self.sign(backend)
        self.assertIs(raised.exception, error)
        self.assertEqual(backend.w.exchanges, [])
        self.assertEqual(len(backend.w.constructor_calls), 1)
        self.assertTrue(backend.w.children[0]["process"].stdin.closed)
        self.assertEqual(backend.cold_sender_report()["records"][0]["firstCause"], str(error))
        self.assertEqual(available_slots(backend.sign_slots), 2)

    def test_rejected_or_unknown_reply_is_not_retried_by_original_entry(self):
        for code in ("REJECTED", "UNKNOWN"):
            with self.subTest(code=code):
                backend = self.backend(reply={"code": code})
                backend.checkpoint = lambda stop: {"height": 7, "appHash": "a" * 64}
                row, _ = self.operation()
                expected = driver.scheduler.KnownFailure if code == "REJECTED" else RuntimeError
                with self.assertRaisesRegex(expected, "no retry"):
                    backend.original(row, {"ownerIndex": 4}, Path("/UNIT-CASE"), lambda event: None, backend.stop_event)
                self.assertEqual(len(backend.w.constructor_calls), 1)
                self.assertEqual(len(backend.w.exchanges), 1)
                self.assertEqual(backend.w.exchanges[0]["command"]["request"]["operationId"], row["operationId"])
                self.assertEqual(backend.cold_sender_report()["attempted"], 1)
                self.assertFalse(backend.cold_sender_report()["automaticReSign"])

    def test_two_sign_slots_and_three_shared_confirm_slots_bound_open_processes(self):
        gate = threading.Event()
        backend = self.backend(exchange_gate=gate)
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
            jobs = [pool.submit(self.sign, backend, index) for index in range(3)]
            jobs += [pool.submit(self.confirm, backend, index) for index in range(3, 7)]
            try:
                self.assertTrue(backend.w.wait_for_exchanges(5))
                phases = [entry["command"]["operation"] for entry in backend.w.exchanges]
                self.assertEqual(phases.count("sign"), 2)
                self.assertEqual(phases.count("confirm"), 3)
                self.assertEqual(len(backend.w.children), 5)
            finally:
                gate.set()
            self.assertTrue(all(job.result(timeout=2)["code"] == "UNIT_TRANSPORT_ONLY" for job in jobs))
        self.assertLessEqual(backend.w.peak, 5)
        self.assertEqual(backend.cold_sender_report()["maximumOwnedRuntimePIDs"], 10)
        self.assertEqual(backend.cold_sender_report()["attempted"], 7)
        self.assertTrue(all(child["process"].poll() == 0 for child in backend.w.children))
        self.assertEqual(available_slots(backend.sign_slots), 2)
        self.assertEqual(available_slots(backend.helper_slots), 3)

    def test_confirm_uses_existing_helper_slots_and_canceled_wait_never_opens(self):
        backend = self.backend()
        for _ in range(3):
            self.assertTrue(backend.helper_slots.acquire(blocking=False))
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            job = pool.submit(self.confirm, backend)
            self.assertEqual(self.sign(backend, 1)["code"], "UNIT_TRANSPORT_ONLY")
            backend.stop_event.set()
            with self.assertRaisesRegex(RuntimeError, "slot not supplied before cutoff"):
                job.result(timeout=2)
        self.assertEqual(len(backend.w.constructor_calls), 1)
        self.assertEqual(backend.w.constructor_calls[0]["startup_kind"], "sender_open_sign")
        self.assertEqual(available_slots(backend.helper_slots), 0)
        for _ in range(3):
            backend.helper_slots.release()
        self.assertEqual(available_slots(backend.helper_slots), 3)

    def test_constructor_without_registered_child_returns_slot_and_original_error(self):
        error = ConstructorFailure("UNIT original constructor failed before child")
        backend = self.backend(constructor_error=error)
        with self.assertRaises(ConstructorFailure) as raised:
            self.sign(backend)
        self.assertIs(raised.exception, error)
        self.assertEqual(backend.w.children, [])
        self.assertEqual(backend.cold_sender_report()["cleanupDebt"], [])
        self.assertEqual(backend.cold_sender_report()["records"][0]["firstCause"], str(error))
        self.assertEqual(available_slots(backend.sign_slots), 2)

    def test_registered_constructor_child_reaped_before_slot_is_returned(self):
        error = ConstructorFailure("UNIT constructor failed with reaped original child")
        backend = self.backend(constructor_error=error, register_before_error=True)
        with mock.patch.object(bounded.os, "killpg", side_effect=backend.w.killpg):
            with self.assertRaises(ConstructorFailure) as raised:
                self.sign(backend)
        self.assertIs(raised.exception, error)
        proc = backend.w.children[0]["process"]
        self.assertEqual(proc.poll(), -signal.SIGTERM)
        self.assertEqual(backend.w.signals, [(proc.pid, signal.SIGTERM)])
        self.assertEqual(backend.cold_sender_report()["cleanupDebt"], [])
        self.assertEqual(available_slots(backend.sign_slots), 2)

    def test_registered_live_constructor_child_keeps_slot_and_exact_cleanup_identity(self):
        error = ConstructorFailure("UNIT original constructor failed after registration")
        backend = self.backend(constructor_error=error, register_before_error=True, terminate_retires=False)
        with mock.patch.object(bounded.os, "killpg", side_effect=backend.w.killpg):
            with self.assertRaises(ConstructorFailure) as raised:
                self.sign(backend)
        self.assertIs(raised.exception, error)
        proc = backend.w.children[0]["process"]
        self.assertIsNone(proc.poll())
        self.assertTrue(backend.stop_event.is_set())
        self.assertEqual(available_slots(backend.sign_slots), 1)
        debt = backend.cold_sender_report()["cleanupDebt"]
        self.assertEqual(len(debt), 1)
        self.assertEqual(debt[0]["pid"], proc.pid)
        self.assertEqual(debt[0]["operationId"], "UNIT-ORIGINAL-OP-0")

    def test_constructor_cleanup_failure_never_overwrites_original_first_cause(self):
        original = ConstructorFailure("UNIT constructor original first cause")
        cleanup = PermissionError("UNIT registered child termination refused")
        backend = self.backend(constructor_error=original, register_before_error=True, kill_error=cleanup)
        with mock.patch.object(bounded.os, "killpg", side_effect=backend.w.killpg):
            with self.assertRaises(ConstructorFailure) as raised:
                self.sign(backend)
        self.assertIs(raised.exception, original)
        report = backend.cold_sender_report()
        self.assertEqual(report["records"][0]["firstCause"], str(original))
        self.assertIn(str(cleanup), report["records"][0]["cleanupError"])
        self.assertEqual(report["cleanupDebt"][0]["pid"], backend.w.children[0]["process"].pid)
        self.assertTrue(backend.stop_event.is_set())
        self.assertEqual(available_slots(backend.sign_slots), 1)

    def test_close_failure_keeps_debt_and_does_not_mask_exchange_first_cause(self):
        original = ExchangeFailure("UNIT original ambiguous command outcome")
        cleanup = CleanupFailure("UNIT original sender wait failed")
        backend = self.backend(exchange_error=original, eof_retires=False, wait_error=cleanup)
        with self.assertRaises(ExchangeFailure) as raised:
            self.sign(backend)
        self.assertIs(raised.exception, original)
        report = backend.cold_sender_report()
        self.assertEqual(report["records"][0]["firstCause"], str(original))
        self.assertEqual(report["records"][0]["cleanupError"], str(cleanup))
        self.assertFalse(report["records"][0]["producerRetired"])
        self.assertEqual(report["cleanupDebt"][0]["pid"], backend.w.children[0]["process"].pid)
        self.assertTrue(backend.stop_event.is_set())
        self.assertEqual(available_slots(backend.sign_slots), 1)
        self.assertEqual(len(backend.w.exchanges), 1)

    def test_close_failure_without_exchange_failure_is_not_returned_as_success(self):
        cleanup = CleanupFailure("UNIT original wait failed after reply")
        backend = self.backend(eof_retires=False, wait_error=cleanup)
        with self.assertRaises(CleanupFailure) as raised:
            self.sign(backend)
        self.assertIs(raised.exception, cleanup)
        self.assertTrue(backend.stop_event.is_set())
        self.assertEqual(len(backend.cold_sender_report()["cleanupDebt"]), 1)
        self.assertEqual(available_slots(backend.sign_slots), 1)

    def test_log_retirement_failure_after_process_exit_does_not_leak_pid_slot(self):
        error = CleanupFailure("UNIT original log retirement failure")
        backend = self.backend(retire_error=error)
        with self.assertRaises(CleanupFailure) as raised:
            self.sign(backend)
        self.assertIs(raised.exception, error)
        self.assertEqual(backend.w.children[0]["process"].poll(), 0)
        self.assertEqual(backend.cold_sender_report()["records"][0]["cleanupError"], str(error))
        self.assertEqual(backend.cold_sender_report()["cleanupDebt"], [])
        self.assertEqual(available_slots(backend.sign_slots), 2)

    def test_stop_signals_only_own_registered_load_children(self):
        backend = self.backend()
        own = backend.w.register("load-00000-sign-sender")
        foreign = backend.w.register("other-owner-worker")
        with mock.patch.object(bounded.os, "killpg", side_effect=backend.w.killpg):
            backend.stop()
        self.assertEqual(backend.w.signals, [(own.pid, signal.SIGTERM)])
        self.assertEqual(own.poll(), -signal.SIGTERM)
        self.assertIsNone(foreign.poll())
        self.assertFalse(foreign.stdin.closed)
        self.assertTrue(backend.stop_event.is_set())

    def test_report_copy_cannot_overwrite_original_first_cause_or_cleanup_debt(self):
        error = ExchangeFailure("UNIT immutable original first cause")
        backend = self.backend(exchange_error=error, eof_retires=False, wait_error=CleanupFailure("UNIT cleanup debt"))
        with self.assertRaises(ExchangeFailure):
            self.sign(backend)
        snapshot = backend.cold_sender_report()
        before = copy.deepcopy(snapshot)
        snapshot["records"][0]["firstCause"] = "caller overwrote evidence"
        snapshot["cleanupDebt"][0]["operationId"] = "caller replaced original operation"
        self.assertEqual(backend.cold_sender_report(), before)

    def test_stop_after_slot_acquisition_does_not_construct_a_new_sender(self):
        backend = self.backend()
        original_slots = backend.sign_slots

        class StopAfterAcquire:
            def acquire(self, *args, **kwargs):
                acquired = original_slots.acquire(*args, **kwargs)
                if acquired:
                    backend.stop_event.set()
                return acquired

            def release(self):
                original_slots.release()

        backend.sign_slots = StopAfterAcquire()
        with mock.patch.object(bounded.os, "killpg", side_effect=backend.w.killpg):
            with self.assertRaisesRegex(RuntimeError, "cancel|cutoff|interrupted"):
                self.sign(backend)
        self.assertEqual(backend.w.constructor_calls, [])
        self.assertEqual(backend.w.children, [])
        self.assertEqual(available_slots(original_slots), 2)

    def test_execute_flag_fails_before_source_check_or_node_when_qualification_absent(self):
        self.assertEqual(driver.STAGED_CALLEE_SOURCE,'c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e')
        self.assertIsNone(driver.STAGED_SOURCE_QUALIFICATION)
        args = SimpleNamespace(mode="online", rate=100, accounts=500, per_account=1, seconds=5, tail_seconds=30, proof_timeout=30, staged_publication=True, execute=True, commit=driver.STAGED_CALLEE_SOURCE, source="/UNIT-SOURCE-NEVER-READ", network_accounting=False, wire_observation=False)
        with mock.patch.object(driver.lab, "check_source") as checked, mock.patch.object(driver.lab, "Window") as window, mock.patch.object(driver.lab, "git") as git, mock.patch.object(driver.lab, "ports_available") as ports:
            with self.assertRaisesRegex(RuntimeError, "large-owner callee.*NOT_SUPPLIED"):
                driver.run(args)
            checked.assert_not_called()
            window.assert_not_called()
            git.assert_not_called()
            ports.assert_not_called()
        capacity = driver.process_capacity(args)
        self.assertEqual(capacity["completeDemand"], 500)
        self.assertEqual(capacity["accountCount"], 500)
        self.assertEqual(capacity["maximumRuntimePIDs"], 10)
        self.assertFalse(capacity["normalLargeOwnerInputQualified"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
