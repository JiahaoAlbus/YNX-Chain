#!/usr/bin/env python3
"""Pure controls: no Go, subprocess child, network, node or source mutation."""
import base64
import contextlib
import hashlib
import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("wire_live_ci", HERE / "wire-live-matching-source-ci.py")
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class WireLiveSourceControls(unittest.TestCase):
    def run_control(self, stdout, stderr=b"", code=0, timeout=False):
        temporary = tempfile.TemporaryDirectory(prefix="wire-live-pure-")
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name).resolve()
        def simulated_run(argv, **kwargs):
            self.assertEqual(argv, ["go", "test", "-json", "-p", "1"])
            self.assertEqual(kwargs["timeout"], 240)
            self.assertIsNot(kwargs["stdout"], kwargs["stderr"])
            self.assertNotEqual(kwargs["stderr"], subprocess.STDOUT)
            kwargs["stdout"].write(stdout)
            kwargs["stderr"].write(stderr)
            if timeout:
                raise subprocess.TimeoutExpired(argv, 240)
            return subprocess.CompletedProcess(argv, code)
        error, result = None, None
        with patch.object(ci.subprocess, "run", side_effect=simulated_run) as run:
            try:
                result = ci.run_go(output, output, "case", ["-json", "-p", "1"], ["TestOriginal"], {})
            except Exception as caught:
                error = caught
            self.assertEqual(run.call_count, 1)
        self.assertEqual((output / "case.jsonl").read_bytes(), stdout)
        self.assertEqual((output / "case.stderr.log").read_bytes(), stderr)
        record = json.loads((output / "case.result.json").read_bytes())
        for field, raw in (("stdout", stdout), ("stderr", stderr)):
            self.assertEqual(record[field]["bytes"], len(raw))
            self.assertEqual(record[field]["sha256"], hashlib.sha256(raw).hexdigest())
        return result, record, error

    @staticmethod
    def events(action="pass"):
        return (json.dumps(dict(Action="run", Test="TestOriginal")) + "\n" +
                json.dumps(dict(Action=action, Test="TestOriginal")) + "\n").encode()

    def test_cold_cache_stderr_is_preserved_separately(self):
        diagnostics = b"go: downloading example.org/original v1.0.0\nraw-byte:\xff\n"
        result, record, error = self.run_control(self.events(), diagnostics)
        self.assertIsNone(error)
        self.assertTrue(record["validationPassed"])
        self.assertEqual(record["returnCode"], 0)
        self.assertEqual(record["requiredPassed"], ["TestOriginal"])
        self.assertEqual(result["stderr"], record["stderr"])
        self.assertEqual(result["sha256"], record["stdout"]["sha256"])

    def test_non_json_stdout_is_never_filtered_into_pass(self):
        for contaminant in (b"go: downloading example.org/source v1.0.0\n", b"\n", b"[]\n", b"null\n", b"\xff\n"):
            with self.subTest(contaminant=contaminant):
                result, record, error = self.run_control(contaminant + self.events(), b"original diagnostic\n")
                self.assertIsNone(result)
                self.assertIsNotNone(error)
                self.assertFalse(record["validationPassed"])
                self.assertEqual(record["requiredPassed"], [])
                self.assertIsNotNone(record["firstFailure"])

    def test_missing_skipped_failed_duplicate_or_empty_named_results_reject(self):
        variants = [b"", self.events("skip"), self.events("fail"), self.events() + self.events(),
                    b'{"Action":"fail","Action":"pass","Test":"TestOriginal"}\n',
                    b'{"Action":"pass","Test":"TestOther"}\n']
        for stdout in variants:
            with self.subTest(stdout=stdout):
                _, record, error = self.run_control(stdout)
                self.assertIsNotNone(error)
                self.assertFalse(record["validationPassed"])

    def test_nonzero_exit_cannot_be_hidden_by_pass_events(self):
        _, record, error = self.run_control(self.events(), b"actual compiler/test failure\n", code=1)
        self.assertIsNotNone(error)
        self.assertEqual(record["returnCode"], 1)
        self.assertFalse(record["validationPassed"])
        self.assertFalse(record["timedOut"])

    def test_timeout_retains_both_streams_without_inventing_exit(self):
        _, record, error = self.run_control(self.events("run"), b"partial original stderr\n", timeout=True)
        self.assertIsInstance(error, subprocess.TimeoutExpired)
        self.assertIsNone(record["returnCode"])
        self.assertTrue(record["timedOut"])
        self.assertFalse(record["validationPassed"])

    def test_existing_result_is_never_overwritten_or_reexecuted(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            original = output / "case.result.json"
            original.write_bytes(b"original UNKNOWN")
            with patch.object(ci.subprocess, "run") as run:
                with self.assertRaises(FileExistsError):
                    ci.run_go(output, output, "case", [], ["TestOriginal"], {})
                run.assert_not_called()
            self.assertEqual(original.read_bytes(), b"original UNKNOWN")

    def test_supplier_missing_or_wrong_is_explicit_and_never_fetches(self):
        for mode in ("missing-commit", "missing-tree", "wrong-tree", "correct"):
            calls = []
            def original_git(root, *args):
                calls.append(args)
                self.assertNotIn("fetch", args)
                self.assertEqual(args[:2], ("rev-parse", "--verify"))
                if args[-1] == ci.FORK_COMMIT + "^{commit}":
                    if mode == "missing-commit":
                        raise subprocess.CalledProcessError(128, ["git", *args])
                    return (ci.FORK_COMMIT + "\n").encode()
                self.assertEqual(args[-1], ci.FORK_COMMIT + ":third_party/cometbft")
                if mode == "missing-tree":
                    raise subprocess.CalledProcessError(128, ["git", *args])
                return (("a" * 40 if mode == "wrong-tree" else ci.FORK_TREE) + "\n").encode()
            with self.subTest(mode=mode), patch.object(ci, "git", side_effect=original_git):
                if mode == "correct":
                    ci.require_supplier_source(Path("/original"))
                else:
                    with self.assertRaisesRegex(RuntimeError, "unavailable locally|fork tree changed"):
                        ci.require_supplier_source(Path("/original"))
            self.assertLessEqual(len(calls), 2)

    def test_missing_supplier_does_not_create_composition_or_change_shared_api(self):
        self.assertEqual(list(inspect.signature(ci.prepare_wire_live_source).parameters),
                         ["root", "fresh_output", "expected_commit", "expected_tree"])
        self.assertEqual(len(ci.LIVE), 7)
        self.assertEqual(len(ci.BUDGET), 22)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            destination = root / "fresh"
            def original_git(_, *args):
                if args == ("rev-parse", "HEAD"):
                    return b"original\n"
                if args == ("rev-parse", "HEAD^{tree}"):
                    return b"original-tree\n"
                if args[0] == "status":
                    return b""
                if args == ("rev-parse", "HEAD:third_party/cometbft"):
                    return ci.PRODUCTION_TREE.encode()
                raise subprocess.CalledProcessError(128, ["git", *args])
            with patch.object(ci, "git", side_effect=original_git), patch.object(ci, "extract") as extract:
                with self.assertRaisesRegex(RuntimeError, "unavailable locally"):
                    ci.prepare_wire_live_source(root, destination, "original", "original-tree")
                extract.assert_not_called()
            self.assertFalse(destination.exists())

    def test_workflow_fetches_only_fixed_supplier_with_ephemeral_read_credential(self):
        workflow = (HERE.parents[1] / ".github/workflows/chain-core.yml").read_text()
        step = workflow.split("      - name: Acquire only the immutable optional supplier object\n", 1)[1]
        step = step.split("      - name: Verify exact optional live getter composition", 1)[0]
        script = step.split("          python3 -B - <<'PY'\n", 1)[1].rsplit("          PY\n", 1)[0]
        script = "\n".join(line[10:] for line in script.splitlines())
        secret = "synthetic-read-only-test-credential"
        header = base64.b64encode(("x-access-token:" + secret).encode()).decode()
        def simulated_fetch(argv, **kwargs):
            self.assertEqual(argv, ["git", "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--depth=1", "--no-write-fetch-head", "origin", ci.FORK_COMMIT])
            self.assertNotIn(secret, " ".join(argv))
            self.assertNotIn("WIRE_SUPPLIER_READ_TOKEN", kwargs["env"])
            self.assertEqual(kwargs["env"]["GIT_CONFIG_VALUE_0"], "AUTHORIZATION: basic " + header)
            self.assertEqual(kwargs["env"]["GIT_CONFIG_KEY_0"], "http.https://github.com/.extraheader")
            self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
            self.assertEqual(kwargs["timeout"], 60)
            return subprocess.CompletedProcess(argv, 0)
        def read_original(argv, **kwargs):
            if argv[-1] == ci.FORK_COMMIT + "^{commit}": return ci.FORK_COMMIT + "\n"
            if argv[-1] == ci.FORK_COMMIT + ":third_party/cometbft": return ci.FORK_TREE + "\n"
            if argv == ["git", "rev-parse", "HEAD"]: return "original\n"
            self.assertEqual(argv, ["git", "status", "--porcelain"])
            return b""
        output = io.StringIO()
        with patch.dict(os.environ, {"WIRE_SUPPLIER_READ_TOKEN": secret, "GITHUB_SHA": "original"}, clear=True), \
             patch.object(subprocess, "run", side_effect=simulated_fetch) as fetch, \
             patch.object(subprocess, "check_output", side_effect=read_original), contextlib.redirect_stdout(output):
            exec(compile(script, "actual-workflow-fetch", "exec"), {})
        self.assertEqual(fetch.call_count, 1)
        self.assertNotIn(secret, output.getvalue())
        self.assertNotIn(header, output.getvalue())
        self.assertIn(ci.FORK_COMMIT, output.getvalue())
        client_job = workflow.split("  client-observations:\n", 1)[1].split("  commit-observation:\n", 1)[0]
        self.assertIn("persist-credentials: false", client_job)
        self.assertIn("fetch-depth: 1", client_job)
        self.assertIn("timeout-minutes: 8", client_job)
        self.assertIn("contents: read", workflow)
        for name in ("normal-live-caller", "original-peer-budget"):
            for suffix in (".jsonl", ".stderr.log", ".result.json"):
                self.assertIn(name + suffix, client_job)


if __name__ == "__main__":
    unittest.main(verbosity=2)
