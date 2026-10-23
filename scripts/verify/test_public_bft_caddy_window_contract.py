"""Independent contract/default-CLI controls; never a real Caddy DATA window."""
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
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


@contextlib.contextmanager
def no_host_operations():
    def refuse(*_args, **_kwargs):
        raise AssertionError("contract control attempted host process/network action")
    def checked(original):
        def call(path, *args, **kwargs):
            if not isinstance(path, int):
                value = os.path.normpath(os.fsdecode(path))
                if (value == "/proc" or value.startswith("/proc/") or value.startswith("/var/tmp/ynx-caddy-baseline-")
                        or value == "/usr/bin/python3" or value.startswith("/usr/bin/python3.")):
                    raise AssertionError("contract control attempted real proc or protected case I/O")
            return original(path, *args, **kwargs)
        return call
    with contextlib.ExitStack() as stack:
        for module, name in ((builtins, "open"), (io, "open"), (os, "open"), (os, "stat"), (os, "lstat"),
                             (os, "scandir"), (os, "listdir"), (os, "readlink")):
            stack.enter_context(patch.object(module, name, checked(getattr(module, name))))
        for module, names in ((subprocess, ("Popen", "run", "check_call", "check_output", "call")),
                (os, ("kill", "killpg", "waitpid", "pidfd_open", "fork", "posix_spawn", "posix_spawnp", "system", "execve", "execv")),
                (signal, ("signal", "setitimer", "pidfd_send_signal")), (ctypes, ("CDLL",)),
                (socket, ("socket", "create_connection"))):
            for name in names:
                stack.enter_context(patch.object(module, name, refuse, create=True))
        yield


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/ops/run-public-bft-caddy-baseline.py"
SPEC = importlib.util.spec_from_file_location("public_bft_caddy_window_contract", RUNNER)
guard = importlib.util.module_from_spec(SPEC)
with no_host_operations():
    SPEC.loader.exec_module(guard)

EXPECTED_CASE = "/var/tmp/ynx-caddy-baseline-5591ad6ff-20261023T2000Z"
EXPECTED_RUNTIME = dict(path="/usr/bin/python3", resolvedPath="/usr/bin/python3.12", bytes="8020928",
    sha256="1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118")
