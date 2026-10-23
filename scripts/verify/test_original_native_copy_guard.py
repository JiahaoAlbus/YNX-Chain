"""Pure controls: no real /proc, signals, subprocesses, network or original case."""
import builtins
import contextlib
import copy
import ctypes
import errno
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


@contextlib.contextmanager
def no_host_operations():
    def refuse(*_args, **_kwargs):
        raise AssertionError("pure control attempted a host process operation")

    def checked(original):
        def call(path, *args, **kwargs):
            if not isinstance(path, int):
                name = os.path.normpath(os.fsdecode(path))
                if name == "/proc" or name.startswith("/proc/") or name.startswith("/var/tmp/ynx-pq-original-native-check"):
                    raise AssertionError("pure control attempted original case or host proc I/O")
            return original(path, *args, **kwargs)
        return call

    with contextlib.ExitStack() as stack:
        for module, name in ((builtins, "open"), (io, "open"), (os, "open"),
                             (os, "listdir"), (os, "scandir"), (os, "readlink"), (os, "stat"), (os, "lstat")):
            stack.enter_context(patch.object(module, name, checked(getattr(module, name))))
        for module, names in ((os, ("kill", "killpg", "waitpid", "pidfd_open", "fork", "posix_spawn", "posix_spawnp", "system", "execve", "execv")),
                              (signal, ("signal", "setitimer", "pidfd_send_signal")),
                              (subprocess, ("Popen",)), (ctypes, ("CDLL",)), (socket, ("socket", "create_connection"))):
            for name in names:
                stack.enter_context(patch.object(module, name, refuse, create=True))
        yield


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("original_native_copy_guard", ROOT / "scripts/ops/verify-original-native-copy.py")
guard = importlib.util.module_from_spec(SPEC)
with no_host_operations():
    SPEC.loader.exec_module(guard)


def contract():
    directories = (".", "data-verified", "tools", "tools/extracted")
    witness = {name: dict(uid="0", mode="700", device="64770", inode=str(100 + index))
               for index, name in enumerate(directories)}
    for index, (name, pin) in enumerate(guard.PINNED.items()):
        witness[name] = dict(uid="0", mode="700" if name.rsplit("/", 1)[-1] in guard.TOOLS else "600",
                             device="64770", inode=str(200 + index), bytes=pin["bytes"],
                             mtimeNs="1792773171000000000", ctimeNs="1792774000000000000", nlink="1")
    return dict(version=guard.VERSION, classification="data", casePath=guard.CASE,
                controllerSHA256="a" * 64, inputs=copy.deepcopy(guard.PINNED),
                toolSource=dict(commit=guard.COMMIT, runId=guard.RUN_ID, artifactId=guard.ARTIFACT_ID,
                                artifactSHA256=guard.ARTIFACT_SHA256),
                limits=dict(guard.LIMITS), environment=dict(guard.ENVIRONMENT),
                mustBeEmptyProcessGroups=[dict(pgid="999", leaderStartTicks="500")], preparedInputWitness=witness)


def row(pid, parent, group, ticks, session=None, state="S", rss=4096, comm="fixture"):
    return dict(pid=pid, parent=parent, group=group, session=group if session is None else session,
                startTicks=ticks, rssBytes=rss, threads=1, state=state, comm=comm)


def cleanup_proc(inventory, one):
    # Retain the production one_or_gone exit-race classification without
    # constructing LinuxProc or reading real /proc in these pure controls.
    proc = object.__new__(guard.LinuxProc)
    proc.inventory, proc.one = inventory, one
    return proc


class SampleClock:
    """Deterministic observation clock; no real waits or host timers."""
    def __init__(self, now=0.0):
        self.now, self.pauses = now, []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        if not 0 < seconds <= 0.01:
            raise AssertionError("terminal observation exceeded its short cadence")
        self.pauses.append(seconds)
        self.now += seconds


