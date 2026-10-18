"""Tiny control fixtures only. No original checkpoint, Go, ELF or network runs."""
import builtins
import contextlib
import ctypes
import errno
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import py_compile
import signal
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


@contextlib.contextmanager
def forbid_host_operations():
    """A regression must fail, never inspect host proc or signal a real PID."""
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
SPEC = importlib.util.spec_from_file_location("private_copy", Path(__file__).with_name("validate-private-consensus-copy.py"))
caller = importlib.util.module_from_spec(SPEC)
with forbid_host_operations():
    SPEC.loader.exec_module(caller)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stat_line(pid, parent, start, state="S"):
    fields = [state]+["0"]*45
    fields[1], fields[2], fields[17], fields[19] = str(parent), "100", "1", str(start)
    return (str(pid)+" (synthetic control) "+" ".join(fields)).encode()


class PrivateCopyControls(unittest.TestCase):
    def setUp(self):
        fence = forbid_host_operations()
        fence.__enter__()
        self.addCleanup(fence.__exit__, None, None, None)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.case = Path(self.temporary.name).resolve()/"case"
        self.case.mkdir(mode=0o700)
        (self.case/"tools").mkdir(mode=0o700)
        # Not a real checkpoint or valid executable. Never passed to run().
        self.raw = b'{"syntheticControlOnly":true}\n'
        self.archive = gzip.compress(self.raw, mtime=0)
        self.write("devnet-state.json.gz", self.archive)
        self.tool_archive = b"synthetic pinned tools archive; never unpacked"
        self.write("tools.zip", self.tool_archive)
        self.capture = dict(format="YNX-PRIVATE-CHECKPOINT-CAPTURE/v1", complete=True,
                            sourceDescriptorUnchanged=True, localGzipVerified=True,
                            serviceChanged=False, sourceWritten=False, migrationExecutionVerified=False,
                            integrityMarker="2\n", sourceBytes=len(self.raw), archiveBytes=len(self.archive),
                            sourceSHA256=sha(self.raw), archiveSHA256=sha(self.archive),
                            localDecompressedSHA256=sha(self.raw),
                            sourcePath="/NEVER-READ-ACTIVE-STATE", archivePath="/NEVER-READ-ORIGINAL-ARCHIVE")
        binary = b"\x7fELF\x02\x01"+bytes(12)+b"\x3e\x00synthetic-never-execute"
        for name in caller.TOOL_NAMES:
            self.write("tools/"+name, binary, 0o700)
        self.source = dict(version="YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1", commit=caller.TOOL_COMMIT,
                           platform="linux/amd64", runId="123", binaries={name:dict(bytes=len(binary), sha256=sha(binary)) for name in caller.TOOL_NAMES})
        self.refresh()

    def write(self, relative, data, mode=0o600):
        path = self.case/relative
        path.write_bytes(data)
        path.chmod(mode)

    def refresh(self):
        self.write("capture.json", json.dumps(self.capture, sort_keys=True).encode())
        self.write("tools/SOURCE.json", json.dumps(self.source, sort_keys=True).encode())
        self.capture_sha = sha((self.case/"capture.json").read_bytes())
        self.source_sha = sha((self.case/"tools/SOURCE.json").read_bytes())

    def validate(self, capture_sha=None, source_sha=None, commit=None):
        # Only this parser-control fixture replaces the fixed original capture
        # pin. Production CLI has no flag or fallback that changes that pin.
        with patch.object(caller, "CAPTURE_SHA256", self.capture_sha), \
                patch.object(caller, "TOOLS_ARCHIVE_SHA256", sha(self.tool_archive)), \
                patch.object(caller, "TOOLS_ARCHIVE_BYTES", len(self.tool_archive)):
            return caller.validate_inputs(self.case, capture_sha or self.capture_sha,
                                          source_sha or self.source_sha, commit or caller.TOOL_COMMIT)

    def prepare_execution(self):
        # Tiny parser/control material, never a claimed migration validation.
        # No original copy, actual ELF or subprocess is read or executed.
        (self.case/"devnet-state.json.gz").unlink()
        self.migration = b'{"syntheticRetainedMigrationControlOnly":true}\n'
        self.write("migration.json", self.migration)
        self.execution_tool_archive = b"synthetic new pinned tools archive; never unpacked"
        self.write("tools.zip", self.execution_tool_archive)
        self.source["commit"] = caller.EXECUTION_TOOL_COMMIT
        self.refresh()

    def validate_execution(self, **overrides):
        args = dict(expected_capture=self.capture_sha, expected_source=self.source_sha,
                    expected_commit=caller.EXECUTION_TOOL_COMMIT,
                    verify_migration_execution=True, expected_migration=sha(self.migration))
        args.update(overrides)
        # Substitute only tiny input pins for real parser tests, not the
        # verifier, process results, signature acceptance or business state.
        with patch.object(caller, "CAPTURE_SHA256", self.capture_sha), \
                patch.object(caller, "EXECUTION_SOURCE_SHA256", self.source_sha), \
                patch.object(caller, "EXECUTION_TOOLS_ARCHIVE_SHA256", sha(self.execution_tool_archive)), \
                patch.object(caller, "EXECUTION_TOOLS_ARCHIVE_BYTES", len(self.execution_tool_archive)), \
                patch.object(caller, "EXECUTION_MIGRATION_SHA256", sha(self.migration)), \
                patch.object(caller, "EXECUTION_MIGRATION_BYTES", len(self.migration)):
            return caller.validate_inputs(self.case, **args)

    def guard(self):
        # Reuse real guard identity algorithms as definitions, without run(),
        # /proc collection, subreaper, affinity, child creation or kill.
        path = ROOT/"scripts/loadtest/pq-paired-linux-window.py"
        with patch.object(caller, "GUARD_SHA256", sha(path.read_bytes())):
            return caller.load_guard(path)

    def test_default_starts_nothing_and_does_not_read_case(self):
        with patch.object(caller, "run", side_effect=AssertionError("execute called")), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(caller.main([]), 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "prepared_only_no_copy_or_process_started")
        self.assertEqual({p.name for p in self.case.iterdir()}, caller.INITIAL_FILES)

    def test_compile_and_import_do_not_enter_execution_profile(self):
        target = Path(self.temporary.name)/"caller-control.pyc"
        py_compile.compile(str(SPEC.origin), cfile=str(target), doraise=True)
        self.assertTrue(target.is_file())
        spec = importlib.util.spec_from_file_location("private_copy_inert_import", SPEC.origin)
        imported = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(imported)
        self.assertEqual(imported.TOOL_COMMIT, caller.TOOL_COMMIT)
        self.assertEqual({p.name for p in self.case.iterdir()}, caller.INITIAL_FILES)

    def test_control_fence_refuses_real_process_and_proc_operations(self):
        for operation in (lambda: os.kill(101, signal.SIGKILL),
                          lambda: os.waitpid(101, os.WNOHANG),
                          lambda: subprocess.Popen(["never-execute"]),
                          lambda: ctypes.CDLL(None),
                          lambda: Path("/proc/self/stat").read_bytes(),
                          lambda: list(Path("/proc").iterdir())):
            with self.assertRaises(AssertionError):
                operation()

    def test_tools_archive_is_required_exact_and_retained_in_input_pins(self):
        _, pins = self.validate()
        self.assertEqual(pins["tools.zip"]["sha256"], sha(self.tool_archive))
        self.write("tools.zip", self.tool_archive+b"changed")
        with self.assertRaises(RuntimeError):
            self.validate()
        self.assertEqual((self.case/"tools.zip").read_bytes(), self.tool_archive+b"changed")
        (self.case/"tools.zip").unlink()
        with self.assertRaises(RuntimeError):
            self.validate()

    def test_external_pins_and_commit_are_mandatory(self):
        self.validate()
        for kwargs in ({"capture_sha":"0"*64}, {"source_sha":"0"*64}, {"commit":"8"*40}):
            with self.subTest(kwargs=kwargs), self.assertRaises(RuntimeError):
                self.validate(**kwargs)
        self.source["commit"] = "8"*40
        self.refresh()
        with self.assertRaises(RuntimeError):
            self.validate()

    def test_main_guard_is_not_silently_substituted_for_frozen_integration_guard(self):
        path = ROOT/"scripts/loadtest/pq-paired-linux-window.py"
        with patch.object(caller, "GUARD_SHA256", "0"*64), self.assertRaises(RuntimeError):
            caller.load_guard(path)

    def test_complete_marker_and_capture_identity_required(self):
        for key, value in (("integrityMarker", ""), ("integrityMarker", "3\n"), ("complete", False),
                           ("sourceDescriptorUnchanged", False), ("sourceWritten", True),
                           ("archiveBytes", True), ("localDecompressedSHA256", "f"*64)):
            previous = self.capture[key]
            self.capture[key] = value
            self.refresh()
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                self.validate()
            self.capture[key] = previous
        self.refresh()

    def test_unknown_or_existing_artifacts_are_not_overwritten(self):
        for name in ("UNKNOWN", "state", "tmp", "migration.json", "export.stdout.log", "validation-receipt.json"):
            path = self.case/name
            self.write(name, b"retain original uncertain artifact")
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                self.validate()
            self.assertEqual(path.read_bytes(), b"retain original uncertain artifact")
            path.unlink()

    def test_bad_archive_binary_and_extra_tool_fail_closed(self):
        self.write("devnet-state.json.gz", self.archive+b"extra")
        with self.assertRaises(RuntimeError):
            self.validate()
        self.write("devnet-state.json.gz", self.archive)
        original = (self.case/"tools/ynx-chaind").read_bytes()
        self.write("tools/ynx-chaind", original+b"tamper", 0o700)
        with self.assertRaises(RuntimeError):
            self.validate()
        self.write("tools/ynx-chaind", original, 0o700)
        self.write("tools/UNKNOWN", b"prior tool result")
        with self.assertRaises(RuntimeError):
            self.validate()

    def test_private_directory_regular_single_link_and_executable_requirements(self):
        self.case.chmod(0o755)
        with self.assertRaises(RuntimeError):
            self.validate()
        self.case.chmod(0o700)
        binary = self.case/"tools/ynx-chaind"
        binary.chmod(0o600)
        with self.assertRaises(RuntimeError):
            self.validate()
        binary.chmod(0o700)
        alias = self.case.parent/"alias"
        alias.symlink_to(self.case, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            caller.private_directory(alias)
        other = self.case.parent/"hardlink"
        os.link(self.case/"capture.json", other)
        with self.assertRaises(RuntimeError):
            self.validate()

    def test_tiny_copy_restores_exact_marker_and_never_uses_capture_paths(self):
        capture, _ = self.validate()
        pins = caller.restore_copy(self.case, capture)
        self.assertEqual((self.case/"state/devnet-state.json").read_bytes(), self.raw)
        self.assertEqual((self.case/"state/devnet-state.integrity-version").read_bytes(), b"2\n")
        self.assertEqual(pins["devnet-state.json"]["sha256"], sha(self.raw))
        with self.assertRaises(FileExistsError):
            caller.restore_copy(self.case, capture)
        self.assertEqual((self.case/"state/devnet-state.json").read_bytes(), self.raw)

    def test_streaming_size_hash_failure_retains_partial_unknown(self):
        capture, _ = self.validate()
        capture["sourceBytes"] -= 1
        with self.assertRaises(RuntimeError):
            caller.restore_copy(self.case, capture)
        self.assertTrue((self.case/"state/devnet-state.json").exists())
        self.assertFalse((self.case/"state/devnet-state.integrity-version").exists())
        with self.assertRaises(FileExistsError):
            caller.restore_copy(self.case, capture)

    def test_same_inode_content_change_and_replacement_are_detected(self):
        _, pins = self.validate()
        source = self.case/"devnet-state.json.gz"
        ino = source.stat().st_ino
        with source.open("r+b") as target:
            target.write(b"XX")
        self.assertEqual(source.stat().st_ino, ino)
        with self.assertRaises(RuntimeError):
            caller.unchanged(self.case, pins, lambda:None)
        source.unlink()
        self.write("devnet-state.json.gz", self.archive)
        with self.assertRaises(RuntimeError):
            caller.unchanged(self.case, pins, lambda:None)

    def test_fixed_commands_and_sanitized_environment(self):
        commands = caller.fixed_commands(self.case)
        self.assertEqual(commands, [
            [str(self.case/"tools/ynx-chaind"), "-data-dir", str(self.case/"state"), "-export-consensus-state", str(self.case/"migration.json")],
            [str(self.case/"tools/ynx-consensus-package"), "-verify-migration-state", str(self.case/"migration.json")]])
        self.assertEqual(caller.ENVIRONMENT["GOMAXPROCS"], "1")
        self.assertEqual(caller.ENVIRONMENT["GOMEMLIMIT"], "3GiB")
        self.assertFalse(any(k.startswith("YNX_") for k in caller.ENVIRONMENT))

    def test_resource_caps_reuse_guard_identity_without_mutating_original_caps(self):
        guard = self.guard()
        before = dict(guard.CAPS)
        sample = dict(rssBytes=1024, privateBytes=2048, threads=1, processes=1,
                      freeDiskBytes=10 << 30, availableMemoryBytes=8 << 30)
        caller.enforce(sample)
        for key in ("rssBytes", "privateBytes", "threads", "processes"):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                caller.enforce(dict(sample, **{key:caller.LIMITS[key]+1}))
        for key in ("freeDiskBytes", "availableMemoryBytes"):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                caller.enforce(dict(sample, **{key:0}))
        self.assertEqual(guard.CAPS, before)

    @contextlib.contextmanager
    def sampled_exit(self, child_reads, now=0.0, terminal=None):
        """Exercise real Window.tick/owned_set; all kernel inputs are synthetic."""
        g = self.guard()
        rows = {p:g.parse_stat(stat_line(p, parent, start, state), p)
                for p,parent,start,state in ((100,1,1000,"S"),(101,100,1001,"R"))}
        window = caller.Window(g, self.case)
        window.started = 0.0
        window.child = SimpleNamespace(pid=101, poll=lambda:terminal)
        window.birth = 1001
        window.command_label = "verify"
        pending, calls, pauses, clock = list(child_reads), [], [], [now]

        def read(path):
            if path.parent.name == "100":
                if path.name == "smaps_rollup":
                    return b"Rss: 8 kB\n"
                if path.name == "stat":
                    return stat_line(100,1,1000)
            if path.parent.name != "101" or not pending:
                raise AssertionError("unexpected synthetic telemetry read")
            name, result = pending.pop(0)
            self.assertEqual(path.name, name)
            calls.append(name)
            if isinstance(result, Exception):
                raise result
            return result

        def pause(seconds):
            self.assertGreater(seconds, 0)
            self.assertLessEqual(seconds, 0.01)
            pauses.append(seconds)
            clock[0] += seconds

        with patch.object(g, "proc_inventory", return_value=(rows, [])), \
                patch.object(g, "bounded", side_effect=read), \
                patch.object(g, "directory_bytes", return_value=2048), \
                patch.object(g, "memory_available", return_value=8 << 30), \
                patch.object(os, "getpid", return_value=100), \
                patch.object(os, "statvfs", return_value=SimpleNamespace(f_bavail=10 << 30, f_frsize=1)), \
                patch.object(caller.time, "monotonic", side_effect=lambda:clock[0]), \
                patch.object(caller.time, "sleep", side_effect=pause):
            yield window, pending, calls, pauses

    def test_exit_mm_race_requires_final_same_identity_zombie(self):
        reads = [("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic exit mm")),
                 ("stat", stat_line(101,100,1001,"R")),
                 ("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic exit mm")),
                 ("stat", stat_line(101,100,1001,"Z"))]
        with self.sampled_exit(reads) as (window, pending, calls, pauses):
            try:
                window.tick(True)
            except RuntimeError as error:
                # Original Window.tick rejects the first R observation here.
                # CI requires this real failure marker before restoring fixed
                # source; no conditional expectation on implementation version.
                self.fail("PRIVATE_COPY_EXIT_MM_TRANSITION_REJECTED: " + str(error))
            self.assertEqual(pending, [])
            self.assertEqual(calls, ["smaps_rollup", "stat"]*2)
            self.assertEqual(pauses, [0.01])
            sample = window.samples[-1]
            self.assertEqual((sample["processes"], sample["rssBytes"]), (2,8192))
            self.assertEqual((sample["tasks"][1]["state"], sample["tasks"][1]["startTicks"]), ("Z",1001))
            self.assertEqual(window.known, {101:1001})  # Cleanup must still reap it.

    def test_exit_mm_race_can_retire_only_after_stat_proves_gone(self):
        reads = [("smaps_rollup", FileNotFoundError(errno.ENOENT, "synthetic mm gone")),
                 ("stat", stat_line(101,100,1001,"R")),
                 ("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic exit mm")),
                 ("stat", FileNotFoundError(errno.ENOENT, "synthetic stat gone"))]
        with self.sampled_exit(reads) as (window, pending, _, _):
            window.tick(True)
            self.assertEqual(pending, [])
            self.assertEqual(window.samples[-1]["processes"], 1)
            self.assertEqual(window.known, {})

    def test_transient_live_row_must_supply_actual_rss_on_recheck(self):
        reads = [("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic transient")),
                 ("stat", stat_line(101,100,1001,"R")),
                 ("smaps_rollup", b"Rss: 2048 kB\n"),
                 ("stat", stat_line(101,100,1001,"R"))]
        with self.sampled_exit(reads) as (window, pending, _, _):
            window.tick(True)
            self.assertEqual(pending, [])
            self.assertEqual(window.samples[-1]["rssBytes"], 8192+(2 << 20))
            self.assertEqual(window.samples[-1]["tasks"][1]["state"], "R")

    def test_still_live_unreadable_rss_fails_closed_even_with_terminal_zero(self):
        reads = [("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic live unreadable")),
                 ("stat", stat_line(101,100,1001,"R"))]*4
        # A terminal result (or printed verifier success) cannot exempt any
        # identity that is still present in the actual owned-process closure.
        with self.sampled_exit(reads, terminal=0) as (window, pending, calls, pauses):
            with self.assertRaisesRegex(RuntimeError, "^active owned RSS unreadable$"):
                window.tick(True)
            self.assertEqual(pending, [])
            self.assertEqual(calls, ["smaps_rollup", "stat"]*4)
            self.assertEqual(pauses, [0.01]*3)
            self.assertEqual(window.samples, [])
            self.assertEqual(window.telemetry_failure, {"command":"verify", "pid":101, "startTicks":1001})

    def test_exit_recheck_never_accepts_recycled_pid_or_permission_error(self):
        for tail, expected in (([("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic exit")),
                                ("stat", stat_line(101,100,2001,"Z"))], RuntimeError),
                               ([("smaps_rollup", PermissionError(errno.EACCES, "synthetic unreadable"))], PermissionError)):
            with self.subTest(expected=expected.__name__), self.sampled_exit(tail) as (window, pending, _, pauses):
                with self.assertRaises(expected):
                    window.tick(True)
                self.assertEqual(pending, [])
                self.assertEqual(pauses, [])
                self.assertEqual(window.samples, [])

    def test_exit_recheck_malformed_rss_is_not_exit_evidence(self):
        with self.sampled_exit([("smaps_rollup", b""), ("stat", stat_line(101,100,1001,"R"))]) as (window, pending, _, pauses):
            with self.assertRaisesRegex(RuntimeError, "RSS missing"):
                window.tick(True)
            self.assertEqual(pending, [])
            self.assertEqual(pauses, [])

    def test_exit_recheck_uses_original_active_deadline(self):
        reads = [("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic exit")),
                 ("stat", stat_line(101,100,1001,"R"))]
        with self.sampled_exit(reads, now=119.995) as (window, pending, _, pauses):
            with self.assertRaisesRegex(RuntimeError, "^private-copy active deadline$"):
                window.tick(True)
            self.assertEqual(pending, [])
            self.assertAlmostEqual(sum(pauses), 0.005)
            self.assertEqual(window.samples, [])

    def test_cleanup_signals_only_fresh_owned_identities_and_reaps_adopted_zombies(self):
        g = self.guard()
        rows = {p:g.parse_stat(stat_line(p, parent, start, state), p) for p,parent,start,state in (
            (100, 1, 1000, "S"), (101, 100, 1001, "S"), (102, 100, 1002, "Z"), (999, 1, 9999, "S"))}
        sent, reaped, known = [], [], {}
        def raw(path):
            row = rows[int(path.parent.name)]
            return stat_line(row["pid"], row["parent"], row["startTicks"], row["state"])
        with patch.object(g, "proc_inventory", return_value=(rows, [])), patch.object(g, "bounded", side_effect=raw):
            self.assertFalse(caller.cleanup_scan(g, 100, None, known, False,
                send=lambda p,s:sent.append((p,s)), wait=lambda p,o:reaped.append(p)))
            self.assertEqual(sent, [(101, signal.SIGTERM)])
            self.assertEqual(reaped, [102])
            sent.clear()
            caller.cleanup_scan(g, 100, None, known, True, send=lambda p,s:sent.append((p,s)), wait=lambda p,o:None)
            self.assertEqual(sent, [(101, signal.SIGKILL)])
        # A recycled known PID outside the actual descendant closure is excluded.
        rows[101]["parent"], rows[101]["startTicks"] = 1, 2001
        self.assertNotIn(101, g.owned_set(rows, 100, known=known))

    def test_cleanup_fresh_identity_mismatch_is_never_signalled(self):
        g = self.guard()
        rows = {p:g.parse_stat(stat_line(p, parent, start), p) for p,parent,start in ((100,1,1000),(101,100,1001))}
        sent = []
        with patch.object(g, "proc_inventory", return_value=(rows, [])), patch.object(g, "bounded", return_value=stat_line(101,100,9999)):
            with self.assertRaises(RuntimeError):
                caller.cleanup_scan(g, 100, None, {}, False, send=lambda p,s:sent.append(p))
        self.assertEqual(sent, [])

    def test_cleanup_defaults_respect_the_current_system_operation_fence(self):
        g = self.guard()
        for state in ("S", "Z"):
            rows = {p:g.parse_stat(stat_line(p, parent, start, item_state), p)
                    for p,parent,start,item_state in ((100,1,1000,"S"),(101,100,1001,state))}
            with self.subTest(state=state), \
                    patch.object(g, "proc_inventory", return_value=(rows, [])), \
                    patch.object(g, "bounded", return_value=stat_line(101,100,1001,state)), \
                    patch.object(os, "kill", side_effect=AssertionError("current signal fence")), \
                    patch.object(os, "waitpid", side_effect=AssertionError("current reap fence")):
                with self.assertRaisesRegex(AssertionError, "current (signal|reap) fence"):
                    caller.cleanup_scan(g, 100, None, {}, False)

    def test_cleanup_requires_two_empty_scans_and_retains_first_failure(self):
        window = caller.Window(self.guard(), self.case)
        with patch.object(caller, "cleanup_scan", side_effect=[True, True]) as scans:
            self.assertEqual(window.cleanup(), (True, None))
            self.assertEqual(scans.call_count, 2)
        with patch.object(caller, "cleanup_scan", side_effect=[RuntimeError("identity"), True, True]):
            complete, cause = window.cleanup()
            self.assertFalse(complete)
            self.assertIn("identity", cause)

    def test_terminal_success_requires_both_commands_and_exact_verifier_completion(self):
        output = ("consensus migration state passed: height=12 lastBlockHash="+"a"*64+" stateHash="+"b"*64+" accounts=2 validators=4\n").encode()
        caller.qualify([0,0], output)
        for codes, data in (([0],output), ([0,1],output), ([0,0],b""), ([0,0],b"SKIP\n"), ([0,0],output+b"UNKNOWN\n")):
            with self.subTest(codes=codes, data=data), self.assertRaises(RuntimeError):
                caller.qualify(codes, data)

    def test_execution_profile_fixed_pins_do_not_replace_af1_profile(self):
        self.assertEqual(caller.TOOL_COMMIT, "af1cbaf94313e628e212aabad60d05d85c2aa3fc")
        self.assertEqual(caller.TOOLS_ARCHIVE_SHA256, "7d05d35e49cffb681a4f3f5ec52582c7450b5d6209cdbbdffd479c4d52930ed1")
        self.assertEqual(caller.TOOLS_ARCHIVE_BYTES, 17650233)
        self.assertEqual(caller.EXECUTION_TOOL_COMMIT, "6e07ff1f8ac20317ab14b932b265f06d4f4a3f35")
        self.assertEqual(caller.EXECUTION_SOURCE_SHA256, "28c065f052f0a3925b256191cc6a39b4457c86b74cf78d7ed2fa7a9094d0391c")
        self.assertEqual(caller.EXECUTION_TOOLS_ARCHIVE_SHA256, "20160d5cb6087ae124e1833e1101451794fb6b16e7154d318aea52be29387c23")
        self.assertEqual(caller.EXECUTION_TOOLS_ARCHIVE_BYTES, 17671146)
        self.assertEqual(caller.EXECUTION_MIGRATION_SHA256, "72606eb9ad4187117f47b14f8745caaed81bd347011b6c5f8bb0b62c1ee84028")
        self.assertEqual(caller.EXECUTION_MIGRATION_BYTES, 683131154)
        self.assertEqual(caller.GUARD_SHA256, "5601bf3eaab58b5986a9ce859a77563956e148989f61134027799bf7ff481a16")
        self.assertEqual(caller.LIMITS, dict(activeMs=120000, cleanupMs=15000, totalMs=135000,
                         rssBytes=4 << 30, privateBytes=8 << 30, logBytes=1 << 20,
                         threads=320, processes=16, diskFloorBytes=2 << 30,
                         memoryFloorBytes=4 << 30, sampleMs=200))

    def test_execution_profile_preparation_is_inert(self):
        before = {p.name for p in self.case.iterdir()}
        with patch.object(caller, "run", side_effect=AssertionError("execute called")), \
                patch.object(caller, "validate_inputs", side_effect=AssertionError("input read")), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(caller.main(["--verify-migration-execution"]), 0)
        prepared = json.loads(output.getvalue())
        self.assertEqual(prepared["status"], "prepared_only_no_copy_or_process_started")
        self.assertEqual(prepared["profile"], "verify-migration-execution")
        self.assertEqual(prepared["toolCommit"], caller.EXECUTION_TOOL_COMMIT)
        self.assertEqual(prepared["sourceManifestSHA256"], caller.EXECUTION_SOURCE_SHA256)
        self.assertEqual(prepared["migrationSHA256"], caller.EXECUTION_MIGRATION_SHA256)
        self.assertEqual({p.name for p in self.case.iterdir()}, before)

    def test_execution_profile_uses_only_fixed_existing_migration_command(self):
        self.assertEqual(caller.fixed_commands(self.case, True), [[
            str(self.case/"tools/ynx-consensus-package"), "-verify-migration-execution", str(self.case/"migration.json")]])
        self.assertEqual(caller.ENVIRONMENT, dict(GOMAXPROCS="1", GOGC="50", GOMEMLIMIT="3GiB",
                         GOTOOLCHAIN="local", GOWORK="off", TZ="UTC", LANG="C"))
        self.prepare_execution()
        capture, pins = self.validate_execution()
        self.assertEqual(capture, self.capture)
        self.assertEqual(set(pins), {"capture.json", "tools/SOURCE.json", "tools.zip", "migration.json",
                                     "tools/ynx-chaind", "tools/ynx-consensus-package"})
        self.assertEqual(pins["migration.json"]["sha256"], sha(self.migration))
        self.assertEqual((self.case/"migration.json").read_bytes(), self.migration)
        self.assertEqual({p.name for p in self.case.iterdir()}, caller.EXECUTION_INITIAL_FILES)
        self.assertFalse((self.case/"state").exists())

    def test_execution_profile_requires_exact_new_tools_and_migration_pins(self):
        self.prepare_execution()
        self.validate_execution()
        for overrides in ({"expected_capture":"0"*64}, {"expected_source":"0"*64},
                          {"expected_commit":caller.TOOL_COMMIT}, {"expected_commit":"8"*40},
                          {"expected_migration":None}, {"expected_migration":"0"*64}):
            with self.subTest(overrides=overrides), self.assertRaises(RuntimeError):
                self.validate_execution(**overrides)
        self.source["commit"] = caller.TOOL_COMMIT
        self.refresh()
        with self.assertRaisesRegex(RuntimeError, "CI tools do not match"):
            self.validate_execution()

    def test_execution_profile_rejects_old_archive_and_changed_binary(self):
        self.prepare_execution()
        self.write("tools.zip", self.tool_archive)
        with self.assertRaisesRegex(RuntimeError, "archive SHA or size"):
            self.validate_execution()
        self.write("tools.zip", self.execution_tool_archive)
        path = "tools/ynx-consensus-package"
        self.write(path, (self.case/path).read_bytes()+b"changed", 0o700)
        with self.assertRaisesRegex(RuntimeError, "binary SHA or size"):
            self.validate_execution()

    def test_execution_profile_rejects_migration_size_hash_and_links(self):
        self.prepare_execution()
        for payload in (self.migration+b" ", b"X"+self.migration[1:]):
            self.write("migration.json", payload)
            with self.subTest(payload=payload), self.assertRaisesRegex(RuntimeError, "migration SHA or size"):
                self.validate_execution()
        self.write("migration.json", self.migration)
        target = self.case.parent/"retained-migration-link"
        os.link(self.case/"migration.json", target)
        with self.assertRaisesRegex(RuntimeError, "private regular owned input"):
            self.validate_execution()
        target.unlink()
        (self.case/"migration.json").rename(target)
        (self.case/"migration.json").symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, "private regular owned input"):
            self.validate_execution()

    def test_execution_profile_preserves_unknown_and_extra_case_artifacts(self):
        self.prepare_execution()
        for name in ("UNKNOWN", "state", "tmp", "devnet-state.json.gz", "export.stdout.log",
                     "verify-execution.stdout.log", "verify-execution.stderr.log", "validation-receipt.json"):
            self.write(name, b"retain original uncertain artifact")
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "preserve UNKNOWN"):
                self.validate_execution()
            self.assertEqual((self.case/name).read_bytes(), b"retain original uncertain artifact")
            self.assertEqual((self.case/"migration.json").read_bytes(), self.migration)
            (self.case/name).unlink()

    def test_execution_profile_detects_same_inode_change_and_replacement(self):
        self.prepare_execution()
        _, pins = self.validate_execution()
        path = self.case/"migration.json"
        original_inode = path.stat().st_ino
        with path.open("r+b") as target:
            target.write(b"XX")
        self.assertEqual(path.stat().st_ino, original_inode)
        with self.assertRaisesRegex(RuntimeError, "original private input changed"):
            caller.unchanged(self.case, pins, lambda:None)
        # Restore bytes only in this synthetic fixture, then pin anew and
        # replace by a different inode carrying identical content.
        self.write("migration.json", self.migration)
        _, pins = self.validate_execution()
        path.rename(self.case.parent/"retained-synthetic-original")
        self.write("migration.json", self.migration)
        with self.assertRaisesRegex(RuntimeError, "original private input changed"):
            caller.unchanged(self.case, pins, lambda:None)

    def test_execution_profile_requires_one_terminal_and_exact_full_completion(self):
        output = ("consensus migration execution passed: height=12 lastBlockHash="+"a"*64+" stateHash="+"b"*64+
                  " blockers=0 scope=executor-compatibility-only validatorBinding=unchecked applicationRestore=unchecked"
                  " deployment=not-performed initChain=not-performed pqActivation=not-performed\n").encode()
        caller.qualify([0], output, True)
        old = ("consensus migration state passed: height=12 lastBlockHash="+"a"*64+" stateHash="+"b"*64+
               " accounts=2 validators=4\n").encode()
        for codes, data in (([],output), ([1],output), ([0,0],output), ([0],old), ([0],b""),
                            ([0],b"SKIP\n"), ([0],output+output), ([0],output+b"UNKNOWN\n"),
                            ([0],output.replace(b"blockers=0", b"blockers=1")),
                            ([0],output.replace(b"applicationRestore=unchecked", b"applicationRestore=passed")),
                            ([0],output.rstrip(b"\n"))):
            with self.subTest(codes=codes, data=data), self.assertRaisesRegex(RuntimeError, "compatibility completion missing"):
                caller.qualify(codes, data, True)
        with self.assertRaises(RuntimeError):
            caller.qualify([0,0], output)

    def test_execution_profile_rejects_extra_arguments_and_missing_external_pin(self):
        common = ["--execute", "--verify-migration-execution", "--case", str(self.case), "--guard", "/not-read",
                  "--expected-capture-sha256", caller.CAPTURE_SHA256,
                  "--expected-source-sha256", caller.EXECUTION_SOURCE_SHA256,
                  "--expected-commit", caller.EXECUTION_TOOL_COMMIT, "--authorization-id", "synthetic-grant"]
        for args in (["--verify-migration-execution", "unexpected"],
                     ["--verify-migration-execution", "--command", "never-execute"],
                     ["--expected-migration-sha256", caller.EXECUTION_MIGRATION_SHA256],
                     common, common+["--expected-migration-sha256", "0"*64]):
            with self.subTest(args=args), patch.object(caller, "run", side_effect=AssertionError("invalid CLI entered run")), \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                caller.main(args)
            self.assertEqual(error.exception.code, 2)

    def test_execution_profile_live_unreadable_rss_still_fails_closed(self):
        reads = [("smaps_rollup", ProcessLookupError(errno.ESRCH, "synthetic live unreadable")),
                 ("stat", stat_line(101,100,1001,"R"))]*4
        with self.sampled_exit(reads, terminal=0) as (window, pending, calls, pauses):
            window.command_label = "verify-execution"
            with self.assertRaisesRegex(RuntimeError, "^active owned RSS unreadable$"):
                window.tick(True)
            self.assertEqual(pending, [])
            self.assertEqual(calls, ["smaps_rollup", "stat"]*4)
            self.assertEqual(pauses, [0.01]*3)
            self.assertEqual(window.samples, [])
            self.assertEqual(window.telemetry_failure, {"command":"verify-execution", "pid":101, "startTicks":1001})


if __name__ == "__main__":
    unittest.main()
