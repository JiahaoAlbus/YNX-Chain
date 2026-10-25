"""Independent contract/default-CLI controls; never a real Caddy ops window."""
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
                        or value.startswith("/var/tmp/ynx-caddy-persistent-source-")
                        or value == "/etc/caddy" or value.startswith("/etc/caddy/")
                        or value.startswith("/etc/systemd/") or value.startswith("/run/systemd/")
                        or value.startswith("/usr/lib/systemd/")
                        or value in ("/usr/bin/caddy", "/usr/bin/curl", "/usr/bin/systemctl")
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
PROCESS_SPEC = importlib.util.spec_from_file_location("public_bft_caddy_contract_process_guard", ROOT / "scripts/ops/verify-original-native-copy.py")
process_guard = importlib.util.module_from_spec(PROCESS_SPEC)
with no_host_operations():
    PROCESS_SPEC.loader.exec_module(process_guard)

EXPECTED_CASE = "/var/tmp/ynx-caddy-baseline-fd-observation-20261023T2040Z"
CONSUMED_CASE = "/var/tmp/ynx-caddy-baseline-5591ad6ff-20261023T2000Z"
EXPECTED_GUARD = dict(bytes="49677", sha256="3474ec7304ac1a43270d49fb106450a3698e1130764b3bd3b885ad6b1aabc610")
EXPECTED_INSTALL_CASE = "/var/tmp/ynx-caddy-persistent-source-20261023T2100Z"
EXPECTED_INSTALL_RUNTIMES = {
    "/usr/bin/caddy": dict(bytes="38845944", sha256="9681d054b6e5137d53f6d027188b349e0603fd12ea6334bd0d49da6755432f1b"),
    "/usr/bin/curl": dict(bytes="297288", sha256="ea43dc3e72aadac2d8820181a79af1ce94f0f713f7aef81f5ef0ed5881d1f5eb"),
    "/usr/bin/systemctl": dict(bytes="1501304", sha256="d03995d5d2ce6a5dd1822854f80c40cdf3d92c7a008179d89e80e5ffcd1a9aa2"),
}
EXPECTED_ORIGINAL_CONFIG = dict(bytes="35508", sha256="98da0cf6439cf9b3332851639a06f2c0b25d9b6baf0bd0ecfc782625eb466a1a")
EXPECTED_BINARY_IDENTITIES = {
    "caddy": ("12998", "1752729729000000000", "1777304488947032345"),
    "curl": ("13122", "1777462543000000000", "1781834915448786176"),
    "systemctl": ("17939", "1764094591000000000", "1772177190159552318"),
}
EXPECTED_GET = ["/usr/bin/curl", "--disable", "--request", "GET", "--noproxy", "*", "--max-redirs", "0",
    "--connect-timeout", "5", "--max-time", "10", "--max-filesize", "16777216", "--fail", "--silent",
    "--show-error", "--url", "http://127.0.0.1:2019/config/"]
EXPECTED_SHOW = ["/usr/bin/systemctl", "show", "caddy.service", "--no-pager",
    "--property=ActiveState,SubState,MainPID,FragmentPath,DropInPaths,User,Group,ExecStart,ExecReload"]
EXPECTED_DAEMON_RELOAD = ["/usr/bin/systemctl", "daemon-reload"]
EXPECTED_VALIDATE = ["/usr/bin/caddy", "validate", "--config", "/etc/caddy/ynx-chain.json"]
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
        size = EXPECTED_PINS[name]["bytes"] if name in EXPECTED_PINS else EXPECTED_GUARD["bytes"] if name == guard.GUARD else str(RUNNER.stat().st_size)
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