class ContractControls(unittest.TestCase):
    def setUp(self):
        self.fence = no_host_operations()
        self.fence.__enter__()
        self.addCleanup(self.fence.__exit__, None, None, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name).resolve()

    def test_exact_contract_is_data_and_fixed_limits(self):
        self.assertEqual(guard.validate_contract(contract())["classification"], "data")
        self.assertEqual(guard.LIMITS["activeSeconds"], 180)
        self.assertEqual(guard.LIMITS["cleanupSeconds"], 15)
        self.assertEqual(guard.LIMITS["totalSeconds"], 195)
        self.assertEqual(guard.ENVIRONMENT, {"GOMAXPROCS": "2", "GOMEMLIMIT": "8GiB"})

    def test_wrong_pins_mixed_profiles_unknown_and_budgets_are_rejected(self):
        changes = [lambda c: c.update(casePath="/NEVER-READ-ACTIVE-STATE"),
                   lambda c: c.update(version="old-2g-600s"), lambda c: c.update(rootGrant=True),
                   lambda c: c.update(controllerSHA256="0" * 64),
                   lambda c: c["toolSource"].update(commit="b" * 40),
                   lambda c: c["toolSource"].update(runId="1"),
                   lambda c: c["toolSource"].update(artifactId="1"),
                   lambda c: c["inputs"]["COPY_RECEIPT.json"].update(sha256="b" * 64),
                   lambda c: c["inputs"].pop("tools/extracted/ynx-chaind"),
                   lambda c: c["inputs"].update({"old-tools.zip": {"bytes": "1", "sha256": "c" * 64}}),
                   lambda c: c["limits"].update(activeSeconds=600),
                   lambda c: c["limits"].update(rssBytes=2 << 30),
                   lambda c: c["limits"].update(sampleMs=True),
                   lambda c: c["environment"].update(YNX_DATA_DIR="/LIVE"),
                   lambda c: c["environment"].update(GOMEMLIMIT="2GiB"),
                   lambda c: c.update(mustBeEmptyProcessGroups=[]),
                   lambda c: c["mustBeEmptyProcessGroups"][0].update(pgid="0999"),
                   lambda c: c["mustBeEmptyProcessGroups"][0].update(leaderStartTicks="0"),
                   lambda c: c["preparedInputWitness"]["data-verified"].update(uid="1000"),
                   lambda c: c["preparedInputWitness"]["COPY_RECEIPT.json"].update(nlink="2"),
                   lambda c: c["preparedInputWitness"]["tools/extracted/ynx-chaind"].update(mode="600")]
        for change in changes:
            with self.subTest(change=change):
                value = contract()
                change(value)
                with self.assertRaises(guard.Refused):
                    guard.validate_contract(value)

    def test_duplicate_and_nonfinite_json_rejected(self):
        for raw in (b'{"version":1,"version":2}', b'{"value":NaN}'):
            with self.assertRaises(guard.Refused):
                guard.decode(raw)

    def test_original_witness_is_not_prepared_owner_or_final_authority(self):
        held = "bytes=666005578 dev=64770 inode=1353209 mtime=1792773171 mode=600 uid=995 gid=986"
        record = dict(schema="YNX_ORIGINAL_PRIMARY_NATIVE_LINUX_COPY_V1", casePath=guard.CASE,
                      dataPath=guard.CASE + "/data-verified", bytes=666005578,
                      sourceSHA256=guard.PINNED["data-verified/devnet-state.json"]["sha256"],
                      copySHA256=guard.PINNED["data-verified/devnet-state.json"]["sha256"],
                      heldSourceStatBefore=held, heldSourceStatAfter=held, markerHex="320a",
                      copyVerified=True, liveSourceNotPaused=True,
                      authoritativeFinalCheckpoint=False, migrationVerified=False)
        guard.validate_copy_receipt(record)
        self.assertEqual(contract()["preparedInputWitness"]["COPY_RECEIPT.json"]["uid"], "0")
        for field, wrong in (("migrationVerified", True), ("authoritativeFinalCheckpoint", True),
                             ("liveSourceNotPaused", False), ("bytes", "666005578"),
                             ("heldSourceStatAfter", held.replace("uid=995", "uid=0"))):
            with self.subTest(field=field), self.assertRaises(guard.Refused):
                guard.validate_copy_receipt({**record, field: wrong})

    def test_source_cannot_self_pin_old_extra_or_swapped_binary(self):
        source = dict(version="YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1", commit=guard.COMMIT,
                      runId=guard.RUN_ID, platform="linux/amd64",
                      purpose="offline copied-state validation; not installed or activated",
                      binaries={name: dict(bytes=int(guard.PINNED["tools/extracted/" + name]["bytes"]),
                                           sha256=guard.PINNED["tools/extracted/" + name]["sha256"])
                                for name in guard.TOOLS})
        guard.validate_source(source)
        for mutate in (lambda s: s.update(commit="b" * 40), lambda s: s["binaries"].update(extra={}),
                       lambda s: s["binaries"]["ynx-chaind"].update(sha256="a" * 64),
                       lambda s: s["binaries"]["ynx-chaind"].update(bytes=True)):
            bad = copy.deepcopy(source)
            mutate(bad)
            with self.assertRaises(guard.Refused):
                guard.validate_source(bad)

    def test_default_cli_validates_only_no_proc_no_child_and_no_outputs(self):
        path = self.directory / "contract.json"
        raw = guard.json_bytes(contract())
        path.write_bytes(raw)
        path.chmod(0o600)
        pin = hashlib.sha256(raw).hexdigest()
        with patch.object(guard, "Controller", side_effect=AssertionError("default started controller")), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(guard.main(["--contract", str(path), "--contract-sha256", pin]), 0)
        result = json.loads(output.getvalue())
        self.assertFalse(result["executionStarted"])
        self.assertFalse(result["rootGrant"])
        self.assertEqual(set(p.name for p in self.directory.iterdir()), {"contract.json"})
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(guard.main(["--contract", str(path), "--contract-sha256", pin, "--execute"]), 1)
            self.assertEqual(guard.main(["--contract", str(path), "--contract-sha256", pin, "--execute",
                                         "--confirmed-contract-sha256", "b" * 64]), 1)
        self.assertEqual(path.read_bytes(), raw)

    def test_private_reader_rejects_symlink_mode_hardlink_and_input_replacement(self):
        path = self.directory / "public-fixture"
        path.write_bytes(b"synthetic DATA\n")
        path.chmod(0o600)
        before, _ = guard.read_file(path)
        with self.assertRaises(guard.Refused):
            guard.read_file(path, executable=True)  # Never auto-chmod inputs.
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        link = self.directory / "link"
        link.symlink_to(path)
        with self.assertRaises(guard.Refused):
            guard.read_file(link)
        link.unlink()
        os.link(path, link)
        with self.assertRaises(guard.Refused):
            guard.read_file(path)
        link.unlink()
        path.chmod(0o644)
        with self.assertRaises(guard.Refused):
            guard.read_file(path)
        path.chmod(0o600)
        replacement = self.directory / "replacement"
        replacement.write_bytes(path.read_bytes())
        replacement.chmod(0o600)
        changed = []
        def replace():
            if not changed:
                changed.append(True)
                os.replace(replacement, path)
        with self.assertRaisesRegex(guard.Refused, "input_changed"):
            guard.read_file(path, before["pin"], progress=replace)
        self.assertEqual(path.read_bytes(), b"synthetic DATA\n")

    def test_exclusive_failure_preserves_partial_and_repeat_original_bytes(self):
        path = self.directory / "intent.json"
        guard.exclusive(path, b"ORIGINAL UNKNOWN\n")
        with self.assertRaises(FileExistsError):
            guard.exclusive(path, b"replacement")
        self.assertEqual(path.read_bytes(), b"ORIGINAL UNKNOWN\n")
        partial = self.directory / "partial"
        with patch.object(guard.os, "fsync", side_effect=OSError("synthetic fsync failure")):
            with self.assertRaises(OSError):
                guard.exclusive(partial, b"PRESERVE PARTIAL\n")
        self.assertEqual(partial.read_bytes(), b"PRESERVE PARTIAL\n")

    def test_actual_spawn_boundary_has_only_fixed_environment_and_pinned_fd(self):
        tool = self.directory / "never-executed-tool"
        tool.write_bytes(b"synthetic public boundary fixture; not an ELF")
        tool.chmod(0o700)
        pin, _ = guard.read_file(tool, executable=True)
        output = self.directory / "output"
        output.mkdir(mode=0o700)
        controller = object.__new__(guard.Controller)
        controller.output, controller.children = output, []
        observations = []
        controller.capacity = lambda **kwargs: observations.append(("capacity", kwargs.copy()))
        captured = []
        def boundary(argv, **kwargs):
            self.assertEqual(observations[-1], ("capacity", {"fresh": True}))
            observations.append(("spawn", None))
            captured.append((argv, kwargs))
            self.assertEqual(guard.identity(os.fstat(kwargs["pass_fds"][0])), pin["identity"])
            raise OSError("intentional mocked spawn boundary; no process started")
        command = [str(tool), "--data-dir", str(self.directory), "--export-consensus-state", str(output / "migration.json")]
        with patch.object(guard.subprocess, "Popen", side_effect=boundary), patch.object(guard.selectors, "DefaultSelector", return_value=Mock()), patch.dict(os.environ, {"YNX_DATA_DIR": "/NEVER-INHERIT-LIVE", "YNX_PRIVATE_CONFIG": "never-inherit"}):
            with self.assertRaisesRegex(OSError, "intentional mocked"):
                controller.command(command, "export", pin)
        argv, kwargs = captured[0]
        self.assertEqual(argv, command)
        self.assertEqual(kwargs["env"], {"GOMAXPROCS": "2", "GOMEMLIMIT": "8GiB"})
        self.assertTrue(kwargs["close_fds"])
        self.assertTrue(kwargs["start_new_session"])
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertNotIn("shell", kwargs)
        self.assertTrue(kwargs["executable"].startswith("/proc/self/fd/"))
        self.assertGreaterEqual(observations.count(("capacity", {"fresh": True})), 2)
        self.assertEqual(observations[-2:], [("capacity", {"fresh": True}), ("spawn", None)])
        self.assertEqual(controller.children, [])
        self.assertEqual(guard.read_file(tool, executable=True)[0], pin)

    def test_spawn_rechecks_held_binary_identity_after_final_fresh_sample(self):
        tool = self.directory / "never-executed-changed-tool"
        tool.write_bytes(b"synthetic public binary boundary; not an ELF")
        tool.chmod(0o700)
        pin, _ = guard.read_file(tool, executable=True)
        output = self.directory / "changed-output"
        output.mkdir(mode=0o700)
        controller = object.__new__(guard.Controller)
        controller.output, controller.children = output, []
        fresh = []
        def sample(**kwargs):
            if kwargs.get("fresh"):
                fresh.append(True)
                if len(fresh) == 2:
                    tool.chmod(0o500)  # Synthetic same-inode identity change.
        controller.capacity = sample
        with patch.object(guard.subprocess, "Popen") as spawn, patch.object(guard.selectors, "DefaultSelector", return_value=Mock()):
            with self.assertRaisesRegex(guard.Refused, "binary_fd_identity_changed"):
                controller.command([str(tool)], "export", pin)
        self.assertEqual(len(fresh), 2)
        spawn.assert_not_called()
        self.assertEqual(controller.children, [])

    def test_only_original_normal_two_commands_can_be_selected(self):
        commands = guard.normal_commands(Path(guard.CASE))
        self.assertEqual([entry[1] for entry in commands], ["export", "verify"])
        first, second = commands[0][0], commands[1][0]
        self.assertEqual(first[1:3], ["--data-dir", guard.CASE + "/data-verified"])
        self.assertEqual(first[3], "--export-consensus-state")
        self.assertEqual(second[1:], ["-verify-migration-state", first[4]])
        self.assertEqual(Path(first[4]).parent.name, guard.ATTEMPT)
        self.assertFalse(any("start" in arg or "key" in arg or "service" in arg or "http" in arg
                             for args, _, _ in commands for arg in args))

    def test_wrong_owner_and_existing_attempt_refuse_before_proc_or_spawn(self):
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=1000), patch.object(guard, "Controller", side_effect=AssertionError("wrong owner reached proc")):
            with self.assertRaisesRegex(guard.Refused, "explicit_root_prepared_copy"):
                guard.run(contract(), "a" * 64, [])
        original = self.directory / guard.ATTEMPT
        original.mkdir(mode=0o700)
        (original / "intent.json").write_bytes(b"ORIGINAL PARTIAL UNKNOWN\n")
        value = contract()
        value["casePath"] = str(self.directory)
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=0), patch.object(guard, "private_directory"), patch.object(guard, "Controller", side_effect=AssertionError("old attempt reached proc")):
            with self.assertRaisesRegex(guard.Refused, "attempt_partial_or_unknown"):
                guard.run(value, "a" * 64, [])
        self.assertEqual((original / "intent.json").read_bytes(), b"ORIGINAL PARTIAL UNKNOWN\n")

    def test_observation_fixed_profile_preserves_old_unknown_and_refuses_existing_before_proc(self):
        old_name = "offline-export-verify-8g180s"
        fixed_name = "offline-export-verify-8g180s-observation-fixed"
        self.assertEqual(guard.ATTEMPT, fixed_name)
        case = Path(guard.CASE)
        migration = str(case / fixed_name / "migration.json")
        self.assertEqual(guard.normal_commands(case), [
            ([str(case / "tools/extracted/ynx-chaind"), "--data-dir", str(case / "data-verified"),
              "--export-consensus-state", migration], "export", "ynx-chaind"),
            ([str(case / "tools/extracted/ynx-consensus-package"), "-verify-migration-state", migration],
             "verify", "ynx-consensus-package")])
        original = self.directory / old_name
        original.mkdir(mode=0o700)
        (original / "intent.json").write_bytes(b"OLD ORIGINAL PARTIAL UNKNOWN\n")
        (original / "migration.json").write_bytes(b"OLD PARTIAL EXPORT RETAINED\n")
        def snapshot(directory):
            return {path.name: (path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns)
                    for path in directory.iterdir()}
        original_before = snapshot(original)
        value = contract()
        value["casePath"] = str(self.directory)
        fixed = self.directory / fixed_name
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=0), patch.object(guard, "private_directory"), patch.object(guard, "Controller", side_effect=RuntimeError("fresh fixed-profile controller boundary")) as controller:
            with self.assertRaisesRegex(RuntimeError, "fresh fixed-profile controller boundary"):
                guard.run(value, "a" * 64, [])
            controller.assert_called_once_with(value, "a" * 64)
        self.assertFalse(fixed.exists())  # The boundary mock never executes.
        self.assertEqual(snapshot(original), original_before)
        fixed.mkdir(mode=0o700)
        (fixed / "intent.json").write_bytes(b"NEW FIXED PROFILE PARTIAL UNKNOWN\n")
        fixed_before = snapshot(fixed)
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=0), patch.object(guard, "private_directory"), patch.object(guard, "Controller") as controller, patch.object(guard, "LinuxProc") as proc, patch.object(guard.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(guard.Refused, "original_attempt_partial_or_unknown_retained"):
                guard.run(value, "a" * 64, [])
        controller.assert_not_called()
        proc.assert_not_called()
        spawn.assert_not_called()
        self.assertEqual(snapshot(original), original_before)
        self.assertEqual(snapshot(fixed), fixed_before)


class ProcessControls(unittest.TestCase):
    def setUp(self):
        self.fence = no_host_operations()
        self.fence.__enter__()
        self.addCleanup(self.fence.__exit__, None, None, None)
        self.base = {100: row(100, 1, 90, 10), 900: row(900, 1, 900, 20)}

    def sampling_controller(self, rows, started=0.0):
        # Actual Controller.capacity and LinuxProc.sample_task, with only public
        # /proc/clock/disk observation seams. No real process or case is touched.
        controller = object.__new__(guard.Controller)
        controller.contract, controller.started, controller.next_sample = contract(), started, 0
        controller.owned = guard.Owned(100, self.base)
        controller.case, controller.initial_bytes = Path("/synthetic-case-unused"), 0
        controller.peak_rss, controller.max_delta, controller.min_free = 0, 0, None
        controller.samples, controller.last_sample = 0, None
        controller.task_sample_failure, controller.task_sample_journal_error = None, None
        events, calls = [], []
        controller.event = lambda kind, detail: events.append((kind, detail))
        proc = object.__new__(guard.LinuxProc)
        proc.inventory = lambda: rows
        proc.one_or_gone = lambda pid: rows[pid]
        proc.available_memory = lambda: 16 << 30
        actual_sample = proc.sample_task
        def sample(original, **kwargs):
            calls.append((original["pid"], kwargs.copy()))
            return actual_sample(original, **kwargs)
        proc.sample_task = sample
        controller.proc = proc
        return controller, proc, events, calls

    def test_recursive_descendants_escape_and_reparent_stay_owned(self):
        owner = guard.Owned(100, self.base)
        rows = {**self.base, 200: row(200, 100, 200, 30), 201: row(201, 200, 200, 31),
                202: row(202, 201, 202, 32)}
        self.assertEqual(set(owner.update(rows)), {200, 201, 202})
        adopted = {**self.base, 202: row(202, 100, 202, 32), 203: row(203, 202, 202, 33)}
        self.assertEqual(set(owner.update(adopted)), {202, 203})
        self.assertEqual(owner.groups, {200, 202})
        self.assertNotIn(900, owner.known)

    def test_pid_reuse_unproven_group_and_foreign_child_fail_closed(self):
        owner = guard.Owned(100, self.base)
        owner.update({**self.base, 200: row(200, 100, 200, 30)})
        reused = {**self.base, 200: row(200, 1, 200, 99)}
        with self.assertRaisesRegex(guard.Refused, "identity_unresolved"):
            owner.update(reused)
        with self.assertRaises(guard.Refused):
            guard.Owned(100, {**self.base, 300: row(300, 100, 300, 90)})

    def test_cleanup_checks_startticks_does_not_signal_foreign_or_reused_pid(self):
        owner = guard.Owned(100, self.base)
        rows = {**self.base, 200: row(200, 100, 200, 30), 201: row(201, 200, 200, 31)}
        owner.update(rows)
        sent = []
        proc = cleanup_proc(lambda: rows, lambda pid: rows[pid])
        self.assertFalse(guard.cleanup_once(proc, owner, [], sent.append, lambda *_: None))
        self.assertCountEqual(sent, [200, 201])
        self.assertNotIn(900, sent)
        sent.clear()
        proc.one = lambda pid: {**rows[pid], "startTicks": 999}
        with self.assertRaisesRegex(guard.Refused, "identity_changed"):
            guard.cleanup_once(proc, owner, [], sent.append, lambda *_: None)
        self.assertEqual(sent, [])
        proc.inventory = Mock(side_effect=PermissionError("synthetic complete proc refusal"))
        with self.assertRaises(PermissionError):
            guard.cleanup_once(proc, owner, [], sent.append, lambda *_: None)
        self.assertEqual(sent, [])

    def test_zombie_must_be_reaped_before_group_is_empty(self):
        owner = guard.Owned(100, self.base)
        rows = {**self.base, 200: row(200, 100, 200, 30, state="Z")}
        owner.update(rows)
        reaped = []
        proc = cleanup_proc(lambda: rows, lambda pid: rows[pid])
        self.assertFalse(guard.cleanup_once(proc, owner, [], lambda _: self.fail("zombie signalled"), lambda pid, _: reaped.append(pid)))
        self.assertEqual(reaped, [200])
        proc.inventory = lambda: self.base
        self.assertTrue(guard.cleanup_once(proc, owner, [], lambda _: self.fail("foreign signalled"), lambda *_: None))

    def test_production_pidfd_cleanup_signals_only_matching_owned_identities(self):
        owner = guard.Owned(100, self.base)
        initial = {**self.base, 200: row(200, 100, 200, 30), 201: row(201, 200, 201, 31)}
        owner.update(initial)
        snapshots = iter([initial, self.base, self.base])
        controller = object.__new__(guard.Controller)
        controller.proc = cleanup_proc(lambda: next(snapshots), lambda pid: initial[pid])
        controller.owned, controller.children, controller.started = owner, [], 0
        ticks = iter(index / 10 for index in range(100))
        opened, sent, closed_fds = [], [], []
        def open_pidfd(pid, flags):
            opened.append(pid)
            self.assertIn(pid, (200, 201))
            self.assertEqual(flags, 0)
            return 10000 + pid
        with patch.object(guard.os, "pidfd_open", side_effect=open_pidfd), patch.object(guard.signal, "pidfd_send_signal", side_effect=lambda fd, sig: sent.append((fd, sig))), patch.object(guard.os, "close", side_effect=closed_fds.append), patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"):
            self.assertEqual(controller.cleanup(), (True, None))
        self.assertCountEqual(opened, [200, 201])
        self.assertCountEqual([fd for fd, _ in sent], [10200, 10201])
        self.assertTrue(all(sig == signal.SIGTERM for _, sig in sent))
        self.assertCountEqual(closed_fds, [10200, 10201])
        self.assertNotIn(900, opened)  # The original A / foreign process survives.

    def test_pidfd_postopen_identity_race_and_proc_failure_never_signal(self):
        owner = guard.Owned(100, self.base)
        initial = {**self.base, 200: row(200, 100, 200, 30)}
        owner.update(initial)
        snapshots = iter([initial, self.base, self.base])
        fresh = iter([initial[200], {**initial[200], "startTicks": 999}])
        controller = object.__new__(guard.Controller)
        controller.proc = cleanup_proc(lambda: next(snapshots), lambda _: next(fresh))
        controller.owned, controller.children, controller.started = owner, [], 0
        ticks = iter(index / 10 for index in range(100))
        with patch.object(guard.os, "pidfd_open", return_value=10200), patch.object(guard.signal, "pidfd_send_signal") as send, patch.object(guard.os, "close") as close, patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"):
            complete, cause = controller.cleanup()
            self.assertFalse(complete)
            self.assertEqual(cause, "cleanup_pidfd_identity_changed")
            send.assert_not_called()
            close.assert_called_once_with(10200)
        controller.proc = SimpleNamespace(inventory=Mock(side_effect=PermissionError("synthetic blocked proc")))
        ticks = iter(range(100))
        with patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"), patch.object(guard.os, "pidfd_open") as opened:
            complete, cause = controller.cleanup()
            self.assertFalse(complete)
            self.assertEqual(cause, "cleanup_telemetry_incomplete")
            opened.assert_not_called()

    def test_cleanup_confirmed_exit_between_inventory_and_stat_is_not_unknown(self):
        owner = guard.Owned(100, self.base)
        initial = {**self.base, 200: row(200, 100, 200, 30)}
        owner.update(initial)
        snapshots = iter([initial, self.base, self.base])
        controller = object.__new__(guard.Controller)
        read_stat = Mock(side_effect=FileNotFoundError("synthetic normal exit after inventory"))
        controller.proc = cleanup_proc(lambda: next(snapshots), read_stat)
        controller.owned, controller.children, controller.started = owner, [], 0
        ticks = iter(index / 10 for index in range(100))
        with patch.object(Path, "lstat", side_effect=FileNotFoundError("synthetic confirmed PID gone")) as confirm, patch.object(guard.os, "pidfd_open") as opened, patch.object(guard.signal, "pidfd_send_signal") as sent, patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"):
            self.assertEqual(controller.cleanup(), (True, None))
        read_stat.assert_called_once_with(200)
        confirm.assert_called_once()
        opened.assert_not_called()
        sent.assert_not_called()
        self.assertEqual(owner.known, {200: 30})  # Original provenance retained.

    def test_cleanup_confirmed_exit_after_pidfd_open_closes_without_signal(self):
        owner = guard.Owned(100, self.base)
        initial = {**self.base, 200: row(200, 100, 200, 30)}
        owner.update(initial)
        snapshots = iter([initial, self.base, self.base])
        controller = object.__new__(guard.Controller)
        read_stat = Mock(side_effect=[initial[200], FileNotFoundError("synthetic exit after pidfd open")])
        controller.proc = cleanup_proc(lambda: next(snapshots), read_stat)
        controller.owned, controller.children, controller.started = owner, [], 0
        ticks = iter(index / 10 for index in range(100))
        with patch.object(Path, "lstat", side_effect=FileNotFoundError("synthetic confirmed PID gone")) as confirm, patch.object(guard.os, "pidfd_open", return_value=10200) as opened, patch.object(guard.signal, "pidfd_send_signal") as sent, patch.object(guard.os, "close") as closed, patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"):
            self.assertEqual(controller.cleanup(), (True, None))
        self.assertEqual(read_stat.call_count, 2)
        confirm.assert_called_once()
        opened.assert_called_once_with(200, 0)
        sent.assert_not_called()
        closed.assert_called_once_with(10200)
        self.assertEqual(owner.known, {200: 30})

    def test_cleanup_gone_classifier_keeps_permission_and_present_stat_failures(self):
        proc = cleanup_proc(lambda: self.base, Mock(side_effect=PermissionError("synthetic stat denied")))
        with self.assertRaises(PermissionError):
            proc.one_or_gone(200)
        proc.one = Mock(side_effect=FileNotFoundError("synthetic missing stat, PID still present"))
        with patch.object(Path, "lstat", return_value=SimpleNamespace()) as present:
            with self.assertRaisesRegex(guard.Refused, "present_process_stat_missing"):
                proc.one_or_gone(200)
        self.assertEqual(present.call_count, 3)
        self.assertEqual(proc.one.call_count, 3)

    def test_dead_leader_with_live_threads_is_signalled_not_reaped(self):
        owner = guard.Owned(100, self.base)
        leader = {**row(200, 100, 200, 30, state="Z"), "threads": 2}
        initial = {**self.base, 200: leader}
        owner.update(initial)
        snapshots = iter([initial, self.base, self.base])
        controller = object.__new__(guard.Controller)
        read_stat = Mock(return_value=leader)
        controller.proc = cleanup_proc(lambda: next(snapshots), read_stat)
        controller.owned, controller.children, controller.started = owner, [], 0
        ticks = iter(index / 10 for index in range(100))
        with patch.object(guard.os, "pidfd_open", return_value=10200) as opened, patch.object(guard.signal, "pidfd_send_signal") as sent, patch.object(guard.os, "close") as closed, patch.object(guard.os, "waitpid") as reaped, patch.object(guard.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(guard.time, "sleep"):
            self.assertEqual(controller.cleanup(), (True, None))
        self.assertEqual(read_stat.call_count, 2)
        opened.assert_called_once_with(200, 0)
        sent.assert_called_once_with(10200, signal.SIGTERM)
        closed.assert_called_once_with(10200)
        reaped.assert_not_called()

    def test_capacity_exact_bounds_and_original_a_group_refusal(self):
        args = dict(rows=self.base, owned={100: self.base[100]}, contract=contract(),
                    available=16 << 30, free=10 << 30, case_delta=4 << 30, elapsed=180, fresh=True)
        guard.capacity(**args)
        cases = [dict(available=(16 << 30) - 1), dict(free=(10 << 30) - 1),
                 dict(case_delta=(4 << 30) + 1), dict(elapsed=180.001),
                 dict(owned={100: row(100, 1, 90, 10, rss=(8 << 30) + 1)}),
                 dict(rows={**self.base, 999: row(999, 1, 999, 500)}),
                 dict(rows={**self.base, 999: row(999, 1, 777, 500)}),
                 dict(rows={**self.base, 999: row(999, 1, 777, 500, comm="cargo")})]
        for changed in cases:
            with self.subTest(changed=changed), self.assertRaises(guard.Refused):
                guard.capacity(**{**args, **changed})

    def test_real_smaps_value_not_stat_rss_and_owned_sockets_rejected(self):
        task = row(200, 100, 200, 30, rss=1)
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _pid: task
        proc.bounded = lambda _path, _limit: b"Rss:                8192 kB\nPss: 1 kB\n"
        entry = Path("/synthetic-fd/4")
        with patch.object(Path, "iterdir", return_value=iter([entry])), patch.object(guard.os, "readlink", return_value="pipe:[42]"):
            self.assertEqual(proc.sample_task(task)["rssBytes"], 8192 * 1024)
        with patch.object(Path, "iterdir", return_value=iter([entry])), patch.object(guard.os, "readlink", return_value="socket:[42]"):
            with self.assertRaisesRegex(guard.Refused, "owned_socket_present"):
                proc.sample_task(task)
        with patch.object(Path, "iterdir", side_effect=PermissionError("synthetic fd read refusal")):
            with self.assertRaises(PermissionError):
                proc.sample_task(task)
        proc.one_or_gone = Mock(side_effect=[task, {**task, "startTicks": 999}])
        with patch.object(Path, "iterdir", return_value=iter([entry])), patch.object(guard.os, "readlink", return_value="pipe:[42]"):
            with self.assertRaisesRegex(guard.Refused, "identity_changed"):
                proc.sample_task(task)
        proc.one_or_gone = lambda _pid: task
        with patch.object(Path, "iterdir", side_effect=AssertionError("controller inherited SSH fd inspected")):
            self.assertEqual(proc.sample_task(task, check_sockets=False)["rssBytes"], 8192 * 1024)

    def test_live_missing_rss_permission_and_changed_identity_never_become_zero(self):
        task = row(200, 100, 200, 30, rss=999999)
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _pid: task
        proc.bounded = Mock(side_effect=FileNotFoundError("synthetic exit transition"))
        with self.assertRaisesRegex(guard.Refused, "live_rss_unresolved"):
            proc.sample_task(task)
        proc.bounded = Mock(side_effect=PermissionError("synthetic denied"))
        with self.assertRaises(PermissionError):
            proc.sample_task(task)
        proc.bounded = lambda *_: b"Rss: 0 kB\n"
        with self.assertRaisesRegex(guard.Refused, "live_rss_unresolved"):
            proc.sample_task(task)
        proc.one_or_gone = lambda _: {**task, "state": "Z"}
        self.assertEqual(proc.sample_task(task)["rssBytes"], 0)
        proc.one_or_gone = lambda _: None
        self.assertIsNone(proc.sample_task(task))
        proc.one_or_gone = lambda _: {**task, "startTicks": 999}
        with self.assertRaisesRegex(guard.Refused, "identity_changed"):
            proc.sample_task(task)

    def test_dead_leader_live_threads_never_report_zero_rss_or_skip_fd_failure(self):
        task = row(200, 100, 200, 30)
        terminal = {**task, "state": "Z", "threads": 2}
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _pid: terminal
        proc.bounded = Mock(side_effect=AssertionError("terminal leader must not synthesize RSS"))
        with self.assertRaisesRegex(guard.Refused, "terminal_thread_count_unresolved"):
            proc.sample_task(task)
        proc.bounded.assert_not_called()
        # Same transition after smaps, while the leader FD directory disappears.
        proc.one_or_gone = Mock(side_effect=[task, terminal])
        proc.bounded = lambda *_: b"Rss: 8192 kB\n"
        with patch.object(Path, "iterdir", side_effect=FileNotFoundError("synthetic dead leader FD directory")):
            with self.assertRaisesRegex(guard.Refused, "terminal_thread_count_unresolved"):
                proc.sample_task(task)
        # Also retain the guard on the final RSS-retry retirement path.
        proc.one_or_gone = Mock(side_effect=[task, task, task, task, task, terminal])
        proc.bounded = Mock(side_effect=FileNotFoundError("synthetic smaps exit transition"))
        with self.assertRaisesRegex(guard.Refused, "terminal_thread_count_unresolved"):
            proc.sample_task(task)
        self.assertEqual(proc.bounded.call_count, 3)

    def test_terminal_observation_missing_smaps_retires_only_same_identity_single_thread(self):
        task, clock = row(200, 100, 200, 30, rss=999999), SampleClock()
        terminal = {**task, "state": "Z"}
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = Mock(side_effect=[task, terminal])
        proc.bounded = Mock(side_effect=FileNotFoundError(errno.ENOENT, "synthetic missing smaps"))
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
            result = proc.sample_task(task, observation_deadline=0.2)
        self.assertEqual(result["rssBytes"], 0)
        self.assertEqual(clock.pauses, [])
        detail = proc.last_task_observation
        self.assertEqual((detail["pid"], detail["expectedStartTicks"], detail["resolution"]), (200, 30, "terminal_single_thread"))
        observation = detail["observations"][0]
        self.assertEqual((observation["kind"], observation["errno"], observation["before"]["state"], observation["after"]["state"]), ("smaps_missing", errno.ENOENT, "S", "Z"))
        self.assertIsNone(observation["smapsRSSKiB"])
        self.assertIsNone(observation["smapsRawBytes"])
        self.assertEqual(observation["before"]["statRSSBytes"], 999999)

    def test_terminal_observation_missing_smaps_confirmed_gone_is_not_zero_fallback(self):
        task, clock = row(200, 100, 200, 30), SampleClock()
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = Mock(side_effect=[task, None])
        proc.bounded = Mock(side_effect=ProcessLookupError(errno.ESRCH, "synthetic confirmed exit"))
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
            self.assertIsNone(proc.sample_task(task, observation_deadline=0.2))
        detail = proc.last_task_observation
        self.assertEqual(detail["resolution"], "confirmed_gone")
        self.assertEqual(detail["observations"][0]["afterKind"], "confirmed_gone")
        self.assertEqual(detail["observations"][0]["errno"], errno.ESRCH)
        self.assertEqual(clock.pauses, [])

    def test_terminal_observation_zero_rss_requires_real_positive_rss_and_complete_fds(self):
        task, clock = row(200, 100, 200, 30, rss=1), SampleClock()
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _: task
        proc.bounded = Mock(side_effect=[b"Rss: 0 kB\n", b"Rss: 8192 kB\n"])
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep), patch.object(Path, "iterdir", return_value=iter([])) as fds:
            result = proc.sample_task(task, observation_deadline=0.2)
        self.assertEqual(result["rssBytes"], 8192 * 1024)
        fds.assert_called_once()
        self.assertEqual(clock.pauses, [0.01])
        self.assertEqual(proc.last_task_observation["resolution"], "rss_recovered")
        self.assertEqual(proc.last_task_observation["resolvedSmapsRSSKiB"], 8192)
        self.assertEqual(proc.last_task_observation["observations"][0]["kind"], "smaps_zero")
        self.assertEqual(proc.last_task_observation["observations"][0]["smapsRSSKiB"], 0)

    def test_terminal_observation_continuous_live_missing_stays_refused_within_cycle(self):
        task, clock = row(200, 100, 200, 30), SampleClock()
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _: task
        proc.bounded = Mock(side_effect=FileNotFoundError(errno.ENOENT, "synthetic continuously missing RSS"))
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
            with self.assertRaisesRegex(guard.Refused, "owned_live_rss_unresolved"):
                proc.sample_task(task, observation_deadline=0.2)
        self.assertLessEqual(clock.now, 0.2)
        self.assertGreaterEqual(clock.now, 0.19)
        detail = proc.last_task_observation
        self.assertEqual(detail["resolution"], "refused")
        self.assertEqual(detail["failureCode"], "owned_live_rss_unresolved")
        self.assertLessEqual(len(detail["observations"]), 21)
        self.assertTrue(all(x["before"]["startTicks"] == x["after"]["startTicks"] == 30 and x["smapsRSSKiB"] is None for x in detail["observations"]))

    def test_terminal_observation_missing_fd_directory_keeps_its_distinct_reason(self):
        task, clock = row(200, 100, 200, 30), SampleClock()
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = lambda _: task
        proc.bounded = lambda *_: b"Rss: 8192 kB\n"
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep), patch.object(Path, "iterdir", side_effect=[FileNotFoundError(errno.ENOENT, "synthetic FD directory transition"), iter([])]):
            result = proc.sample_task(task, observation_deadline=0.2)
        self.assertEqual(result["rssBytes"], 8192 * 1024)
        detail = proc.last_task_observation
        self.assertEqual(detail["resolution"], "rss_recovered")
        self.assertEqual(detail["observations"][0]["kind"], "fd_directory_missing")
        self.assertEqual(detail["observations"][0]["errno"], errno.ENOENT)
        self.assertEqual(detail["observations"][0]["smapsRSSKiB"], 8192)
        self.assertEqual(clock.pauses, [0.01])

    def test_fd_reuse_repeats_whole_inventory_and_real_rss_within_shared_cycle(self):
        task, clock = row(200, 100, 200, 30, rss=1), SampleClock()
        proc = object.__new__(guard.LinuxProc)
        proc.one_or_gone = Mock(return_value=task)
        proc.bounded = Mock(side_effect=[b"Rss: 8192 kB\n", b"Rss: 4096 kB\n"])
        entry = Path('/synthetic-fd/4')
        with patch.object(guard.time,'monotonic',side_effect=clock.monotonic), patch.object(guard.time,'sleep',side_effect=clock.sleep), \
                patch.object(Path,'iterdir',side_effect=lambda: iter([entry])) as inventories, \
                patch.object(Path,'lstat',return_value=SimpleNamespace()), \
                patch.object(guard.os,'readlink',side_effect=[FileNotFoundError(errno.ENOENT,'synthetic reused fd'),'pipe:[42]']):
            result=proc.sample_task(task,observation_deadline=0.2)
        self.assertEqual(result['rssBytes'],4096*1024)
        self.assertEqual(inventories.call_count,2)
        self.assertEqual(proc.bounded.call_count,2)
        self.assertEqual(clock.pauses,[0.01])
        detail=proc.last_task_observation
        self.assertEqual(detail['resolution'],'fd_recovered')
        self.assertEqual(detail['resolvedSmapsRSSKiB'],4096)
        self.assertEqual(detail['observations'][0]['kind'],'fd_reused_during_read')
        self.assertEqual(detail['observations'][0]['before']['startTicks'],30)
        self.assertEqual(detail['observations'][0]['after']['startTicks'],30)

    def test_fd_churn_stays_refused_at_original_shared_deadline(self):
        task,clock=row(200,100,200,30),SampleClock(now=0.17)
        proc=object.__new__(guard.LinuxProc)
        proc.one_or_gone=lambda _pid:task
        proc.bounded=Mock(return_value=b'Rss: 8192 kB\n')
        entry=Path('/synthetic-fd/4')
        with patch.object(guard.time,'monotonic',side_effect=clock.monotonic), patch.object(guard.time,'sleep',side_effect=clock.sleep), \
                patch.object(Path,'iterdir',side_effect=lambda:iter([entry])), patch.object(Path,'lstat',return_value=SimpleNamespace()), \
                patch.object(guard.os,'readlink',side_effect=FileNotFoundError(errno.ENOENT,'synthetic continuous reuse')):
            with self.assertRaisesRegex(guard.Refused,'owned_fd_observation_unresolved'):
                proc.sample_task(task,observation_deadline=0.2)
        self.assertLessEqual(clock.now,0.2)
        self.assertLessEqual(len(clock.pauses),4)
        self.assertEqual(proc.last_task_observation['failureCode'],'owned_fd_observation_unresolved')
        self.assertTrue(all(item['kind']=='fd_reused_during_read' for item in proc.last_task_observation['observations']))

    def test_fd_churn_never_skips_a_socket_or_changed_pid_identity(self):
        task,clock=row(200,100,200,30),SampleClock()
        entry,other=Path('/synthetic-fd/4'),Path('/synthetic-fd/5')
        proc=object.__new__(guard.LinuxProc)
        proc.one_or_gone=lambda _pid:task
        proc.bounded=lambda *_:b'Rss: 8192 kB\n'
        with patch.object(guard.time,'monotonic',side_effect=clock.monotonic), patch.object(guard.time,'sleep',side_effect=clock.sleep), \
                patch.object(Path,'iterdir',return_value=iter([entry,other])), patch.object(Path,'lstat',return_value=SimpleNamespace()), \
                patch.object(guard.os,'readlink',side_effect=[FileNotFoundError(errno.ENOENT,'synthetic reuse'),'socket:[42]']):
            with self.assertRaisesRegex(guard.Refused,'owned_socket_present'):proc.sample_task(task,observation_deadline=0.2)
        self.assertEqual(clock.pauses,[])
        proc.one_or_gone=Mock(side_effect=[task,{**task,'startTicks':999}])
        with patch.object(Path,'iterdir',return_value=iter([entry])), patch.object(Path,'lstat',return_value=SimpleNamespace()), \
                patch.object(guard.os,'readlink',side_effect=FileNotFoundError(errno.ENOENT,'synthetic reuse')):
            with self.assertRaisesRegex(guard.Refused,'sample_pid_identity_changed'):proc.sample_task(task)

    def test_closed_fd_requires_fresh_complete_read_not_a_skipped_entry(self):
        task,clock=row(200,100,200,30),SampleClock()
        entry=Path('/synthetic-fd/4')
        proc=object.__new__(guard.LinuxProc)
        proc.one_or_gone=lambda _pid:task
        proc.bounded=Mock(return_value=b'Rss: 8192 kB\n')
        with patch.object(guard.time,'monotonic',side_effect=clock.monotonic), patch.object(guard.time,'sleep',side_effect=clock.sleep), \
                patch.object(Path,'iterdir',side_effect=[iter([entry]),iter([])]) as inventories, \
                patch.object(Path,'lstat',side_effect=FileNotFoundError(errno.ENOENT,'synthetic closed fd')), \
                patch.object(guard.os,'readlink',side_effect=FileNotFoundError(errno.ENOENT,'synthetic closed fd')):
            result=proc.sample_task(task,observation_deadline=0.2)
        self.assertEqual(result['rssBytes'],8192*1024)
        self.assertEqual(inventories.call_count,2)
        self.assertEqual(proc.bounded.call_count,2)
        self.assertEqual(proc.last_task_observation['observations'][0]['kind'],'fd_closed_during_read')

    def test_terminal_observation_permission_identity_and_live_threads_never_wait(self):
        task = row(200, 100, 200, 30)
        for kind in ("permission", "changed-ticks", "terminal-live-threads"):
            with self.subTest(kind=kind):
                clock = SampleClock()
                proc = object.__new__(guard.LinuxProc)
                proc.one_or_gone = lambda _: task
                proc.bounded = Mock(side_effect=PermissionError(errno.EACCES, "never-record-this-private-path"))
                expected = PermissionError
                if kind == "changed-ticks":
                    proc.one_or_gone = Mock(side_effect=[task, {**task, "startTicks": 31}])
                    proc.bounded = Mock(side_effect=FileNotFoundError(errno.ENOENT, "synthetic exit transition"))
                    expected = guard.Refused
                elif kind == "terminal-live-threads":
                    proc.one_or_gone = lambda _: {**task, "state": "Z", "threads": 2}
                    expected = guard.Refused
                with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
                    with self.assertRaises(expected):
                        proc.sample_task(task, observation_deadline=0.2)
                self.assertEqual(clock.pauses, [])
                detail = proc.last_task_observation
                self.assertEqual((detail["pid"], detail["expectedStartTicks"], detail["resolution"]), (200, 30, "refused"))
                self.assertNotIn("never-record-this-private-path", json.dumps(detail))
                if kind == "permission":
                    self.assertEqual(detail["observations"][0]["errno"], errno.EACCES)
                elif kind == "changed-ticks":
                    self.assertEqual(detail["observations"][0]["after"]["startTicks"], 31)
                else:
                    proc.bounded.assert_not_called()

    def test_capacity_tasks_share_one_terminal_observation_deadline(self):
        clock, first = SampleClock(), []
        rows = {**self.base, 200: row(200, 100, 200, 30), 201: row(201, 100, 201, 31)}
        controller, proc, events, calls = self.sampling_controller(rows)
        def bounded(path, _limit):
            pid = int(path.parent.name)
            if not first:
                first.append(pid)
            if pid == first[0] and clock.now >= 0.14:
                return b"Rss: 8192 kB\n"
            raise FileNotFoundError(errno.ENOENT, "synthetic missing per-task RSS")
        proc.bounded = bounded
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep), patch.object(Path, "iterdir", return_value=iter([])):
            with self.assertRaisesRegex(guard.Refused, "owned_live_rss_unresolved"):
                controller.capacity()
        self.assertEqual(len(calls), 2)
        self.assertEqual([kwargs["observation_deadline"] for _, kwargs in calls], [0.2, 0.2])
        self.assertLessEqual(clock.now, 0.2)
        self.assertEqual(controller.task_sample_failure["pid"], calls[1][0])
        self.assertEqual(events[-1][0], "task_sample_refused")
        self.assertEqual(controller.samples, 0)  # No partial RSS sum was accepted.

    def test_capacity_controller_missing_rss_and_active_deadline_are_not_special_cased(self):
        clock = SampleClock(179.95)
        controller, proc, events, calls = self.sampling_controller(self.base)
        proc.bounded = Mock(side_effect=FileNotFoundError(errno.ENOENT, "synthetic controller mm observation"))
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
            with self.assertRaisesRegex(guard.Refused, "owned_live_rss_unresolved"):
                controller.capacity()
        self.assertEqual(calls, [(100, {"check_sockets": False, "observation_deadline": 180})])
        self.assertLessEqual(clock.now, 180)
        self.assertEqual((controller.task_sample_failure["pid"], controller.task_sample_failure["expectedStartTicks"]), (100, 10))
        self.assertEqual(events[-1][0], "task_sample_refused")
        self.assertEqual(controller.samples, 0)

    def test_capacity_observation_updates_elapsed_without_postponing_next_sample(self):
        clock = SampleClock()
        controller, proc, events, calls = self.sampling_controller(self.base)
        proc.bounded = lambda *_: b"Rss: 8192 kB\n"
        def disk_scan(_case):
            clock.now += 0.1  # Pure public fixture latency, no actual I/O/wait.
            return 0
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep), patch.object(guard.os, "statvfs", return_value=SimpleNamespace(f_bavail=10 << 30, f_frsize=1)), patch.object(guard, "directory_bytes", side_effect=disk_scan):
            controller.capacity()
        self.assertEqual(controller.last_sample["elapsedMs"], 100)
        self.assertEqual(controller.next_sample, 0.2)
        self.assertNotEqual(controller.next_sample, clock.now + 0.2)
        self.assertEqual(events[-1][0], "sample")

    def test_fresh_spawn_memory_floor_does_not_apply_to_active_samples(self):
        clock = SampleClock()
        controller, proc, _, _ = self.sampling_controller(self.base)
        proc.bounded = lambda *_: b"Rss: 8192 kB\n"
        proc.available_memory = lambda: 14 << 30  # Above zero, below spawn's 16GiB.
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep), patch.object(guard.os, "statvfs", return_value=SimpleNamespace(f_bavail=10 << 30, f_frsize=1)), patch.object(guard, "directory_bytes", return_value=0):
            controller.capacity()  # Existing active-run condition is >0 only.
            with self.assertRaisesRegex(guard.Refused, "fresh_memory_floor"):
                controller.capacity(fresh=True)  # Cannot use cached active sample.
        self.assertEqual(controller.samples, 2)
        self.assertEqual(clock.pauses, [])

    def test_capacity_diagnostic_journal_failure_preserves_original_refusal(self):
        clock = SampleClock()
        controller, proc, _, _ = self.sampling_controller(self.base)
        proc.bounded = Mock(side_effect=PermissionError(errno.EACCES, "never-record-this-private-path"))
        controller.event = Mock(side_effect=OSError(errno.ENOSPC, "synthetic journal disk failure"))
        with patch.object(guard.time, "monotonic", side_effect=clock.monotonic), patch.object(guard.time, "sleep", side_effect=clock.sleep):
            with self.assertRaises(PermissionError) as failure:
                controller.capacity()
        self.assertEqual(failure.exception.errno, errno.EACCES)
        self.assertEqual(controller.task_sample_failure["failureClass"], "PermissionError")
        self.assertEqual(controller.task_sample_journal_error, {"kind": "journal_persistence_failed", "errorClass": "OSError", "errno": errno.ENOSPC})
        self.assertEqual(clock.pauses, [])

    def test_normal_verifier_requires_both_codes_and_exact_stdout(self):
        raw = b"consensus migration state passed: height=1987000 lastBlockHash=" + b"a" * 64 + b" stateHash=" + b"b" * 64 + b" accounts=12 validators=4\n"
        self.assertEqual(guard.qualify_verifier(raw, [0, 0])["height"], "1987000")
        for codes, output in (([0], raw), ([0, 1], raw), ([0, 0], raw + b"extra\n"),
                              ([0, 0], raw.replace(b"validators=4", b"validators=3"))):
            with self.assertRaises(guard.Refused):
                guard.qualify_verifier(output, codes)

    def test_proc_stat_parser_binds_pid_startticks_and_complete_fields(self):
        fields = ["S"] + ["0"] * 45
        fields[1], fields[2], fields[3] = "100", "200", "200"
        fields[17], fields[19], fields[21] = "3", "12345", "2"
        raw = ("200 (comm with ) spaces) " + " ".join(fields)).encode()
        parsed = guard.parse_stat(raw, 200, 4096)
        self.assertEqual((parsed["pid"], parsed["parent"], parsed["group"], parsed["startTicks"]), (200, 100, 200, 12345))
        self.assertEqual(parsed["rssBytes"], 8192)  # Parser only, not sampled RSS.
        for wrong in (raw.replace(b"200 (", b"201 (", 1), b"200 (incomplete) S 1", b"200 (bad) ? " + b"0 " * 46):
            with self.assertRaises(guard.Refused):
                guard.parse_stat(wrong, 200, 4096)


if __name__ == "__main__":
    unittest.main()
