"""Only fixed CI/source-DATA/storage-root wiring; no Go, keys or node start."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

path = Path(__file__).with_name("pq-current75-baseline-ci.py")
spec = importlib.util.spec_from_file_location("current75_ci_controls", path)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class FixedCurrent75Controls(unittest.TestCase):
    def qualification(self):
        run = dict(id=int(entry.NORMAL_RUN), workflow_id=123, run_attempt=1, head_sha=entry.GO_SOURCE)
        names = ("focused-go", "protocol-delivery", "proof-verifier-macos")
        prefix = "/repos/JiahaoAlbus/YNX-Chain/actions/"
        root = prefix + "runs/" + entry.NORMAL_RUN
        rows = [dict(id=i+1, name=name, head_sha=entry.GO_SOURCE, run_id=run["id"], run_attempt=1,
                     run_url="https://api.github.com" + root, status="completed", conclusion="success")
                for i, name in enumerate(names)]
        responses = {root: run, prefix + "workflows/resource-market-ci.yml":
                     dict(id=123, path=".github/workflows/resource-market-ci.yml"),
                     root + "/attempts/1/jobs?per_page=100&page=1": dict(total_count=3, jobs=rows)}
        # This is a seam for the reused immutable validator, not an alternate
        # current-dispatch authority. These tests never read the GitHub API.
        def validate(value, candidate, run_id):
            self.assertEqual((candidate, run_id), (entry.GO_SOURCE, entry.NORMAL_RUN))
            return (value["id"], value["run_attempt"])
        lib = types.SimpleNamespace(REPOSITORY="JiahaoAlbus/YNX-Chain", API="https://api.github.com",
                                    WORKFLOW_PATH=".github/workflows/resource-market-ci.yml",
                                    MAX_JOB_PAGES=3, REQUIRED_JOBS=names,
                                    validate_run=mock.Mock(side_effect=validate))
        return lib, responses, root

    def test_default_has_no_reads_api_process_or_execution(self):
        with mock.patch.object(entry, "execute", side_effect=AssertionError("execute")), \
             mock.patch.object(entry, "git", side_effect=AssertionError("git")), \
             mock.patch.object(entry, "pinned_module", side_effect=AssertionError("source import")), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(entry.main([]), 0)
        result = json.loads(output.getvalue())
        self.assertEqual((result["configuredDemand"], result["offeredTPS"], result["seconds"]), (500, 100, 5))
        self.assertFalse(result["executed"] or result["nodeStartAuthorized"] or result["untouchedFdcBefore"])

    def test_fixed_options_keep_all_500_and_one_independent_account_capacity(self):
        options = entry.fixed_options(Path("/owned/source"))
        self.assertEqual((options.commit, options.mode, options.rate, options.seconds),
                         ("7593d691bafa6e7e5bb40511464aed27a41b416d", "online", 100, 5))
        self.assertEqual((options.accounts, options.per_account, options.tail_seconds, options.proof_timeout), (16, 32, 30, 30))
        self.assertEqual(options.rate * options.seconds, 500)
        self.assertGreaterEqual(options.accounts * options.per_account, 500)
        self.assertEqual((options.accounts + 4) * options.per_account, 640)
        self.assertFalse(options.wire_observation or options.network_accounting)
        self.assertEqual(entry.CAPS, dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4294967296,
                                        newBytes=8589934592, initialMemoryBytes=6442450944,
                                        initialDiskBytes=17179869184, logBytes=4194304, cpus=2))

    def test_prior_successful_source_is_data_not_a_current_remote_grant(self):
        lib, responses, root = self.qualification()
        result = entry.prior_source_data(lib, lambda path: copy.deepcopy(responses[path]))
        self.assertEqual(result["normalRunId"], "41228262522")
        self.assertEqual(result["sourceCommit"], entry.GO_SOURCE)
        self.assertTrue(result["previousSourceQualificationOnly"])
        self.assertFalse(result["nodeStartAuthorized"] or result["currentControllerRemoteGatePassed"] or result["authorityGranted"])
        self.assertEqual(lib.validate_run.call_count, 2)
        lib.validate_run.side_effect = RuntimeError("original source validator refused")
        with self.assertRaisesRegex(RuntimeError, "original source validator refused"):
            entry.prior_source_data(lib, lambda path: copy.deepcopy(responses[path]))

    def test_qualification_requires_same_head_attempt_closed_jobs_and_original_terminal(self):
        lib, responses, root = self.qualification()
        key = root + "/attempts/1/jobs?per_page=100&page=1"
        for field, value in (("head_sha", "f"*40), ("run_attempt", 2), ("conclusion", "cancelled"),
                             ("status", "in_progress"), ("id", False), ("run_url", "https://foreign/run")):
            bad = copy.deepcopy(responses); bad[key]["jobs"][0][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                entry.prior_source_data(lib, lambda path: bad[path])
        for rows in (responses[key]["jobs"][:-1], responses[key]["jobs"] + [responses[key]["jobs"][0]]):
            bad = copy.deepcopy(responses); bad[key]["jobs"] = rows; bad[key]["total_count"] = len(rows)
            with self.assertRaises(RuntimeError): entry.prior_source_data(lib, lambda path: bad[path])

    def test_only_fixed_first_attempt_ref_profile_and_workflow_may_execute(self):
        fixed_ref = "refs/heads/codex/ynx-pq-current75-baseline-20261101"
        self.assertEqual(entry.REF, fixed_ref)
        environment = dict(GITHUB_ACTIONS="true", RUNNER_ENVIRONMENT="github-hosted",
                           GITHUB_REPOSITORY="JiahaoAlbus/YNX-Chain", GITHUB_EVENT_NAME="push",
                           GITHUB_REF=fixed_ref, GITHUB_RUN_ATTEMPT="1", PQ_BASELINE_PROFILE=entry.PROFILE,
                           GITHUB_WORKFLOW_REF="JiahaoAlbus/YNX-Chain/" + entry.WORKFLOW + "@" + fixed_ref,
                           GITHUB_SHA="a"*40, GITHUB_RUN_ID="123")
        with mock.patch.object(entry.sys, "platform", "linux"):
            for event in ("push", "workflow_dispatch"):
                with self.subTest(allowed_event=event):
                    entry.validate_host(dict(environment, GITHUB_EVENT_NAME=event))
            for key, value in (("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_EVENT_NAME", "schedule"),
                               ("GITHUB_EVENT_NAME", "workflow_call"), ("GITHUB_REF", "refs/heads/main"),
                               ("GITHUB_REF", "refs/heads/codex/ynx-pq-normal-process-20261031"),
                               ("GITHUB_RUN_ATTEMPT", "2"), ("PQ_BASELINE_PROFILE", "optimized"),
                               ("PQ_BASELINE_PROFILE", "functional"),
                               ("GITHUB_WORKFLOW_REF", "other-workflow"), ("GITHUB_SHA", "0"*40)):
                with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                    entry.validate_host(dict(environment, **{key: value}))
        workflow = path.parents[2]/".github/workflows/pq-normal-process.yml"
        text = workflow.read_text()
        self.assertIn("      - codex/ynx-pq-normal-process-20261031\n"
                      "      - codex/ynx-pq-current75-baseline-20261101\n", text)
        self.assertIn("    if: github.ref != '" + fixed_ref + "' && "
                      "(github.event_name != 'workflow_dispatch' || inputs.load_profile != '" + entry.PROFILE + "')", text)
        self.assertIn("    if: github.ref == '" + fixed_ref + "' && github.run_attempt == 1 && "
                      "(github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && "
                      "inputs.load_profile == '" + entry.PROFILE + "'))", text)

    def test_only_one_original_window_adds_all_roots_and_preserves_its_methods(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root/"source"; work = root/"work"; extra = root/"workspace"
            for path in (source, work, extra): path.mkdir()
            original = mock.Mock(return_value=types.SimpleNamespace(storage_roots=[work, source, extra]))
            writes = mock.Mock()
            driver = types.SimpleNamespace(lab=types.SimpleNamespace(Window=original, write_new=writes))
            # Retain exact caller roots; the immutable source75 helper itself
            # owns canonical overlap reduction, not this mock fixture.
            dedup = mock.Mock(side_effect=lambda roots: list(roots))
            intake = types.SimpleNamespace(nonoverlapping_roots=dedup)
            old, calls = entry.install_counted_window(driver, intake, (extra,), dict(controllerSourceSHA256="a"*64))
            result = driver.lab.Window(source, work, additional_storage=(source,))
            self.assertIs(old, original); self.assertEqual(len(calls), 1)
            original.assert_called_once_with(source, work, additional_storage=(source, extra))
            self.assertEqual(dedup.call_count, 2)
            self.assertEqual(writes.call_args.args[1]["additionalRoots"], [str(extra)])
            self.assertTrue(writes.call_args.args[1]["onlyStorageRootAdapter"])
            self.assertIs(result, calls[0])
            with self.assertRaises(RuntimeError): driver.lab.Window(source, work)
            failing = types.SimpleNamespace(nonoverlapping_roots=mock.Mock(side_effect=FileNotFoundError("missing root")))
            other = types.SimpleNamespace(lab=types.SimpleNamespace(Window=original, write_new=writes))
            entry.install_counted_window(other, failing, (extra,), {})
            with self.assertRaises(FileNotFoundError): other.lab.Window(source, work)
            self.assertEqual(original.call_count, 1)

    def test_modified_pinned_code_never_executes_and_partial_cannot_qualify(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/"source.py"; path.write_text("raise AssertionError('should not execute')\n")
            with self.assertRaisesRegex(RuntimeError, "source bytes changed"):
                entry.pinned_module("untrusted", path, "0"*64)
        result = dict(firstCause=None, cleanupComplete=True, loadExecuted=True, normalLiveCalleeUsed=True,
                      configuredDemand=500, requestedOfferedTPS=100,
                      loadResult=dict(windowCompleted=True, configuredDemand=500, notQualified=0))
        entry.require_complete(result)
        for key, value in (("firstCause", "original refusal"), ("cleanupComplete", False),
                           ("configuredDemand", 499), ("normalLiveCalleeUsed", False)):
            with self.assertRaises(RuntimeError): entry.require_complete(dict(result, **{key: value}))
        for key, value in (("configuredDemand", 499), ("notQualified", 1), ("windowCompleted", False)):
            bad = copy.deepcopy(result); bad["loadResult"][key] = value
            with self.assertRaises(RuntimeError): entry.require_complete(bad)

    def test_execute_writes_private_exclusive_source_data_before_loading_driver(self):
        class StopBeforeDriver(RuntimeError):
            pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); workspace = root / "workspace"; runner_temp = root / "runner-temp"
            controller = workspace / "controller"; source = workspace / "source"; tools = workspace / "tools"
            script = controller / "scripts/loadtest/pq-current75-baseline-ci.py"
            script.parent.mkdir(parents=True)
            for directory in (source, tools, runner_temp): directory.mkdir(parents=True)
            script.write_text("# control only\n")
            environment = dict(GITHUB_ACTIONS="true", RUNNER_ENVIRONMENT="github-hosted",
                               GITHUB_REPOSITORY="JiahaoAlbus/YNX-Chain", GITHUB_EVENT_NAME="push",
                               GITHUB_REF=entry.REF, GITHUB_RUN_ATTEMPT="1", PQ_BASELINE_PROFILE=entry.PROFILE,
                               GITHUB_WORKFLOW_REF="JiahaoAlbus/YNX-Chain/" + entry.WORKFLOW + "@" + entry.REF,
                               GITHUB_SHA="a"*40, GITHUB_RUN_ID="123", GITHUB_WORKSPACE=str(workspace),
                               RUNNER_TEMP=str(runner_temp), GH_TOKEN="read-only-control-token")
            data = dict(classification="data", sourceCommit=entry.GO_SOURCE)
            lib = types.SimpleNamespace(github_fetcher=mock.Mock(return_value=object()))
            def git(root, *arguments):
                return "" if arguments[0] == "status" else (entry.FORK_TREE if "HEAD:third_party/cometbft" in arguments else "a"*40)
            with mock.patch.dict(entry.os.environ, environment, clear=True), \
                 mock.patch.object(entry.sys, "platform", "linux"), mock.patch.object(entry, "__file__", str(script)), \
                 mock.patch.object(entry, "git", side_effect=git), mock.patch.object(entry, "checked_source"), \
                 mock.patch.object(entry, "pinned_bytes"), mock.patch.object(entry, "prior_source_data", return_value=data), \
                 mock.patch.object(entry, "pinned_module", side_effect=[lib, StopBeforeDriver("no Go or signing"), lib]) as modules:
                with self.assertRaisesRegex(StopBeforeDriver, "no Go or signing"):
                    entry.execute(source, tools)
                destination = runner_temp / "pq-current75-source-qualification-123-1.json"
                self.assertEqual(json.loads(destination.read_bytes()), data)
                self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
                before = destination.read_bytes()
                self.assertNotIn("GH_TOKEN", entry.os.environ)
                self.assertEqual(modules.call_count, 2)
                # The same original result may never be truncated or overwritten.
                with self.assertRaisesRegex(RuntimeError, "fresh and exclusive"):
                    entry.execute(source, tools)
                self.assertEqual(destination.read_bytes(), before)
                self.assertEqual(modules.call_count, 3)

    def test_cli_never_accepts_rate_capacity_or_alternate_signing_overrides(self):
        for args in (["--rate", "500"], ["--mode", "pre-signed"], ["--accounts", "99"],
                     ["--source", "a", "--source", "b"]):
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises((RuntimeError, SystemExit)): entry.main(args)


if __name__ == "__main__":
    unittest.main()
