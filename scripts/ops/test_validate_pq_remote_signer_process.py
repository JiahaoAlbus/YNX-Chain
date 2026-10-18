"""Tiny parser/control regressions; no actual ELF, proc, signal or process run.

Synthetic samples and result text only test the guard's rejection decisions.
They are never operational signer evidence. The separate opt-in Go process
window is the only source of normal-command execution evidence.
"""
import builtins
import contextlib
import ctypes
import errno
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


@contextlib.contextmanager
def forbid_host_operations():
    def refuse(*_args, **_kwargs):
        raise AssertionError("pure control attempted a host process operation")

    def checked(original):
        def call(path, *args, **kwargs):
            if not isinstance(path, int):
                name = os.path.normpath(os.fsdecode(path))
                if name == "/proc" or name.startswith("/proc/"):
                    raise AssertionError("pure control attempted host proc access")
            return original(path, *args, **kwargs)
        return call

    with contextlib.ExitStack() as stack:
        for module, name in ((builtins, "open"), (io, "open"), (os, "open"), (os, "listdir"), (os, "scandir")):
            stack.enter_context(patch.object(module, name, checked(getattr(module, name))))
        for name in ("kill", "killpg", "waitpid", "fork", "posix_spawn", "posix_spawnp", "sched_getaffinity", "sched_setaffinity"):
            stack.enter_context(patch.object(os, name, refuse, create=True))
        for module, name in ((ctypes, "CDLL"), (subprocess, "Popen"), (signal, "signal")):
            stack.enter_context(patch.object(module, name, refuse))
        yield


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("remote_process_guard", Path(__file__).with_name("validate-pq-remote-signer-process.py"))
caller = importlib.util.module_from_spec(SPEC)
with forbid_host_operations():
    SPEC.loader.exec_module(caller)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stat_line(pid, parent, start, state="S"):
    fields = [state]+["0"]*45
    fields[1], fields[2], fields[17], fields[19] = str(parent), "100", "1", str(start)
    return (str(pid)+" (synthetic control) "+" ".join(fields)).encode()


def resource_sample(**overrides):
    sample = dict(elapsedMs=0, rssBytes=4096, privateBytes=0, buildBytes=1024,
                  logBytes=0, processes=1, threads=1, tasks=[],
                  freeDiskBytes=caller.LIMITS["diskFloorBytes"],
                  availableMemoryBytes=caller.LIMITS["memoryFloorBytes"])
    sample.update(overrides)
    return sample


def process_output(pin, layout="atomic-json"):
    marker = ("normalRemoteProcess=true proposal=true prevote=true precommit=true extension=true "
              "coldOriginalHRS=true unknownNoRetry=true freshCheckpoint=true fullPeerPin=true "
              "nodeStarted=false publicDeployment=false binarySHA256="+pin)
    layout_marker = ("checkpointLayout="+layout+
                     " normalCLI=true originalSourceUnchanged=true coldOriginalHRS=true unknownNoRetry=true")
    return ("=== RUN   "+caller.TEST+"\n    pq_remote_process_test.go:192: "+layout_marker+
            "\n    pq_remote_process_test.go:193: "+marker+
            "\n--- PASS: "+caller.TEST+" (1.25s)\nPASS\n").encode()


