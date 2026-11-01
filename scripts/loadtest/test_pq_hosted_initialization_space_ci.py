"""Pure controller/tiny path controls. Never execute sudo/rm/Go/Node/workloads."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("hosted_space", Path(__file__).with_name("pq-hosted-initialization-space-ci.py"))
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
MOUNTS = "1 0 8:1 / / rw,relatime - ext4 /dev/root rw\n"


def environment():
    return dict(GITHUB_ACTIONS="true", RUNNER_ENVIRONMENT="github-hosted",
                RUNNER_OS="Linux", RUNNER_ARCH="X64", ImageOS="ubuntu24",
                GITHUB_REPOSITORY=entry.REPOSITORY, GITHUB_REF=entry.REF,
                GITHUB_RUN_ATTEMPT="1", GITHUB_JOB=entry.PROFILE,
                PQ_BASELINE_PROFILE=entry.PROFILE,
                PQ_HOSTED_SPACE_PREPARATION=entry.AUTHORIZATION,
                GITHUB_WORKFLOW_REF=entry.REPOSITORY + "/" + entry.WORKFLOW + "@" + entry.REF,
                GITHUB_EVENT_NAME="push", GITHUB_SHA="a" * 40,
                GITHUB_WORKFLOW_SHA="a" * 40, GITHUB_RUN_ID="123")


class HostedSpaceIdentityControls(unittest.TestCase):
    def test_default_is_inert_without_files_processes_or_host_claims(self):
        with mock.patch.object(entry, "execute", side_effect=AssertionError("execute")), \
             mock.patch.object(entry, "command", side_effect=AssertionError("command")), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(entry.main([]), 0)
        data = json.loads(output.getvalue())
        self.assertFalse(data["execute"] or data["admissionGranted"] or data["nodeStartAuthorized"] or data["pressureAuthorized"])
        self.assertEqual((data["initialMemoryBytes"], data["initialDiskBytes"]), (6 << 30, 16 << 30))
        self.assertEqual(data["target"], "/usr/local/lib/android")

    def test_exact_first_attempt_host_identity_only(self):
        with mock.patch.object(entry.sys, "platform", "linux"), \
             mock.patch.object(entry.platform, "machine", return_value="x86_64"), \
             mock.patch.object(entry.os, "geteuid", return_value=1001):
            entry.validate_host(environment())
            entry.validate_host(dict(environment(), GITHUB_EVENT_NAME="workflow_dispatch"))
            mutations = {"RUNNER_ENVIRONMENT": "self-hosted", "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64",
                         "ImageOS": "ubuntu22", "GITHUB_ACTIONS": "false", "GITHUB_REPOSITORY": "attacker/YNX-Chain",
                         "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "functional",
                         "PQ_BASELINE_PROFILE": "online-100x5", "PQ_HOSTED_SPACE_PREPARATION": "true",
                         "GITHUB_WORKFLOW_REF": "other", "GITHUB_EVENT_NAME": "pull_request",
                         "GITHUB_SHA": "0" * 40, "GITHUB_WORKFLOW_SHA": "b" * 40, "GITHUB_RUN_ID": "0"}
            for name, value in mutations.items():
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    entry.validate_host(dict(environment(), **{name: value}))
            for name in environment():
                without = environment()
                without.pop(name)
                with self.subTest(missing=name), self.assertRaises(RuntimeError):
                    entry.validate_host(without)

    def test_actual_nonlinux_or_root_is_rejected_before_layout_or_mutation(self):
        for system, machine, uid in (("darwin", "arm64", 501), ("linux", "aarch64", 1001), ("linux", "x86_64", 0)):
            with self.subTest(system=system, uid=uid), mock.patch.object(entry.sys, "platform", system), \
                 mock.patch.object(entry.platform, "machine", return_value=machine), \
                 mock.patch.object(entry.os, "geteuid", return_value=uid), \
                 mock.patch.object(entry, "checked_layout") as layout, self.assertRaises(RuntimeError):
                entry.execute(environment())
            layout.assert_not_called()

    def test_no_paths_caps_profile_or_repeated_flag_override(self):
        for argv in (["--target", "/"], ["--profile", entry.PROFILE], ["--disk-floor", "0"],
                     ["--output", "/tmp/x"], ["--execute", "--execute"], ["--exec"]):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), \
                 mock.patch.object(entry, "execute") as execute, self.assertRaises((SystemExit, RuntimeError)):
                entry.main(argv)
            execute.assert_not_called()


class HostedSpacePathControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.target = self.root / "usr/local/lib/android"
        self.target.mkdir(parents=True)
        for path in (self.target, *list(self.target.parents)[:3]):
            path.chmod(0o755)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.cache = self.root / "cache"
        self.cache.mkdir()
        self.context = SimpleNamespace(parent=self.root, workspace=self.workspace)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(mock.patch.object(entry, "TARGET", self.target))
        self.stack.enter_context(mock.patch.object(entry, "SECURE_ANCESTOR", self.root / "usr"))
        self.stack.enter_context(mock.patch.object(entry, "PATH_OWNER_UID", os.getuid()))
        self.mounts = entry.parse_mounts(MOUNTS)

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def check(self, protected=None, mounts=None):
        return entry.target_guard(self.context, mounts or self.mounts,
                                  protected if protected is not None else [self.workspace, self.cache])

    def test_real_tiny_physical_directory_and_absent_target(self):
        value = self.check()
        self.assertEqual(value["inode"], self.target.stat().st_ino)
        self.target.rmdir()
        self.assertIsNone(self.check())

    def test_target_symlink_and_dangling_symlink_refused(self):
        self.target.rmdir()
        for destination in (self.workspace, self.root / "missing"):
            self.target.symlink_to(destination, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                self.check()
            self.target.unlink()

    def test_parent_symlink_alias_refused(self):
        parent = self.target.parent
        other = parent.with_name("real-lib")
        parent.rename(other)
        parent.symlink_to(other, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.check()

    def test_file_writable_directory_and_wrong_owner_refused(self):
        self.target.rmdir()
        self.target.write_bytes(b"PUBLIC")
        with self.assertRaises(RuntimeError):
            self.check()
        self.target.unlink()
        self.target.mkdir()
        self.target.chmod(0o777)
        with self.assertRaises(RuntimeError):
            self.check()
        self.target.chmod(0o755)
        with mock.patch.object(entry, "PATH_OWNER_UID", os.getuid() + 1), self.assertRaises(RuntimeError):
            self.check()

    def test_workspace_home_cache_and_evidence_overlap_in_both_directions(self):
        for protected in (self.target, self.target / "work", self.target.parent, self.target / "go-cache"):
            with self.subTest(protected=protected), self.assertRaises(RuntimeError):
                self.check([protected])

    def test_child_mount_parent_mount_and_bind_source_alias_refused(self):
        for point, root in ((self.target, "/"), (self.target / "sdk", "/"),
                            (self.target.parent, "/"), (self.root / "elsewhere", self.target),
                            (self.root / "elsewhere", self.target / "sdk")):
            mounts = self.mounts + [dict(point=str(point), root=str(root), device="8:1")]
            with self.subTest(point=point, root=root), self.assertRaises(RuntimeError):
                self.check(mounts=mounts)

    def test_internal_symbolic_link_is_not_followed_by_target_guard(self):
        # rm's fixed no-follow recursive semantics unlink this child, not its
        # external target. No rm is executed in this tiny metadata-only test.
        secret_standin = self.root / "preserve.txt"
        secret_standin.write_bytes(b"PUBLIC-standin")
        (self.target / "link").symlink_to(secret_standin)
        self.check()
        self.assertEqual(secret_standin.read_bytes(), b"PUBLIC-standin")

    def test_mountinfo_escaped_paths_and_malformed_rejection(self):
        parsed = entry.parse_mounts(MOUNTS + "2 1 8:1 /data\\040set /mnt/data\\040set rw - ext4 /dev/root rw\n")
        self.assertEqual(parsed[1]["point"], "/mnt/data set")
        for raw in ("", "bad", MOUNTS.replace("/ /", "/relative relative"),
                    MOUNTS.replace("/ /", "/ /bad\\041"), "x" * ((256 << 10) + 1)):
            with self.subTest(raw=raw[:30]), self.assertRaises(RuntimeError):
                entry.parse_mounts(raw)

    def test_private_remove_primitive_rejects_any_nonfixed_target(self):
        with mock.patch.object(entry.subprocess, "Popen") as popen, self.assertRaises(RuntimeError):
            entry.remove_fixed_target({})
        popen.assert_not_called()

    def test_capture_records_df_mount_memory_directory_size_and_tools(self):
        original = Path.read_text
        def read(path, *args, **kwargs):
            if str(path) == "/proc/self/mountinfo":
                return MOUNTS
            if str(path) == "/proc/meminfo":
                return "MemAvailable:    6291456 kB\n"
            return original(path, *args, **kwargs)
        def command(argv, **kwargs):
            if argv[0] == "/usr/bin/du":
                self.assertEqual(argv, ["/usr/bin/du", "-s", "-x", "-B1", "--", str(self.target)])
                return "4096\t" + str(self.target)
            self.assertEqual(argv[0], "/usr/bin/df")
            return "PUBLIC exact df fixture"
        self.context.protected = [self.workspace, self.cache]
        tools = {key: {"executable": "/tools/" + key, "version": "public version"}
                 for key in ("go", "python3", "node", "cc", "openssl")}
        into = {}
        with mock.patch.object(Path, "read_text", read), \
             mock.patch.object(entry, "command", side_effect=command), \
             mock.patch.object(entry, "tools_snapshot", return_value=(tools, {"GOROOT": "/tools"}, [])), \
             mock.patch.object(entry.os, "statvfs", return_value=SimpleNamespace(f_bavail=32, f_bfree=99, f_frsize=512)):
            entry.capture(self.context, into)
        self.assertEqual(into["diskAvailableBytes"], 16384)
        self.assertEqual(into["memoryAvailableBytes"], 6 << 30)
        self.assertEqual(into["targetAllocatedBytes"], 4096)
        self.assertEqual(into["tools"], tools)
        self.assertEqual(into["mountinfo"], MOUNTS)
        self.assertTrue(into["complete"])


class HostedSpaceFlowControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.target = self.root / "android"
        self.target.mkdir()
        self.context = SimpleNamespace(output=self.root / "evidence", parent=self.root, workspace=self.root,
                                       protected=[self.root / "protected"])
        info = self.target.stat()
        self.identity = dict(device=info.st_dev, inode=info.st_ino, ctimeNS=info.st_ctime_ns, mode=0o755, uid=info.st_uid)
        self.before_disk, self.after_disk = (16 << 30) - 1, 20 << 30
        self.before_memory = self.after_memory = 7 << 30
        self.before_exists, self.after_exists = True, False
        self.capture_count = 0
        self.change_tool = False
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(mock.patch.object(entry, "validate_host"))
        self.stack.enter_context(mock.patch.object(entry, "checked_layout", return_value=self.context))
        self.stack.enter_context(mock.patch.object(entry, "TARGET", self.target))
        self.stack.enter_context(mock.patch.object(entry, "capture", side_effect=self.capture))
        self.guard = self.stack.enter_context(mock.patch.object(entry, "target_guard", return_value=self.identity))
        self.remove = self.stack.enter_context(mock.patch.object(entry, "remove_fixed_target", side_effect=self.removed))
        original = Path.read_text
        self.stack.enter_context(mock.patch.object(Path, "read_text", lambda p, *a, **kw: MOUNTS if str(p) == "/proc/self/mountinfo" else original(p, *a, **kw)))

    def tearDown(self):
        self.stack.close()
        self.temp.cleanup()

    def capture(self, context, into):
        first = self.capture_count == 0
        self.capture_count += 1
        into.update(complete=True, diskAvailableBytes=self.before_disk if first else self.after_disk,
                    memoryAvailableBytes=self.before_memory if first else self.after_memory,
                    targetExists=self.before_exists if first else self.after_exists,
                    targetIdentity=self.identity if first and self.before_exists else None,
                    targetAllocatedBytes=12 << 30 if first and self.before_exists else 0,
                    df="synthetic df only", mountinfo=MOUNTS, meminfo="synthetic meminfo only",
                    tools={"go": "changed" if self.change_tool and not first else "same-actual-version-fixture"},
                    goPaths={"GOROOT": "/opt/public-fixture"})
        return entry.parse_mounts(MOUNTS), context.protected

    def removed(self, record):
        self.assertTrue((self.context.output / "BEFORE.json").is_file())
        self.assertTrue((self.context.output / "INTENT.json").is_file())
        intent = json.loads((self.context.output / "INTENT.json").read_bytes())
        self.assertFalse(intent["automaticRetryAllowed"])
        record.update(returncode=0, simulated=True)

    def run_entry(self):
        with contextlib.redirect_stdout(io.StringIO()):
            status = entry.execute(environment())
        return status, json.loads((self.context.output / "RESULT.json").read_bytes())

    def test_simulated_insufficient_disk_prepares_once_then_never_grants_admission(self):
        code, result = self.run_entry()
        self.assertEqual(code, 0)
        self.remove.assert_called_once()
        self.assertEqual(result["status"], "PREPARATION_COMPLETE_NOT_ADMISSION")
        self.assertFalse(result["admissionGranted"] or result["nodeStartAuthorized"] or result["pressureAuthorized"])
        self.assertTrue(result["originalDriverMustReadmit"])
        self.assertEqual(result["parentReportedPriorFailure"]["runID"], "41332298089")
        originals = {p.name: p.read_bytes() for p in self.context.output.iterdir()}
        with self.assertRaises(FileExistsError):
            self.run_entry()
        self.assertEqual(originals, {p.name: p.read_bytes() for p in self.context.output.iterdir()})
        self.assertEqual(self.remove.call_count, 1)

    def test_disk_already_sufficient_never_deletes(self):
        self.before_disk = 16 << 30
        self.before_exists = self.after_exists = True
        code, result = self.run_entry()
        self.assertEqual(code, 0)
        self.remove.assert_not_called()
        self.assertFalse((self.context.output / "INTENT.json").exists())
        self.assertEqual(result["notRemovedReason"], "disk floor already available")

    def test_low_memory_never_deletes_to_pretend_capacity(self):
        self.before_memory = self.after_memory = (6 << 30) - 1
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (0, "NO_CAPACITY"))
        self.remove.assert_not_called()
        self.assertFalse(result["admissionGranted"])

    def test_absent_android_does_not_search_for_another_cleanup_target(self):
        self.before_exists = False
        self.after_disk = self.before_disk
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (0, "NO_CAPACITY"))
        self.remove.assert_not_called()

    def test_actual_after_disk_and_memory_floors_are_not_lowered(self):
        self.after_disk = (16 << 30) - 1
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (0, "NO_CAPACITY"))
        self.remove.assert_called_once()
        self.assertEqual(result["initialDiskBytes"], 17179869184)
        self.assertEqual(result["initialMemoryBytes"], 6442450944)

    def test_changed_held_identity_refuses_before_removal(self):
        self.identity["inode"] += 1
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (1, "REFUSED"))
        self.remove.assert_not_called()

    def test_changed_mount_or_target_before_mutation_refuses(self):
        self.guard.side_effect = RuntimeError("new bind mount")
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (1, "REFUSED"))
        self.remove.assert_not_called()
        self.assertTrue((self.context.output / "INTENT.json").exists())

    def test_removal_failure_preserves_before_intent_after_and_unknown_first_cause(self):
        def failed(record):
            self.removed(record)
            record["returncode"] = 124
            raise RuntimeError("original removal timeout")
        self.remove.side_effect = failed
        self.after_exists = True
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (1, "UNKNOWN_REMOVAL"))
        self.assertEqual(result["firstCause"], "original removal timeout")
        self.assertTrue(json.loads((self.context.output / "AFTER.json").read_bytes())["complete"])
        self.assertEqual(self.remove.call_count, 1)

    def test_after_observation_failure_does_not_replace_removal_first_cause(self):
        self.remove.side_effect = RuntimeError("first removal failure")
        count = 0
        normal = self.capture
        def capture(context, into):
            nonlocal count
            count += 1
            if count > 1:
                raise RuntimeError("secondary after failure")
            return normal(context, into)
        with mock.patch.object(entry, "capture", side_effect=capture):
            code, result = self.run_entry()
        self.assertEqual(code, 1)
        self.assertEqual(result["firstCause"], "first removal failure")
        self.assertEqual(json.loads((self.context.output / "AFTER.json").read_bytes())["captureError"], "secondary after failure")

    def test_changed_toolchain_or_remaining_target_is_not_success(self):
        self.change_tool = True
        code, result = self.run_entry()
        self.assertEqual((code, result["status"]), (1, "UNKNOWN_REMOVAL"))
        self.assertIn("tool/version/path changed", result["firstCause"])


class HostedSpacePrimitiveControls(unittest.TestCase):
    def test_controller_and_source_tools_exact_clean_identity_before_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            workspace = root / "work"
            for name in ("controller", "source", "tools"):
                (workspace / name).mkdir(parents=True)
            helper = workspace / "controller" / entry.SCRIPT
            helper.parent.mkdir(parents=True)
            helper.write_bytes(b"PUBLIC original helper")
            for name in ("temp", "home", "toolcache"):
                (root / name).mkdir()
            env = dict(environment(), GITHUB_WORKSPACE=str(workspace), RUNNER_TEMP=str(root / "temp"),
                       HOME=str(root / "home"), RUNNER_TOOL_CACHE=str(root / "toolcache"))
            wrong, dirty = [False], [False]
            def command(argv, **kwargs):
                checkout = Path(argv[argv.index("-C") + 1]).name
                if "status" in argv:
                    return " M original.go" if dirty[0] else ""
                if wrong[0]:
                    return "b" * 40
                return {"controller": env["GITHUB_SHA"], "source": entry.GO_SOURCE, "tools": entry.TOOLS_SOURCE}[checkout]
            original_read = Path.read_text
            original_exists = Path.exists
            def read(path, *args, **kwargs):
                return 'ID=ubuntu\nVERSION_ID="24.04"\n' if str(path) == "/etc/os-release" else original_read(path, *args, **kwargs)
            with mock.patch.object(entry, "__file__", str(helper)), \
                 mock.patch.object(entry, "command", side_effect=command), \
                 mock.patch.object(entry.subprocess, "check_output", return_value=helper.read_bytes()), \
                 mock.patch.object(Path, "read_text", read), \
                 mock.patch.object(Path, "exists", lambda p: False if str(p) == "/.dockerenv" else original_exists(p)):
                context = entry.checked_layout(env)
                self.assertFalse(context.output.exists())
                wrong[0] = True
                with self.assertRaises(RuntimeError):
                    entry.checked_layout(env)
                wrong[0], dirty[0] = False, True
                with self.assertRaises(RuntimeError):
                    entry.checked_layout(env)
                dirty[0] = False
                context.output.mkdir()
                (context.output / "UNKNOWN.json").write_bytes(b"PUBLIC-original")
                with self.assertRaises(RuntimeError):
                    entry.checked_layout(env)
                self.assertEqual((context.output / "UNKNOWN.json").read_bytes(), b"PUBLIC-original")

    def test_diagnostic_calls_do_not_refresh_git_index_or_auto_download_toolchains(self):
        with mock.patch.object(entry.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"public", stderr=b"")) as run:
            self.assertEqual(entry.command(["/usr/bin/git", "status"]), "public")
        env = run.call_args.kwargs["env"]
        self.assertEqual((env["GIT_OPTIONAL_LOCKS"], env["GOTOOLCHAIN"], env["GOTELEMETRY"]), ("0", "local", "off"))
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_exact_remove_argv_and_failure_have_no_shell_retry_or_other_target(self):
        child = mock.Mock(pid=2468, returncode=124)
        child.communicate.return_value = (None, b"synthetic timeout")
        record = {}
        with mock.patch.object(entry, "validate_host") as gate, \
             mock.patch.object(entry.subprocess, "Popen", return_value=child) as popen, self.assertRaises(RuntimeError):
            entry.remove_fixed_target(record)
        gate.assert_called_once_with(entry.os.environ)
        self.assertEqual(popen.call_count, 1)
        args, kwargs = popen.call_args
        self.assertEqual(args[0], entry.REMOVE_ARGV)
        self.assertEqual(args[0][-2:], ("--", "/usr/local/lib/android"))
        self.assertIn("--one-file-system", args[0])
        self.assertIn("--preserve-root=all", args[0])
        self.assertNotIn("shell", kwargs)
        self.assertNotIn("start_new_session", kwargs)
        self.assertEqual(record["returncode"], 124)
        self.assertEqual(record["pid"], 2468)

    def test_private_primitive_rechecks_actual_host_before_sudo(self):
        with mock.patch.object(entry.sys, "platform", "darwin"), \
             mock.patch.object(entry.subprocess, "Popen") as popen, self.assertRaises(RuntimeError):
            entry.remove_fixed_target({})
        popen.assert_not_called()

    def test_evidence_exclusive_bound_fsync_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            entry.write_new(root, "before.json", {"public": True})
            raw = (root / "before.json").read_bytes()
            with self.assertRaises(FileExistsError):
                entry.write_new(root, "before.json", {"public": False})
            self.assertEqual((root / "before.json").read_bytes(), raw)
            (root / "alias.json").symlink_to(root / "before.json")
            with self.assertRaises(OSError):
                entry.write_new(root, "alias.json", {"public": False})
            with self.assertRaises(RuntimeError):
                entry.write_new(root, "large.json", {"data": "x" * entry.MAX_PUBLIC_FILE})
            self.assertFalse((root / "large.json").exists())


if __name__ == "__main__":
    unittest.main()