def install_contract():
    value = contract()
    value.update(version="YNX-CADDY-BASELINE-INSTALL-WINDOW/v1", classification="install", casePath=EXPECTED_INSTALL_CASE)
    binaries = {}
    for path, expected in EXPECTED_INSTALL_RUNTIMES.items():
        name = Path(path).name
        inode, modified, changed = EXPECTED_BINARY_IDENTITIES[name]
        binaries[name] = dict(path=path, **expected, witness=dict(uid="0", gid="0", mode="755", device="64770",
            inode=inode, bytes=expected["bytes"], nlink="1", mtimeNs=modified, ctimeNs=changed))
    value["systemBinaries"] = binaries
    return value


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
        self.assertEqual(guard.GUARD_BYTES, EXPECTED_GUARD["bytes"])
        self.assertEqual(guard.GUARD_SHA256, EXPECTED_GUARD["sha256"])
        source_path = Path(EXPECTED_CASE) / guard.GUARD
        for observed in (dict(bytes="47901", sha256="fa8a1ac1230b4f3ac5bee549019d7e7e3312c5a954c3a19227c8607f054e6c37"),
                dict(bytes="48804", sha256="f6f9b1da0289707e8e30cac545d3f557819bc7bd75f5d413ae08eb7ce8e9d11d")):
            legacy = dict(pin=observed, identity=("historical-source-observation",))
            with self.subTest(observed=observed), patch.object(guard, "read_private", return_value=(b"PUBLIC HISTORICAL SOURCE OBSERVATION", legacy)) as read, patch.object(guard, "captured_module") as captured:
                with self.assertRaisesRegex(guard.Refused, "original_process_guard_source_pin_mismatch"):
                    guard.load_process_guard(source_path)
                read.assert_called_once_with(source_path, {"bytes": guard.GUARD_BYTES, "sha256": guard.GUARD_SHA256}, maximum=1 << 20)
                captured.assert_not_called()

    def test_closed_contract_does_not_accept_authority_commands_or_an_old_profile(self):
        value = contract()
        self.assertEqual(guard.validate_contract(value), value)
        changes = [lambda v: v.update(rootGrant=True), lambda v: v.update(approved=True),
            lambda v: v.update(expiresAt="2099-01-01T00:00:00Z"), lambda v: v.update(command=["/bin/sh", "-c", "false"]),
            lambda v: v.update(operation="install"), lambda v: v.update(resume=True), lambda v: v.update(automaticRetry=True),
            lambda v: v.update(version="YNX-ORIGINAL-NATIVE-COPY-VERIFY/v1"),
            lambda v: v.update(version="YNX-RETAINED-NATIVE-EXPORT-VERIFY/v1"),
            lambda v: v.update(classification="approval"), lambda v: v.update(casePath="/arbitrary"),
            lambda v: v.update(casePath=CONSUMED_CASE),
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
        shadows = ("source/scripts/ops/json.py", "control/ctypes.py")
        for replaced in (None, "control", guard.PRODUCER, *shadows):
            def directory(path):
                name = "." if str(path) == EXPECTED_CASE else str(path.relative_to(EXPECTED_CASE))
                row = copy.deepcopy(value["preparedInputWitness"][name])
                if name == replaced:
                    row["inode"] = "9999"
                return row
            def metadata(path):
                name = str(path.relative_to(EXPECTED_CASE))
                row = copy.deepcopy(value["preparedInputWitness"].get(name, dict(uid="0", gid="0", mode="600", device="64770",
                    inode="7777", bytes="32", nlink="1", mtimeNs="1792780753533647655", ctimeNs="1792780753533647655")))
                if name == replaced:
                    row["inode"] = "9999"
                kind = stat.S_IFDIR if name in guard.DIRECTORIES else stat.S_IFREG
                return SimpleNamespace(st_uid=int(row["uid"]), st_gid=int(row["gid"]), st_mode=kind | int(row["mode"], 8),
                    st_dev=int(row["device"]), st_ino=int(row["inode"]), st_size=int(row.get("bytes", "4096")), st_nlink=int(row.get("nlink", "2")),
                    st_mtime_ns=int(row.get("mtimeNs", "1")), st_ctime_ns=int(row.get("ctimeNs", "1")))
            def walk(base, followlinks=False):
                self.assertIs(followlinks, False)
                if base == Path(EXPECTED_CASE) / "source":
                    return iter([
                        (str(base), ["scripts"], ["SOURCE.json"]),
                        (str(base / "scripts"), ["ops"], []),
                        (str(base / "scripts/ops"), ["remote"], ["prepare-public-bft-caddy-json-source.py", "install-public-bft-caddy-json-baseline.py"]
                            + (["json.py"] if replaced == shadows[0] else [])),
                        (str(base / "scripts/ops/remote"), [], ["public-bft-caddy-json.py"]),
                    ])
                self.assertEqual(base, Path(EXPECTED_CASE) / "control")
                return iter([(str(base), [], [Path(guard.GUARD).name, Path(guard.CALLER).name]
                    + (["ctypes.py"] if replaced == shadows[1] else []))])
            with self.subTest(replaced=replaced), patch.object(guard, "directory_witness", side_effect=directory), patch.object(Path, "lstat", metadata), patch.object(guard.os, "walk", side_effect=walk) as walked, patch.object(guard, "captured_module") as captured:
                if replaced is None:
                    guard.check_witness(value)
                    self.assertEqual(walked.call_count, 2)
                elif replaced in shadows:
                    with self.assertRaisesRegex(guard.Refused, "closed_staged_python_sources_required"):
                        guard.check_witness(value)
                else:
                    with self.assertRaisesRegex(guard.Refused, "prepared_.*_identity_changed"):
                        guard.check_witness(value)
                    walked.assert_not_called()
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

    def test_data_profile_cannot_gain_installation_from_install_fields_or_a_new_case(self):
        value = contract()
        # The former DATA profile is still useful as a validator, but cannot
        # become the new installation window by adding a field or swapping its
        # directory. This exercises the real closed contract validator.
        variants = [dict(systemBinaries={}), dict(install=True), dict(operation="persistent-startup-install"),
            dict(casePath=EXPECTED_INSTALL_CASE), dict(version="YNX-CADDY-BASELINE-INSTALL-WINDOW/v1"),
            dict(version="YNX-CADDY-BASELINE-INSTALL-WINDOW/v1", casePath=EXPECTED_INSTALL_CASE)]
        for change in variants:
            bad = copy.deepcopy(value)
            bad.update(change)
            with self.subTest(change=change), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)
        self.assertNotIn("--install", guard.normal_command(value))
        self.assertNotIn("persistent-startup-install", " ".join(guard.normal_command(value)))

    def test_install_normal_command_is_only_the_original_fixed_installer(self):
        value = install_contract()
        command = guard.normal_command(value)
        self.assertEqual(command[:3], ["/usr/bin/python3", "-B", EXPECTED_INSTALL_CASE + "/source/scripts/ops/install-public-bft-caddy-json-baseline.py"])
        self.assertEqual(len(command), 14)
        self.assertEqual(command.count("--install"), 1)
        tokens = command[3:]
        tokens.remove("--install")
        self.assertEqual(len(tokens), 10)
        options = dict(zip(tokens[::2], tokens[1::2]))
        self.assertEqual(options, {
            "--binding": EXPECTED_INSTALL_CASE + "/BASELINE_BINDING_RPC_EVM.json",
            "--binding-sha256": "f296b0ce244425ff083edfeb75e8182a66287bb35d384ce738b4219cdda80cff",
            "--producer-sha256": "b3291e712232650c977c57ec1fec199371ab0e9aac9070abd5bdad875be8652e",
            "--json-helper-sha256": "c5989af8f9f8bfa8ae71191ee32f239699741d09f317589833de15fea8091b4d",
            "--output-dir": EXPECTED_INSTALL_CASE + "/persistent-startup-install",
        })
        for forbidden in ("candidate.json", "--resume", "--reload", "--restart", "/bin/sh", "-c"):
            self.assertNotIn(forbidden, command)

    def test_install_profile_is_closed_independent_and_has_the_original_window_caps(self):
        value = install_contract()
        self.assertEqual(guard.validate_contract(value), value)
        self.assertEqual(guard.INSTALL_VERSION, "YNX-CADDY-BASELINE-INSTALL-WINDOW/v1")
        self.assertEqual(guard.INSTALL_CASE, EXPECTED_INSTALL_CASE)
        self.assertEqual(guard.INSTALL_ATTEMPT, "persistent-source-install-attempt")
        self.assertEqual(guard.INSTALL_DESTINATION, "persistent-startup-install")
        self.assertEqual(set(value), set(contract()) | {"systemBinaries"})
        self.assertEqual(guard.LIMITS, dict(activeSeconds=120, cleanupSeconds=15, totalSeconds=135,
            rssBytes=512 << 20, caseDeltaBytes=64 << 20, freshMemoryBytes=1 << 30, diskFloorBytes=1 << 30,
            stdoutBytes=262144, stderrBytes=262144, journalBytes=262144, sampleMs=200, processes=8, threads=64))
        self.assertEqual(guard.SYSTEM_BINARIES, {
            Path(path).name: dict(path=path, **expected) for path, expected in EXPECTED_INSTALL_RUNTIMES.items()
        })
        self.assertEqual((guard.GET, guard.SHOW, guard.DAEMON_RELOAD, guard.VALIDATE),
            (EXPECTED_GET, EXPECTED_SHOW, EXPECTED_DAEMON_RELOAD, EXPECTED_VALIDATE))
        changes = [lambda v: v.pop("systemBinaries"), lambda v: v.update(classification="data"),
            lambda v: v.update(version="YNX-CADDY-BASELINE-DATA-WINDOW/v1"),
            lambda v: v.update(casePath=EXPECTED_CASE), lambda v: v.update(casePath=CONSUMED_CASE),
            lambda v: v.update(casePath=EXPECTED_INSTALL_CASE + "/../other"),
            lambda v: v.update(rootGrant=True), lambda v: v.update(operation="reload"),
            lambda v: v.update(install=True), lambda v: v.update(resume=True), lambda v: v.update(automaticRetry=True),
            lambda v: v.update(command=["/bin/sh", "-c", "false"]),
            lambda v: v.update(configPath="/tmp/candidate.json"),
            lambda v: v.update(dropInPath="/tmp/arbitrary.conf"),
            lambda v: v.update(sourceSHA256="c" * 64), lambda v: v.update(candidateBytes="27620")]
        changes.extend(lambda v, key=key: v["limits"].update({key: v["limits"][key] + 1}) for key in value["limits"])
        changes.extend((lambda v: v["environment"].update(PYTHONPATH="/tmp/foreign"),
            lambda v: v["pythonRuntime"].update(sha256="c" * 64),
            lambda v: v["preparedInputWitness"][guard.INSTALLER].update(bytes="1")))
        for change in changes:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_install_system_binaries_are_fixed_root_owned_pins_and_closed_witnesses(self):
        value = install_contract()
        changes = [lambda v: v["systemBinaries"].pop("curl"),
            lambda v: v["systemBinaries"].update(shell={}),
            lambda v: v["systemBinaries"].update(caddy=list(v["systemBinaries"]["caddy"]))]
        for name in ("curl", "systemctl", "caddy"):
            mutations = [dict(path="/bin/sh"), dict(path="/usr/bin/../bin/" + name), dict(bytes="1"),
                dict(bytes=int(value["systemBinaries"][name]["bytes"])), dict(sha256="c" * 64),
                dict(sha256="0" * 64), dict(command="reload"), dict(witness={})]
            for fields in mutations:
                changes.append(lambda v, name=name, fields=fields: v["systemBinaries"][name].update(fields))
            for fields in (dict(uid="1000"), dict(gid="1000"), dict(mode="777"), dict(mode="600"),
                    dict(nlink="2"), dict(bytes="1"), dict(inode="0"), dict(device=True), dict(mtimeNs="01"),
                    dict(ctimeNs=123), dict(path="/tmp/foreign")):
                changes.append(lambda v, name=name, fields=fields: v["systemBinaries"][name]["witness"].update(fields))
        for change in changes:
            bad = copy.deepcopy(value)
            change(bad)
            with self.subTest(bad=bad["systemBinaries"]), self.assertRaises(guard.Refused):
                guard.validate_contract(bad)

    def test_actual_install_default_cli_preserves_unknown_and_never_contacts_the_host(self):
        raw = guard.encode(install_contract())
        path, digest, _ = self.contract_file(raw, "install-contract.json")
        old = self.directory / "persistent-startup-install"
        old.mkdir(mode=0o700)
        unknown = old / "baseline-install-intent.json"
        unknown.write_bytes(b"ORIGINAL INSTALL UNKNOWN MUST NOT REPLAY\n")
        before = [(p, p.read_bytes(), p.stat().st_ino, p.stat().st_mtime_ns) for p in (path, unknown)]
        with patch.object(guard, "run") as execute, patch.object(guard, "Controller") as controller, patch.object(guard, "check_witness") as stage, patch.object(guard, "load_process_guard") as load, patch.object(guard, "captured_module") as captured, patch.object(guard, "live_snapshot") as live, patch.object(guard.http.client, "HTTPConnection") as http, patch.object(guard.subprocess, "Popen") as spawn:
            code, out, err = self.invoke(["--contract", str(path), "--contract-sha256", digest])
        self.assertEqual((code, err), (0, ""))
        result = json.loads(out)
        self.assertEqual((result["version"], result["classification"]), ("YNX-CADDY-BASELINE-INSTALL-WINDOW/v1", "install"))
        self.assertIs(result["contractValidated"], True)
        for key in ("executionStarted", "rootGrant", "installed", "serviceCommandsPerformed"):
            self.assertIs(result[key], False)
        for function in (execute, controller, stage, load, captured, live, http, spawn):
            function.assert_not_called()
        for p, content, inode, modified in before:
            self.assertEqual((p.read_bytes(), p.stat().st_ino, p.stat().st_mtime_ns), (content, inode, modified))
        self.assertEqual(set(p.name for p in self.directory.iterdir()), {"install-contract.json", "persistent-startup-install"})

    def test_install_cli_needs_external_pin_and_separate_confirmation_without_command_flags(self):
        path, digest, raw = self.contract_file(guard.encode(install_contract()), "install-contract.json")
        base = ["--contract", str(path), "--contract-sha256", digest]
        for args in (base + ["--execute"], base + ["--execute", "--confirmed-contract-sha256", "c" * 64],
                base + ["--confirmed-contract-sha256", digest],
                ["--contract", str(path), "--contract-sha256", "c" * 64]):
            with self.subTest(args=args), patch.object(guard, "run") as execute, patch.object(guard, "load_process_guard") as low:
                code, out, _ = self.invoke(args)
            self.assertEqual((code, out), (1, ""))
            execute.assert_not_called(); low.assert_not_called()
        for extra in (["--install"], ["--reload"], ["--restart"], ["--resume"], ["--command", "/bin/sh"],
                ["--config", "/tmp/candidate.json"], ["--operation", "daemon-reload"]):
            with self.subTest(extra=extra), patch.object(guard, "read_private") as read, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as stopped:
                    guard.main(base + extra)
                self.assertEqual(stopped.exception.code, 2)
                read.assert_not_called()
        self.assertEqual(path.read_bytes(), raw)

    def test_install_execute_binds_only_the_new_case_caller_and_independent_code_pin(self):
        value = install_contract()
        path, digest, raw = self.contract_file(guard.encode(value), "install-contract.json")
        args = ["--contract", str(path), "--contract-sha256", digest, "--execute", "--confirmed-contract-sha256", digest]
        with patch.object(guard, "run") as execute:
            code, out, err = self.invoke(args)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("fixed_normal_caller_path_required", err)
        execute.assert_not_called()
        fixed = Path(EXPECTED_INSTALL_CASE) / guard.CALLER
        old = Path(EXPECTED_CASE) / guard.CALLER
        real_resolve = Path.resolve
        contract_record = dict(pin=dict(bytes=str(len(raw)), sha256=digest), identity=("synthetic-install-contract",))
        for caller, source_sha in ((old, "b" * 64), (fixed, "c" * 64), (fixed, "b" * 64)):
            def resolve(candidate, *positional, **keywords):
                return caller if str(candidate) == guard.__file__ else real_resolve(candidate, *positional, **keywords)
            source_record = dict(pin=dict(bytes="123", sha256=source_sha), identity=("synthetic-install-caller",))
            def read(candidate, *_args, **_kwargs):
                self.assertIn(candidate, (path, fixed))
                return (raw, contract_record) if candidate == path else (b"PUBLIC INSTALL CODE", source_record)
            with self.subTest(caller=caller, source_sha=source_sha), patch.object(Path, "resolve", resolve), patch.object(guard, "read_private", side_effect=read), patch.object(guard, "run", side_effect=guard.Refused("isolated_install_boundary")) as execute:
                code, out, err = self.invoke(args)
            self.assertEqual((code, out), (1, ""))
            if caller == old:
                self.assertIn("fixed_normal_caller_path_required", err)
                execute.assert_not_called()
            elif source_sha != "b" * 64:
                self.assertIn("external_controller_source_pin_mismatch", err)
                execute.assert_not_called()
            else:
                self.assertIn("isolated_install_boundary", err)
                execute.assert_called_once_with(value, digest, [(path, contract_record), (fixed, source_record)])
        with patch.object(guard.sys, "platform", "linux"), patch.object(guard.platform, "machine", return_value="x86_64"), patch.object(guard.os, "geteuid", return_value=1000), patch.object(guard, "directory_witness") as stage, patch.object(guard, "Controller") as controller:
            with self.assertRaisesRegex(guard.Refused, "root_linux_amd64_required"):
                guard.run(value, digest, [])
        stage.assert_not_called(); controller.assert_not_called()

    def test_install_targets_are_fixed_and_existing_or_unknown_paths_are_never_replayed(self):
        self.assertEqual(guard.CONFIG, "/etc/caddy/ynx-chain.json")
        self.assertEqual(guard.DROPIN, "/etc/systemd/system/caddy.service.d/ynx-chain-json.conf")
        allowed = {path + suffix for path in ("/etc/caddy/ynx-chain.json", "/etc/systemd/system/caddy.service.d/ynx-chain-json.conf",
            "/etc/systemd/system/caddy.service.d") for suffix in ("", ".partial", ".UNKNOWN", ".tmp")}
        for present in (None, *sorted(allowed)):
            def exists(path):
                self.assertIn(str(path), allowed)
                return str(path) == present
            with self.subTest(present=present), patch.object(guard.os.path, "lexists", side_effect=exists), patch.object(guard, "exclusive") as write, patch.object(guard.subprocess, "Popen") as spawn:
                if present is None:
                    guard.absent_install_targets()
                else:
                    with self.assertRaisesRegex(guard.Refused, "existing_install_target_or_unknown"):
                        guard.absent_install_targets()
            write.assert_not_called(); spawn.assert_not_called()

    def test_curl_socket_proof_is_exact_outbound_loopback_2019_and_never_listen(self):
        fields = ["0:", "0100007F:C123", "0100007F:07E3", "01", "00000000:00000000", "00:00000000", "00000000", "0", "0", "444"]
        def table(rows):
            return ("sl local_address rem_address st tx_queue tr retrnsmt uid timeout inode\n" +
                "\n".join(" ".join(row) for row in rows) + "\n").encode()
        guard.verify_curl_socket(table([fields]), 444)
        for index, replacement in ((1, "00000000:C123"), (1, "0100007F:0000"), (2, "0200007F:07E3"),
                (2, "0100007F:1914"), (2, "08080808:01BB"), (3, "0A"), (9, "445")):
            row = list(fields)
            row[index] = replacement
            with self.subTest(index=index, replacement=replacement), self.assertRaises(guard.Refused):
                guard.verify_curl_socket(table([row]), 444)
        for rows in ([], [fields, fields], [fields[:9]]):
            with self.subTest(rows=rows), self.assertRaises(guard.Refused):
                guard.verify_curl_socket(table(rows), 444)

    def test_systemctl_ipc_proof_requires_the_connected_fixed_peer_and_stable_socket(self):
        client = dict(inode=444, type=1, state=1, cookie=(100, 200), peer=555, name=None)
        peer = dict(inode=555, type=1, state=1, cookie=(300, 400), peer=444, name=b"/run/systemd/private")
        for path in (b"/run/systemd/private", b"/run/dbus/system_bus_socket"):
            with self.subTest(path=path), patch.object(guard, "unix_diag", side_effect=[client, dict(peer, name=path), client]) as observe:
                guard.verify_ipc_socket(444, 0.2)
            self.assertEqual(observe.call_args_list, [unittest.mock.call(444, 0.2), unittest.mock.call(555, 0.2),
                unittest.mock.call(444, 0.2, (100, 200))])
        variants = [(dict(client, type=2), peer, client), (dict(client, state=10), peer, client),
            (dict(client, peer=None), peer, client), (client, dict(peer, state=10), client),
            (client, dict(peer, type=2), client), (client, dict(peer, peer=999), client),
            (client, dict(peer, name=b"/tmp/foreign.sock"), client), (client, peer, dict(client, cookie=(999, 999)))]
        for observations in variants:
            with self.subTest(observations=observations), patch.object(guard, "unix_diag", side_effect=observations), self.assertRaises(guard.Refused):
                guard.verify_ipc_socket(444, 0.2)
        with patch.object(guard, "unix_diag", side_effect=PermissionError("synthetic denied kernel observation")) as observe, self.assertRaises(PermissionError):
            guard.verify_ipc_socket(444, 0.2)
        observe.assert_called_once_with(444, 0.2)

    def test_install_socket_callback_accepts_only_owned_fixed_tools_and_exact_commands(self):
        row = dict(pid=200, parent=100, group=200, session=200, startTicks=300,
                   rssBytes=4096, threads=1, state="S", comm="tool")
        positive = [("curl", list(EXPECTED_GET)), ("systemctl", list(EXPECTED_SHOW)), ("systemctl", list(EXPECTED_DAEMON_RELOAD))]
        negative = [("systemctl", ["/usr/bin/systemctl", "reload", "caddy.service"]),
            ("systemctl", ["/usr/bin/systemctl", "restart", "caddy.service"]),
            ("systemctl", ["/usr/bin/systemctl", "daemon-reexec"]),
            ("systemctl", list(EXPECTED_SHOW) + ["--root=/tmp/foreign"]),
            ("curl", ["/usr/bin/curl", "http://127.0.0.1:2019/load"]),
            ("curl", [part.replace("http://127.0.0.1:2019/config/", "http://127.0.0.1:6420/") for part in EXPECTED_GET]),
            ("caddy", list(EXPECTED_VALIDATE)), ("caddy", ["/usr/bin/caddy", "reload", "--config", "/tmp/candidate.json"]),
            ("foreign", ["/bin/sh", "-c", "false"])]
        for tool, command in positive + negative:
            value = install_contract()
            witness = value["systemBinaries"].get(tool, value["systemBinaries"]["caddy"])["witness"]
            info = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o755, st_nlink=1,
                st_dev=int(witness["device"]), st_ino=int(witness["inode"]), st_size=int(witness["bytes"]),
                st_mtime_ns=int(witness["mtimeNs"]), st_ctime_ns=int(witness["ctimeNs"]))
            controller = object.__new__(guard.Controller)
            controller.contract = value
            controller.owned = SimpleNamespace(controller=100, known={200: 300})
            controller.system_records = {tool: dict(identity=guard.identity(info))}
            tcp = b"sl local_address rem_address st tx_queue tr retrnsmt uid timeout inode\n0: 0100007F:C123 0100007F:07E3 01 0:0 0:0 0 0 0 444\n"
            def bounded(path, limit):
                if str(path) == "/proc/200/cmdline":
                    self.assertEqual(limit, 65536)
                    return b"\0".join(part.encode() for part in command) + b"\0"
                self.assertEqual((str(path), limit), ("/proc/200/net/tcp", 4 << 20))
                return tcp
            controller.proc = SimpleNamespace(one_or_gone=lambda pid: dict(row), bounded=bounded)
            actual_exe = "/bin/sh" if tool == "foreign" else "/usr/bin/" + tool
            def readlink(path):
                paths = {"/proc/200/ns/net": "net:[88]", "/proc/self/ns/net": "net:[88]",
                    "/proc/200/fd/7": "socket:[444]", "/proc/200/exe": actual_exe}
                self.assertIn(str(path), paths)
                return paths[str(path)]
            def proc_stat(path, *_args, **_kwargs):
                self.assertEqual(str(path), "/proc/200/exe")
                return info
            def tool_stat(path, *_args, **_kwargs):
                self.assertEqual(str(path), actual_exe)
                return info
            with self.subTest(tool=tool, command=command), patch.object(guard.os, "readlink", side_effect=readlink), patch.object(Path, "stat", proc_stat), patch.object(Path, "lstat", tool_stat), patch.object(guard.time, "monotonic", return_value=0), patch.object(guard, "verify_ipc_socket") as ipc:
                if (tool, command) in positive:
                    self.assertIs(controller.authorize_socket(row, 7, 444, 0.2), True)
                    if tool == "systemctl":
                        ipc.assert_called_once_with(444, 0.2)
                    else:
                        ipc.assert_not_called()
                else:
                    with self.assertRaises(guard.Refused):
                        controller.authorize_socket(row, 7, 444, 0.2)
                    ipc.assert_not_called()
        for policy, known in ((contract(), {200: 300}), (install_contract(), {}), (install_contract(), {200: 999})):
            controller = object.__new__(guard.Controller)
            controller.contract = policy
            controller.owned = SimpleNamespace(controller=100, known=known)
            controller.proc = SimpleNamespace(one_or_gone=Mock())
            with self.subTest(policy=policy["version"], known=known), self.assertRaisesRegex(guard.Refused, "install_socket_owned_identity_required"):
                controller.authorize_socket(row, 7, 444, 0.2)
            controller.proc.one_or_gone.assert_not_called()

    def test_socket_observation_still_denies_by_default_and_needs_exact_true(self):
        # Exercise the actual low-level sampler with only public /proc readback
        # seams replaced. It must keep enumerating FDs; this is not a blanket
        # check_sockets=False exception for installer descendants.
        row = dict(pid=200, parent=100, group=200, session=200, startTicks=300,
                   rssBytes=4096, threads=1, state="S", comm="curl")
        fd = Path("/proc/200/fd/7")
        for authorization in ("absent", False, None, 1, "allowed", True):
            proc = object.__new__(process_guard.LinuxProc)
            proc.one_or_gone = lambda _pid: dict(row)
            proc.bounded = lambda _path, _bound: b"Rss: 4096 kB\n"
            callback = Mock(return_value=authorization)
            args = dict(check_sockets=True, observation_deadline=0.2)
            if authorization != "absent":
                args["socket_authorizer"] = callback
            with self.subTest(authorization=authorization), patch.object(process_guard.time, "monotonic", return_value=0), patch.object(Path, "iterdir", return_value=iter([fd])), patch.object(process_guard.os, "readlink", return_value="socket:[444]"):
                if authorization is True:
                    self.assertEqual(proc.sample_task(row, **args)["rssBytes"], 4096 << 10)
                else:
                    with self.assertRaisesRegex(process_guard.Refused, "owned_socket_present"):
                        proc.sample_task(row, **args)
            if authorization == "absent":
                callback.assert_not_called()
            else:
                callback.assert_called_once_with(row, 7, 444, 0.2)

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