class RemoteProcessControls(unittest.TestCase):
    def setUp(self):
        fence = forbid_host_operations()
        fence.__enter__()
        self.addCleanup(fence.__exit__, None, None, None)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.case, self.build = self.root/"case", self.root/"build"
        self.case.mkdir(mode=0o700)
        self.build.mkdir(mode=0o700)
        # Tiny parser-only ELF headers: invalid runnable programs, never run.
        header = b"\x7fELF\x02\x01"+bytes(10)+b"\x02\x00\x3e\x00"
        self.binaries = {caller.TEST_BINARY: header+b"test-control-only",
                         caller.DAEMON_BINARY: header+b"daemon-control-only"}
        for name, raw in self.binaries.items():
            self.write(self.build/name, raw, 0o700)
        self.write(self.build/"pq_remote_process_test.go", (ROOT/caller.SOURCE_LEAF).read_bytes())
        self.source = dict(version="YNX-PQ-REMOTE-SIGNER-PROCESS-BUILD/v1", commit="a"*40,
                           platform="linux/amd64", sourceLeaves={caller.SOURCE_LEAF:caller.SOURCE_SHA256},
                           binaries={name:dict(bytes=len(raw), sha256=sha(raw)) for name, raw in self.binaries.items()})
        self.args = SimpleNamespace(case=self.case, build=self.build,
                                    guard=ROOT/"scripts/loadtest/pq-paired-linux-window.py",
                                    profile=caller.PROFILE, authorization_id="synthetic-control-only",
                                    checkpoint_layout="atomic-json",
                                    expected_commit="a"*40, expected_manifest_sha256="",
                                    expected_test_sha256=sha(self.binaries[caller.TEST_BINARY]),
                                    expected_daemon_sha256=sha(self.binaries[caller.DAEMON_BINARY]))
        self.refresh()

    def write(self, path, raw, mode=0o600):
        path.write_bytes(raw)
        path.chmod(mode)

    def refresh(self):
        raw = json.dumps(self.source, sort_keys=True).encode()
        self.write(self.build/"SOURCE.json", raw)
        self.args.expected_manifest_sha256 = sha(raw)

    def guard(self):
        # Exact released definitions; never alter its CAPS or invoke its run.
        return caller.load_guard(self.args.guard)

    def test_default_is_inert_and_does_not_read_or_create_case(self):
        with patch.object(caller, "run", side_effect=AssertionError("execute called")), \
                patch.object(caller, "load_guard", side_effect=AssertionError("input read")), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(caller.main(["--case", "/never-read"]), 0)
        prepared = json.loads(output.getvalue())
        self.assertEqual(prepared["status"], "prepared_only_no_process_started")
        self.assertEqual(prepared["profile"], "remote-signer-process-v1")
        self.assertEqual(prepared["checkpointLayout"], "atomic-json")
        self.assertEqual(list(self.case.iterdir()), [])

    def test_host_operations_and_proc_access_are_forbidden_in_controls(self):
        for operation in (lambda: subprocess.Popen(["never-execute"]),
                          lambda: os.kill(991, signal.SIGKILL), lambda: os.waitpid(991, os.WNOHANG),
                          lambda: ctypes.CDLL(None), lambda: Path("/proc/self/stat").read_bytes(),
                          lambda: list(Path("/proc").iterdir())):
            with self.assertRaises(AssertionError):
                operation()

    def test_execution_requires_explicit_authorization_and_supported_host_before_reads(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as refused:
            caller.main(["--execute"])
        self.assertEqual(refused.exception.code, 2)
        with patch.object(caller, "load_guard", side_effect=AssertionError("must refuse before input read")):
            with patch.object(caller.sys, "platform", "darwin"), self.assertRaisesRegex(RuntimeError, "Linux amd64"):
                caller.run(self.args)
            with patch.object(caller.sys, "platform", "linux"), \
                    patch.object(caller.os, "uname", return_value=SimpleNamespace(machine="x86_64")):
                self.args.authorization_id = ""
                with self.assertRaisesRegex(RuntimeError, "authorization reference"):
                    caller.run(self.args)
        self.assertEqual(list(self.case.iterdir()), [])

    def test_exact_source_and_dual_binary_pins_with_no_guard_cap_mutation(self):
        pins = caller.validate_inputs(self.args)
        self.assertEqual(set(pins), caller.BUILD_FILES)
        self.assertEqual(pins["pq_remote_process_test.go"]["sha256"], caller.SOURCE_SHA256)
        self.assertNotEqual(pins[caller.TEST_BINARY]["sha256"], pins[caller.DAEMON_BINARY]["sha256"])
        caller.unchanged(self.build, pins)
        guard = self.guard()
        original = dict(guard.CAPS)
        caller.enforce(resource_sample())
        self.assertEqual(guard.CAPS, original)
        self.assertEqual(sha(self.args.guard.read_bytes()), caller.GUARD_SHA256)
        with patch.object(caller, "GUARD_SHA256", "0"*64), self.assertRaisesRegex(RuntimeError, "SHA mismatch"):
            caller.load_guard(self.args.guard)

    def test_selected_checkpoint_layout_is_explicit_and_never_inherited(self):
        pins = caller.validate_inputs(self.args)
        original = dict(caller.ENVIRONMENT)
        with patch.dict(os.environ, {"YNX_PQ_REMOTE_PROCESS_LAYOUT": "foreign-layout", "SECRET_CONTROL": "must-not-inherit"}):
            for layout in ("atomic-json", "snapshot-journal", "block-journal"):
                self.args.checkpoint_layout = layout
                caller.validate_inputs(self.args)
                env = caller.process_environment(self.case, self.build, pins, layout)
                self.assertEqual(env, dict(original, HOME=str(self.case/"tmp"), TMPDIR=str(self.case/"tmp"),
                    YNX_PQ_REMOTE_SIGNER_BINARY=str(self.build/caller.DAEMON_BINARY),
                    YNX_PQ_REMOTE_SIGNER_SHA256=self.args.expected_daemon_sha256,
                    YNX_PQ_REMOTE_PROCESS_LAYOUT=layout))
                self.assertEqual(caller.ENVIRONMENT, original)
        for bad in ("", "auto", "snapshot-journal ", "ATOMIC-JSON", None, True, 1):
            self.args.checkpoint_layout = bad
            with patch.object(caller, "private_directory", side_effect=AssertionError("layout must fail before any inputs")):
                with self.subTest(bad=bad), self.assertRaisesRegex(RuntimeError, "checkpoint layout"):
                    caller.validate_inputs(self.args)
                with self.assertRaisesRegex(RuntimeError, "checkpoint layout"):
                    caller.run(self.args)
        self.assertEqual(list(self.case.iterdir()), [])

    def test_independent_pins_cannot_be_replaced_by_manifest_self_report(self):
        for field, bad in (("expected_commit", "b"*40), ("expected_manifest_sha256", "b"*64),
                           ("expected_test_sha256", "b"*64), ("expected_daemon_sha256", "b"*64),
                           ("expected_commit", "a"*7), ("expected_test_sha256", "A"*64)):
            original = getattr(self.args, field)
            setattr(self.args, field, bad)
            with self.subTest(field=field, bad=bad), self.assertRaises(RuntimeError):
                caller.validate_inputs(self.args)
            setattr(self.args, field, original)
        self.source["commit"] = "b"*40
        self.refresh()
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)

    def test_bad_or_duplicate_manifest_fields_and_noninteger_sizes_rejected(self):
        for change in (lambda s: s.update(extra=True),
                       lambda s: s.update(platform="darwin/arm64"),
                       lambda s: s.update(sourceLeaves={caller.SOURCE_LEAF:"0"*64}),
                       lambda s: s["binaries"][caller.TEST_BINARY].update(bytes=float(len(self.binaries[caller.TEST_BINARY])))):
            original = json.loads(json.dumps(self.source))
            change(self.source)
            self.refresh()
            with self.assertRaises(RuntimeError):
                caller.validate_inputs(self.args)
            self.source = original
        self.refresh()
        raw = (self.build/"SOURCE.json").read_bytes()
        duplicate = b'{"commit":"a",'+raw[1:]
        self.write(self.build/"SOURCE.json", duplicate)
        self.args.expected_manifest_sha256 = sha(duplicate)
        with self.assertRaisesRegex(RuntimeError, "duplicate"):
            caller.validate_inputs(self.args)

    def test_existing_unknown_and_private_files_are_retained_without_overwrite(self):
        for name in ("UNKNOWN", "tmp", "remote-process-receipt.json", "original.hrs"):
            path = self.case/name
            original = b"synthetic unresolved original bytes"
            self.write(path, original)
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "fresh empty case"):
                caller.validate_inputs(self.args)
            with self.assertRaises(FileExistsError):
                caller.exclusive(path, b"must not overwrite")
            self.assertEqual(path.read_bytes(), original)
            path.unlink()

    def test_noncanonical_permissions_symlinks_hardlinks_and_extra_inputs_rejected(self):
        self.case.chmod(0o755)
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)
        self.case.chmod(0o700)
        alias = self.root/"alias"
        alias.symlink_to(self.case, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            caller.private_directory(alias)
        binary = self.build/caller.TEST_BINARY
        binary.chmod(0o600)
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)
        binary.chmod(0o700)
        os.link(binary, self.root/"hardlink")
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)
        (self.root/"hardlink").unlink()
        self.write(self.build/"unexpected", b"unknown")
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)

    def test_tampered_leaf_wrong_elf_same_binary_and_mutated_input_rejected(self):
        pins = caller.validate_inputs(self.args)
        leaf = self.build/"pq_remote_process_test.go"
        raw = leaf.read_bytes()
        self.write(leaf, raw+b"\n// synthetic mutation\n")
        with self.assertRaises(RuntimeError):
            caller.validate_inputs(self.args)
        with self.assertRaises(RuntimeError):
            caller.unchanged(self.build, pins)
        self.write(leaf, raw)
        for raw in (b"#!/bin/sh\nnever-execute", self.binaries[caller.TEST_BINARY]):
            self.write(self.build/caller.DAEMON_BINARY, raw, 0o700)
            self.source["binaries"][caller.DAEMON_BINARY] = dict(bytes=len(raw), sha256=sha(raw))
            self.args.expected_daemon_sha256 = sha(raw)
            self.refresh()
            with self.assertRaises(RuntimeError):
                caller.validate_inputs(self.args)

    def test_same_inode_change_during_read_fails_closed(self):
        path = self.build/"SOURCE.json"
        original = path.stat().st_ino
        def mutate():
            with path.open("r+b") as output:
                output.write(b"XX")
        with self.assertRaisesRegex(RuntimeError, "changed during read"):
            caller.read_file(path, 65536, progress=mutate)
        self.assertEqual(path.stat().st_ino, original)

    def test_all_fixed_caps_require_exact_nonnegative_int_and_resource_floor(self):
        self.assertEqual(caller.LIMITS, dict(activeMs=75000, cleanupMs=15000, totalMs=90000,
            rssBytes=512 << 20, privateBytes=32 << 20, logBytes=1 << 20, buildBytes=1 << 30,
            processes=3, threads=160, diskFloorBytes=2 << 30, memoryFloorBytes=1 << 30, sampleMs=100))
        for name in ("rssBytes", "privateBytes", "buildBytes", "logBytes", "processes", "threads"):
            caller.enforce(resource_sample(**{name:caller.LIMITS[name]}))
            for bad in (-1, True, 1.0, caller.LIMITS[name]+1):
                with self.subTest(name=name, bad=bad), self.assertRaises(RuntimeError):
                    caller.enforce(resource_sample(**{name:bad}))
        for name, cap in (("freeDiskBytes", "diskFloorBytes"), ("availableMemoryBytes", "memoryFloorBytes")):
            for bad in (caller.LIMITS[cap]-1, True, float(caller.LIMITS[cap])):
                with self.assertRaises(RuntimeError):
                    caller.enforce(resource_sample(**{name:bad}))

    def test_actual_pass_shape_requires_one_complete_test_and_one_pinned_marker(self):
        pin = self.args.expected_daemon_sha256
        original = process_output(pin)
        self.assertRegex(caller.qualify(original, b"", 0, pin), r"^[0-9a-f]{64}$")
        cases = (b"PASS\n", original.replace(b"--- PASS:", b"--- SKIP:"),
                 original.replace(b"--- PASS:", b"--- FAIL:"), original+b"PASS\n",
                 original+original, original.replace(b"extension=true", b"extension=false"),
                 original.replace(pin.encode(), b"0"*64), original+b"=== RUN   unrelated\n",
                 original.replace(b"    pq_remote_process_test.go:193:", b"    other.go:193:"),
                 original+b"panic: synthetic\n")
        for raw in cases:
            with self.subTest(raw=raw[:60]), self.assertRaises(RuntimeError):
                caller.qualify(raw, b"", 0, pin)
        for terminal, stderr in ((1, b""), (-15, b""), (None, b""), (False, b""), (0, b"synthetic stderr")):
            with self.assertRaises(RuntimeError):
                caller.qualify(original, stderr, terminal, pin)

    def test_actual_layout_completion_must_match_the_requested_window(self):
        pin = self.args.expected_daemon_sha256
        for layout in ("atomic-json", "snapshot-journal", "block-journal"):
            raw = process_output(pin, layout)
            self.assertRegex(caller.qualify(raw, b"", 0, pin, layout), r"^[0-9a-f]{64}$")
            other = "block-journal" if layout != "block-journal" else "snapshot-journal"
            with self.subTest(layout=layout), self.assertRaisesRegex(RuntimeError, "layout marker"):
                caller.qualify(raw, b"", 0, pin, other)
            line = next(v for v in raw.splitlines(keepends=True) if b"checkpointLayout=" in v)
            for bad in (raw.replace(line, b""), raw.replace(line, line+line),
                        raw.replace(b"normalCLI=true", b"normalCLI=false"),
                        raw.replace(b"originalSourceUnchanged=true", b"originalSourceUnchanged=false"),
                        raw.replace(b"pq_remote_process_test.go:192:", b"other.go:192:")):
                with self.assertRaises(RuntimeError):
                    caller.qualify(bad, b"", 0, pin, layout)

    def sample(self, responses, deadline=1):
        guard = self.guard()
        row = guard.parse_stat(stat_line(101, 100, 55), 101)
        def bounded(path, *_args):
            self.assertEqual(str(path), responses[0][0])
            value = responses.pop(0)[1]
            if isinstance(value, Exception):
                raise value
            return value
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(guard, "bounded", side_effect=bounded), \
                patch.object(caller.time, "monotonic", side_effect=lambda:clock[0]), \
                patch.object(caller.time, "sleep", side_effect=sleep):
            result = caller.sample_owned_task(guard, row, deadline)
        self.assertEqual(responses, [])
        return result

    def test_exit_mm_race_requires_actual_zombie_or_disappearance(self):
        absent = lambda: FileNotFoundError(errno.ENOENT, "synthetic disappearance")
        self.assertIsNone(self.sample([("/proc/101/smaps_rollup", absent()), ("/proc/101/stat", absent())]))
        zombie = self.sample([("/proc/101/smaps_rollup", absent()), ("/proc/101/stat", stat_line(101, 100, 55, "Z"))])
        self.assertEqual((zombie["state"], zombie["rssBytes"]), ("Z", 0))
        recovered = self.sample([("/proc/101/smaps_rollup", absent()), ("/proc/101/stat", stat_line(101, 100, 55)),
                                 ("/proc/101/smaps_rollup", b"Rss: 37 kB\n"), ("/proc/101/stat", stat_line(101, 100, 55))])
        self.assertEqual(recovered["rssBytes"], 37*1024)

    def test_live_unreadable_permission_recycled_identity_and_deadline_fail(self):
        for responses, deadline in (([("/proc/101/smaps_rollup", PermissionError(errno.EACCES, "synthetic"))], 1),
                ([("/proc/101/smaps_rollup", FileNotFoundError(errno.ENOENT, "synthetic")),
                  ("/proc/101/stat", stat_line(101, 100, 56))], 1),
                ([("/proc/101/smaps_rollup", b"Rss: 1 kB\n"), ("/proc/101/stat", stat_line(101, 100, 56))], 1),
                ([], 0)):
            with self.subTest(deadline=deadline), self.assertRaises((RuntimeError, OSError)):
                self.sample(responses, deadline)
        responses = []
        for _ in range(4):
            responses.extend([("/proc/101/smaps_rollup", FileNotFoundError(errno.ENOENT, "synthetic")),
                              ("/proc/101/stat", stat_line(101, 100, 55))])
        with self.assertRaisesRegex(RuntimeError, "RSS unreadable"):
            self.sample(responses)

    def test_cleanup_uses_fresh_identity_and_only_own_closure(self):
        guard = self.guard()
        rows = {100:guard.parse_stat(stat_line(100, 1, 40), 100),
                101:guard.parse_stat(stat_line(101, 100, 55), 101),
                102:guard.parse_stat(stat_line(102, 101, 56), 102),
                900:guard.parse_stat(stat_line(900, 1, 90), 900)}
        sent, waited, known = [], [], {}
        def bounded(path, *_args):
            pid = int(path.parent.name)
            return stat_line(pid, rows[pid]["parent"], rows[pid]["startTicks"])
        with patch.object(guard, "proc_inventory", return_value=(rows, [])), patch.object(guard, "bounded", side_effect=bounded):
            self.assertFalse(caller.cleanup_scan(guard, 100, None, known, False,
                             send=lambda *args:sent.append(args), wait=lambda *args:waited.append(args)))
        self.assertEqual(sent, [(101, signal.SIGTERM), (102, signal.SIGTERM)])
        self.assertEqual(waited, [])
        self.assertEqual(known, {101:55, 102:56})
        sent.clear()
        with patch.object(guard, "proc_inventory", return_value=(rows, [])), \
                patch.object(guard, "bounded", return_value=stat_line(101, 100, 999)), \
                self.assertRaisesRegex(RuntimeError, "identity changed"):
            caller.cleanup_scan(guard, 100, None, known, True, send=lambda *args:sent.append(args))
        self.assertEqual(sent, [])
        rows = {100:rows[100], 101:guard.parse_stat(stat_line(101, 100, 55, "Z"), 101), 900:rows[900]}
        with patch.object(guard, "proc_inventory", return_value=(rows, [])), \
                patch.object(guard, "bounded", return_value=stat_line(101, 100, 55, "Z")):
            self.assertFalse(caller.cleanup_scan(guard, 100, None, known, True,
                             send=lambda *args:sent.append(args), wait=lambda *args:waited.append(args)))
        self.assertEqual(waited, [(101, os.WNOHANG)])
        self.assertEqual(sent, [])

    def test_cleanup_requires_two_consecutive_real_empty_scans(self):
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(caller.time, "monotonic", side_effect=lambda:clock[0]), \
                patch.object(caller.time, "sleep", side_effect=sleep):
            window = caller.Window(SimpleNamespace(), self.case, self.build)
            with patch.object(caller, "cleanup_scan", side_effect=[True, FileNotFoundError(errno.ENOENT, "synthetic"), True, True]) as scans:
                self.assertEqual(window.cleanup(), (True, None))
            self.assertEqual(scans.call_count, 4)
            self.assertEqual(len(window.empty_scans), 3)
            window = caller.Window(SimpleNamespace(), self.case, self.build)
            with patch.object(caller, "cleanup_scan", side_effect=[RuntimeError("synthetic identity error"), True, True]):
                okay, cause = window.cleanup()
            self.assertFalse(okay)
            self.assertIn("identity", cause)
            window = caller.Window(SimpleNamespace(), self.case, self.build)
            with patch.object(caller, "cleanup_scan", return_value=False):
                self.assertEqual(window.cleanup(), (False, "owned process cleanup incomplete"))
            self.assertLessEqual(clock[0]-window.started, 15.1)

    def test_stricter_three_process_cap_precedes_any_rss_guess(self):
        guard = self.guard()
        rows = {pid:guard.parse_stat(stat_line(pid, 1 if pid == 100 else 100, pid+10), pid)
                for pid in (100, 101, 102, 103)}
        with patch.object(caller.os, "getpid", return_value=100), \
                patch.object(guard, "proc_inventory", return_value=(rows, [])), \
                patch.object(guard, "bounded", side_effect=AssertionError("must refuse before RSS read")):
            window = caller.Window(guard, self.case, self.build)
            with self.assertRaisesRegex(RuntimeError, "processes"):
                window.tick(True)

    def test_command_control_uses_only_fixed_binary_fd_argv_and_sanitized_environment(self):
        pins = caller.validate_inputs(self.args)
        guard = self.guard()
        window = caller.Window(guard, self.case, self.build)
        closed, registered, reads = [], {}, {}
        streams = []
        for name, fd in (("stdout", 301), ("stderr", 302)):
            streams.append(SimpleNamespace(fileno=lambda fd=fd:fd, close=lambda name=name:closed.append(name)))
            reads[fd] = [process_output(self.args.expected_daemon_sha256), b""] if name == "stdout" else [b""]
        child = SimpleNamespace(pid=101, stdout=streams[0], stderr=streams[1], poll=lambda:0, returncode=0)
        class ControlSelector:
            def register(self, stream, _events, name):
                registered[stream.fileno()] = SimpleNamespace(fileobj=stream, data=name)
            def unregister(self, stream):
                del registered[stream.fileno()]
            def select(self, _timeout):
                return [(key, 1) for key in list(registered.values())]
            def get_map(self):
                return registered
            def close(self):
                pass
        with patch.object(window, "tick"), patch.object(caller.subprocess, "Popen", return_value=child) as launch, \
                patch.object(caller.selectors, "DefaultSelector", return_value=ControlSelector()), \
                patch.object(caller.os, "set_blocking"), \
                patch.object(caller.os, "read", side_effect=lambda fd, _size:reads[fd].pop(0)), \
                patch.object(guard, "bounded", return_value=stat_line(101, os.getpid(), 55)):
            self.assertEqual(window.command(pins), 0)
        launch.assert_called_once()
        args, kwargs = launch.call_args
        self.assertEqual(args[0], [str(self.build/caller.TEST_BINARY), "-test.run=^"+caller.TEST+"$",
                                  "-test.count=1", "-test.timeout=90s", "-test.v"])
        self.assertEqual(kwargs["env"], dict(caller.ENVIRONMENT, HOME=str(self.case/"tmp"), TMPDIR=str(self.case/"tmp"),
            YNX_PQ_REMOTE_SIGNER_BINARY=str(self.build/caller.DAEMON_BINARY),
            YNX_PQ_REMOTE_SIGNER_SHA256=self.args.expected_daemon_sha256,
            YNX_PQ_REMOTE_PROCESS_LAYOUT="atomic-json"))
        self.assertEqual(kwargs["executable"], "/proc/self/fd/"+str(kwargs["pass_fds"][0]))
        self.assertEqual(kwargs["cwd"], self.case)
        self.assertTrue(kwargs["start_new_session"])
        self.assertEqual(closed, ["stdout", "stderr"])
        self.assertTrue(window.output_complete)
        self.assertEqual((self.case/"stdout.log").read_bytes(), process_output(self.args.expected_daemon_sha256))
        self.assertEqual((self.case/"stderr.log").read_bytes(), b"")

    def test_final_retired_scan_detects_late_private_growth_and_unstable_files(self):
        guard = self.guard()
        window = caller.Window(guard, self.case, self.build)
        row = guard.parse_stat(stat_line(os.getpid(), 1, 55), os.getpid())
        task = dict(row, rssBytes=1024)
        with patch.object(guard, "directory_bytes", side_effect=[1, 100, 2, 100]), \
                self.assertRaisesRegex(RuntimeError, "changed during final scan"):
            window.final_files()
        with patch.object(guard, "directory_bytes", side_effect=[(32 << 20)+1, 100, (32 << 20)+1, 100]), \
                patch.object(guard, "bounded", return_value=stat_line(os.getpid(), 1, 55)), \
                patch.object(caller, "sample_owned_task", return_value=task), \
                patch.object(caller.os, "statvfs", return_value=SimpleNamespace(f_bavail=2 << 30, f_frsize=1)), \
                patch.object(guard, "memory_available", return_value=1 << 30), \
                self.assertRaisesRegex(RuntimeError, "privateBytes"):
            window.final_files()
        self.assertEqual(window.samples[-1]["privateBytes"], (32 << 20)+1)

    def simulated_run(self, command_error=None, cleanup_error=None, mutate=False):
        """Receipt decisions only. No real command, authority or sampled PID."""
        guard = self.guard()
        captured = {}
        outer = self
        class ControlWindow:
            def __init__(self, _guard, _case, _build, layout):
                outer.assertEqual(layout, outer.args.checkpoint_layout)
                self.checkpoint_layout = layout
                self.started, self.child, self.birth = 0, None, None
                self.subreaper, self.telemetry_failure = True, None
                self.samples, self.empty_scans = [resource_sample()], []
                self.log_bytes, self.observed_processes, self.output_complete = 0, 1, False
            def start(self):
                pass
            def tick(self, *_args):
                pass
            def total_deadline(self):
                pass
            def command(self, _pins):
                self.child = SimpleNamespace(pid=101, poll=lambda:0)
                self.birth = 55
                outer.write(outer.case/"stdout.log", process_output(outer.args.expected_daemon_sha256, self.checkpoint_layout))
                outer.write(outer.case/"stderr.log", b"")
                outer.write(outer.case/"tmp"/"original.hrs", b"synthetic-private-original-not-a-real-key")
                if mutate:
                    outer.write(outer.build/caller.DAEMON_BINARY, b"mutated", 0o700)
                if command_error:
                    raise RuntimeError(command_error)
                self.output_complete = True
                return 0
            def cleanup(self):
                self.empty_scans = [] if cleanup_error else [1, 2]
                return cleanup_error is None, cleanup_error
            def final_files(self):
                self.samples.append(resource_sample(privateBytes=guard.directory_bytes(outer.case)))
        with patch.object(caller.sys, "platform", "linux"), \
                patch.object(caller.os, "uname", return_value=SimpleNamespace(machine="x86_64")), \
                patch.object(caller, "Window", ControlWindow), patch.object(caller, "load_guard", return_value=guard), \
                patch.object(caller.signal, "signal"), patch.object(caller.time, "monotonic", return_value=1), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            code = caller.run(self.args)
        captured["stdout"] = output.getvalue()
        captured["receipt"] = json.loads((self.case/"remote-process-receipt.json").read_bytes())
        return code, captured

    def test_receipt_control_preserves_unknown_original_and_first_cause(self):
        code, captured = self.simulated_run("synthetic original UNKNOWN", "synthetic cleanup failure")
        receipt = captured["receipt"]
        self.assertEqual(code, 1)
        self.assertEqual(receipt["status"], "unknown")
        self.assertEqual(receipt["firstCause"], "synthetic original UNKNOWN")
        self.assertFalse(receipt["cleanupComplete"])
        self.assertFalse(receipt["processAssertionsVerified"])
        self.assertFalse(receipt["outputComplete"])
        self.assertEqual(receipt["terminalCode"], 0)
        self.assertEqual((self.case/"tmp"/"original.hrs").read_bytes(), b"synthetic-private-original-not-a-real-key")
        for public in (captured["stdout"], json.dumps(receipt)):
            self.assertNotIn("synthetic-private-original-not-a-real-key", public)
            self.assertNotIn(str(self.case), public)
        self.assertEqual(receipt["output"]["stdout"]["sha256"], sha((self.case/"stdout.log").read_bytes()))
        with self.assertRaisesRegex(RuntimeError, "fresh empty case"):
            caller.validate_inputs(self.args)

    def test_receipt_control_requires_retired_inputs_and_cleanup_even_with_pass_text(self):
        code, captured = self.simulated_run(mutate=True)
        self.assertEqual(code, 1)
        self.assertEqual(captured["receipt"]["status"], "unknown")
        self.assertFalse(captured["receipt"]["processAssertionsVerified"])
        self.assertEqual(captured["receipt"]["firstCause"], "read-only build input changed")

    def test_receipt_control_success_is_not_public_deployment_and_has_full_output_hash(self):
        code, captured = self.simulated_run()
        receipt = captured["receipt"]
        self.assertEqual(code, 0)
        self.assertEqual(receipt["status"], "validated_normal_remote_process")
        self.assertTrue(receipt["cleanupComplete"])
        self.assertEqual(receipt["emptyOwnedScans"], [1, 2])
        self.assertTrue(receipt["processAssertionsVerified"])
        self.assertTrue(receipt["outputComplete"])
        self.assertFalse(receipt["publicDeployment"])
        self.assertFalse(receipt["nodeStarted"])
        self.assertEqual(receipt["checkpointLayout"], self.args.checkpoint_layout)
        self.assertEqual(receipt["checkpointLayoutMarkerSHA256"], sha(
            ("checkpointLayout="+self.args.checkpoint_layout+
             " normalCLI=true originalSourceUnchanged=true coldOriginalHRS=true unknownNoRetry=true").encode()))
        self.assertIn("Ephemeral host retirement is not a durable backup", receipt["privateRetentionScope"])
        self.assertEqual(set(receipt["binaryPins"]), {caller.TEST_BINARY, caller.DAEMON_BINARY})
        self.assertEqual(receipt["output"]["stdout"]["sha256"], sha((self.case/"stdout.log").read_bytes()))
        self.assertTrue((self.case/"tmp"/"original.hrs").is_file())

    def test_selected_journal_is_bound_to_invocation_and_qualified_receipt(self):
        self.args.checkpoint_layout = "block-journal"
        code, captured = self.simulated_run()
        self.assertEqual(code, 0)
        receipt = captured["receipt"]
        self.assertEqual(receipt["checkpointLayout"], "block-journal")
        invocation = json.loads((self.case/"invocation.json").read_bytes())
        self.assertEqual(invocation["checkpointLayout"], "block-journal")
        self.assertEqual(receipt["checkpointLayoutMarkerSHA256"], sha(
            b"checkpointLayout=block-journal normalCLI=true originalSourceUnchanged=true coldOriginalHRS=true unknownNoRetry=true"))
        self.assertEqual(receipt["limits"], caller.LIMITS)
        self.assertFalse(receipt["nodeStarted"])
        self.assertFalse(receipt["publicDeployment"])


if __name__ == "__main__":
    unittest.main()
