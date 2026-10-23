"""Pure retained-export controls: no host /proc, child, signal, network or case."""
import builtins
import contextlib
import copy
import ctypes
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
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
        raise AssertionError("retained pure control attempted a host operation")
    def checked(original):
        def call(path, *args, **kwargs):
            if not isinstance(path, int):
                name = os.path.normpath(os.fsdecode(path))
                if name == "/proc" or name.startswith("/proc/") or name.startswith("/var/tmp/ynx-pq-original-native-check"):
                    raise AssertionError("retained pure control attempted host proc or original case I/O")
            return original(path, *args, **kwargs)
        return call
    with contextlib.ExitStack() as stack:
        for module, name in ((builtins, "open"), (io, "open"), (os, "open"), (os, "listdir"),
                             (os, "scandir"), (os, "readlink"), (os, "stat"), (os, "lstat")):
            stack.enter_context(patch.object(module, name, checked(getattr(module, name))))
        for module, names in ((os, ("kill", "killpg", "waitpid", "pidfd_open", "fork", "posix_spawn", "posix_spawnp", "system", "execve", "execv")),
                              (signal, ("signal", "setitimer", "pidfd_send_signal")),
                              (subprocess, ("Popen",)), (ctypes, ("CDLL",)), (socket, ("socket", "create_connection"))):
            for name in names:
                stack.enter_context(patch.object(module, name, refuse, create=True))
        yield


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("retained_native_export_guard", ROOT / "scripts/ops/verify-retained-native-export.py")
guard = importlib.util.module_from_spec(SPEC)
with no_host_operations():
    SPEC.loader.exec_module(guard)


def prior_result():
    return dict(version=guard.BASE_VERSION, classification="data", contractSHA256=guard.PRIOR_CONTRACT,
        normalExitCodes=[0], firstCause="fresh_memory_floor", cleanupComplete=True, cleanupError=None,
        sampleCount=136, peakOwnedRSSBytes=7198531584, maxCaseDeltaBytes=700724272, minFreeDiskBytes=116924219392,
        elapsedMs=34950, inputBytesUnchanged=False, verification=None, preparedOwnerUID="0",
        guardMode="sampled-proc-smaps-rollup-200ms", cgroupHardWall=False, ownedSockets="sampled-rejected",
        migrationVerified=False, authoritativeFinalCheckpoint=False, sourceDeploymentQualified=False,
        deployment=False, rootGrant=False, publicActivation=False)


def completion():
    return ("consensus migration state passed: height=1987832 lastBlockHash=" + "a" * 64
            + " stateHash=" + guard.CHECKPOINT["stateHash"] + " accounts=5310 validators=4\n").encode()


def contract(base):
    directories = (".", "data-verified", "tools", "tools/extracted")
    prepared = {name: dict(uid="0", mode="700", device="64770", inode=str(100 + index))
                for index, name in enumerate(directories)}
    for index, (name, pin) in enumerate(base.PINNED.items()):
        prepared[name] = dict(uid="0", mode="700" if name.rsplit("/", 1)[-1] in base.TOOLS else "600",
            device="64770", inode=str(200 + index), bytes=pin["bytes"], mtimeNs="1792773171000000000",
            ctimeNs="1792774000000000000", nlink="1")
    descriptor = dict(**guard.BASE_PIN, witness=dict(uid="0", mode="600", device="64770", inode="405748",
        bytes=guard.BASE_PIN["bytes"], mtimeNs="1792780753533647655", ctimeNs="1792780753533647655", nlink="1"))
    return dict(version=guard.VERSION, classification="data", casePath=guard.CASE, controllerSHA256="b" * 64,
        baseGuard=descriptor, priorExport=copy.deepcopy(guard.PRIOR_EXPORT), inputs=copy.deepcopy(base.PINNED),
        toolSource=dict(commit=base.COMMIT, runId=base.RUN_ID, artifactId=base.ARTIFACT_ID, artifactSHA256=base.ARTIFACT_SHA256),
        limits=dict(base.LIMITS), environment=dict(base.ENVIRONMENT),
        mustBeEmptyProcessGroups=[dict(pgid="999", leaderStartTicks="500"), dict(pgid="1592161", leaderStartTicks="1557438355")],
        preparedInputWitness=prepared)