EXPECTED_ENVIRONMENT = dict(PATH="/usr/bin:/bin", LC_ALL="C", PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1")
EXPECTED_PINS = {
    "source/SOURCE.json": dict(bytes="766", sha256="3caa9ff2c340f758316550d1455618b7992a0e046e803817e105f39fbb025811"),
    "BASELINE_BINDING_RPC_EVM.json": dict(bytes="2013", sha256="f296b0ce244425ff083edfeb75e8182a66287bb35d384ce738b4219cdda80cff"),
    "source/scripts/ops/prepare-public-bft-caddy-json-source.py": dict(bytes="18192", sha256="b3291e712232650c977c57ec1fec199371ab0e9aac9070abd5bdad875be8652e"),
    "source/scripts/ops/remote/public-bft-caddy-json.py": dict(bytes="25071", sha256="c5989af8f9f8bfa8ae71191ee32f239699741d09f317589833de15fea8091b4d"),
    "source/scripts/ops/install-public-bft-caddy-json-baseline.py": dict(bytes="19313", sha256="1c38ec975a73961207ac87481fdae65b4633d5d3d7e00916bca2365c9f5b6b9e"),
    "source.zip": dict(bytes="20437", sha256="8a9241049cf3c5d4de93e6902f9d1351f7606f3a5313c1ce6e591c68d07b6279"),
}


def contract():
    prepared = {name: dict(uid="0", gid="0", mode="700", device="64770", inode=str(100 + index))
                for index, name in enumerate(guard.DIRECTORIES)}
    for index, name in enumerate(guard.INPUT_NAMES):
        size = EXPECTED_PINS[name]["bytes"] if name in EXPECTED_PINS else "47901" if name == guard.GUARD else str(RUNNER.stat().st_size)
        prepared[name] = dict(uid="0", gid="0", mode="600", device="64770", inode=str(200 + index),
            bytes=size, nlink="1", mtimeNs="1792780753533647655", ctimeNs="1792780753533647655")
    return dict(version="YNX-CADDY-BASELINE-DATA-WINDOW/v1", classification="data", casePath=EXPECTED_CASE,
        controllerSHA256="b" * 64, pythonRuntime=copy.deepcopy(EXPECTED_RUNTIME), limits=dict(guard.LIMITS),
        environment=copy.deepcopy(EXPECTED_ENVIRONMENT), mustBeEmptyProcessGroups=[dict(pgid="123", leaderStartTicks="456")],
        preparedInputWitness=prepared)


def source_index():
    names = ("source/scripts/ops/prepare-public-bft-caddy-json-source.py", "source/scripts/ops/remote/public-bft-caddy-json.py",
             "source/scripts/ops/install-public-bft-caddy-json-baseline.py")
    return dict(version="YNX-CADDY-BASELINE-PUBLIC-SOURCE/v1", commit="5591ad6ff59f5e495be01712286b1acd846f0cea",
        tree="04b8b951a7c0ff0793e911549fc41471e833aebd", runId="40014651538", runAttempt="1", producerJob="caddy-source",
        files=[dict(path=name.removeprefix("source/"), bytes=int(EXPECTED_PINS[name]["bytes"]), sha256=EXPECTED_PINS[name]["sha256"]) for name in names],
        publicSourceOnly=True, deployed=False, servicesChanged=False, rootGrant=False)


class CaddyWindowContractControls(unittest.TestCase):
    def setUp(self):
        self.fence = no_host_operations()
        self.fence.__enter__()
        self.addCleanup(self.fence.__exit__, None, None, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name).resolve()

    def contract_file(self, raw=None, name="contract.json"):
        raw = guard.encode(contract()) if raw is None else raw
        path = self.directory / name
        path.write_bytes(raw)
        path.chmod(0o600)
        return path, hashlib.sha256(raw).hexdigest(), raw

    def invoke(self, args):
        with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
            code = guard.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_root_window_caps_are_independent_of_the_production_dictionary(self):
        # These are the granted DATA-window values, not a cloned dictionary
        # compared with itself. Migration/ELF 8GiB/180s limits are inapplicable.
        for key, expected in dict(activeSeconds=120, cleanupSeconds=15, totalSeconds=135,
                rssBytes=512 << 20, caseDeltaBytes=64 << 20, freshMemoryBytes=1 << 30, sampleMs=200,
                stdoutBytes=262144, stderrBytes=262144, journalBytes=262144).items():
            self.assertEqual(guard.LIMITS[key], expected, key)
        self.assertEqual(guard.ENVIRONMENT, EXPECTED_ENVIRONMENT)
        self.assertEqual(guard.CASE, EXPECTED_CASE)
        self.assertEqual(guard.VERSION, "YNX-CADDY-BASELINE-DATA-WINDOW/v1")
        self.assertEqual(guard.PINNED, EXPECTED_PINS)
        self.assertEqual(guard.GUARD_BYTES, "47901")
        self.assertEqual(guard.GUARD_SHA256, "fa8a1ac1230b4f3ac5bee549019d7e7e3312c5a954c3a19227c8607f054e6c37")

    def test_closed_contract_does_not_accept_authority_commands_or_an_old_profile(self):
        value = contract()
        self.assertEqual(guard.validate_contract(value), value)
        changes = [lambda v: v.update(rootGrant=True), lambda v: v.update(approved=True),
            lambda v: v.update(expiresAt="2099-01-01T00:00:00Z"), lambda v: v.update(command=["/bin/sh", "-c", "false"]),
            lambda v: v.update(operation="install"), lambda v: v.update(resume=True), lambda v: v.update(automaticRetry=True),
            lambda v: v.update(version="YNX-ORIGINAL-NATIVE-COPY-VERIFY/v1"),
            lambda v: v.update(version="YNX-RETAINED-NATIVE-EXPORT-VERIFY/v1"),
            lambda v: v.update(classification="approval"), lambda v: v.update(casePath="/arbitrary"),
            lambda v: v.update(casePath=EXPECTED_CASE + "/../other"), lambda v: v.pop("controllerSHA256")]
        for change in changes:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)
        for digest in ("0" * 64, "A" * 64, "a" * 63, "g" * 64, None, True):
            bad = copy.deepcopy(value)
            bad["controllerSHA256"] = digest
            with self.subTest(digest=digest), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_every_limit_and_environment_change_is_rejected(self):
        value = contract()
        for key in value["limits"]:
            for item in (value["limits"][key] + 1, True, str(value["limits"][key])):
                bad = copy.deepcopy(value)
                bad["limits"][key] = item
                with self.subTest(key=key, item=item), self.assertRaises(guard.Refused):
                    guard.validate_contract(bad)
        for change in (lambda v: v["limits"].update(activeSeconds=180, totalSeconds=195, rssBytes=8 << 30),
                lambda v: v["limits"].update(journalBytes=4 << 20), lambda v: v["environment"].update(PYTHONPATH="/untrusted"),
                lambda v: v["environment"].update(PATH="/untrusted:/usr/bin:/bin"),
                lambda v: v["environment"].update(PYTHONDONTWRITEBYTECODE="0"),
                lambda v: v["environment"].update(PYTHONSTARTUP="/untrusted/start.py")):
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_python_runtime_is_closed_typed_canonical_metadata(self):
        value = contract()
        self.assertEqual(value["pythonRuntime"], EXPECTED_RUNTIME)
        invalid = [dict(EXPECTED_RUNTIME, command="install"), dict(EXPECTED_RUNTIME, path="python3"),
            dict(EXPECTED_RUNTIME, path="/bin/sh"), dict(EXPECTED_RUNTIME, resolvedPath="/usr/bin/../bin/python3.12"),
            dict(EXPECTED_RUNTIME, resolvedPath="/usr/bin//python3.12"), dict(EXPECTED_RUNTIME, resolvedPath="/tmp/python3.12"),
            dict(EXPECTED_RUNTIME, bytes=8020928), dict(EXPECTED_RUNTIME, bytes="08020928"),
            dict(EXPECTED_RUNTIME, bytes="0"), dict(EXPECTED_RUNTIME, sha256="0" * 64),
            dict(EXPECTED_RUNTIME, sha256="A" * 64), dict(EXPECTED_RUNTIME, sha256=True),
            dict(EXPECTED_RUNTIME, resolvedPath="/usr/bin/python3.11"), dict(EXPECTED_RUNTIME, sha256="c" * 64),
            dict(EXPECTED_RUNTIME, bytes="8020929")]
        for runtime in invalid:
            bad = copy.deepcopy(value)
            bad["pythonRuntime"] = runtime
            with self.subTest(runtime=runtime), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_witnesses_are_closed_root_private_single_link_and_fixed_source_sizes(self):
        value = contract()
        self.assertEqual(len(guard.DIRECTORIES), 6)
        self.assertEqual(len(guard.INPUT_NAMES), 8)
        self.assertEqual(len(value["preparedInputWitness"]), 14)
        changes = [lambda v: v["preparedInputWitness"].pop("control"),
            lambda v: v["preparedInputWitness"].update({"../../other": {}}),
            lambda v: v["preparedInputWitness"]["control"].update(mode="755"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(uid="1000"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(gid="1000"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(mode="644"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(nlink="2"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(inode="0"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(inode="010"),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(mtimeNs=1792780753533647655),
            lambda v: v["preparedInputWitness"][guard.SOURCE].update(path="/different"),
            lambda v: v["preparedInputWitness"][guard.GUARD].update(bytes="1")]
        for name in EXPECTED_PINS:
            changes.append(lambda v, name=name: v["preparedInputWitness"][name].update(bytes="1"))
        for change in changes:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_empty_owner_groups_are_typed_unique_and_bounded(self):
        value = contract()
        for groups in ("123", [{}], [dict(pgid="1", leaderStartTicks="456")],
                [dict(pgid="0123", leaderStartTicks="456")], [dict(pgid="123", leaderStartTicks="0")],
                [dict(pgid="123", leaderStartTicks=456)], value["mustBeEmptyProcessGroups"] * 2,
                [dict(pgid=str(123 + n), leaderStartTicks="456") for n in range(9)]):
            bad = copy.deepcopy(value)
            bad["mustBeEmptyProcessGroups"] = groups
            with self.subTest(groups=groups), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_actual_witness_reader_rejects_replacement_before_business_import(self):
        value = contract()
        for replaced in (None, "control", guard.PRODUCER):
            def directory(path):
                name = "." if str(path) == EXPECTED_CASE else str(path.relative_to(EXPECTED_CASE))
                row = copy.deepcopy(value["preparedInputWitness"][name])
                if name == replaced:
                    row["inode"] = "9999"
                return row
            def metadata(path):
                name = str(path.relative_to(EXPECTED_CASE))
                row = copy.deepcopy(value["preparedInputWitness"][name])
                if name == replaced:
                    row["inode"] = "9999"
                return SimpleNamespace(st_uid=int(row["uid"]), st_gid=int(row["gid"]), st_mode=stat.S_IFREG | int(row["mode"], 8),
                    st_dev=int(row["device"]), st_ino=int(row["inode"]), st_size=int(row["bytes"]), st_nlink=int(row["nlink"]),
                    st_mtime_ns=int(row["mtimeNs"]), st_ctime_ns=int(row["ctimeNs"]))
            with self.subTest(replaced=replaced), patch.object(guard, "directory_witness", side_effect=directory), patch.object(Path, "lstat", metadata), patch.object(guard, "captured_module") as captured:
                if replaced is None:
                    guard.check_witness(value)
                else:
                    with self.assertRaisesRegex(guard.Refused, "prepared_.*_identity_changed"):
                        guard.check_witness(value)
                captured.assert_not_called()

    def test_source_index_cannot_replace_the_three_frozen_business_sources(self):
        value = source_index()
        guard.validate_source_index(value)
        changes = [lambda v: v.update(command="install"), lambda v: v.update(commit="c" * 40),
            lambda v: v.update(tree="c" * 40), lambda v: v.update(runId="1"), lambda v: v.update(producerJob="different"),
            lambda v: v.update(publicSourceOnly=False), lambda v: v.update(rootGrant=True),
            lambda v: v.update(deployed=True), lambda v: v.update(servicesChanged=True),
            lambda v: v["files"].pop(), lambda v: v["files"].append(copy.deepcopy(v["files"][0])),
            lambda v: v["files"][0].update(path="../../untrusted.py"),
            lambda v: v["files"][0].update(sha256="c" * 64), lambda v: v["files"][0].update(bytes=1)]
        for change in changes:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(guard.Refused):
                guard.validate_source_index(bad)

    def test_normal_command_is_fixed_data_preparation_without_install_mode(self):
        self.assertEqual(guard.normal_command(), ["/usr/bin/python3", "-B", EXPECTED_CASE + "/source/scripts/ops/prepare-public-bft-caddy-json-source.py",
            "--binding", EXPECTED_CASE + "/BASELINE_BINDING_RPC_EVM.json", "--binding-sha256",
            "f296b0ce244425ff083edfeb75e8182a66287bb35d384ce738b4219cdda80cff", "--json-helper-sha256",
            "c5989af8f9f8bfa8ae71191ee32f239699741d09f317589833de15fea8091b4d", "--output-dir", EXPECTED_CASE + "/prepared-baseline"])

    def test_actual_default_cli_reads_only_the_small_contract_and_preserves_material(self):
        path, pin, raw = self.contract_file()
        old = self.directory / "data-prepare-attempt"
        old.mkdir(mode=0o700)
        unknown = old / "intent.json"
        unknown.write_bytes(b"ORIGINAL UNKNOWN NO RETRY\n")
        before = [(p, p.read_bytes(), p.stat().st_ino, p.stat().st_mtime_ns) for p in (path, unknown)]
        with patch.object(guard, "run") as execute, patch.object(guard, "Controller") as controller, patch.object(guard, "check_witness") as stage, patch.object(guard, "load_process_guard") as load, patch.object(guard, "captured_module") as captured, patch.object(guard, "live_snapshot") as live, patch.object(guard.http.client, "HTTPConnection") as http, patch.object(guard.subprocess, "Popen") as spawn:
            code, out, err = self.invoke(["--contract", str(path), "--contract-sha256", pin])
        self.assertEqual((code, err), (0, ""))
        result = json.loads(out)
        self.assertTrue(result["contractValidated"])
        for name in ("executionStarted", "rootGrant", "installed", "serviceCommandsPerformed"):
            self.assertIs(result[name], False)
        for function in (execute, controller, stage, load, captured, live, http, spawn):
            function.assert_not_called()
        for p, content, inode, mtime in before:
            self.assertEqual((p.read_bytes(), p.stat().st_ino, p.stat().st_mtime_ns), (content, inode, mtime))
        self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(set(p.name for p in self.directory.iterdir()), {"contract.json", "data-prepare-attempt"})

    def test_wrong_pin_missing_or_wrong_confirmation_never_reaches_run(self):
        path, pin, raw = self.contract_file()
        base = ["--contract", str(path), "--contract-sha256", pin]
        variants = [(base + ["--execute"], "later_exact_confirmation_required"),
            (base + ["--execute", "--confirmed-contract-sha256", "c" * 64], "later_exact_confirmation_required"),
            (base + ["--confirmed-contract-sha256", pin], "confirmation_without_execution"),
            (["--contract", str(path), "--contract-sha256", "c" * 64], "external_contract_pin_mismatch"),
            (base + ["--contract", str(path)], "duplicate_cli_option"),
            (base + ["--execute", "--execute"], "duplicate_cli_option")]
        for args, expected in variants:
            with self.subTest(args=args), patch.object(guard, "run") as execute, patch.object(guard, "load_process_guard") as load, patch.object(guard.http.client, "HTTPConnection") as http:
                code, out, err = self.invoke(args)
                self.assertEqual(code, 1)
                self.assertEqual(out, "")
                self.assertIn(expected, err)
                execute.assert_not_called(); load.assert_not_called(); http.assert_not_called()
        self.assertEqual(path.read_bytes(), raw)

    def test_unknown_positional_and_abbreviated_cli_options_refuse_before_read(self):
        path, pin, _ = self.contract_file()
        base = ["--contract", str(path), "--contract-sha256", pin]
        for extra in (["--operation", "install"], ["--command", "/bin/sh"], ["--resume"], ["--execut"], ["unexpected"]):
            with self.subTest(extra=extra), patch.object(guard, "read_private") as read, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as stopped:
                    guard.main(base + extra)
                self.assertEqual(stopped.exception.code, 2)
                read.assert_not_called()

    def test_duplicate_and_nonfinite_json_never_loads_business_code(self):
        raw = guard.encode(contract())
        for index, malformed in enumerate((raw.replace(b"{", b'{"version":"YNX-CADDY-BASELINE-DATA-WINDOW/v1",', 1),
                raw.replace(b'"classification":"data"', b'"classification":NaN'),
                raw.replace(b'"classification":"data"', b'"classification":Infinity'))):
            path, pin, _ = self.contract_file(malformed, "invalid-" + str(index) + ".json")
            with patch.object(guard, "run") as execute, patch.object(guard, "captured_module") as captured:
                code, out, _ = self.invoke(["--contract", str(path), "--contract-sha256", pin])
            self.assertEqual((code, out), (1, ""))
            execute.assert_not_called(); captured.assert_not_called()

    def test_actual_contract_reader_rejects_symlink_hardlink_and_public_mode(self):
        path, pin, raw = self.contract_file()
        link = self.directory / "symbolic.json"
        link.symlink_to(path)
        hard = self.directory / "hard.json"
        os.link(path, hard)
        for candidate in (link, hard):
            code, _, _ = self.invoke(["--contract", str(candidate), "--contract-sha256", pin])
            self.assertEqual(code, 1)
        hard.unlink()
        path.chmod(0o644)
        code, _, _ = self.invoke(["--contract", str(path), "--contract-sha256", pin])
        self.assertEqual(code, 1)
        self.assertEqual(path.read_bytes(), raw)

    def test_nonroot_execution_refuses_before_case_proc_or_network(self):
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=1000), patch.object(guard, "directory_witness") as stage, patch.object(guard, "load_process_guard") as load, patch.object(guard, "Controller") as controller:
            with self.assertRaisesRegex(guard.Refused, "root_linux_amd64_required"):
                guard.run(contract(), "b" * 64, [])
        stage.assert_not_called(); load.assert_not_called(); controller.assert_not_called()

    def test_confirmed_main_still_requires_fixed_caller_and_independent_source_pin(self):
        path, pin, raw = self.contract_file()
        args = ["--contract", str(path), "--contract-sha256", pin, "--execute", "--confirmed-contract-sha256", pin]
        with patch.object(guard, "run") as execute:
            code, _, err = self.invoke(args)
        self.assertEqual(code, 1)
        self.assertIn("fixed_normal_caller_path_required", err)
        execute.assert_not_called()
        contract_record = dict(pin=dict(bytes=str(len(raw)), sha256=pin), identity=("synthetic-contract",))
        fixed_caller = Path(EXPECTED_CASE) / guard.CALLER
        real_resolve = Path.resolve
        def resolve(candidate, *pargs, **kwargs):
            return fixed_caller if str(candidate) == guard.__file__ else real_resolve(candidate, *pargs, **kwargs)
        for digest, expected in (("c" * 64, "external_controller_source_pin_mismatch"), ("b" * 64, "isolated_run_boundary")):
            caller_record = dict(pin=dict(bytes="123", sha256=digest), identity=("synthetic-caller",))
            def read(candidate, *_pargs, **_kwargs):
                self.assertIn(candidate, (path, fixed_caller))
                return (raw, contract_record) if candidate == path else (b"PUBLIC SYNTHETIC CODE", caller_record)
            with self.subTest(digest=digest), patch.object(Path, "resolve", resolve), patch.object(guard, "read_private", side_effect=read), patch.object(guard, "run", side_effect=guard.Refused("isolated_run_boundary")) as execute:
                code, _, err = self.invoke(args)
            self.assertEqual(code, 1)
            self.assertIn(expected, err)
            if digest == "b" * 64:
                execute.assert_called_once_with(contract(), pin, [(path, contract_record), (fixed_caller, caller_record)])
            else:
                execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