class RetainedExportControls(unittest.TestCase):
    def setUp(self):
        self.fence = no_host_operations()
        self.fence.__enter__()
        self.addCleanup(self.fence.__exit__, None, None, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name).resolve()
        self.base_path = self.directory / guard.BASE_NAME
        self.base_path.write_bytes((ROOT / "scripts/ops" / guard.BASE_NAME).read_bytes())
        self.base_path.chmod(0o600)
        self.descriptor = dict(**guard.BASE_PIN, witness=guard.witness(self.base_path.stat()))
        with patch.object(guard, "__file__", str(self.directory / "verify-retained-native-export.py")):
            self.base, self.base_witness = guard.load_base(self.descriptor)

    def test_false_authority_and_unproven_prior_exit_are_rejected(self):
        raw = completion()
        for key, changed in (("normalExitCodes", []), ("normalExitCodes", [False]), ("normalExitCodes", [1]),
                ("normalExitCodes", [0, 0]), ("cleanupComplete", False), ("cleanupError", "unknown"),
                ("firstCause", None), ("contractSHA256", "c" * 64), ("verification", {}),
                ("inputBytesUnchanged", True), ("migrationVerified", True), ("rootGrant", True),
                ("deployment", True), ("publicActivation", True), ("authoritativeFinalCheckpoint", True)):
            with self.subTest(key=key, changed=changed):
                bad = prior_result()
                bad[key] = changed
                with self.assertRaises((guard.Refused, self.base.Refused)):
                    guard.qualify_retained_verifier(self.base, raw, [0], bad)

    def test_single_current_exit_and_exact_bound_checkpoint_required(self):
        for codes in ([], [False], [1], [0, 0], [0, 1]):
            with self.subTest(codes=codes), self.assertRaisesRegex(guard.Refused, "actual_single_verifier_exit0"):
                guard.qualify_retained_verifier(self.base, completion(), codes, prior_result())
        for output in (completion() + b"extra\n", completion().replace(b"1987832", b"1987833"),
                completion().replace(b"5310", b"5311"), completion().replace(b"validators=4", b"validators=3"),
                completion().replace(guard.CHECKPOINT["stateHash"].encode(), b"c" * 64)):
            with self.subTest(output=output), self.assertRaises(guard.Refused):
                guard.qualify_retained_verifier(self.base, output, [0], prior_result())
        result = guard.qualify_retained_verifier(self.base, completion(), [0], prior_result())
        self.assertEqual({key: result[key] for key in guard.CHECKPOINT}, guard.CHECKPOINT)
        self.assertEqual(hashlib.sha256(self.base.json_bytes(prior_result())).hexdigest(), guard.PRIOR_FILES["result.json"]["sha256"])
        # Retained qualification does not weaken the old two-command rule.
        with self.assertRaisesRegex(self.base.Refused, "both_normal_exit_codes"):
            self.base.qualify_verifier(completion(), [0])

    def test_closed_contract_rejects_changed_source_proof_profile_and_budget(self):
        value = contract(self.base)
        self.assertEqual(guard.validate_contract(self.base, value), value)
        mutations = [lambda v: v.update(rootGrant=True), lambda v: v.update(casePath="/arbitrary"),
            lambda v: v.update(version=guard.BASE_VERSION), lambda v: v["limits"].update(freshMemoryBytes=1),
            lambda v: v["baseGuard"].update(sha256="c" * 64), lambda v: v["baseGuard"]["witness"].update(uid="1000"),
            lambda v: v["priorExport"].update(attempt="offline-export-verify-8g180s"),
            lambda v: v["priorExport"]["files"]["migration.json"]["witness"].update(inode="405999"),
            lambda v: v["priorExport"]["files"]["result.json"].update(sha256="c" * 64),
            lambda v: v["mustBeEmptyProcessGroups"].pop()]
        for change in mutations:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises((guard.Refused, self.base.Refused)):
                guard.validate_contract(self.base, bad)

    def test_base_pin_mode_symlink_and_metadata_refuse_before_execution(self):
        for kind in ("content", "metadata", "mode", "symlink"):
            with self.subTest(kind=kind):
                path = self.base_path
                original = path.read_bytes()
                descriptor = copy.deepcopy(self.descriptor)
                if kind == "content":
                    path.write_bytes(original + b"\n")
                elif kind == "metadata":
                    descriptor["witness"]["inode"] = "1"
                elif kind == "mode":
                    path.chmod(0o644)
                else:
                    path.rename(self.directory / "moved-original")
                    path.symlink_to(self.directory / "moved-original")
                with patch.object(guard, "__file__", str(self.directory / "caller.py")), patch.object(guard, "ModuleType") as module:
                    with self.assertRaises(guard.Refused):
                        guard.load_base(descriptor)
                    module.assert_not_called()
                if path.is_symlink():
                    path.unlink()
                    (self.directory / "moved-original").rename(path)
                path.write_bytes(original)
                path.chmod(0o600)
                self.descriptor = dict(**guard.BASE_PIN, witness=guard.witness(path.stat()))

    def test_verified_bytes_never_use_source_loader_or_pycache(self):
        cache = self.directory / "__pycache__"
        cache.mkdir()
        (cache / "verify-original-native-copy.malicious.pyc").write_bytes(b"must never be consulted")
        with patch.object(guard, "__file__", str(self.directory / "caller.py")), patch.object(importlib.util, "spec_from_file_location", side_effect=AssertionError("untrusted loader consulted")), patch.object(importlib.util, "module_from_spec", side_effect=AssertionError("untrusted module factory consulted")):
            base, _ = guard.load_base(self.descriptor)
        self.assertEqual(base.ATTEMPT, guard.PRIOR_ATTEMPT)
        self.assertIsNone(base.__dict__.get("malicious_replacement_executed"))

    def test_path_swap_after_pin_cannot_execute_replacement_and_is_refused(self):
        marker = self.directory / "replacement-side-effect"
        actual_compile = builtins.compile
        modules = []
        actual_module = guard.ModuleType
        def module(name):
            value = actual_module(name)
            modules.append(value)
            return value
        def compile_verified(raw, filename, mode, *args, **kwargs):
            if filename == str(self.base_path):
                self.assertEqual(hashlib.sha256(raw).hexdigest(), guard.BASE_PIN["sha256"])
                self.base_path.write_bytes(("from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('BAD')\n").encode())
            return actual_compile(raw, filename, mode, *args, **kwargs)
        with patch.object(guard, "__file__", str(self.directory / "caller.py")), patch.object(guard, "ModuleType", side_effect=module), patch.object(builtins, "compile", side_effect=compile_verified):
            with self.assertRaisesRegex(guard.Refused, "bootstrap_pin_mismatch"):
                guard.load_base(self.descriptor)
        self.assertFalse(marker.exists())
        self.assertEqual(len(modules), 1)
        self.assertEqual(modules[0].ATTEMPT, guard.PRIOR_ATTEMPT)  # Actual pinned bytes executed.

    def test_normal_command_has_only_the_retained_original_input(self):
        self.assertEqual(guard.normal_command(Path(guard.CASE)), [guard.CASE + "/tools/extracted/ynx-consensus-package",
            "-verify-migration-state", guard.CASE + "/" + guard.PRIOR_ATTEMPT + "/migration.json"])
        self.assertEqual(self.base.ATTEMPT, guard.PRIOR_ATTEMPT)
        self.assertEqual(guard.ATTEMPT, "offline-verify-retained-export-8g180s")
        self.assertEqual(self.base.LIMITS["freshMemoryBytes"], 16 << 30)
        self.assertEqual((self.base.LIMITS["activeSeconds"], self.base.LIMITS["cleanupSeconds"], self.base.LIMITS["totalSeconds"]), (180, 15, 195))

    def prior_observations(self, journal_child=None):
        raw = {
            "result.json": self.base.json_bytes(prior_result()),
            "intent.json": self.base.json_bytes(dict(version=guard.BASE_VERSION, contractSHA256=guard.PRIOR_CONTRACT,
                controllerSHA256=guard.BASE_PIN["sha256"], status="unknown", automaticRetry=False,
                limits=self.base.LIMITS, environment=self.base.ENVIRONMENT, sourceFinalCheckpoint=False, rootGrant=False)),
            "first-cause.json": self.base.json_bytes({"code": "fresh_memory_floor"}),
            "journal.jsonl": self.base.json_bytes({"event": "child_started", "detail": journal_child or guard.PRIOR_CHILD})
                + self.base.json_bytes({"event": "child_exited", "detail": {"phase": "export", "code": 0}}),
            "migration.json": b"",  # Production streams this DATA; no ledger is fabricated/read here.
        }
        def read(path, pin, maximum, progress):
            self.assertEqual(pin, {key: guard.PRIOR_FILES[path.name][key] for key in ("bytes", "sha256")})
            self.assertEqual(maximum, None if path.name == "migration.json" else 131072)
            return dict(pin=copy.deepcopy(pin), identity=(path.name,)), raw[path.name]
        return read

    def test_prior_journal_requires_the_actual_pid_and_startticks(self):
        for child in (guard.PRIOR_CHILD, {**guard.PRIOR_CHILD, "pid": 999}, {**guard.PRIOR_CHILD, "startTicks": 1}, {**guard.PRIOR_CHILD, "phase": "verify"}):
            with self.subTest(child=child), patch.object(self.base, "private_directory"), patch.object(self.base, "regular", side_effect=lambda path: path), patch.object(self.base, "prepared_witness", side_effect=lambda path: guard.PRIOR_FILES[path.name]["witness"]), patch.object(self.base, "read_file", side_effect=self.prior_observations(child)) as read:
                if child == guard.PRIOR_CHILD:
                    proof = guard.validate_prior_export(self.base, self.directory, lambda: None)
                    self.assertEqual(set(proof["files"]), set(guard.PRIOR_FILES))
                    self.assertEqual(read.call_count, 5)
                else:
                    with self.assertRaisesRegex(guard.Refused, "prior_export_journal_exit0"):
                        guard.validate_prior_export(self.base, self.directory, lambda: None)

    def test_prior_replacement_identity_and_hash_refuse_before_verifier(self):
        for name in guard.PRIOR_FILES:
            def wrong_identity(path):
                value = copy.deepcopy(guard.PRIOR_FILES[path.name]["witness"])
                if path.name == name:
                    value["inode"] = "1"
                return value
            with self.subTest(name=name), patch.object(self.base, "private_directory"), patch.object(self.base, "regular", side_effect=lambda path: path), patch.object(self.base, "prepared_witness", side_effect=wrong_identity), patch.object(self.base, "read_file", side_effect=self.prior_observations()), patch.object(self.base, "Controller") as controller:
                with self.assertRaisesRegex(guard.Refused, "retained_export_identity_mismatch"):
                    guard.validate_prior_export(self.base, self.directory, lambda: None)
                controller.assert_not_called()
        with patch.object(self.base, "private_directory"), patch.object(self.base, "regular", side_effect=lambda path: path), patch.object(self.base, "prepared_witness", side_effect=lambda path: guard.PRIOR_FILES[path.name]["witness"]), patch.object(self.base, "read_file", side_effect=self.base.Refused("independent_input_pin_mismatch")):
            with self.assertRaisesRegex(self.base.Refused, "independent_input_pin_mismatch"):
                guard.validate_prior_export(self.base, self.directory, lambda: None)

    def test_existing_new_attempt_preserves_both_old_attempts_before_proc(self):
        old_names = ("offline-export-verify-8g180s", guard.PRIOR_ATTEMPT, guard.ATTEMPT)
        for name in old_names:
            path = self.directory / name
            path.mkdir(mode=0o700)
            (path / "intent.json").write_bytes((name + " UNKNOWN\n").encode())
        before = {name: ((self.directory / name / "intent.json").read_bytes(), (self.directory / name / "intent.json").stat().st_ino)
                  for name in old_names}
        value = contract(self.base)
        value["casePath"] = str(self.directory)
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=0), patch.object(self.base, "private_directory"), patch.object(self.base, "Controller") as controller, patch.object(self.base, "LinuxProc") as proc, patch.object(self.base.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(guard.Refused, "retained_verifier_attempt_partial_or_unknown"):
                guard.run(self.base, value, "b" * 64, [])
        controller.assert_not_called()
        proc.assert_not_called()
        spawn.assert_not_called()
        for name, (raw, inode) in before.items():
            self.assertEqual((self.directory / name / "intent.json").read_bytes(), raw)
            self.assertEqual((self.directory / name / "intent.json").stat().st_ino, inode)

    def test_default_cli_and_missing_confirmation_never_execute(self):
        value = contract(self.base)
        raw = self.base.json_bytes(value)
        pin = hashlib.sha256(raw).hexdigest()
        record = dict(pin=dict(bytes=str(len(raw)), sha256=pin), identity=("contract",))
        source = dict(pin=dict(bytes="1", sha256="b" * 64), identity=("caller",))
        args = ["--contract", str(self.directory / "contract.json"), "--contract-sha256", pin]
        with patch.object(guard, "read_bootstrap", return_value=(record, raw)), patch.object(guard, "load_base", return_value=(self.base, self.base_witness)), patch.object(self.base, "read_file", return_value=(source, b"")), patch.object(guard, "run") as execute, contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(guard.main(args), 0)
            self.assertFalse(json.loads(output.getvalue())["executionStarted"])
            self.assertEqual(guard.main(args + ["--execute"]), 1)
            self.assertEqual(guard.main(args + ["--execute", "--confirmed-contract-sha256", "c" * 64]), 1)
            execute.assert_not_called()

    def test_production_run_has_single_verify_postchecks_original_timers_and_cleanup(self):
        for failure in (None, "fresh", "source", "prior", "cleanup"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir=self.directory) as folder:
                case = Path(folder)
                originals = {}
                for name in ("offline-export-verify-8g180s", guard.PRIOR_ATTEMPT):
                    path = case / name
                    path.mkdir(mode=0o700)
                    (path / "intent.json").write_bytes((name + " ORIGINAL UNKNOWN\n").encode())
                    (path / "migration.json").write_bytes(b"ORIGINAL PARTIAL DATA\n")
                    for leaf in path.iterdir():
                        originals[leaf] = (leaf.read_bytes(), leaf.stat().st_ino, leaf.stat().st_mtime_ns)
                value = contract(self.base)
                value["casePath"] = str(case)
                source_pins = {name: dict(pin=copy.deepcopy(pin), identity=(name,)) for name, pin in self.base.PINNED.items()}
                proof = dict(files={"migration.json": {"identity": ("original",)}}, result=prior_result())
                controller = SimpleNamespace(output=case / guard.PRIOR_ATTEMPT, started=0, codes=[],
                    last_sample={"fixture": True}, samples=1, peak_rss=4096, max_delta=1, min_free=10 << 30,
                    first_cause=None, task_sample_failure=None, task_sample_journal_error=None,
                    event=Mock(), capacity=Mock(), cleanup=Mock(return_value=(failure != "cleanup", "owned_cleanup_incomplete" if failure == "cleanup" else None)))
                def command(argv, label, pin):
                    self.assertEqual(argv, guard.normal_command(case))
                    self.assertEqual(label, "verify")
                    self.assertEqual(pin, source_pins["tools/extracted/ynx-consensus-package"])
                    if failure == "fresh":
                        raise self.base.Refused("fresh_memory_floor")
                    (controller.output / "verify.stdout").write_bytes(completion())
                    controller.codes.append(0)
                controller.command = Mock(side_effect=command)
                reads = []
                def read(path, expected=None, maximum=None, progress=None, executable=False):
                    reads.append(path)
                    if path == self.base_path:
                        return self.base_witness[1], b""
                    relative = str(path.relative_to(case))
                    self.assertEqual(expected, self.base.PINNED[relative])
                    if failure == "source":
                        raise self.base.Refused("independent_input_pin_mismatch")
                    return source_pins[relative], b""
                returns = [copy.deepcopy(proof), copy.deepcopy(proof)]
                if failure == "prior":
                    returns[1]["files"]["migration.json"]["identity"] = ("replaced",)
                libc, gets, timers = Mock(), [], []
                def prctl(option, argument, *_rest):
                    if option == 37:
                        ctypes.cast(argument, ctypes.POINTER(ctypes.c_int)).contents.value = 0 if not gets else 1
                        gets.append(True)
                    return 0
                libc.prctl.side_effect = prctl
                with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=0), patch.object(self.base, "private_directory"), patch.object(self.base, "Controller", return_value=controller) as constructor, patch.object(self.base.ctypes, "CDLL", return_value=libc), patch.object(self.base, "sync_directory"), patch.object(signal, "getitimer", return_value=(0.0, 0.0)), patch.object(signal, "signal", return_value=signal.SIG_DFL), patch.object(signal, "setitimer", side_effect=lambda _timer, duration: timers.append(duration)), patch.object(self.base.time, "monotonic", return_value=1), patch.object(self.base, "check_prepared_witness") as check_witness, patch.object(self.base, "validate_inputs", return_value=source_pins), patch.object(guard, "validate_prior_export", side_effect=returns) as prior, patch.object(self.base, "read_file", side_effect=read):
                    result = guard.run(self.base, value, "d" * 64, [self.base_witness])
                constructor.assert_called_once_with(guard.base_contract(value), "d" * 64)
                controller.command.assert_called_once()
                controller.cleanup.assert_called_once()
                self.assertIn(179, timers)
                self.assertIn(15, timers)
                self.assertEqual(result["normalExitCodes"], [] if failure == "fresh" else [0])
                self.assertEqual(result["migrationVerified"], failure is None)
                self.assertFalse(result["rootGrant"])
                self.assertFalse(result["publicActivation"])
                self.assertEqual(result["priorExport"], guard.PRIOR_EXPORT)
                self.assertEqual(json.loads((case / guard.ATTEMPT / "result.json").read_bytes()), result)
                if failure is None:
                    self.assertEqual(prior.call_count, 2)
                    self.assertEqual(check_witness.call_count, 2)
                    self.assertEqual(set(reads), {case / name for name in self.base.PINNED} | {self.base_path})
                else:
                    self.assertIsNotNone(result["firstCause"])
                for path, (raw, inode, mtime) in originals.items():
                    self.assertEqual((path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns), (raw, inode, mtime))


if __name__ == "__main__":
    unittest.main()
