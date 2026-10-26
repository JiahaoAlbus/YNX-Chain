"""Pure synthetic GitHub metadata/transport controls; no live API or runtime.

These fixtures exercise the production validator and mocked opener only. They
neither execute a node nor prove that any real GitHub run has completed.
"""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import re
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    "normal_ci_gate", Path(__file__).with_name("validate-pq-remote-normal-ci.py"))
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)

SHA = "a" * 40
PRIOR, CURRENT, ATTEMPT = "39160050001", "39160050002", 2
RUN_PATH = "/repos/" + gate.REPOSITORY + "/actions/runs/" + PRIOR
CURRENT_PATH = "/repos/" + gate.REPOSITORY + "/actions/runs/" + CURRENT
WORKFLOW = "/repos/" + gate.REPOSITORY + "/actions/workflows/" + gate.WORKFLOW_FILE
JOBS = RUN_PATH + "/attempts/2/jobs?per_page=100&page=1"
ARTIFACTS = RUN_PATH + "/artifacts?per_page=100&page=1"


def run_metadata():
    repository = dict(id=42, full_name=gate.REPOSITORY, fork=False)
    return dict(id=int(PRIOR), head_sha=SHA, event="push",
                head_branch="codex/ynx-pq-perf-integration", status="completed",
                conclusion="success", path=gate.WORKFLOW_PATH, workflow_id=73,
                run_attempt=ATTEMPT, repository=repository,
                head_repository=copy.deepcopy(repository))


def job_metadata(name, identifier):
    return dict(id=identifier, name=name, run_id=int(PRIOR), run_attempt=ATTEMPT,
                head_sha=SHA, run_url=gate.API + RUN_PATH,
                status="completed", conclusion="success")


def api_fixture():
    current = run_metadata()
    current.update(id=int(CURRENT), event="workflow_dispatch", status="in_progress", conclusion=None,
                   run_started_at="2026-10-19T02:03:04Z")
    return {RUN_PATH: run_metadata(), WORKFLOW: dict(id=73, path=gate.WORKFLOW_PATH),
            CURRENT_PATH: current,
            JOBS: dict(total_count=4, jobs=[job_metadata("focused-go", 100),
                                         job_metadata("proof-verifier-macos", 101), job_metadata("protocol-delivery", 103),
                                         dict(id=102, name="verify", status="completed", conclusion="skipped")])}


def fresh_api_fixture():
    fixture = api_fixture()
    fixture[ARTIFACTS] = dict(total_count=1, artifacts=[dict(id=700,
        name="ynx-pq-fresh-paired-business-build-" + SHA + "-" + PRIOR + "-2",
        expired=False, size_in_bytes=81040562, digest="sha256:" + "d" * 64,
        workflow_run=dict(id=int(PRIOR), head_sha=SHA, head_branch=fixture[RUN_PATH]["head_branch"],
                          repository_id=42, head_repository_id=42))])
    return fixture


class NormalCIMetadataControls(unittest.TestCase):
    def validate(self, fixture=None, **inputs):
        fixture = api_fixture() if fixture is None else fixture
        calls = []

        def fetch(path):
            calls.append(path)
            if path not in fixture:
                self.fail("validator requested an unexpected endpoint")
            return copy.deepcopy(fixture[path])

        options = {} if "context" not in inputs else dict(context=inputs["context"])
        result = gate.validate_normal_ci(inputs.get("repo", gate.REPOSITORY),
                                         inputs.get("candidate", SHA),
                                         inputs.get("normal", PRIOR), inputs.get("current", CURRENT), fetch, **options)
        return result, calls

    def test_fresh_explicit_closed_context_reuses_exact_success_and_original_artifact_only(self):
        fixture = fresh_api_fixture()
        result, calls = self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        self.assertEqual(calls, [RUN_PATH, WORKFLOW, CURRENT_PATH, JOBS, ARTIFACTS, RUN_PATH, CURRENT_PATH])
        self.assertEqual(result["version"], "YNX-PQ-FRESH-NORMAL-CI/v1")
        self.assertEqual(result["context"], dict(profile="consensus-fresh-paired-business-v1",
            performanceClientCommit="70e7e450997a0ae77dbad5a8be3682f482c6ddd8", performanceClientTree="4866cc3924c060eb6a29939915d39b1c5c625607"))
        self.assertEqual(result["artifact"], dict(artifactId="700", name=fixture[ARTIFACTS]["artifacts"][0]["name"], archiveBytes=81040562, archiveSHA256="d" * 64))
        self.assertEqual(result["currentRunStartedAt"], "2026-10-19T02:03:04Z")
        self.assertEqual(set(result["jobs"]), set(gate.REQUIRED_JOBS))
        self.assertFalse(result["nodeStartAuthorized"])
        self.assertFalse(result["publicDeployment"])
        fixture[RUN_PATH]["head_branch"] = "main"
        fixture[ARTIFACTS]["artifacts"][0]["workflow_run"]["head_branch"] = "main"
        fixture[CURRENT_PATH]["head_branch"] = "codex/ynx-pq-remote-" + SHA[:9]
        self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture)  # The old remote branch contract is unchanged.

    def test_fresh_bad_context_or_branch_is_never_a_command_or_resource_grant(self):
        for context in ({}, True, [], "consensus-fresh-paired-business-v1",
                        dict(profile="consensus-signed-business-v1"),
                        dict(profile=gate.FRESH_PROFILE, activeMs=120000),
                        dict(profile=gate.FRESH_PROFILE, command=["node"]),
                        dict(profile=gate.FRESH_PROFILE, nodeStartAuthorized=True)):
            with self.subTest(context=context), self.assertRaises(gate.NormalCIError):
                gate.validate_normal_ci(gate.REPOSITORY, SHA, PRIOR, CURRENT,
                    lambda _path: self.fail("bad context reached API"), context=context)
        for branch in (None, [], "other", "codex/ynx-pq-remote-" + "b" * 9, "refs/heads/main"):
            fixture = fresh_api_fixture(); fixture[CURRENT_PATH]["head_branch"] = branch
            with self.subTest(branch=branch), self.assertRaises(gate.NormalCIError):
                self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))

    def test_fresh_artifact_rejects_other_attempt_source_expiry_duplicate_or_unbounded_zip(self):
        changes = [("expired", True), ("size_in_bytes", 0), ("size_in_bytes", True),
                   ("size_in_bytes", (256 << 20) + 1), ("digest", "sha256:" + "0" * 64),
                   ("digest", "sha256:" + "D" * 64), ("digest", "not-a-digest"),
                   ("name", "ynx-pq-fresh-paired-business-build-" + SHA + "-" + PRIOR + "-1")]
        for key, value in changes:
            fixture = fresh_api_fixture(); fixture[ARTIFACTS]["artifacts"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(gate.NormalCIError):
                self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        for key, value in (("id", int(CURRENT)), ("id", PRIOR), ("id", True),
                           ("head_sha", "b" * 40), ("head_branch", "other"),
                           ("repository_id", 999), ("head_repository_id", 999)):
            fixture = fresh_api_fixture(); fixture[ARTIFACTS]["artifacts"][0]["workflow_run"][key] = value
            with self.subTest(owner_field=key), self.assertRaises(gate.NormalCIError):
                self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        for key in fresh_api_fixture()[ARTIFACTS]["artifacts"][0]:
            fixture = fresh_api_fixture(); del fixture[ARTIFACTS]["artifacts"][0][key]
            with self.subTest(missing=key), self.assertRaises(gate.NormalCIError):
                self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        fixture = fresh_api_fixture()
        second = copy.deepcopy(fixture[ARTIFACTS]["artifacts"][0]); second["id"] = 701
        fixture[ARTIFACTS] = dict(total_count=2, artifacts=[fixture[ARTIFACTS]["artifacts"][0], second])
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))
        fixture[ARTIFACTS] = dict(total_count=1, artifacts=[])
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture, context=dict(profile=gate.FRESH_PROFILE))

    def test_exact_completed_normal_push_and_latest_attempt_are_data_only(self):
        result, calls = self.validate()
        self.assertEqual(calls, [RUN_PATH, WORKFLOW, CURRENT_PATH, JOBS, RUN_PATH, CURRENT_PATH])
        self.assertEqual(set(result), {"version", "classification", "source", "repo", "candidateSha",
                         "normalRunId", "currentRunId", "currentRunStartedAt", "normalRunAttempt", "workflowPath", "normalBranch",
                         "jobs", "normalCIReusable", "nodeStartAuthorized", "publicDeployment"})
        self.assertEqual(gate.REQUIRED_JOBS, ("focused-go", "protocol-delivery", "proof-verifier-macos"))
        self.assertEqual(result["version"], "YNX-PQ-REMOTE-NORMAL-CI/v1")
        self.assertEqual(result["jobs"], {"focused-go": "100", "protocol-delivery": "103", "proof-verifier-macos": "101"})
        self.assertEqual(result["normalRunAttempt"], "2")
        self.assertEqual(result["currentRunStartedAt"], "2026-10-19T02:03:04Z")
        self.assertTrue(result["normalCIReusable"])
        self.assertFalse(result["nodeStartAuthorized"])
        self.assertFalse(result["publicDeployment"])

    def test_input_identity_rejects_before_any_fetch(self):
        for inputs in [dict(repo="other/YNX-Chain"), dict(repo="jiahaoalbus/YNX-Chain"),
                       dict(candidate="0" * 40), dict(candidate="A" * 40), dict(candidate="a" * 39),
                       dict(candidate="a" * 40 + "\n"), dict(candidate=None),
                       dict(normal=CURRENT), dict(normal=""), dict(normal="01"), dict(normal="1e3"),
                       dict(normal="+1"), dict(normal="1/attempts/2"), dict(normal=1),
                       dict(current="0"), dict(current=" 7"), dict(current="7\n"),
                       dict(current="1" * 21)]:
            with self.subTest(inputs=inputs), self.assertRaises(gate.NormalCIError):
                gate.validate_normal_ci(inputs.get("repo", gate.REPOSITORY), inputs.get("candidate", SHA),
                                        inputs.get("normal", PRIOR), inputs.get("current", CURRENT),
                                        lambda _path: self.fail("invalid input reached fetch"))

    def test_run_source_workflow_branch_fork_status_and_field_types_fail_closed(self):
        mutations = [("id", int(CURRENT)), ("id", PRIOR), ("id", True),
                     ("head_sha", "b" * 40), ("event", "workflow_dispatch"), ("event", "pull_request"),
                     ("head_branch", "codex/ynx-pq-remote-" + SHA[:9]), ("head_branch", "main"),
                     ("head_branch", "refs/heads/codex/ynx-pq-perf-integration"), ("head_branch", []),
                     ("path", ".github/workflows/other.yml"), ("workflow_id", True),
                     ("run_attempt", 0), ("run_attempt", "2"), ("run_attempt", True),
                     ("status", "in_progress"), ("status", "queued"),
                     ("conclusion", "failure"), ("conclusion", "cancelled"),
                     ("conclusion", "skipped"), ("conclusion", None)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                fixture = api_fixture()
                fixture[RUN_PATH][key] = value
                with self.assertRaises(gate.NormalCIError):
                    self.validate(fixture)
        for key in run_metadata():
            with self.subTest(missing=key):
                fixture = api_fixture()
                del fixture[RUN_PATH][key]
                with self.assertRaises(gate.NormalCIError):
                    self.validate(fixture)
        for field in ("repository", "head_repository"):
            for key, value in (("full_name", "attacker/YNX-Chain"), ("fork", True), ("fork", "false"), ("id", 999)):
                with self.subTest(field=field, key=key):
                    fixture = api_fixture()
                    fixture[RUN_PATH][field][key] = value
                    with self.assertRaises(gate.NormalCIError):
                        self.validate(fixture)

    def test_workflow_metadata_is_independently_matched(self):
        for metadata in ({}, {"id": 74, "path": gate.WORKFLOW_PATH},
                         {"id": 73, "path": ".github/workflows/other.yml"},
                         {"id": "73", "path": gate.WORKFLOW_PATH}, []):
            fixture = api_fixture()
            fixture[WORKFLOW] = metadata
            with self.subTest(metadata=metadata), self.assertRaises(gate.NormalCIError):
                self.validate(fixture)

    def test_current_run_requires_actual_active_same_source_dispatch_and_canonical_server_start(self):
        for key, value in (("id", int(PRIOR)), ("id", CURRENT), ("id", True),
                           ("head_sha", "b" * 40), ("event", "push"), ("status", "queued"),
                           ("status", "completed"), ("conclusion", "success"),
                           ("workflow_id", 74), ("workflow_id", "73"), ("run_attempt", 0),
                           ("path", ".github/workflows/other.yml"),
                           ("run_started_at", ""), ("run_started_at", None),
                           ("run_started_at", "2026-10-19T02:03:04+00:00"),
                           ("run_started_at", "2026-10-19T02:03:04.000Z"),
                           ("run_started_at", "2026-02-30T02:03:04Z"),
                           ("run_started_at", "2026-10-19T24:03:04Z"),
                           ("run_started_at", "2026-10-19T02:03:04Z\n")):
            fixture = api_fixture()
            fixture[CURRENT_PATH][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(gate.NormalCIError):
                self.validate(fixture)
        for key in ("id", "head_sha", "event", "status", "conclusion", "workflow_id", "path",
                    "run_attempt", "repository", "head_repository", "run_started_at"):
            fixture = api_fixture()
            del fixture[CURRENT_PATH][key]
            with self.subTest(missing=key), self.assertRaises(gate.NormalCIError):
                self.validate(fixture)
        fixture = api_fixture()
        fixture[CURRENT_PATH]["head_repository"]["fork"] = True
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture)

    def test_required_jobs_reject_missing_duplicate_failed_skipped_pending_and_mixed_identity(self):
        for index in (0, 1, 2):
            for key, value in (("run_id", int(CURRENT)), ("run_id", PRIOR), ("run_id", True),
                               ("head_sha", "b" * 40), ("run_attempt", 1), ("run_attempt", "2"),
                               ("run_url", "https://evil.invalid/token"),
                               ("status", "in_progress"), ("status", "queued"),
                               ("conclusion", "failure"), ("conclusion", "cancelled"),
                               ("conclusion", "skipped"), ("conclusion", None),
                               ("name", "focused-go / synthetic")):
                fixture = api_fixture()
                fixture[JOBS]["jobs"][index][key] = value
                with self.subTest(index=index, key=key, value=value), self.assertRaises(gate.NormalCIError):
                    self.validate(fixture)
            for key in job_metadata("focused-go", 100):
                fixture = api_fixture()
                del fixture[JOBS]["jobs"][index][key]
                with self.subTest(index=index, missing=key), self.assertRaises(gate.NormalCIError):
                    self.validate(fixture)
            fixture = api_fixture()
            del fixture[JOBS]["jobs"][index]
            fixture[JOBS]["total_count"] -= 1
            with self.subTest(missing_job=index), self.assertRaises(gate.NormalCIError):
                self.validate(fixture)
            fixture = api_fixture()
            extra = copy.deepcopy(fixture[JOBS]["jobs"][index])
            extra["id"] = 200
            fixture[JOBS]["jobs"].append(extra)
            fixture[JOBS]["total_count"] += 1
            with self.subTest(duplicate_job=index), self.assertRaises(gate.NormalCIError):
                self.validate(fixture)
        fixture = api_fixture()
        fixture[JOBS]["jobs"][1]["id"] = 100
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture)

    def test_pagination_is_complete_bounded_and_fixed_to_original_attempt(self):
        fixture = api_fixture()
        rows = fixture[JOBS]["jobs"]
        rows.extend(dict(id=1000+i, name="unrelated-"+str(i)) for i in range(101 - len(rows)))
        fixture[JOBS] = dict(total_count=101, jobs=rows[:100])
        next_page = JOBS[:-1] + "2"
        fixture[next_page] = dict(total_count=101, jobs=rows[100:])
        _, calls = self.validate(fixture)
        self.assertEqual(calls, [RUN_PATH, WORKFLOW, CURRENT_PATH, JOBS, next_page, RUN_PATH, CURRENT_PATH])
        for response in ({"total_count": 301, "jobs": []}, {"total_count": True, "jobs": []},
                         {"total_count": 0, "jobs": []}, {"total_count": 3, "jobs": []},
                         {"jobs": []}, {"total_count": 3, "jobs": None}):
            broken = api_fixture()
            broken[JOBS] = response
            with self.subTest(response=response), self.assertRaises(gate.NormalCIError):
                self.validate(broken)
        fixture[next_page]["total_count"] = 102
        with self.assertRaises(gate.NormalCIError):
            self.validate(fixture)

    def test_rerun_or_status_change_during_read_is_refused(self):
        for key, value in (("run_attempt", 3), ("status", "in_progress"),
                           ("conclusion", "cancelled"), ("head_sha", "b" * 40)):
            fixture = api_fixture()
            reads = 0

            def fetch(path):
                nonlocal reads
                result = copy.deepcopy(fixture[path])
                if path == RUN_PATH:
                    reads += 1
                    if reads == 2:
                        result[key] = value
                return result

            with self.subTest(key=key), self.assertRaises(gate.NormalCIError):
                gate.validate_normal_ci(gate.REPOSITORY, SHA, PRIOR, CURRENT, fetch)

    def test_current_attempt_start_or_status_race_does_not_replace_the_server_deadline(self):
        for key, value in (("run_attempt", 3), ("run_started_at", "2026-10-19T02:03:05Z"),
                           ("status", "completed")):
            fixture = api_fixture()
            reads = 0

            def fetch(path):
                nonlocal reads
                result = copy.deepcopy(fixture[path])
                if path == CURRENT_PATH:
                    reads += 1
                    if reads == 2:
                        result[key] = value
                return result

            with self.subTest(key=key), self.assertRaises(gate.NormalCIError):
                gate.validate_normal_ci(gate.REPOSITORY, SHA, PRIOR, CURRENT, fetch)


class Response:
    def __init__(self, raw=b"{}", status=200, url=None, headers=None):
        self.raw, self.status = raw, status
        self.url = url or gate.API + RUN_PATH
        self.headers = {} if headers is None else headers
        self.amount = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self):
        return self.url

    def read(self, amount):
        self.amount = amount
        return self.raw[:amount]


class NormalCITransportControls(unittest.TestCase):
    def fetch_with(self, response):
        opener = Mock()
        opener.open.return_value = response
        with patch.object(gate.urllib.request, "build_opener", return_value=opener):
            fetch = gate.github_fetcher("synthetic-token-not-a-credential")
        return fetch, opener

    def test_fixed_https_get_and_bounded_read_only_token_header(self):
        response = Response()
        fetch, opener = self.fetch_with(response)
        self.assertEqual(fetch(RUN_PATH), {})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, gate.API + RUN_PATH)
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer synthetic-token-not-a-credential")
        self.assertIsNone(request.data)
        self.assertEqual(opener.open.call_args.kwargs["timeout"], gate.REQUEST_TIMEOUT_SECONDS)
        self.assertEqual(response.amount, gate.MAX_RESPONSE_BYTES + 1)

    def test_untrusted_paths_urls_redirects_oversize_and_invalid_json_fail_closed(self):
        fetch, opener = self.fetch_with(Response())
        for path in ("https://evil.invalid/", "//evil.invalid/", RUN_PATH+"/logs", RUN_PATH+"?token=x",
                     RUN_PATH+"/attempts/2/jobs?per_page=100&page=4", RUN_PATH+"#fragment",
                     "/repos/attacker/YNX-Chain/actions/runs/1"):
            with self.subTest(path=path), self.assertRaises(gate.NormalCIError):
                fetch(path)
        opener.open.assert_not_called()
        for response in (Response(status=302), Response(url="https://evil.invalid/"),
                         Response(headers={"Content-Length": str(gate.MAX_RESPONSE_BYTES+1)}),
                         Response(headers={"Content-Length": "invalid"}),
                         Response(raw=b"x"*(gate.MAX_RESPONSE_BYTES+1)), Response(raw=b"not json"),
                         Response(raw=b'{"id":1,"id":1}'), Response(raw=b'{"id":NaN}'),
                         Response(raw=b"\xff")):
            fetch, _ = self.fetch_with(response)
            with self.subTest(response=response), self.assertRaises(gate.NormalCIError):
                fetch(RUN_PATH)
        with self.assertRaises(gate.NormalCIError):
            gate.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.invalid/")

    def test_missing_token_deadline_and_transport_error_are_inert_and_do_not_leak(self):
        for token in (None, "", "contains\nnewline", "contains space"):
            with self.subTest(token=token), self.assertRaises(gate.NormalCIError):
                gate.github_fetcher(token)
        fetch, opener = self.fetch_with(Response())
        with patch.object(gate.time, "monotonic", return_value=float("inf")), self.assertRaises(gate.NormalCIError):
            fetch(RUN_PATH)
        opener.open.assert_not_called()
        fetch, opener = self.fetch_with(Response())
        opener.open.side_effect = OSError("synthetic-token-not-a-credential PRIVATE diagnostic")
        with self.assertRaisesRegex(gate.NormalCIError, "^api_read_failed$"):
            fetch(RUN_PATH)

    def test_cli_success_and_failure_use_production_validator_without_token_output(self):
        fixture = api_fixture()
        args = ["--repo", gate.REPOSITORY, "--candidate", SHA,
                "--normal-run-id", PRIOR, "--current-run-id", CURRENT]
        with patch.object(gate, "github_fetcher", return_value=lambda path: copy.deepcopy(fixture[path])), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(gate.main(args), 0)
        self.assertTrue(json.loads(output.getvalue())["normalCIReusable"])
        with patch.object(gate, "github_fetcher", side_effect=gate.NormalCIError("github_token_unavailable")), \
                contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(gate.main(args), 1)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(errors.getvalue(), "YNX_REMOTE_NORMAL_CI_REJECTED: github_token_unavailable\n")

    def test_fresh_cli_selects_only_the_explicit_context_and_fixed_artifact_endpoint(self):
        fixture = fresh_api_fixture()
        args = ["--repo", gate.REPOSITORY, "--candidate", SHA, "--normal-run-id", PRIOR,
                "--current-run-id", CURRENT, "--profile", "consensus-fresh-paired-business-v1"]
        with patch.object(gate, "github_fetcher", return_value=lambda path: copy.deepcopy(fixture[path])), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(gate.main(args), 0)
        self.assertEqual(json.loads(output.getvalue())["artifact"]["artifactId"], "700")
        response = Response(raw=b"{}", url=gate.API + ARTIFACTS)
        fetch, opener = self.fetch_with(response)
        self.assertEqual(fetch(ARTIFACTS), {})
        self.assertEqual(opener.open.call_args.args[0].full_url, gate.API + ARTIFACTS)
        with patch.object(gate, "github_fetcher") as fetcher, contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            gate.main(args[:-1] + ["consensus-signed-business-v1"])
        fetcher.assert_not_called()

    def test_cli_requires_exact_flags_and_does_not_accept_shell_style_or_abbreviations(self):
        args = ["--repo", gate.REPOSITORY, "--candidate", SHA,
                "--normal-run-id", PRIOR, "--current-run-id", CURRENT]
        for invalid in ([], args[:-2], args + ["--execute"], args + ["extra"],
                        ["--rep", gate.REPOSITORY] + args[2:]):
            with self.subTest(args=invalid), patch.object(gate, "github_fetcher") as fetcher, \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as failure:
                gate.main(invalid)
            self.assertEqual(failure.exception.code, 2)
            fetcher.assert_not_called()


# Fixed pre-split normal commands: source assertions, not execution evidence.
NORMAL_STEP_NAMES = (
    "Verify pure dual-PQ protocol and account authorization",
    "Upload public canonical action vectors from the actual Go codec",
    "Verify forked engine keys and actual consensus objects",
    "Compile forked state and consensus engine without starting nodes",
    "Verify exact-height maintenance stop with real engine commit and cold stores",
    "Reproduce and repair same-directory database ownership without starting nodes",
    "Verify real profile state transition and historical store without starting nodes",
    "Reproduce and repair real Commit and engine checkpoint read ordering",
    "Verify bounded remote signer transport and unchanged legacy protobuf vectors",
    "Verify actual engine signing caller uses committed height key and round context",
    "Measure fresh single and bounded concurrent dual signature paths",
    "Measure actual policy certificate cache consumer cold and warm paths",
    "Install pinned contract build runtime",
    "Verify failed candidate deployment preserves services and signing history",
    "Verify original-state operator transition preserves custody and uncertain attempts",
    "Compile frozen measured production overlay without executing cases",
    "Generate canonical IDE contract fixture",
    "Verify native ledger and HTTP PQ integration",
    "Compile production entry points",
    "Reproduce opaque classic staking refusal with original successful transactions",
    "Reproduce the original missing PQ validator staking entry",
    "Verify complete state bridge and sponsor continuity",
    "Verify original Host source, live lifecycle and delivery persistence",
    "Verify complete large original migration through normal package and cold recovery",
    "Verify normal Host source producer with original signed transaction fixture",
    "Reproduce signed-history overwrite and unsafe rollback callers",
    "Reproduce source-authority initialization coupling and verify independent execution",
    "Reproduce JSON-only signing source and verify real journal recovery",
    "Reproduce atomic-only Comet operator startup and verify normal journal selection",
    "Reproduce Ethereum mutable-lot provenance counterexamples and verify cold recovery",
    "Reproduce historical AA policy counterexamples against the original state validator",
    "Reproduce source evidence rehash counterexamples and verify original-label coverage",
    "Verify Whole BFT gateway and native container readback",
    "Upload only public classic staking originals and actual HTTP interoperability fixture",
    "Verify existing Chain readback and recovery after protocol integration",
    "Verify existing Chain SDK after protocol integration",
    "Emit application-backed public Wallet HTTP fixture",
    "Upload only public Wallet HTTP fixture",
    "Verify shared Wallet policy and Chain payment authorization regressions",
    "Reproduce private verifier process-exit telemetry counterexample",
    "Verify operator checkpoint format and original read-lock admission",
    "Build and pin normal signer process binaries without running them",
    "Run the separately authorized normal remote signer process",
    "Preserve only public remote process receipt",
    "Checkout fixed repaired performance client",
    "Verify fixed segmented client integration with original assertions",
    "Emit public inverse interop fixture",
    "Upload public signature fixture",
    "Build fixed-source offline migration validation tools",
    "Upload public offline migration validation tools",
    "Build public Linux runtime candidate without starting services",
    "Verify original candidate delivery with pinned archive permissions",
    "Verify normal single-App operator package and original deployment caller",
    "Upload only public operator inputs and normal CLI receipt",
    "Verify original public cutover caller preserves independent operator and runtime pins",
    "Verify normal proof CLI with exact public interoperability fixture",
    "Verify normal transaction proof CLI with exact public two-header fixture",
    "Verify stopped-source publication and original Host ABI through normal binaries",
    "Upload only public Host delivery and normal CLI receipt",
    "Upload only public transaction proof fixture and normal CLI receipt",
    "Upload only public consensus proof fixture and normal CLI receipt",
    "Upload only public Linux runtime candidate",
)


def workflow_steps(raw, name="focused-go"):
    """Exact indentation/source contract only; not a YAML/GitHub scheduler."""
    matches = re.findall(r"(?ms)^  " + re.escape(name) + r":\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)", raw)
    if len(matches) != 1:
        raise AssertionError("one actual named job required")
    job = matches[0]
    chunks = re.split(r"(?m)(?=^      - (?:name:|uses:))", job)
    return job, chunks[1:]


def assert_native_cabi_workflow_contract(raw):
    """Closed source contract; actual C/Go execution remains the native job."""
    job, steps = workflow_steps(raw, "artifact-release-cabi")

    def need(condition):
        if not condition:
            raise AssertionError("native C-ABI normal-push source contract changed; no execution claim")

    push = ("github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
            "github.ref == 'refs/heads/codex/ynx-pq-perf-integration')")
    header = ("    if: " + push + "\n    strategy:\n      fail-fast: false\n      matrix:\n"
              "        runner: [ubuntu-24.04, macos-15]\n    runs-on: ${{ matrix.runner }}\n"
              "    timeout-minutes: 18\n    env:\n      GOMAXPROCS: '2'\n      GOGC: '50'\n"
              "      GOMEMLIMIT: '1536MiB'\n      CGO_ENABLED: '1'\n      GOFLAGS: '-p=1 -trimpath'\n"
              "      GOPROXY: https://proxy.golang.org\n      GOSUMDB: sum.golang.org\n"
              "      GOTOOLCHAIN: local\n      YNX_NATIVE_MATRIX_RUNNER: ${{ matrix.runner }}\n"
              "      MACOSX_DEPLOYMENT_TARGET: '13.0'\n")
    need(job.split("    steps:\n", 1)[0] == header and "continue-on-error:" not in job)
    push_source = raw.split("  pull_request:\n", 1)[0]
    for leaf in ("cmd/**", "scripts/fixtures/verify-artifact-release-cabi/**",
                 "scripts/verify/artifact-release-cabi-check.sh",
                 "scripts/fixtures/verify-transaction-batch-cabi/**",
                 "scripts/verify/transaction-batch-cabi-check.sh",
                 "scripts/fixtures/verify-account-initial-cabi/**",
                 "scripts/verify/account-initial-cabi-check.sh",
                 "scripts/fixtures/verify-publisher-registration-cabi/**",
                 "scripts/verify/publisher-registration-cabi-check.sh",
                 "scripts/fixtures/verify-project-control-cabi/**",
                 "scripts/verify/project-control-cabi-check.sh",
                 "scripts/verify/seal-project-control-cabi.py"):
        need(push_source.count("      - '" + leaf + "'\n") == 1)
    names = ("Checkout exact Native callee and independent caller source",
             "Install the original pinned Go toolchain",
             "Verify fixed Native key and output cleanup behavior",
             "Execute actual C ABI and independently verify both signatures",
             "Verify the executed original Main arm64 target",
             "Install pinned contract runtime for Darwin migration callers",
             "Prepare same-source compiled contracts for Darwin migration callers",
             "Verify complete Darwin migration package CLI against original contract inputs",
             "Seal only native library public outputs and exact compile inputs",
             "Upload only public native host archive header and evidence",
             "Upload only public Main arm64 archive header and executed target evidence",
             "Verify fixed CONTROL key lifecycle and actual C ABI dual signatures",
             "Seal only executed CONTROL archive and fixed public inputs",
             "Upload only public fixed CONTROL native archive header and evidence")
    lines = lambda step: [line for line in step.splitlines() if line.strip()]
    data_names = ("Install the original pinned operator DATA test runtime",
                  "Verify original operator runtime preparation on the actual platform")
    wallet_names = ("Execute Wallet transaction ABI from the same native archive",
                    "Execute initial-account ABI from the same native archive")
    publisher_names = ("Execute fixed publisher generation and both registration proofs from the same archive",
                       "Seal the same executed archive with dedicated publisher public evidence",
                       "Upload only public publisher archive headers and real native evidence")
    ordered_names = (names[:1] + data_names + names[1:4] + wallet_names + publisher_names[:1]
                     + names[4:9] + publisher_names[1:] + names[9:])
    need(len(steps) == len(ordered_names))
    need(all(step.startswith("      - name: " + name + "\n") for step, name in zip(steps, ordered_names)))
    named = {name: step for name, step in zip(ordered_names, steps)}
    need(lines(named[data_names[0]]) == ["      - name: " + data_names[0],
        "        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "        with:",
        "          node-version: '24.19.0'"])
    need(lines(named[data_names[1]]) == ["      - name: " + data_names[1],
        "        run: node --test --test-name-pattern='^actual runtime preparation' scripts/deploy/consensus-candidate-failure-retention.test.mjs"])
    # The new fixed Wallet caller must execute after the original archive was
    # built, before arm64 inspection or sealing. Keep every original closed
    # step assertion below rather than accepting arbitrary additional steps.
    need(lines(named[wallet_names[0]]) == ["      - name: Execute Wallet transaction ABI from the same native archive",
        "        run: |", "          set -euo pipefail",
        '          bash scripts/verify/transaction-batch-cabi-check.sh \\',
        '            "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a" \\',
        '            "$RUNNER_TEMP/ynx-transaction-batch-cabi"'])
    need(lines(named[wallet_names[1]]) == ["      - name: Execute initial-account ABI from the same native archive",
        "        run: |", "          set -euo pipefail",
        '          bash scripts/verify/account-initial-cabi-check.sh \\',
        '            "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a" \\',
        '            "$RUNNER_TEMP/ynx-account-initial-cabi"'])
    # The fixed publisher caller executes the archive already built by the
    # original C-ABI step. Its dedicated seven-leaf seal follows the original
    # same-source seal, and upload follows both successful real call and seals.
    need(lines(named[publisher_names[0]]) == ["      - name: " + publisher_names[0],
        "        run: |", "          set -euo pipefail",
        '          bash scripts/verify/publisher-registration-cabi-check.sh \\',
        '            "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a" \\',
        '            "$RUNNER_TEMP/ynx-publisher-registration-cabi"'])
    steps = [named[name] for name in names]
    need(all(step.startswith("      - name: " + name + "\n") for step, name in zip(steps, names)))
    need([line for line in lines(steps[0]) if not line.lstrip().startswith("#")] == ["      - name: " + names[0],
        "        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "        with:",
        "          ref: ${{ github.sha }}", "          fetch-depth: 0", "          filter: blob:none",
        "          persist-credentials: false"])
    need(lines(steps[1]) == ["      - name: " + names[1],
        "        uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e", "        with:",
        "          go-version-file: go.mod", "          check-latest: false", "          cache: true"])
    need(lines(steps[2]) == ["      - name: " + names[2], "        run: |", "          set -euo pipefail",
        '          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', "          git diff --exit-code",
        "          go test -p 1 ./cmd/ynx-artifact-release-cabi -count=1"])
    need(lines(steps[3]) == ["      - name: " + names[3], "        run: |", "          set -euo pipefail",
        '          bash scripts/verify/artifact-release-cabi-check.sh "$RUNNER_TEMP/ynx-artifact-release-cabi"'])
    arm_lines = [line for line in lines(steps[4]) if not line.lstrip().startswith("#")]
    need(arm_lines == ["      - name: " + names[4], "        if: runner.os == 'macOS'", "        run: |",
        "          set -euo pipefail", "          umask 077",
        '          test "$(go env GOHOSTOS)" = darwin', '          test "$(go env GOHOSTARCH)" = arm64',
        '          test "$(go env GOOS)" = darwin', '          test "$(go env GOARCH)" = arm64',
        '          lipo "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a" -verify_arch arm64',
        '          lipo "$RUNNER_TEMP/ynx-artifact-release-cabi/c-driver" -verify_arch arm64',
        '          lipo "$RUNNER_TEMP/ynx-transaction-batch-cabi/tx-c-driver" -verify_arch arm64',
        '          lipo "$RUNNER_TEMP/ynx-account-initial-cabi/initial-c-driver" -verify_arch arm64',
        '          lipo "$RUNNER_TEMP/ynx-publisher-registration-cabi/publisher-c-driver" -verify_arch arm64'])
    need(lines(steps[5]) == ["      - name: " + names[5], "        if: runner.os == 'macOS'",
        "        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "        with:",
        "          node-version: '24.19.0'", "          cache: npm"])
    need(lines(steps[6]) == ["      - name: " + names[6], "        if: runner.os == 'macOS'",
        "        timeout-minutes: 3", "        env:", "          NODE_OPTIONS: --max-old-space-size=1536",
        "        run: |", "          set -euo pipefail", '          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
        "          npm ci --ignore-scripts --no-audit --no-fund",
        "          npm run hardhat:build -- contracts/devtools/SampleEVMWriteCounter.sol contracts/tokens/SampleYNXTCompatibleERC20.sol",
        "          npm run contracts:selectors", "          git diff --exit-code -- artifacts",
        "          test -s artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json",
        "          test -s artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json",
        "          shasum -a 256 contracts/devtools/SampleEVMWriteCounter.sol artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json artifacts/ynx-selector-metadata.json",
        "          shasum -a 256 contracts/tokens/SampleYNXTCompatibleERC20.sol artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json"])
    need(lines(steps[7]) == ["      - name: " + names[7], "        if: runner.os == 'macOS'", "        run: |",
        "          set -euo pipefail", '          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
        "          go test -p 1 -count=1 -timeout=90s ./cmd/ynx-consensus-package"])
    seal = steps[8]
    need(not re.search(r"(?m)^        if:", seal))
    need(lines(seal)[1:5] == ["        run: |", "          set -euo pipefail", "          umask 077",
                            "          python3 -B - <<'PY'"])
    # These facts refer to the preceding executed native archive. The arm64
    # label must not substitute a different, unexecuted cross-compiled binary.
    seal_lines = [line.strip() for line in seal.splitlines()]
    for required in (
        "if command('git', 'rev-parse', 'HEAD') != os.environ['GITHUB_SHA']:",
        "if module.get('Version') != 'v1.6.5' or module.get('Replace'):",
        "transaction_case = Path(os.environ['RUNNER_TEMP']) / 'ynx-transaction-batch-cabi'",
        "initial_case = Path(os.environ['RUNNER_TEMP']) / 'ynx-account-initial-cabi'",
        "source_names = command('git', 'ls-files', 'go.mod', 'go.sum', 'internal/ynxbatch', 'internal/ynxauth', 'internal/accountaddress',",
        "'cmd/ynx-artifact-release-cabi', 'scripts/fixtures/verify-artifact-release-cabi',",
        "'scripts/fixtures/verify-transaction-batch-cabi', 'scripts/verify/artifact-release-cabi-check.sh',",
        "'scripts/verify/transaction-batch-cabi-check.sh', 'scripts/fixtures/verify-account-initial-cabi',",
        "'scripts/verify/account-initial-cabi-check.sh', 'scripts/fixtures/verify-publisher-registration-cabi',",
        "'scripts/verify/publisher-registration-cabi-check.sh', '.github/workflows/resource-market-ci.yml').splitlines()",
        "sources = {name:dict(**pin(Path(name)), gitBlob=command('git','rev-parse','HEAD:'+name)) for name in source_names}",
        "native_os, native_arch = command('go','env','GOOS'), command('go','env','GOARCH')",
        "targets = [('native-host', case / 'libynx_artifact_release.a', native_os, native_arch, True)]",
        "if native_os == 'darwin':", "if native_arch != 'arm64':",
        "targets.append(('darwin-arm64', case / 'libynx_artifact_release.a', 'darwin', 'arm64', True))",
        "public_names = ('PUBLIC-RECEIPT.json', 'PUBLIC-INTEROP.json')",
        "public_pins = {name:pin(case / 'output' / name) for name in public_names}",
        "transaction_public_pins = {'TX-'+name:pin(transaction_case / 'input' / name) for name in public_names}",
        "initial_public_pins = {'INITIAL-'+name:pin(initial_case / 'input' / name) for name in public_names}",
        "for label, archive, target_os, target_arch, executed in targets:",
        "shutil.copyfile(archive, out / 'libynx_artifact_release.a')",
        "shutil.copyfile('cmd/ynx-artifact-release-cabi/ynx_artifact_release.h', out / 'ynx_artifact_release.h')",
        "shutil.copyfile('cmd/ynx-artifact-release-cabi/tx_batch.h', out / 'tx_batch.h')",
        "shutil.copyfile('cmd/ynx-artifact-release-cabi/account_initial.h', out / 'account_initial.h')",
        "shutil.copyfile(transaction_case / 'input' / name, out / ('TX-'+name))",
        "shutil.copyfile(initial_case / 'input' / name, out / ('INITIAL-'+name))",
        "sourceTree=command('git','rev-parse','HEAD^{tree}'), runId=os.environ['GITHUB_RUN_ID'],",
        "matrixRunner=os.environ['YNX_NATIVE_MATRIX_RUNNER'], runnerOS=os.environ['RUNNER_OS'],",
        "host=dict(os=native_os, arch=native_arch), target=dict(os=target_os, arch=target_arch),",
        "minimumSystemVersion='13.0' if target_os == 'darwin' else None,",
        "deploymentTargetEnvironment=os.environ.get('MACOSX_DEPLOYMENT_TARGET') if target_os == 'darwin' else None,",
        "sources=sources, abi='YNXArtifactPublicationSignV1', abiVersion=1,",
        "suite='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',",
        "publicEvidence=public_pins, publicEvidenceTarget=dict(os=native_os, arch=native_arch),",
        "transactionABI='YNXTransactionBatchSignV1', transactionABIVersion=1,",
        "transactionHeader=pin(out / 'tx_batch.h'), transactionPublicEvidence=transaction_public_pins,",
        "actualTransactionCABIExecuted=executed, transactionIndependentGoDualANDVerified=executed,",
        "transactionCallerRecipe='scripts/verify/transaction-batch-cabi-check.sh', transactionAccountAuthorized=False,",
        "initialAccountABI='YNXAccountInitialSignV1', initialAccountABIVersion=1,",
        "initialAccountHeader=pin(out / 'account_initial.h'), initialAccountPublicEvidence=initial_public_pins,",
        "actualInitialAccountCABIExecuted=executed, initialAccountIndependentGoDualANDVerified=executed,",
        "initialAccountCallerRecipe='scripts/verify/account-initial-cabi-check.sh', initialAccountAuthorized=False,",
        "nativeHostCoreTestsPassed=True, actualCABIExecuted=executed,",
        "independentGoDualANDVerified=executed, typedN1Inspected=executed,",
        "crossCompiled=(not executed and (target_os,target_arch)!=(native_os,native_arch)),",
        "syntheticTestKeysOnly=True, privateMaterialIncluded=False, cleanup='logical Clear/Destroy; no provider physical-erasure guarantee',",
        "publisherAuthorized=False, nativeRootAuthorized=False, mainCustodyVerified=False,",
        "productInstalled=False, publicDeployment=False, pqActivation=False)",
        "if command('git','status','--porcelain','--untracked-files=normal'):"):
        need(required in seal_lines)
    # Only these public leaves may leave the runner, never input DER, the case
    # directory, caller binary or a recursive wildcard. Missing output fails.
    for step, name, label, artifact, leaves, mac_only in (
        (steps[9], names[9], "native-host", "native-${{ matrix.runner }}",
         ("libynx_artifact_release.a", "ynx_artifact_release.h", "tx_batch.h", "account_initial.h", "SOURCE.json", "PUBLIC-RECEIPT.json", "PUBLIC-INTEROP.json", "TX-PUBLIC-RECEIPT.json", "TX-PUBLIC-INTEROP.json", "INITIAL-PUBLIC-RECEIPT.json", "INITIAL-PUBLIC-INTEROP.json"), False),
        (steps[10], names[10], "darwin-arm64", "darwin-arm64",
         ("libynx_artifact_release.a", "ynx_artifact_release.h", "tx_batch.h", "account_initial.h", "SOURCE.json", "TX-PUBLIC-RECEIPT.json", "TX-PUBLIC-INTEROP.json", "INITIAL-PUBLIC-RECEIPT.json", "INITIAL-PUBLIC-INTEROP.json"), True)):
        expected = ["      - name: " + name]
        if mac_only:
            expected.append("        if: runner.os == 'macOS'")
        expected.extend(["        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", "        with:",
                         "          name: ynx-artifact-release-cabi-" + artifact + "-${{ github.sha }}", "          path: |"])
        expected.extend("            ${{ runner.temp }}/ynx-artifact-release-cabi/delivery/" + label + "/" + leaf for leaf in leaves)
        expected.extend(["          if-no-files-found: error", "          retention-days: 7"])
        need(lines(step) == expected)

    need(lines(steps[11]) == ["      - name: " + names[11], "        run: |", "          set -euo pipefail",
        '          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
        "          go test -p 1 -count=1 -timeout=90s ./internal/ynxbatch -run '^TestProjectControl'",
        '          bash scripts/verify/project-control-cabi-check.sh "$RUNNER_TEMP/ynx-project-control-cabi"'])
    need(lines(steps[12]) == ["      - name: " + names[12], "        run: |", "          set -euo pipefail", "          umask 077",
        '          python3 -B scripts/verify/seal-project-control-cabi.py "$RUNNER_TEMP/ynx-project-control-cabi"'])
    expected = ["      - name: " + names[13],
        "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", "        with:",
        "          name: ynx-project-control-cabi-native-${{ matrix.runner }}-${{ github.sha }}", "          path: |"]
    expected.extend("            ${{ runner.temp }}/ynx-project-control-cabi/delivery/" + leaf for leaf in
        ("libynx_project_control.a", "ynx_project_control.h", "SOURCE.json", "PUBLIC-RECEIPT.json", "PUBLIC-INTEROP.json"))
    expected.extend(["          if-no-files-found: error", "          retention-days: 7"])
    need(lines(steps[13]) == expected)

    # Exact dedicated DATA sealer: the wildcard upload below is safe only
    # behind this closed seven-file catalog, same executed archive/source pins,
    # fixed public headers/evidence and explicit absence of real authority or
    # private material. Reject extra commands as well as weakened predicates.
    need(lines(named[publisher_names[1]]) == lines(r"""      - name: Seal the same executed archive with dedicated publisher public evidence
        run: |
          set -euo pipefail
          umask 077
          python3 -B - <<'PY'
          import hashlib, json, os, shutil, stat, subprocess
          from pathlib import Path
          root = Path(os.environ['RUNNER_TEMP'])
          original = root / 'ynx-artifact-release-cabi/delivery/native-host'
          case = root / 'ynx-publisher-registration-cabi'
          out = case / 'delivery'
          out.mkdir(mode=0o700)
          def pin(path):
              s = path.lstat()
              if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or not 0 < s.st_size <= 128 << 20:
                  raise RuntimeError('bounded original public leaf required')
              with path.open('rb') as source:
                  return dict(bytes=s.st_size, sha256=hashlib.file_digest(source, 'sha256').hexdigest())
          parent = json.loads((original / 'SOURCE.json').read_bytes())
          if (parent['commit'] != os.environ['GITHUB_SHA'] or parent['runId'] != os.environ['GITHUB_RUN_ID']
                  or not parent['actualCABIExecuted'] or not parent['nativeHostCoreTestsPassed']
                  or parent['crossCompiled'] or parent['privateMaterialIncluded']):
              raise RuntimeError('same executed native archive producer required')
          names = ('ynx_artifact_release.h', 'ynx_project_control.h', 'publisher_registration.h')
          for name in names:
              shutil.copyfile(Path('cmd/ynx-artifact-release-cabi') / name, out / name)
          shutil.copyfile(original / 'libynx_artifact_release.a', out / 'libynx_artifact_release.a')
          if pin(out / 'libynx_artifact_release.a') != parent['archive']:
              raise RuntimeError('shared archive changed after actual publisher calls')
          public_names = ('PUBLIC-INTEROP.json', 'PUBLIC-RECEIPT.json')
          for name in public_names:
              shutil.copyfile(case / 'input' / name, out / name)
          record = dict(version='YNX-PUBLISHER-REGISTRATION-CABI-CANDIDATE/v1', commit=parent['commit'],
              sourceTree=parent['sourceTree'], runId=parent['runId'], runAttempt=parent['runAttempt'],
              host=parent['host'], target=parent['target'], minimumSystemVersion=parent['minimumSystemVersion'],
              deploymentTargetEnvironment=parent['deploymentTargetEnvironment'], goVersion=parent['goVersion'],
              compilerVersion=parent['compilerVersion'], circl=parent['circl'], goMod=parent['goMod'], goSum=parent['goSum'],
              originalArchiveSource=pin(original / 'SOURCE.json'), archive=parent['archive'],
              sources=parent['sources'], headers={name:pin(out / name) for name in names},
              publicEvidence={name:pin(out / name) for name in public_names},
              abiVersion=1, functions=['YNXPublisherGenerateV1','YNXPublisherPoPSignV1','YNXPublisherCustodianSignV1'],
              capacities=dict(private=16384, public=8192, member=131072),
              suite=parent['suite'], callerRecipe='scripts/verify/publisher-registration-cabi-check.sh',
              actualCABIExecuted=True, independentGoDualANDVerified=True, typedN1Inspected=True,
              sharedOriginalArchive=True, syntheticTestKeysOnly=True, privateMaterialIncluded=False,
              crossCompiled=False, protectedMainCustodyVerified=False, sourceOwnerQualified=False,
              publisherAuthorized=False, nativeRootAuthorized=False, productInstalled=False,
              publicDeployment=False, pqActivation=False,
              cleanup='logical Clear/Destroy plus caller-owned transfer-buffer wipe; no physical provider erasure guarantee')
          with (out / 'SOURCE.json').open('x') as sink:
              sink.write(json.dumps(record, sort_keys=True, separators=(',', ':'))+'\n')
          if {p.name for p in out.iterdir()} != set(names) | set(public_names) | {'SOURCE.json','libynx_artifact_release.a'}:
              raise RuntimeError('closed publisher public artifact catalog differs')
          if subprocess.check_output(['git','status','--porcelain','--untracked-files=normal'], text=True):
              raise RuntimeError('publisher Native CI modified source checkout')
          print('YNX_PUBLISHER_REGISTRATION_CABI_CANDIDATE '+json.dumps(record,sort_keys=True,separators=(',',':')))
          PY"""))
    need(lines(named[publisher_names[2]]) == ["      - name: " + publisher_names[2],
        "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", "        with:",
        "          name: ynx-publisher-registration-cabi-native-${{ matrix.runner }}-${{ github.sha }}",
        "          path: ${{ runner.temp }}/ynx-publisher-registration-cabi/delivery/*",
        "          if-no-files-found: error", "          retention-days: 7"])


def assert_runtime_gateway_identity_workflow_contract(raw):
    """The normal build must observe its actual ELF, never synthesize identity."""
    _, steps = workflow_steps(raw, "protocol-delivery")
    found = [step for step in steps if step.startswith(
        "      - name: Build public Linux runtime candidate without starting services\n")]
    if len(found) != 1:
        raise AssertionError("one original runtime build required")
    step = found[0]
    required = (
        'YNX_RUNTIME_GATEWAY_COMMIT=$GITHUB_SHA',
        'YNX_RUNTIME_BUILD_OBSERVATION="$RUNNER_TEMP/ynx-pq-runtime-gateway-build-info.json"',
        'export YNX_RUNTIME_BUILD_TIME YNX_RUNTIME_BUILD_OBSERVATION',
        'go build -p 1 -trimpath -buildvcs=true -ldflags "-X main.buildCommit=$YNX_RUNTIME_GATEWAY_COMMIT -X main.buildRelease=ynx-bft-gateway-${YNX_RUNTIME_GATEWAY_COMMIT:0:12} -X main.buildTime=$YNX_RUNTIME_BUILD_TIME" -o "$YNX_RUNTIME_CANDIDATE/ynx-bft-gatewayd" ./cmd/ynx-bft-gatewayd',
        '(set -C; timeout 5s "$YNX_RUNTIME_CANDIDATE/ynx-bft-gatewayd" --build-info --comet-rpc not-a-url --http invalid-address --migration-height 1 >"$YNX_RUNTIME_BUILD_OBSERVATION")',
        "observation = Path(os.environ['YNX_RUNTIME_BUILD_OBSERVATION'])",
        'if not 0 < observation.stat().st_size <= 1024:',
        "gateway_build = json.loads(observation.read_text(encoding='utf8'))",
        "expected_build = dict(commit=os.environ['GITHUB_SHA'],",
        "release='ynx-bft-gateway-' + os.environ['GITHUB_SHA'][:12],",
        "buildTime=os.environ['YNX_RUNTIME_BUILD_TIME'])",
        'if gateway_build != expected_build:',
        "print('YNX_GATEWAY_BUILD_IDENTITY ' + json.dumps(dict(sourceCommit=os.environ['GITHUB_SHA'],",
        "binary=binaries['ynx-bft-gatewayd'], build=gateway_build,",
        "runtimeStarted=False, publicDeployment=False, pqActivation=False), sort_keys=True, separators=(',', ':')))",
    )
    lines = [line.strip() for line in step.splitlines()]
    if any(lines.count(line) != 1 for line in required):
        raise AssertionError("runtime gateway build/observation identity changed")
    if lines.index(required[3]) >= lines.index(required[4]) or lines.index(required[4]) >= lines.index(required[5]):
        raise AssertionError("actual runtime identity observation must follow its build")
    clean_required = (
        'YNX_RUNTIME_SOURCE="$RUNNER_TEMP/ynx-pq-runtime-source-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"',
        'YNX_RUNTIME_EXPECTED_TREE=$(git rev-parse "$GITHUB_SHA^{tree}")',
        'test ! -e "$YNX_RUNTIME_SOURCE" && test ! -L "$YNX_RUNTIME_SOURCE"',
        'git init "$YNX_RUNTIME_SOURCE"',
        'git -C "$YNX_RUNTIME_SOURCE" fetch --no-tags --depth=1 "$GITHUB_WORKSPACE" "$GITHUB_SHA"',
        'git -C "$YNX_RUNTIME_SOURCE" checkout --detach "$GITHUB_SHA"',
        'test -d "$YNX_RUNTIME_SOURCE/.git" && test ! -L "$YNX_RUNTIME_SOURCE/.git"',
        'test ! -e "$YNX_RUNTIME_SOURCE/.git/objects/info/alternates"',
        'cd "$YNX_RUNTIME_SOURCE"',
        'YNX_RUNTIME_BEFORE_HEAD=$(git rev-parse HEAD)',
        'YNX_RUNTIME_BEFORE_TREE=$(git rev-parse HEAD^{tree})',
        'YNX_RUNTIME_BEFORE_STATUS=$(git status --porcelain --untracked-files=all)',
        'test "$YNX_RUNTIME_BEFORE_HEAD" = "$GITHUB_SHA"',
        'test "$YNX_RUNTIME_BEFORE_TREE" = "$YNX_RUNTIME_EXPECTED_TREE"',
        'test -z "$YNX_RUNTIME_BEFORE_STATUS"',
        'for YNX_RUNTIME_COMMAND in ynx-abci ynx-comet ynx-consensus-keycheck ynx-consensus-package ynx-consensus-pq-key-init ynx-consensus-proof-verify ynx-consensus-pq-remote-signer; do',
        'go build -p 1 -trimpath -buildvcs=true -o "$YNX_RUNTIME_CANDIDATE/$YNX_RUNTIME_COMMAND" "./cmd/$YNX_RUNTIME_COMMAND"',
        "result = subprocess.run(['go', 'version', '-m', str(path)], cwd=source_root,",
        'go_infos[name] = go_info(path)',
        'source_after = source_observation()',
        'if source_after != source_before:',
    )
    if any(lines.count(line) != 1 for line in clean_required):
        raise AssertionError("eight runtime ELFs must come from their exact independent clean source")
    if not (lines.index(clean_required[3]) < lines.index(clean_required[4]) < lines.index(clean_required[5])
            < lines.index(clean_required[6]) < lines.index(clean_required[7]) < lines.index(clean_required[8])
            < lines.index(clean_required[11]) < lines.index(clean_required[15]) < lines.index(required[3])
            < lines.index(clean_required[18]) < lines.index(clean_required[19])):
        raise AssertionError("runtime clean source and actual Go metadata checks must bracket all builds")
    for token in ("source_before != dict(head=os.environ['GITHUB_SHA'], tree=os.environ['YNX_RUNTIME_EXPECTED_TREE'], porcelain='')",
                  "settings.get('vcs.revision') != os.environ['GITHUB_SHA']", "settings.get('vcs.modified') != 'false'",
                  "key in settings", "timeout=5, check=False", "len(result.stdout) <= 65536",
                  "print('YNX_LINUX_RUNTIME_CLEAN_BUILD '", "sourceClean=(source_after['porcelain'] == '')", "goInfo=go_infos"):
        if token not in step:
            raise AssertionError("actual eight-ELF clean VCS metadata/readback required")
    if any(token in step for token in ('-buildvcs=false', '-buildvcs=auto', 'git clean ', 'git reset ', 'worktree remove ',
                                       'git worktree add ', 'cp "$YNX_REMOTE_BUILD/ynx-consensus-pq-remote-signer"')):
        raise AssertionError("runtime source and VCS metadata cannot be cleaned, bypassed or substituted")


def assert_macos_source_register_workflow_contract(raw):
    """Check supply boundaries; the CI build/seal checks the actual artifacts."""
    job, steps = workflow_steps(raw, "proof-verifier-macos")
    def need(value):
        if not value:
            raise AssertionError("normal macOS SourceOwner registration supply changed")
    named = lambda name: [step for step in steps if step.startswith("      - name: " + name + "\n")]
    builds = named("Build the normal macOS SourceOwner registration CLI without executing it")
    uploads = named("Upload only public macOS SourceOwner registration executables and exact source pins")
    need(len(builds) == len(uploads) == 1 and "continue-on-error:" not in job and "permissions:" not in job)
    need("    timeout-minutes: 12\n" in job)
    build, upload = builds[0], uploads[0]
    need(steps.index(build) < steps.index(upload) and not re.search(r"(?m)^        if:", build + upload))
    need("        timeout-minutes: 5\n" in build and "        timeout-minutes: 1\n" in upload)
    need("set -euo pipefail" in build and "||" not in build.split("        run: |\n", 1)[1] and not re.search(r"\bsudo\b", build + upload))
    parts = build.split("          python3 -B - <<'PY'\n")
    need(len(parts) == 2 and "for YNX_MAC_REGISTER_ARCH in arm64 amd64; do" in parts[0])
    command = 'CGO_ENABLED=0 GOOS=darwin GOARCH="$YNX_MAC_REGISTER_ARCH" go build -p 1 -trimpath -o "$YNX_MAC_REGISTER/ynx-comet-darwin-$YNX_MAC_REGISTER_ARCH" ./cmd/ynx-comet'
    need(parts[0].count(command) == 1 and not any("ynx-comet-darwin-" in line and " go build " not in line for line in parts[0].splitlines()))
    need('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in build and build.count('test -z "$(git status --porcelain --untracked-files=normal)"') == 2)
    body = parts[1].split("          PY\n")
    need(len(body) == 2 and body[1].strip() == 'test -z "$(git status --porcelain --untracked-files=normal)"')
    need(body[0].count("subprocess.check_output(") == 4 and not re.search(r"\b(?:subprocess\.(?:Popen|run|call|check_call)|os\.(?:system|popen|exec\w*)|exec|eval)\s*\(", body[0]))
    evidence = ("hashlib.file_digest(source, 'sha256')", "binaries[name] = pin(path)",
        "head[:4] != b'\\xcf\\xfa\\xed\\xfe'", "0x0100000c", "0x01000007", "head[12:16])[0] != 2",
        "gitBlob=subprocess.check_output(['git','rev-parse','HEAD:'+name]", "sourceTree=subprocess.check_output(['git','rev-parse','HEAD^{tree}']",
        "pin(Path(name))", "'internal/consensus/proof_host_selection.go'", "'cmd/ynx-comet/register_proof_host_source.go'", "'cmd/ynx-comet/main.go'",
        "RegisterProofHostSourceCatalogForWallet", "requestMaxBytes=4096", "resultFields=['catalogPath','catalogSha256']",
        "executed=False", "nativeRootAuthorized=False", "productInstalled=False")
    need(all(token in body[0] for token in evidence))
    files = ["ynx-comet-darwin-arm64", "ynx-comet-darwin-amd64", "SOURCE.json"]
    need(re.findall(r"(?m)^            (.+)$", upload) == ["${{ runner.temp }}/ynx-pq-macos-proof-source-register/" + name for name in files])
    need("          path: |\n" in upload and "          if-no-files-found: error\n" in upload)
    need("uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in upload)
    need(re.findall(r"(?m)^          name: (.+)$", upload) == ["ynx-pq-macos-proof-source-register-${{ github.sha }}"])
    old_build = named("Build only the existing offline verifier for macOS callers")
    old_upload = named("Upload only public macOS verifier executables and exact source pins")
    need(len(old_build) == len(old_upload) == 1 and steps.index(old_build[0]) < steps.index(old_upload[0]) < steps.index(build))
    need("          name: ynx-pq-macos-proof-verifier-${{ github.sha }}\n" in old_upload[0])
    need("          path: ${{ runner.temp }}/ynx-pq-macos-proof-verifier\n" in old_upload[0])


def assert_signed_business_supply_workflow_contract(raw):
    """Normal build supply only; never qualifies or executes a network window."""
    job, steps = workflow_steps(raw, "protocol-delivery")

    def need(value):
        if not value:
            raise AssertionError("signed-business normal build/source supply changed")

    def one(name):
        found = [step for step in steps if step.startswith("      - name: " + name + "\n")]
        need(len(found) == 1)
        return found[0]

    checkout = one("Checkout the exact signed-business performance client source")
    build = one("Build and seal the exact signed-business inputs without starting nodes")
    upload = one("Upload only the exact public signed-business build inputs")
    normal_runtime = one("Build public Linux runtime candidate without starting services")
    normal_test = one("Build and pin normal signer process binaries without running them")
    candidate_delivery = one("Verify original candidate delivery with pinned archive permissions")
    runtime_upload = one("Upload only public Linux runtime candidate")
    condition = "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && github.event_name == 'push') }}"
    for step in (checkout, build):
        need(re.findall(r"(?m)^        if: (.+)$", step) == [condition])
    need(steps.index(normal_test) < steps.index(normal_runtime) < steps.index(candidate_delivery)
         < steps.index(runtime_upload) < steps.index(checkout) < steps.index(build) < steps.index(upload))
    need("    timeout-minutes: 12\n" in job and "continue-on-error:" not in job)
    need("uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" in checkout)
    need("          repository: JiahaoAlbus/YNX-Chain\n" in checkout
         and "          ref: 3f5b1ce792616b01b38fe4320c6d4d83fbcc22a0\n" in checkout
         and "          path: qa-signed-business-performance-client\n" in checkout
         and "          persist-credentials: false\n" in checkout)
    need("        id: pqsignedbusinessbuild\n" in build and "        timeout-minutes: 3\n" in build
         and "          GOTOOLCHAIN: local\n" in build)
    parts = build.split("          python3 -B - <<'PY'\n")
    need(len(parts) == 2)
    shell, body = parts
    command = 'go -C qa-signed-business-performance-client build -p 1 -trimpath -mod=readonly -o "$YNX_SIGNED_BUSINESS/build/ynx-consensus-perf-client" ./cmd/ynx-consensus-perf-client'
    need(shell.count(command) == 1 and "go test " not in shell and "go run " not in shell)
    for token in ('set -euo pipefail', 'umask 077', 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
                  "rev-parse HEAD)\" = '3f5b1ce792616b01b38fe4320c6d4d83fbcc22a0'",
                  "rev-parse HEAD^{tree})\" = '2fb228ab5646fad232e0e06f2dd26a5ba30bb372'",
                  "rev-parse HEAD:cmd/ynx-consensus-perf-client)\" = '4762ac0be18454c3504939cb2d9e232cdbfc1114'",
                  "rev-parse HEAD:go.mod)\" = '622faa4b1c6f388d855a8a7f031bb78a5f20dfb4'",
                  "rev-parse HEAD:go.sum)\" = '994c2b5795bc8d495199930d841c0e66f13e7a40'",
                  'mkdir -m 0700 "$YNX_SIGNED_BUSINESS" "$YNX_SIGNED_BUSINESS/build" "$YNX_SIGNED_BUSINESS/source"',
                  'git -C qa-signed-business-performance-client diff --exit-code'):
        need(token in shell)
    need(not re.search(r"\b(?:subprocess\.(?:Popen|run|call|check_call)|os\.(?:system|popen|exec\w*)|exec|eval)\s*\(", body))
    for forbidden in ("-test.run", "YNX_PQ_NETWORK_BUSINESS_E2E=", "YNX_PQ_NETWORK_BUSINESS_E2E:", "--consensus-signed-business", "|| true"):
        need(forbidden not in build)
    for token in ("leaves = ('internal/consensus/pq_network_e2e_test.go', 'internal/consensus/pq_network_business_test.go')",
                  "names = ('consensus.test', 'ynx-bft-gatewayd', 'ynx-consensus-perf-client', 'ynx-consensus-proof-verify')",
                  "header[:6] != b'\\x7fELF\\x02\\x01'", "header[18:20] != b'\\x3e\\x00'",
                  "s.st_mtime_ns, s.st_ctime_ns", "identity(before) != identity(os.fstat(source.fileno()))",
                  "identity(before) != identity(path.lstat())", "destination.open('xb')", "os.fsync(target.fileno())",
                  "read_record(remote / 'SOURCE.json', os.environ['YNX_REMOTE_MANIFEST_SHA'])",
                  "read_record(runtime / 'SOURCE.json', os.environ['YNX_RUNTIME_MANIFEST_SHA'])",
                  "remote_source['commit'] != commit or runtime_source['commit'] != commit",
                  "remote_source['binaries']['consensus.test']['sha256'] != os.environ['YNX_REMOTE_TEST_SHA']",
                  "copy(remote / 'consensus.test', root / 'build/consensus.test', remote_source['binaries']['consensus.test'], 128 << 20, True)",
                  "copy(runtime / name, root / 'build' / name, runtime_source['binaries'][name], 128 << 20, True)",
                  "len({item['sha256'] for item in binaries.values()}) != 4", "sum(item['bytes'] for item in binaries.values()) > 512 << 20",
                  "['git', 'hash-object', leaf]", "copy(source_root / leaf, root / 'source' / leaf, expected, 256 << 10)",
                  "manifest = dict(version='YNX-PQ-NETWORK-BUSINESS-BUILD/v1', protocolCommit=commit,",
                  "performanceClientCommit=client_commit, sourceRoot=str(source_root), sourceLeaves=source_leaves, binaries=binaries)",
                  "write(root / 'build/business-manifest.json', manifest)", "version='YNX-PQ-NETWORK-BUSINESS-SUPPLY/v1', classification='data'",
                  "relocationRequiresVerifiedOriginalSourceAndFreshNormalCallerManifest=True",
                  "relocatedAbsoluteManifestRunnable=False, preparedRecipeSupplied=False",
                  "binariesExecuted=False, nodesStarted=False, workloadExecuted=False, authorityGranted=False, publicDeployment=False, pqActivation=False",
                  "actual != set(files) | {'SOURCE.json'}", "set(names) | {'business-manifest.json'}",
                  "print('YNX_PQ_SIGNED_BUSINESS_BUILD_SOURCE_PIN '", "print('YNX_PQ_SIGNED_BUSINESS_BUILD_MANIFEST_PIN '"):
        need(token in body)
    need("target.write('YNX_RUNTIME_MANIFEST_SHA=' + pin(root / 'SOURCE.json')['sha256'] + '\\n')" in normal_runtime)
    need(re.findall(r"(?m)^        if: (.+)$", upload) == ["${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && github.event_name == 'push' && steps.pqsignedbusinessbuild.outcome == 'success') }}"])
    need("        id: pqsignedbusinessupload\n" in upload and "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in upload)
    need("          name: ynx-pq-signed-business-build-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}\n" in upload)
    files = ("SOURCE.json", "build/business-manifest.json", "build/consensus.test", "build/ynx-bft-gatewayd",
             "build/ynx-consensus-perf-client", "build/ynx-consensus-proof-verify",
             "source/internal/consensus/pq_network_e2e_test.go", "source/internal/consensus/pq_network_business_test.go")
    need(re.findall(r"(?m)^            (.+)$", upload) == ["${{ runner.temp }}/ynx-pq-signed-business-build/" + name for name in files])
    need("          path: |\n" in upload and "          if-no-files-found: error\n" in upload)


def assert_fresh_business_supply_workflow_contract(raw):
    """Fresh supply preserves the old profile and never executes a window."""
    job, steps = workflow_steps(raw, "protocol-delivery")

    def need(value):
        if not value:
            raise AssertionError("fresh paired-business normal supply contract changed")

    def one(name):
        found = [s for s in steps if s.startswith("      - name: " + name + "\n")]
        need(len(found) == 1)
        return found[0]

    previous = one("Upload only the exact public signed-business build inputs")
    receive = one("Receive the exact normal fresh performance client without executing it")
    seal = one("Seal the independent fresh paired-business public inputs without executing them")
    upload = one("Upload only the exact public fresh paired-business build inputs")
    need(steps.index(previous) < steps.index(receive) < steps.index(seal) < steps.index(upload))
    need("    timeout-minutes: 12\n" in job and "continue-on-error:" not in job)
    for step, dependency in ((receive, "pqsignedbusinessupload"), (seal, "pqfreshclient"), (upload, "pqfreshbusinessbuild")):
        need(re.findall(r"(?m)^        if: (.+)$", step) == ["${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && github.event_name == 'push' && steps." + dependency + ".outcome == 'success') }}"])
        need("|| true" not in step and "continue-on-error:" not in step)
    need("        timeout-minutes: 2\n" in receive and "        timeout-minutes: 2\n" in seal)
    need("          GH_TOKEN: ${{ github.token }}\n" in receive and "timeout 90s /bin/bash -euo pipefail" in receive)
    for endpoint, limit in (("runs/40220335526", 131073), ("artifacts/12609705118", 65537), ("artifacts/12609705118/zip", 33554433)):
        need(receive.count("gh api --method GET repos/JiahaoAlbus/YNX-Chain/actions/" + endpoint + " | head -c " + str(limit) + " >") == 1)
    for pin in ("9746d58ff81522bf58fe92825f9202883e5db44e27c0ed8b523ec76054788eaf",
                "40aff3ccf799ae084897b37a9661c3e49914f9de13cc0cca8c94c158b6469ce9",
                "a34a55a856e021c71565b1155b2767951e73147771841fc80f73f6e582a6edec",
                "25ef00fcb1241abeb208239a07e2273fd90af5cc9c7a848254631b7bd91fd603"):
        need(pin in receive and pin in seal)
    for token in ("run.get('conclusion') != 'success'", "artifact.get('digest') != 'sha256:' + digest",
                  "hashlib.sha256(archive).hexdigest() != digest", "len(entries) != 3",
                  "{entry.filename for entry in entries} != set(expected)", "stat.S_ISLNK(mode)",
                  "(len(raw), hashlib.sha256(raw).hexdigest()) != expected[entry.filename]"):
        need(token in receive)
    for token in ("70e7e450997a0ae77dbad5a8be3682f482c6ddd8", "4866cc3924c060eb6a29939915d39b1c5c625607",
                  "19b9fafcfbb3f434b9ff745fb785afb1d0741247", "da3060e150e2bd0f5695d67a76f3b30fafd1c696",
                  "8f2d4f58808dee77ab00dc69a9a285f770b7aeafa49b4e8865455f581ad1d438",
                  "YNX-PQ-NETWORK-FRESH-BUSINESS-BUILD/v1", "performanceClientTree=client_tree",
                  "'internal/consensus/pq_network_fresh_business_test.go'", "sourceRoot=str(source_root)",
                  "os.environ['YNX_SIGNED_BUSINESS_SOURCE_SHA']", "previous_source['protocolCommit'] != commit",
                  "copy(previous / 'build' / name", "copy(client / 'ynx-consensus-perf-client'",
                  "['git', 'hash-object', leaf]", "header[:6] != b'\\x7fELF\\x02\\x01'",
                  "identity(before) != identity(path.lstat())", "destination.open('xb')", "os.fsync(target.fileno())",
                  "actual != set(files) | {'SOURCE.json'}", "relocatedAbsoluteManifestRunnable=False",
                  "binariesExecuted=False, nodesStarted=False, workloadExecuted=False, authorityGranted=False",
                  "print('YNX_PQ_FRESH_BUSINESS_BUILD_SOURCE_PIN '"):
        need(token in seal)
    for forbidden in ("go build ", "go test ", "go run ", "-test.run", "YNX_PQ_NETWORK_FRESH_BUSINESS_E2E=", "YNX_PQ_NETWORK_FRESH_BUSINESS_E2E:", "--consensus-fresh-paired-business"):
        need(forbidden not in receive + seal)
    need(not re.search(r"\b(?:subprocess\.(?:Popen|run|call|check_call)|os\.(?:system|popen|exec\w*))\s*\(", seal))
    files = ("SOURCE.json", "build/business-manifest.json", "build/consensus.test", "build/ynx-bft-gatewayd",
             "build/ynx-consensus-perf-client", "build/ynx-consensus-proof-verify",
             "source/internal/consensus/pq_network_e2e_test.go", "source/internal/consensus/pq_network_business_test.go",
             "source/internal/consensus/pq_network_fresh_business_test.go", "client/SOURCE.json", "client/go-build-info.txt")
    need("uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in upload)
    need("          name: ynx-pq-fresh-paired-business-build-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}\n" in upload)
    need("          path: |\n" in upload and "          if-no-files-found: error\n" in upload)
    need(re.findall(r"(?m)^            (.+)$", upload) == ["${{ runner.temp }}/ynx-pq-fresh-paired-business-build/" + name for name in files])


def assert_fresh_business_execution_workflow_contract(raw):
    """Source admission controls; these assertions never dispatch or run a node."""
    _, steps = workflow_steps(raw)

    def need(value):
        if not value:
            raise AssertionError("fresh paired-business original caller contract changed")

    def one(identifier):
        found = [step for step in steps if "        id: " + identifier + "\n" in step]
        need(len(found) == 1)
        return found[0]

    option = raw.split("      consensus_fresh_paired_business:\n", 1)
    need(len(option) == 2 and option[1].split("      remote_signer_process:\n", 1)[0].endswith(
        "        required: false\n        default: false\n        type: boolean\n"))
    identity, normal, prepare, network = (one(name) for name in ("identity", "normalci", "pqfreshprepare", "pqnetwork"))
    need('YNX_ENTRY_FRESH_BUSINESS: ${{ inputs.consensus_fresh_paired_business }}' in identity
         and '"$YNX_ENTRY_REMOTE_PROCESS" "${YNX_ENTRY_FRESH_BUSINESS:-false}"; do' in identity
         and 'test "$YNX_WINDOW_SELECTIONS" -le 1' in identity)
    need('if [ "${YNX_ENTRY_FRESH_BUSINESS:-false}" = \'true\' ]; then' in identity
         and '[[ "$YNX_ENTRY_CANDIDATE_SHA" == "${BASH_REMATCH[1]}"* ]]' in identity)
    need('YNX_NORMAL_FRESH_BUSINESS: ${{ inputs.consensus_fresh_paired_business }}' in normal
         and 'if [ "$YNX_NORMAL_FRESH_BUSINESS" = \'true\' ]; then' in normal
         and 'normal_args+=(--profile consensus-fresh-paired-business-v1)' in normal)
    expected = "${{ success() && github.event_name == 'workflow_dispatch' && inputs.consensus_fresh_paired_business && inputs.candidate_sha == github.sha && steps.identity.outcome == 'success' && steps.normalci.outcome == 'success' && !inputs.paired_n1 && !inputs.consensus_e2e && !inputs.consensus_e2e_retained_history && !inputs.consensus_remote_e2e_retained_history && !inputs.remote_signer_process }}"
    need(re.findall(r"(?m)^        if: (.+)$", prepare) == [expected]
         and "        timeout-minutes: 3\n" in prepare and 'GH_TOKEN: ${{ github.token }}' in prepare)
    body = prepare.split("        run: |\n", 1)[1]
    need("${{" not in body and "set -euo pipefail" in body and "set -o noclobber" in body)
    need('timeout 120s gh api --method GET "repos/JiahaoAlbus/YNX-Chain/actions/artifacts/$YNX_FRESH_ARTIFACT_ID/zip"' in body
         and 'head -c "$YNX_FRESH_ARCHIVE_BOUND"' in body)
    for token in ("gate['version'] != 'YNX-PQ-FRESH-NORMAL-CI/v1'", "gate['candidateSha'] != os.environ['GITHUB_SHA']",
                  "gate['currentRunId'] != os.environ['GITHUB_RUN_ID']", "gate['nodeStartAuthorized'] is not False",
                  "archive_pin == dict(bytes=gate['artifact']['archiveBytes'], sha256=gate['artifact']['archiveSHA256'])",
                  "len(entries) == len(catalog)", "{entry.filename for entry in entries} == catalog",
                  "stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)",
                  "set(original) == set(keys)", "original['runId'] == gate['normalRunId']", "original['runAttempt'] == gate['normalRunAttempt']",
                  "original['protocolCommit'] == os.environ['GITHUB_SHA']", "original['protocolTree'] == subprocess.check_output",
                  "pins = guard.consensus_business_source_pins(True)", "set(original['files']) == catalog - {'SOURCE.json'}",
                  "original['sourceLeaves'] == {key: pin['sha256'] for key, pin in pins.items()}",
                  "write(intake / 'SOURCE.json', source_raw)", "original['locationBoundManifest'] == dict(file='build/business-manifest.json'",
                  "dict(bytes=length, sha256=h.hexdigest()) == expected", "file_pin(destination, maximum) == expected",
                  "file_pin(source / leaf, 256 << 10) == original['files']['source/' + leaf]",
                  "original['sourceGitBlobs'][leaf]", "file_pin(intake / 'original.zip', 256 << 20) == archive_pin",
                  "dict(bytes=38595797, sha256='a34a55a856e021c71565b1155b2767951e73147771841fc80f73f6e582a6edec')",
                  "manifest_pin = write(build / 'business-manifest.json', encode(relocated))",
                  "businessManifestPin=dict(path=str(build / 'business-manifest.json'), sha256=manifest_pin['sha256'])",
                  "caps=guard.fixed_caps(guard.FRESH_BUSINESS_E2E_PROFILE)", "executionAuthorized=False",
                  "'-test.run=^TestPQNetworkFourValidatorFreshPairedBusinessAndPhaseTiming$'", "'-test.timeout=120s'",
                  "plan['environment'] = guard.consensus_business_environment(plan, build, True)",
                  "guard.validate_consensus_fresh_business_recipe(plan, case / 'prepared.json', inherited={})",
                  "originalSourcePin=file_pin(intake / 'SOURCE.json', 65536)", "originalArtifactUnchanged=True",
                  "nodesStarted=False, executionAuthorized=False, authorityGranted=False"):
        need(token in body)
    need("go build " not in body and "go test " not in body and "vcs.modified" not in body
         and not re.search(r"(?m)^\s+python3[^\n]*pq-paired-linux-window\.py[^\n]*--execute", body))
    need("build / 'SOURCE.json'" not in body and "case / 'SOURCE.json'" not in body)
    fresh_guard = 'scripts/loadtest/pq-paired-linux-window.py --consensus-fresh-paired-business'
    need(network.count(fresh_guard) == 1 and fresh_guard not in prepare
         and 'if [ "${YNX_PQ_FRESH_BUSINESS:-false}" = \'true\' ]; then' in network
         and 'if started > now or remaining < 150:' in network
         and network.index('if started > now or remaining < 150:') < network.index(fresh_guard))
    need(steps.index(identity) < steps.index(normal) < steps.index(prepare) < steps.index(network))
    public = next(step for step in steps if step.startswith("      - name: Preserve only public network-test logs and guard receipt\n"))
    need("inputs.consensus_fresh_paired_business && 'ynx-pq-fresh-paired-business'" in public)
    paths = re.findall(r"(?m)^            (.+)$", public)
    need(paths == ['${{ runner.temp }}/ynx-pq-network-${{ github.run_id }}-${{ github.run_attempt }}' + suffix for suffix in
        ('.receipt.json', '/prepared.json', '/go.stdout.log', '/go.stderr.log', '.file-sizes.json', '.build/business-manifest.json')]
        + ['${{ runner.temp }}/ynx-pq-fresh-intake-${{ github.run_id }}-${{ github.run_attempt }}/relocation.json'])


def assert_browser_verification_workflow_contract(raw):
    """Public source/CI wiring only; real browser evidence is emitted by its job."""
    job, steps = workflow_steps(raw, "browser-verification")

    def need(condition):
        if not condition:
            raise AssertionError("browser verification source contract changed; no browser execution claim")

    condition = ("github.event_name == 'push' && (github.ref == 'refs/heads/main' || "
                 "github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
                 "github.ref == 'refs/heads/codex/ynx-pq-perf-integration')")
    need("    if: " + condition + "\n" in job)
    need("    runs-on: ubuntu-24.04\n    timeout-minutes: 8\n" in job)
    need("      - 'packages/ynx-batch-v01/**'\n" in raw.split("  pull_request:", 1)[0])
    need("        working-directory: packages/ynx-batch-v01\n        shell: bash\n" in job)
    need("      NODE_OPTIONS: --max-old-space-size=256\n" in job)
    need("${{ runner." not in job.split("    steps:\n", 1)[0])
    need(len(steps) == 9)
    need("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" in steps[0]
         and "          ref: ${{ github.sha }}\n          persist-credentials: false\n" in steps[0])
    need("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" in steps[1]
         and "          node-version: '26.7.0'\n          check-latest: false\n" in steps[1])
    names = ["Bind the exact standalone public verification source snapshot",
             "Install only the original locked dual-PQ dependencies",
             "Record actual explicit portable library versions without native fallback",
             "Run the original codec and explicit portable Node public verification",
             "Verify the same public vectors through real headless browser modules",
             "Pack only the tested candidate and bind the actual browser readback",
             "Upload only the tested browser verification candidate and exact DATA"]
    need(all(step.startswith("      - name: " + name + "\n") for step, name in zip(steps[2:], names)))
    source, dependencies, runtime, node, browser, seal, upload = steps[2:]
    for text in ('export YNX_BROWSER_DELIVERY="$RUNNER_TEMP/ynx-batch-browser-delivery"',
                 'printf \'YNX_BROWSER_DELIVERY=%s\\n\' "$YNX_BROWSER_DELIVERY" >> "$GITHUB_ENV"',
                 "test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"", "git diff --exit-code -- .",
                 "'2586af9ac40c824bbf4fc0ac7f8b98a07a5e86f2'", "'8f404e68dcd470f206b92bb75bdfad4d70998f78'",
                 "'2875034ca5afe3ef30b5e331ac37304991bbab87c4e4091dee97f73456a3325d'",
                 "assert.equal(process.versions.node, '26.7.0')", "assert.deepEqual(actual, [...source.files.map(record => record.path), 'SOURCE.json'].sort())",
                 "!entry.isSymbolicLink()", "stat.nlink === 1", "assert.equal(sha(raw), record.sha256)",
                 "record.gitBlob", "pkg.exports['./browser'], './src/browser.mjs'", "pkg.exports['.'], './src/index.mjs'"):
        need(text in source)
    need("run: timeout 90s npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org\n" in dependencies)
    need("const portable = providerInfo({provider: 'portable'})" in runtime and "providerInfo()" not in runtime
         and "node_modules/@noble/" in runtime and "assert.equal(portable.version, '0.6.1')" in runtime
         and "assert.equal(portable.hashesVersion, '2.2.0')" in runtime
         and "browserDependencyVersionVerified: false" in runtime)
    need("        id: nodetests\n        timeout-minutes: 3\n        run: timeout 120s npm run test:public\n" in node)
    need("        id: browser\n        timeout-minutes: 3\n" in browser
         and "          BROWSER_BINARY: /usr/bin/google-chrome\n" in browser
         and "          YNX_BROWSER_VERIFICATION_RECEIPT_OUT: ${{ runner.temp }}/ynx-batch-browser-delivery/BROWSER-VERIFICATION.json\n" in browser
         and 'test -x "$BROWSER_BINARY"' in browser
         and "          timeout 150s npm run test:browser\n" in browser)
    for text in ('npm pack --ignore-scripts --json --pack-destination "$YNX_BROWSER_DELIVERY"',
                 "assert.equal(receipt.browser.result.ok, true)", "assert.equal(receipt.browser.result.noRuntimeShims, true)",
                 "assert.equal(receipt.browser.result.randomnessCalls, 0)", "assert.equal(receipt.browser.result.provider.dependencyVersionVerified, false)",
                 "assert.deepEqual(receipt.browser.result.vectors, receipt.uint8)",
                 "assert.deepEqual(receipt.browser.result.officialSigVer, receipt.officialSigVer)",
                 "assert.equal(receipt.officialSigVer.total, 29)", "assert.equal(receipt.officialSigVer.positive, 5)",
                 "assert.equal(receipt.officialSigVer.negative, 24)", "assert.equal(receipt.nativeTestsExecuted, false)",
                 "'ynx-batch-v01-candidate-0.1.0-candidate.3.tgz'", "assert.deepEqual(entries.sort(), expected.map(record => 'package/' + record.path).sort())",
                 "tar(['-xOzf', archive, 'package/' + record.path]", "assert.equal(sha(raw), record.sha256)",
                 "fs.constants.COPYFILE_EXCL", "standaloneSourceSHA256: sha(snapshotRaw)",
                 "portableNodeVerificationExecuted: true", "nativeNodeQualified: false", "nativeTestsExecuted: false",
                 "qualifiedExport: './browser'", "packageRootNativeQualification: 'not-qualified-by-this-artifact'",
                 "nativeRuntimeRequirementUnavailable: receipt.nativeRuntimeRequirementUnavailable",
                 "browserVerificationExecuted: true", "privateKeyMaterialPublished: false",
                 "installed: false, authorityGranted: false", "assert.deepEqual(fs.readdirSync(out).sort(), [...names, 'SOURCE.json'].sort())"):
        need(text in seal)
    need("        if: ${{ success() && steps.nodetests.outcome == 'success' && steps.browser.outcome == 'success' && steps.seal.outcome == 'success' }}\n" in upload)
    need("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in upload
         and "          name: ynx-batch-browser-candidate-${{ github.sha }}\n" in upload
         and "          if-no-files-found: error\n" in upload)
    paths = re.findall(r"(?m)^            (.+)$", upload)
    need(paths == ['${{ runner.temp }}/ynx-batch-browser-delivery/' + name for name in
        ('ynx-batch-v01-candidate-0.1.0-candidate.3.tgz', 'SOURCE.json', 'STANDALONE-SOURCE.json',
         'PACKAGE-FILES.json', 'BROWSER-VERIFICATION.json')])
    need("continue-on-error:" not in job and "if: false" not in job
         and "workflow_dispatch" not in job and "npm publish" not in job and "    needs:" not in job)


def assert_native_compatibility_classification_contract(raw):
    """Unsupported native runtime is BLOCKED; it is never a portable test PASS."""
    job, steps = workflow_steps(raw, "native-compatibility")

    def need(condition):
        if not condition:
            raise AssertionError("native runtime classification changed; no native qualification claim")

    need("github.event_name == 'push'" in job and "workflow_dispatch" not in job)
    need("    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n" in job)
    need("        working-directory: packages/ynx-batch-v01\n" in job)
    need(len(steps) == 6)
    need("          ref: ${{ github.sha }}\n          persist-credentials: false\n" in steps[0])
    need("          node-version: '26.7.0'\n          check-latest: false\n" in steps[1])
    preflight, dependencies, native, result = steps[2:]
    for text in ("import {RUNTIME} from './src/native.mjs'", "actual.node === RUNTIME.node && actual.openssl === RUNTIME.openssl",
                 "fs.appendFileSync(process.env.GITHUB_OUTPUT, 'matched=' + matched + '\\n')",
                 "status: matched ? 'SUPPORTED_UNVERIFIED' : 'BLOCKED'", "nativeTestsExecuted: false, nativeQualified: false"):
        need(text in preflight)
    need("        if: steps.runtime.outputs.matched == 'true'\n" in dependencies
         and "run: timeout 90s npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org\n" in dependencies)
    need("        id: native\n        if: steps.runtime.outputs.matched == 'true'\n        timeout-minutes: 3\n        run: timeout 120s npm test\n" in native)
    for text in ("        if: ${{ !cancelled() }}\n", "YNX_NATIVE_TEST_OUTCOME: ${{ steps.native.outcome }}",
                 "const executed = outcome === 'success' || outcome === 'failure'",
                 "const qualified = matched && outcome === 'success'", "status: qualified ? 'QUALIFIED' : matched ? 'FAILED' : 'BLOCKED'",
                 "nativeTestsExecuted: executed, nativeQualified: qualified", "publicBrowserQualified: false, authorityGranted: false"):
        need(text in result)
    need("continue-on-error:" not in job and "provider: 'portable'" not in job and "if: false" not in job)


def assert_workflow_contract(raw):
    assert_native_compatibility_classification_contract(raw)
    assert_browser_verification_workflow_contract(raw)
    assert_native_cabi_workflow_contract(raw)
    assert_runtime_gateway_identity_workflow_contract(raw)
    assert_macos_source_register_workflow_contract(raw)
    assert_signed_business_supply_workflow_contract(raw)
    assert_fresh_business_supply_workflow_contract(raw)
    assert_fresh_business_execution_workflow_contract(raw)
    job, steps = workflow_steps(raw)

    def need(condition):
        if not condition:
            raise AssertionError("normal-CI workflow source contract changed; no scheduler claim")

    def by_id(identifier):
        matches = [step for step in steps if "        id: " + identifier + "\n" in step]
        need(len(matches) == 1)
        return matches[0]

    def condition(step):
        matches = re.findall(r"(?m)^        if: (.+)$", step)
        need(len(matches) == 1)
        return matches[0]

    expected_job_if = ("(github.event_name == 'push' && github.ref == 'refs/heads/main') || ((github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
        "github.ref == 'refs/heads/codex/ynx-pq-perf-integration') && (github.event_name == 'push' || "
        "(github.event_name == 'workflow_dispatch' && inputs.candidate_sha == github.sha))) || "
        "(github.event_name == 'workflow_dispatch' && (startsWith(github.ref, "
        "'refs/heads/codex/ynx-pq-remote-') || inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business))")
    need("    if: " + expected_job_if + "\n" in job)
    heavy_group = "ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade"
    heavy_modes = ("paired_n1", "consensus_e2e", "consensus_e2e_retained_history",
                   "consensus_remote_e2e_retained_history", "remote_signer_process", "consensus_fresh_paired_business")
    focused_group = ("${{ github.event_name == 'workflow_dispatch' && ("
                     + " || ".join("inputs." + name for name in heavy_modes)
                     + ") && '" + heavy_group
                     + "' || format('ynx-pq-source-{0}-{1}-{2}', github.workflow, github.ref, github.sha) }}")
    need("      group: " + focused_group + "\n      cancel-in-progress: false\n" in job)
    paired_job, _ = workflow_steps(raw, "pq-paired-n1")
    need("    concurrency:\n      group: " + heavy_group + "\n      cancel-in-progress: false\n" in paired_job)
    need("    needs: focused-go\n" in paired_job)
    need("    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' && inputs.candidate_sha == github.sha && inputs.paired_n1\n" in paired_job)
    need("    timeout-minutes: 5\n" in paired_job)
    need("    timeout-minutes: ${{ inputs.consensus_fresh_paired_business && 12 || 15 }}\n" in job)
    need("permissions:\n  contents: read\n  actions: read\n" in raw)
    need("      normal_ci_run_id:\n" in raw)
    for leaf in ("scripts/ops/validate-pq-remote-normal-ci.py", "scripts/ops/test_validate_pq_remote_normal_ci.py"):
        need("      - '" + leaf + "'\n" in raw)
    normal = by_id("normalci")
    need(condition(normal) == "${{ !cancelled() && steps.identity.outcome == 'success' && github.event_name == 'workflow_dispatch' && (inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) }}")
    need("          GH_TOKEN: ${{ github.token }}\n" in normal)
    need("          YNX_NORMAL_CI_RUN_ID: ${{ inputs.normal_ci_run_id }}\n" in normal)
    need(normal.count("${{ inputs.normal_ci_run_id }}") == 1)
    need("        run: |\n" in normal)
    body = normal.split("        run: |\n", 1)[1]
    need("${{" not in body and "python3 -B scripts/ops/validate-pq-remote-normal-ci.py" in body)
    for argument in ('--repo "$GITHUB_REPOSITORY"', '--candidate "$GITHUB_SHA"',
                     '--normal-run-id "$YNX_NORMAL_CI_RUN_ID"', '--current-run-id "$GITHUB_RUN_ID"'):
        need(argument in body)
    need("receipt['currentRunStartedAt']" in body and "datetime.timezone.utc" in body)
    need("output.write('YNX_REMOTE_WORKFLOW_STARTED_AT=' + str(int(started.timestamp()))" in body)
    need("datetime.datetime.now" not in body and "time.time()" not in body)
    build = by_id("pqnetworkbuild")
    network = by_id("pqnetwork")
    contract_runtime = by_id("pqnetworknode")
    contract_inputs = by_id("pqnetworkcontracts")
    remote_inputs_condition = "${{ success() && github.event_name == 'workflow_dispatch' && inputs.consensus_remote_e2e_retained_history && inputs.candidate_sha == github.sha && steps.identity.outcome == 'success' && steps.normalci.outcome == 'success' }}"
    need(condition(contract_runtime) == remote_inputs_condition)
    need(condition(contract_inputs) == remote_inputs_condition.replace("success() && ", "success() && steps.pqnetworknode.outcome == 'success' && ", 1))
    need("uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" in contract_runtime)
    need("          node-version: '24.19.0'\n" in contract_runtime)
    need("        timeout-minutes: 3\n" in contract_inputs)
    need("          NODE_OPTIONS: --max-old-space-size=1536\n" in contract_inputs)
    contract_body = contract_inputs.split("        run: |\n", 1)[1]
    contract_lines = [line.strip() for line in contract_body.splitlines()]
    source_check = 'git diff --exit-code HEAD -- package.json package-lock.json hardhat.config.ts scripts/contracts contracts'
    need('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in contract_lines)
    need(contract_lines.count(source_check) == 2)
    contract_commands = (
        "npm ci --ignore-scripts --no-audit --no-fund",
        "npm run hardhat:build -- contracts/devtools/SampleEVMWriteCounter.sol contracts/tokens/SampleYNXTCompatibleERC20.sol",
        "npm run contracts:selectors", "git diff --exit-code -- artifacts",
        "test -s artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json",
        "test -s artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json",
        "sha256sum contracts/devtools/SampleEVMWriteCounter.sol artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json artifacts/ynx-selector-metadata.json",
        "sha256sum contracts/tokens/SampleYNXTCompatibleERC20.sol artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json")
    need(all(command in contract_lines for command in contract_commands))
    positions = [contract_lines.index(command) for command in contract_commands]
    need(positions == sorted(positions)
         and contract_lines.index(source_check) < positions[0]
         and max(i for i, line in enumerate(contract_lines) if line == source_check) > positions[-1])
    base_condition = "${{ success() && github.event_name == 'workflow_dispatch' && (inputs.consensus_e2e || inputs.consensus_e2e_retained_history || inputs.consensus_remote_e2e_retained_history) && inputs.candidate_sha == github.sha && !inputs.paired_n1 && !inputs.remote_signer_process && (!inputs.consensus_remote_e2e_retained_history || (steps.normalci.outcome == 'success' && steps.pqnetworkcontracts.outcome == 'success')) }}"
    need(condition(build) == base_condition)
    need(condition(network) == "${{ success() && github.event_name == 'workflow_dispatch' && inputs.candidate_sha == github.sha && !inputs.paired_n1 && !inputs.remote_signer_process && ((steps.pqnetworkbuild.outcome == 'success' && (inputs.consensus_e2e || inputs.consensus_e2e_retained_history || inputs.consensus_remote_e2e_retained_history) && !inputs.consensus_fresh_paired_business && (!inputs.consensus_remote_e2e_retained_history || (steps.normalci.outcome == 'success' && steps.pqnetworkcontracts.outcome == 'success'))) || (inputs.consensus_fresh_paired_business && steps.identity.outcome == 'success' && steps.normalci.outcome == 'success' && steps.pqfreshprepare.outcome == 'success' && !inputs.consensus_e2e && !inputs.consensus_e2e_retained_history && !inputs.consensus_remote_e2e_retained_history)) }}")
    need("go test -p 1 -c -o \"$YNX_E2E_BUILD/consensus.test\" ./internal/consensus" in build)
    need("go build -p 1 -trimpath -o \"$YNX_E2E_BUILD/ynx-consensus-pq-remote-signer\" ./cmd/ynx-consensus-pq-remote-signer" in build)
    need("go test " not in network and "go build " not in network)
    for variable in ("YNX_E2E_CASE", "YNX_E2E_BUILD", "YNX_PQ_RETAINED_HISTORY", "YNX_PQ_REMOTE_RETAINED_HISTORY"):
        need('"' + variable + '=$' + variable + '"' in build)
    need('>> "$GITHUB_ENV"' in build)
    guard = "scripts/loadtest/pq-paired-linux-window.py --consensus-remote-e2e-retained-history"
    need(guard in network and guard not in build)
    budget = "if started > now or remaining < 150:"
    need("started = int(os.environ['YNX_REMOTE_WORKFLOW_STARTED_AT'])" in network)
    need("remaining = started + 12*60 - now" in network and budget in network)
    need("YNX_REMOTE_OUTER_BUDGET_REFUSED" in network and network.index(budget) < network.index(guard))
    need(steps.index(normal) < steps.index(contract_runtime) < steps.index(contract_inputs)
         < steps.index(build) < steps.index(network))
    need("activeMs=105000, cleanupMs=15000, totalMs=120000" in build)
    for cap in ("ownedRSSBytes=1073741824", "threads=320", "ownedProcesses=16", "privateBytes=536870912",
                "buildBytes=1073741824", "logBytes=1048576", "diskFloorBytes=1073741824",
                "availableMemoryFloorBytes=1207959552"):
        need(cap in build)
    controls = [step for step in steps if step.startswith("      - name: Verify Linux window controls without starting a node\n")]
    need(len(controls) == 1)
    need(condition(controls[0]) == "${{ !cancelled() && steps.identity.outcome == 'success' }}")
    need("test_validate_pq_remote_normal_ci.py" in controls[0]
         and "scripts/loadtest/test_pq_paired_linux_window.py" in controls[0])
    # Pure source/CLI admission controls need no compiled inputs and must fail
    # before the expensive protocol group, while still executing only once.
    protocol = [step for step in steps if step.startswith(
        "      - name: Verify pure dual-PQ protocol and account authorization\n")]
    need(len(protocol) == 1 and steps.index(controls[0]) < steps.index(protocol[0]))
    receipts = [step for step in steps if step.startswith((
        "      - name: Record public retained network-file size metadata after owned cleanup\n",
        "      - name: Preserve only public network-test logs and guard receipt\n"))]
    need(len(receipts) == 2)
    need(all(condition(step) == "${{ always() && (steps.pqnetwork.outcome == 'success' || steps.pqnetwork.outcome == 'failure') }}" for step in receipts))
    need(".cleanupComplete == true" in receipts[0])
    delivery_job, delivery_steps = workflow_steps(raw, "protocol-delivery")
    mac_job, _ = workflow_steps(raw, "proof-verifier-macos")
    push_condition = ("github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
                      "github.ref == 'refs/heads/codex/ynx-pq-perf-integration')")
    need(re.findall(r"(?m)^    needs: (.+)$", delivery_job) == ["[focused-go, caddy-source]"]
         and "    timeout-minutes: 12\n" in delivery_job)
    # One build-cache shape covers the original tests and later pinned ELFs.
    # Neither a step nor a command may silently restore the duplicate shape.
    need(re.findall(r"(?m)^      GOFLAGS: (.+)$", delivery_job) == ["'-p=1 -trimpath'"])
    need("GOFLAGS=" not in delivery_job and "          GOFLAGS:" not in delivery_job)
    need("continue-on-error:" not in delivery_job)
    need(re.findall(r"(?m)^    if: (.+)$", delivery_job) == [push_condition
         + " && needs.focused-go.result == 'success' && needs.caddy-source.result == 'success'"])
    # Caddy's source-only controls run independently once. Delivery consumes
    # their actual successful job result rather than replaying the old guard.
    caddy_job, caddy_steps = workflow_steps(raw, "caddy-source")
    need(caddy_job.split("    steps:\n", 1)[0] == "    if: " + push_condition
         + "\n    runs-on: ubuntu-24.04\n    timeout-minutes: 6\n")
    need("continue-on-error:" not in caddy_job)
    branches = re.findall(r"(?m)^  push:\n    branches:\n((?:      - [^\n]+\n)+)", raw)
    need(branches == ["      - 'main'\n      - 'codex/ynx-pq-public-upgrade'\n      - 'codex/ynx-pq-perf-integration'\n"])
    lines = lambda step: [line for line in step.splitlines() if line.strip()]
    need(lines(caddy_steps[0]) == [
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "        with:", "          ref: ${{ github.sha }}", "          persist-credentials: false"])
    need(lines(caddy_steps[1]) == [
        "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        "        with:", "          node-version: '24.19.0'"])
    sources = [step for step in caddy_steps if step.startswith("      - name: Record exact original Caddy source identity\n")]
    need(len(sources) == 1)
    source = sources[0]
    need(lines(source) == ["      - name: Record exact original Caddy source identity", "        id: source",
        "        run: |", "          test \"$(git rev-parse HEAD)\" = '${{ github.sha }}'", "          git diff --exit-code"])
    caddy_commands = (
        ("Verify original Caddy JSON consumer without changing services",
         "timeout 90s python3 -B scripts/verify/test_public_bft_caddy_json.py -v"),
        ("Verify independently prepared original Caddy baseline DATA",
         "timeout 90s python3 -B scripts/verify/test_prepare_public_bft_caddy_json_source.py -v"),
        ("Verify original Caddy source approval and normal cutover caller",
         "node scripts/verify/public-bft-caddy-json-source-check.mjs"),
        ("Verify existing Caddyfile and JSON ingress source controls",
         "timeout 120s bash scripts/verify/public-bft-gateway-ingress-check.sh"),
        ("Verify exact persistent baseline installer without operating services",
         "timeout 90s python3 -B scripts/verify/test_install_public_bft_caddy_json_baseline.py -v"),
        ("Verify real FD transitions in the original bounded process guard",
         "timeout 90s python3 -B scripts/verify/test_original_native_copy_guard.py -v"))
    qualified_caddy_steps = []
    for name, command in caddy_commands:
        found = [step for step in caddy_steps if step.startswith("      - name: " + name + "\n")]
        need(len(found) == 1)
        need(lines(found[0]) == ["      - name: " + name,
            "        if: ${{ !cancelled() && steps.source.outcome == 'success' }}",
            "        timeout-minutes: 3", "        run: " + command])
        need(caddy_steps.index(source) < caddy_steps.index(found[0]))
        qualified_caddy_steps.append(found[0])
    control_seals = [step for step in caddy_steps if step.startswith(
        "      - name: Seal only the normal bounded Caddy DATA control sources\n")]
    control_uploads = [step for step in caddy_steps if step.startswith(
        "      - name: Upload only the tested normal Caddy DATA control source bundle\n")]
    need(len(control_seals) == len(control_uploads) == 1)
    need(not re.search(r"(?m)^        if:", control_seals[0] + control_uploads[0]))
    need(all(caddy_steps.index(step) < caddy_steps.index(control_seals[0]) for step in qualified_caddy_steps))
    need(caddy_steps.index(control_seals[0]) < caddy_steps.index(control_uploads[0]))
    need(raw.count("bash scripts/verify/public-bft-gateway-ingress-check.sh") == 1)
    need("    needs: protocol-delivery\n" in mac_job and "    timeout-minutes: 12\n" in mac_job)
    need("    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/codex/ynx-pq-perf-integration')\n" in mac_job)
    need("          ref: ${{ github.sha }}\n" in delivery_job and "          ref: ${{ github.sha }}\n" in mac_job)
    combined = steps + delivery_steps
    by_name = lambda name: [step for step in combined if step.startswith("      - name: " + name + "\n")]
    copy_controls = by_name("Verify original-copy observation controls without touching the original case")
    need(len(copy_controls) == 1 and copy_controls[0] in steps)
    copy_controls = copy_controls[0]
    need(condition(copy_controls) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}")
    need("          set -euo pipefail\n" in copy_controls and "||" not in copy_controls.split("        run: |\n", 1)[1])
    need("timeout 45s python3 -B scripts/ops/test_verify_original_native_copy_once.py -v 2>&1 | tee" in copy_controls)
    need("grep -F -c 'YNX_NATIVE_ROFD_STABLE_FINAL_PATH_DATA_PASS'" in copy_controls and '\" -eq 1' in copy_controls)
    need("timeout 45s python3 -B scripts/ops/test_verify_retained_migration_preservation_once.py -v 2>&1 | tee" in copy_controls)
    need("grep -F -c 'YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS'" in copy_controls)
    for leaf in ("scripts/ops/remote/verify-original-native-copy-once.sh", "scripts/ops/test_verify_original_native_copy_once.py",
                 "scripts/ops/remote/verify-retained-migration-preservation-once.sh", "scripts/ops/test_verify_retained_migration_preservation_once.py"):
        need("      - '" + leaf + "'\n" in raw)
    signer_name = "Build and pin normal signer process binaries without running them"
    for name in NORMAL_STEP_NAMES:
        found = by_name(name)
        need(len(found) == (2 if name == signer_name else 1))
        for step in found:
            need(condition(step).startswith("${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (")
                 and condition(step).endswith(") }}"))
    non_host = by_name("Verify complete state bridge and sponsor continuity")[0]
    host = by_name("Verify original Host source, live lifecycle and delivery persistence")[0]
    need("-skip '^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$)' ./internal/consensus" in non_host)
    need("-run '^TestProofHost' ./internal/consensus" in host)
    need("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT: ${{ runner.temp }}/ynx-proof-host-source-public" in host)
    need("YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT: ${{ runner.temp }}/ynx-pq-initial-prepared-funding-public.json" in host)
    need('test -s "$YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT"' in host
         and 'sha256sum "$YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT"' in host)
    large = by_name("Verify complete large original migration through normal package and cold recovery")[0]
    need(large in delivery_steps and "        timeout-minutes: 3\n" in large)
    need(large.count("go test ") == 1 and "-timeout=180s -v -run '^TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$' ./internal/consensus" in large)
    need("--- PASS: TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery (" in large)
    need("grep -F -c 'COMET_MIGRATION_REFERENCE_LARGE_CANONICAL_RECOVERY_PASS'" in large and '" -eq 1' in large)
    cutover = by_name("Verify original public cutover caller preserves independent operator and runtime pins")[0]
    for script in ("public-bft-production-driver-check.sh --snapshot-only", "owner-handover-check.sh",
                   "production-service-signer-ceremony-check.sh", "production-custody-review-check.sh",
                   "public-bft-production-candidate-check.sh", "public-bft-cutover-transaction-check.sh",
                   "public-bft-gateway-dependencies-check.sh",
                   "public-bft-validator-registration-check.sh"):
        need("bash scripts/verify/" + script in cutover)
    need("bash scripts/verify/public-bft-gateway-ingress-check.sh" not in cutover)
    need("PUBLIC_BFT_FINAL_SNAPSHOT_PARTIAL_ERASED" in cutover)
    # All current consensus cases still execute once. Only the new large
    # fixture runs separately under its original bounded timeout; no old case
    # is removed. Private Host stores stay on their original runner.
    for name in ("Verify complete state bridge and sponsor continuity", "Verify Whole BFT gateway and native container readback"):
        need(by_name(name)[0] in steps)
    gateway = by_name("Verify Whole BFT gateway and native container readback")[0]
    need("YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT: ${{ runner.temp }}/ynx-pq-contract-deploy-public-interop.json" in gateway)
    need("          go test -p 1 -count=1 -timeout=180s ./internal/bftgateway ./cmd/ynx-bft-gatewayd\n" in gateway
         and gateway.count("go test ") == 1)
    need('test -s "$YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT"' in gateway
         and 'sha256sum "$YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT"' in gateway)
    deploy_upload = by_name("Upload only public compiled contract deploy and finality interoperability fixture")
    need(len(deploy_upload) == 1 and deploy_upload[0] in steps)
    deploy_upload = deploy_upload[0]
    need(condition(deploy_upload) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.pqgateway.outcome == 'success') }}")
    need("uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in deploy_upload)
    need("          name: ynx-pq-contract-deploy-public-interop-${{ github.sha }}\n" in deploy_upload)
    need("          path: ${{ runner.temp }}/ynx-pq-contract-deploy-public-interop.json\n" in deploy_upload
         and "          path: |" not in deploy_upload and "          if-no-files-found: error\n" in deploy_upload)
    need(steps.index(gateway) < steps.index(deploy_upload))
    for name in ("Verify original Host source, live lifecycle and delivery persistence",
                 "Verify normal Host source producer with original signed transaction fixture",
                 "Verify original public cutover caller preserves independent operator and runtime pins",
                 "Verify normal proof CLI with exact public interoperability fixture",
                 "Verify normal transaction proof CLI with exact public two-header fixture",
                 "Verify stopped-source publication and original Host ABI through normal binaries"):
        need(by_name(name)[0] in delivery_steps)
    initial_cli = by_name("Verify initial registration and funded transfer through the original proof CLI")
    need(len(initial_cli) == 1 and initial_cli[0] in delivery_steps)
    need(condition(initial_cli[0]) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && steps.identity.outcome == 'success') }}")
    for token in ("timeout-minutes: 2", "YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT: ${{ runner.temp }}/ynx-pq-initial-prepared-funding-public.json",
                  "-run '^TestTransactionProofInitialPreparedFundingOriginalCLI$'", "--- PASS: TestTransactionProofInitialPreparedFundingOriginalCLI (",
                  "PQ_INITIAL_FUNDED_TRANSACTION_CLI_VERIFIED_DATA_ONLY"):
        need(token in initial_cli[0])
    need(delivery_steps.index(by_name("Verify original Host source, live lifecycle and delivery persistence")[0]) < delivery_steps.index(initial_cli[0]))
    vulnerability = by_name("Check reachable vulnerabilities in the eight production runtime commands")
    need(len(vulnerability) == 1 and vulnerability[0] in steps
         and raw.count("      - name: Check reachable vulnerabilities in the eight production runtime commands\n") == 1)
    need(condition(vulnerability[0]) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success' && github.event_name == 'push') }}")
    need("        timeout-minutes: 3\n" in vulnerability[0] and "        run: >-\n" in vulnerability[0])
    need("go run golang.org/x/vuln/cmd/govulncheck@v1.1.4" in vulnerability[0]
         and "||" not in vulnerability[0].split("        run: >-\n", 1)[1] and "continue-on-error:" not in vulnerability[0])
    need(re.findall(r"\./cmd/([a-z-]+)", vulnerability[0]) == ["ynx-abci", "ynx-comet", "ynx-bft-gatewayd",
         "ynx-consensus-pq-remote-signer", "ynx-consensus-pq-key-init", "ynx-consensus-proof-verify", "ynx-consensus-package", "ynx-consensus-keycheck"])
    need(job.index("      - uses: actions/setup-go@") < job.index("      - name: Record exact candidate identity\n")
         and steps.index(vulnerability[0]) == steps.index(by_id("identity")) + 1
         and steps.index(vulnerability[0]) < steps.index(protocol[0]))
    # A reachable vulnerability blocks this job and the delivery dependency,
    # while independent source/implementation checks still get their results.
    need(condition(protocol[0]) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}")
    need(condition(non_host) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (!cancelled() && steps.identity.outcome == 'success') }}")
    focused_signer, delivery_signer = by_name(signer_name)
    need("success() && github.event_name == 'workflow_dispatch' && inputs.remote_signer_process" in condition(focused_signer))
    need("github.event_name == 'push' ||" in condition(delivery_signer))
    need("      inputs-artifact-id: ${{ steps.stageupload.outputs.artifact-id }}\n" in job)
    need("      inputs-manifest-sha256: ${{ steps.stagepack.outputs.manifest-sha256 }}\n" in job)
    pack, upload = by_id("stagepack"), by_id("stageupload")
    need(condition(pack) == "${{ success() && github.event_name == 'push' }}")
    need(condition(upload) == "${{ success() && github.event_name == 'push' && steps.stagepack.outcome == 'success' }}")
    need("scripts/ops/pq-ci-stage-inputs.py export" in pack and 'test -z "$(git status --porcelain --untracked-files=normal)"' in pack)
    need("name: ynx-pq-stage-inputs-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}" in upload)
    admit = by_name("Admit only the successful producer artifact identity")
    download = by_name("Download only this producer artifact by immutable ID")
    need(len(admit) == len(download) == 1)
    need("uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093" in download[0])
    need("          merge-multiple: true\n" in download[0])
    need(delivery_steps.index(admit[0]) < delivery_steps.index(download[0]))
    need("artifact-ids: ${{ needs.focused-go.outputs.inputs-artifact-id }}" in delivery_job)
    need("          name: ynx-pq-stage-inputs-" not in delivery_job)
    restore = [step for step in delivery_steps if "        id: identity\n" in step]
    need(len(restore) == 1 and "scripts/ops/pq-ci-stage-inputs.py restore" in restore[0])
    need('YNX_STAGE_MANIFEST_SHA256: ${{ needs.focused-go.outputs.inputs-manifest-sha256 }}' in restore[0])
    for parameter in ('--commit "$GITHUB_SHA"', '--source-tree "$(git rev-parse HEAD^{tree})"',
                      '--run-id "$GITHUB_RUN_ID"', '--run-attempt "$GITHUB_RUN_ATTEMPT"'):
        need(parameter in pack and parameter in restore[0])
    need('--manifest-sha256 "$YNX_STAGE_MANIFEST_SHA256"' in restore[0])
    need(delivery_steps.index(restore[0]) < delivery_steps.index(by_name("Verify original Host source, live lifecycle and delivery persistence")[0]))
    need(delivery_steps.index(download[0]) < delivery_steps.index(restore[0]))
    compiled = by_name("Prepare same-source compiled contract inputs for delivery callers")
    need(len(compiled) == 1 and compiled[0] in delivery_steps)
    need(delivery_steps.index(restore[0]) < delivery_steps.index(compiled[0])
         < delivery_steps.index(by_name("Verify original candidate delivery with pinned archive permissions")[0]))
    for command in ("npm ci --ignore-scripts --no-audit --no-fund",
                    "npm run hardhat:build -- contracts/devtools/SampleEVMWriteCounter.sol contracts/tokens/SampleYNXTCompatibleERC20.sol",
                    "npm run contracts:selectors", "git diff --exit-code -- artifacts"):
        need(command in compiled[0])
    target_test = [step for step in delivery_steps if "        id: pqprooftargetcmd\n" in step]
    need(len(target_test) == 1)
    target_test = target_test[0]
    need(condition(target_test) == "${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && steps.identity.outcome == 'success') }}")
    need("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT: ${{ runner.temp }}/ynx-proof-host-source-public" in target_test)
    need("go test -p 1 -count=1 -timeout=90s -v -run '^TestInspectProofHostTarget' ./cmd/ynx-comet" in target_test)
    need("grep -F -- '--- PASS: TestInspectProofHostTargetNormalCommandRetainedFixture ('" in target_test)
    publisher = by_name("Verify stopped-source publication and original Host ABI through normal binaries")[0]
    need(delivery_steps.index(host) < delivery_steps.index(target_test) < delivery_steps.index(publisher))
    inspect_call = "inspected = invoke('inspect-stopped-original-target', inspect, b'', 48 << 20)"
    export_call = "delivery = invoke('export-stopped-original-source', publish, b'', 16384)"
    need("inspect = [str(candidate / 'ynx-comet'), 'inspect-proof-host-target'," in publisher)
    need(inspect_call in publisher and export_call in publisher and publisher.index(inspect_call) < publisher.index(export_call))
    for original in ("'--engine-height', plan['engineHeight']", "'--engine-app-hash', plan['engineAppHash']",
                     "'--trusted-height', plan['trustedHeight']", "'--trusted-block-hash', plan['trustedBlockHash']",
                     "'--trusting-period-nanoseconds', plan['trustingPeriodNanoseconds']",
                     "'--trust-level-numerator', plan['trustLevelNumerator']", "'--trust-level-denominator', plan['trustLevelDenominator']",
                     "'--transaction-hash', expected_target['transactionHash']", "'--native-wire-hash', expected_target['nativeWireHash']"):
        need(original in publisher)
    need("expected_target = plan['expectedTransaction']" in publisher)
    need("base64.b64decode(expected_target[field], validate=True)" in publisher)
    need("('envelope', 'target-original-envelope', 'transactionHash')" in publisher
         and "('nativeWire', 'target-original-native-wire', 'nativeWireHash')" in publisher)
    need("os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600" in publisher)
    need("inspected['expectedTransaction'] != expected_target" in publisher)
    need("inspected['classification'] != 'data'" in publisher
         and "('sourceReadOnly', 'writerExcluded', 'signingWriterExcluded', 'ledgerProofVerified')" in publisher)
    need("inspected['nativeRootAuthorized'] is not False or inspected['deploymentVerified'] is not False" in publisher)
    need("target_verification['nativeGrant'] is not False" in publisher)
    need("('included', 'finalized', 'executionSuccessful')" in publisher
         and "target_verification['executionCode'] != '0'" in publisher)
    host_upload = by_name("Upload only public Host delivery and normal CLI receipt")[0]
    need("        timeout-minutes: 2\n" in publisher and "cwd=case, timeout=25, check=False" in publisher)
    need("def run_case(prefix, expected_type, receipt_name):" in publisher)
    need("metadata_raw = read(case / (prefix + 'metadata.json'), 16384)" in publisher)
    for name in ('source-plan.json', 'delivery', 'request.json'):
        need("case / (prefix + '" + name + "')" in publisher)
    need("plan['expectedTransaction']['transactionType'] != expected_type" in publisher)
    need("single_plan = run_case('', 'pq_transfer', 'ynx-proof-host-source-cli-public-receipt.json')" in publisher)
    need("typed_plan = run_case('typed-', 'pq_action', 'ynx-proof-host-typed-source-cli-public-receipt.json')" in publisher)
    need("path = case / (prefix + name)" in publisher)
    need("('cometDataDirectory', 'engineHeight', 'engineAppHash')" in publisher)
    need("transactionType=result['transactionType'], transactionHash=result['transactionHash'], nativeWireHash=result['nativeWireHash']" in publisher
         and "height=result['height'], index=result['index']" in publisher)
    need("public_catalog = dict(migration='migration.json', genesis='genesis.json', state='committed-state.json'" in publisher)
    need("public_catalog.get(item['role']) != item['name']" in publisher
         and "len({item['role'] for item in entries}) != len(entries)" in publisher)
    need("set(p.name for p in destination.iterdir()) != set(originals)" in publisher
         and "str(len(raw)) != item['bytes'] or sha(raw) != item['sha256']" in publisher)
    upload_paths = host_upload.split("          path: |\n", 1)[1].split("          if-no-files-found:", 1)[0]
    paths = [line.strip() for line in upload_paths.splitlines() if line.strip()]
    need(paths == ['${{ runner.temp }}/ynx-proof-host-source-public/delivery',
                   '${{ runner.temp }}/ynx-proof-host-source-public/request.json',
                   '${{ runner.temp }}/ynx-proof-host-source-cli-public-receipt.json',
                   '${{ runner.temp }}/ynx-proof-host-source-public/typed-delivery',
                   '${{ runner.temp }}/ynx-proof-host-source-public/typed-request.json',
                   '${{ runner.temp }}/ynx-proof-host-typed-source-cli-public-receipt.json',
                   '${{ runner.temp }}/ynx-pq-initial-prepared-funding-public.json'])
    need("test_pq_ci_stage_inputs.py" in controls[0])
    need("          python3 -B -m unittest discover -s scripts/ops -p 'test_prepare_testnet_assets.py' -v\n" in controls[0])


class NormalCIWorkflowSourceControls(unittest.TestCase):
    def test_browser_public_snapshot_and_actual_headless_job_are_closed_and_required_for_its_artifact(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_browser_verification_workflow_contract(raw)
        job, steps = workflow_steps(raw, "browser-verification")
        source, dependencies, runtime, node, browser, seal, upload = steps[2:]

        def change(before, after, step=None):
            target = raw if step is None else step
            self.assertIn(before, target)
            altered = target.replace(before, after, 1)
            return altered if step is None else raw.replace(step, altered, 1)

        changes = [
            change("      - 'packages/ynx-batch-v01/**'\n", ""),
            raw.replace("  browser-verification:\n" + job, "", 1),
            raw.replace(job, job.replace("github.event_name == 'push'", "github.event_name == 'workflow_dispatch'", 1), 1),
            change("timeout-minutes: 8", "timeout-minutes: 18", job),
            change("      NODE_OPTIONS: --max-old-space-size=256\n",
                   "      NODE_OPTIONS: --max-old-space-size=256\n      YNX_BROWSER_DELIVERY: ${{ runner.temp }}/ynx-batch-browser-delivery\n", job),
            change('export YNX_BROWSER_DELIVERY="$RUNNER_TEMP/ynx-batch-browser-delivery"',
                   ': # output directory not initialized', source),
            change('printf \'YNX_BROWSER_DELIVERY=%s\\n\' "$YNX_BROWSER_DELIVERY" >> "$GITHUB_ENV"',
                   ': # output directory not propagated', source),
            change("node-version: '26.7.0'", "node-version: '24.19.0'", steps[1]),
            change("persist-credentials: false", "persist-credentials: true", steps[0]),
            change("2586af9ac40c824bbf4fc0ac7f8b98a07a5e86f2", "0" * 40, source),
            change("2875034ca5afe3ef30b5e331ac37304991bbab87c4e4091dee97f73456a3325d", "0" * 64, source),
            change("assert.equal(sha(raw), record.sha256)", "void record.sha256", source),
            change("!entry.isSymbolicLink()", "true", source),
            change("--ignore-scripts", "--include=dev", dependencies),
            change("const portable = providerInfo({provider: 'portable'})", "const portable = providerInfo()", runtime),
            change("timeout 120s npm run test:public", "true # original codec/public tests skipped", node),
            change("/usr/bin/google-chrome", "/bin/echo", browser),
            change("timeout 150s npm run test:browser", "node --input-type=module -e 'console.log(true)'", browser),
            change("assert.equal(receipt.browser.result.ok, true)", "void receipt.browser.result", seal),
            change("assert.equal(receipt.browser.result.provider.dependencyVersionVerified, false)", "void receipt.browser.result.provider", seal),
            change("assert.deepEqual(entries.sort(), expected.map(record => 'package/' + record.path).sort())", "void entries", seal),
            change("privateKeyMaterialPublished: false", "privateKeyMaterialPublished: true", seal),
            change("nativeNodeQualified: false", "nativeNodeQualified: true", seal),
            change("qualifiedExport: './browser'", "qualifiedExport: '.'", seal),
            change("assert.equal(receipt.officialSigVer.total, 29)", "void receipt.officialSigVer", seal),
            change("installed: false, authorityGranted: false", "installed: true, authorityGranted: true", seal),
            change("steps.browser.outcome == 'success'", "true", upload),
            change("if-no-files-found: error", "if-no-files-found: warn", upload),
            change("            ${{ runner.temp }}/ynx-batch-browser-delivery/BROWSER-VERIFICATION.json\n",
                   "            ${{ runner.temp }}/ynx-batch-browser-delivery\n", upload),
            change("          if-no-files-found: error\n", "            ${{ runner.temp }}/synthetic/private-key.der\n          if-no-files-found: error\n", upload),
            raw.replace(source, "", 1).replace(browser, browser + source, 1),
        ]
        for index, changed in enumerate(changes):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_browser_verification_workflow_contract(changed)

    def test_unavailable_native_runtime_is_explicitly_blocked_without_a_fake_pass_or_fallback(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_native_compatibility_classification_contract(raw)
        job, steps = workflow_steps(raw, "native-compatibility")
        preflight, dependencies, native, result = steps[2:]
        mutations = [
            raw.replace("  native-compatibility:\n" + job, "", 1),
            raw.replace(preflight, preflight.replace("actual.node === RUNTIME.node && actual.openssl === RUNTIME.openssl", "actual.node === RUNTIME.node", 1), 1),
            raw.replace(preflight, preflight.replace("'BLOCKED'", "'QUALIFIED'", 1), 1),
            raw.replace(dependencies, dependencies.replace("steps.runtime.outputs.matched == 'true'", "true", 1), 1),
            raw.replace(native, native.replace("steps.runtime.outputs.matched == 'true'", "true", 1), 1),
            raw.replace(native, native.replace("timeout 120s npm test", "npm run test:public", 1), 1),
            raw.replace(native, native.replace("        run:", "        continue-on-error: true\n        run:", 1), 1),
            raw.replace(result, result.replace("const qualified = matched && outcome === 'success'", "const qualified = true", 1), 1),
            raw.replace(result, result.replace("nativeTestsExecuted: executed", "nativeTestsExecuted: true", 1), 1),
        ]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_native_compatibility_classification_contract(changed)

    def test_actual_workflow_source_keeps_gate_guard_caps_receipts_and_normal_push(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_workflow_contract(raw)

    def test_delivery_tests_and_pinned_binaries_keep_one_compilation_shape(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_workflow_contract(raw)
        job, _ = workflow_steps(raw, "protocol-delivery")
        flag = "      GOFLAGS: '-p=1 -trimpath'\n"
        self.assertEqual(job.count(flag), 1)
        mutations = [job.replace(flag, replacement, 1) for replacement in (
            "", "      GOFLAGS: '-p=1'\n", "      GOFLAGS: '-p=2 -trimpath'\n")]
        host = "YNX_PQ_NETWORK_E2E='' go test -p 1 -count=1 -timeout=180s -run '^TestProofHost'"
        self.assertIn(host, job)
        mutations.append(job.replace(host, host.replace(" go test", " GOFLAGS= go test", 1), 1))
        mutations.append(job.replace("          YNX_PROOF_HOST_SOURCE_FIXTURE_OUT:",
            "          GOFLAGS: ''\n          YNX_PROOF_HOST_SOURCE_FIXTURE_OUT:", 1))
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, job)
            whole = raw.replace("  protocol-delivery:\n" + job,
                "  protocol-delivery:\n" + changed, 1)
            self.assertNotEqual(whole, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(whole)

    def test_fresh_execution_rejects_missing_default_gate_pins_relocation_or_original_controller(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        _, steps = workflow_steps(raw)
        prepare = next(step for step in steps if "        id: pqfreshprepare\n" in step)
        network = next(step for step in steps if "        id: pqnetwork\n" in step)
        normal = next(step for step in steps if "        id: normalci\n" in step)
        identity = next(step for step in steps if "        id: identity\n" in step)
        option = raw.split("      consensus_fresh_paired_business:\n", 1)[1].split("      remote_signer_process:\n", 1)[0]
        mutations = [raw.replace(option, option.replace("default: false", "default: true", 1), 1),
            raw.replace(identity, identity.replace('"$YNX_ENTRY_REMOTE_PROCESS" "${YNX_ENTRY_FRESH_BUSINESS:-false}"; do', '"$YNX_ENTRY_REMOTE_PROCESS"; do', 1), 1),
            raw.replace(identity, identity.replace('if [ "${YNX_ENTRY_FRESH_BUSINESS:-false}"', 'if [ "$YNX_ENTRY_FRESH_BUSINESS"', 1), 1),
            raw.replace(identity, identity.replace('"${YNX_ENTRY_FRESH_BUSINESS:-false}"; do', '"$YNX_ENTRY_FRESH_BUSINESS"; do', 1), 1),
            raw.replace(normal, normal.replace("normal_args+=(--profile consensus-fresh-paired-business-v1)", "normal_args+=()", 1), 1),
            raw.replace(prepare, "", 1),
            raw.replace(prepare, prepare.replace("steps.normalci.outcome == 'success'", "true", 1), 1),
            raw.replace(prepare, prepare.replace("inputs.consensus_fresh_paired_business", "true", 1), 1),
            raw.replace(prepare, prepare.replace('timeout 120s gh api', 'timeout 180s gh api', 1), 1),
            raw.replace(prepare, prepare.replace("archive_pin == dict(bytes=gate['artifact']['archiveBytes'], sha256=gate['artifact']['archiveSHA256'])", "True", 1), 1),
            raw.replace(prepare, prepare.replace("{entry.filename for entry in entries} == catalog", "True", 1), 1),
            raw.replace(prepare, prepare.replace("set(original) == set(keys)", "True", 1), 1),
            raw.replace(prepare, prepare.replace("original['runAttempt'] == gate['normalRunAttempt']", "True", 1), 1),
            raw.replace(prepare, prepare.replace("original['sourceLeaves'] == {key: pin['sha256'] for key, pin in pins.items()}", "True", 1), 1),
            raw.replace(prepare, prepare.replace("file_pin(destination, maximum) == expected", "True", 1), 1),
            raw.replace(prepare, prepare.replace("file_pin(intake / 'original.zip', 256 << 20) == archive_pin", "True", 1), 1),
            raw.replace(prepare, prepare.replace("write(intake / 'SOURCE.json', source_raw)", "write(build / 'SOURCE.json', source_raw)", 1), 1),
            raw.replace(prepare, prepare.replace("a34a55a856e021c71565b1155b2767951e73147771841fc80f73f6e582a6edec", "0" * 64, 1), 1),
            raw.replace(prepare, prepare.replace("caps=guard.fixed_caps(guard.FRESH_BUSINESS_E2E_PROFILE)", "caps=dict(activeMs=120000)", 1), 1),
            raw.replace(prepare, prepare.replace("guard.validate_consensus_fresh_business_recipe(plan, case / 'prepared.json', inherited={})", "pass", 1), 1),
            raw.replace(network, network.replace("--consensus-fresh-paired-business", "--consensus-signed-business", 1), 1),
            raw.replace(network, network.replace("if started > now or remaining < 150:", "if remaining < 120:", 1), 1),
            raw.replace(prepare, "", 1).replace(network, network + prepare, 1),
            raw.replace("    timeout-minutes: ${{ inputs.consensus_fresh_paired_business && 12 || 15 }}\n",
                "    timeout-minutes: ${{ inputs.consensus_fresh_paired_business && 15 || 15 }}\n", 1)]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_fresh_business_supply_requires_original_client_and_closed_data_only_inputs(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_fresh_business_supply_workflow_contract(raw)
        _, steps = workflow_steps(raw, "protocol-delivery")
        receive = next(s for s in steps if s.startswith("      - name: Receive the exact normal fresh performance client without executing it\n"))
        seal = next(s for s in steps if s.startswith("      - name: Seal the independent fresh paired-business public inputs without executing them\n"))
        upload = next(s for s in steps if s.startswith("      - name: Upload only the exact public fresh paired-business build inputs\n"))
        previous = next(s for s in steps if s.startswith("      - name: Upload only the exact public signed-business build inputs\n"))
        mutations = [
            raw.replace(receive, receive.replace("timeout 90s", "timeout 180s", 1), 1),
            raw.replace(receive, receive.replace("artifacts/12609705118/zip", "artifacts/12609705119/zip", 1), 1),
            raw.replace(receive, receive.replace("9746d58ff81522bf58fe92825f9202883e5db44e27c0ed8b523ec76054788eaf", "0" * 64), 1),
            raw.replace(receive, receive.replace("len(entries) != 3", "len(entries) != 4", 1), 1),
            raw.replace(receive, receive.replace("hashlib.sha256(archive).hexdigest() != digest", "False", 1), 1),
            raw.replace(seal, seal.replace("previous_source['protocolCommit'] != commit", "False", 1), 1),
            raw.replace(seal, seal.replace("4866cc3924c060eb6a29939915d39b1c5c625607", "19b9fafcfbb3f434b9ff745fb785afb1d0741247"), 1),
            raw.replace(seal, seal.replace("8f2d4f58808dee77ab00dc69a9a285f770b7aeafa49b4e8865455f581ad1d438", "0" * 64), 1),
            raw.replace(seal, seal.replace("binariesExecuted=False", "binariesExecuted=True", 1), 1),
            raw.replace(seal, seal.replace("          python3 -B - <<'PY'\n", "          go build ./cmd/ynx-consensus-perf-client\n          python3 -B - <<'PY'\n", 1), 1),
            raw.replace(seal, seal.replace("          python3 -B - <<'PY'\n", "          YNX_PQ_NETWORK_FRESH_BUSINESS_E2E=authorized-fresh-four-node-business-window\n          python3 -B - <<'PY'\n", 1), 1),
            raw.replace(upload, upload.replace("steps.pqfreshbusinessbuild.outcome == 'success'", "true", 1), 1),
            raw.replace(upload, upload.replace("/client/go-build-info.txt", "/private/validator-key.json", 1), 1),
            raw.replace(receive, receive.replace("gh api --method GET repos/JiahaoAlbus/YNX-Chain/actions/artifacts/12609705118/zip", "gh api --method GET repos/JiahaoAlbus/YNX-Chain/actions/artifacts/12609705118/zip || true", 1), 1),
            raw.replace(receive + seal + upload, "", 1).replace(previous, receive + seal + upload + previous, 1),
        ]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_fresh_business_supply_workflow_contract(changed)

    def test_signed_business_supply_reuses_exact_binaries_and_never_executes_the_window(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_signed_business_supply_workflow_contract(raw)
        _, steps = workflow_steps(raw, "protocol-delivery")
        checkout = next(step for step in steps if step.startswith(
            "      - name: Checkout the exact signed-business performance client source\n"))
        build = next(step for step in steps if step.startswith(
            "      - name: Build and seal the exact signed-business inputs without starting nodes\n"))
        upload = next(step for step in steps if step.startswith(
            "      - name: Upload only the exact public signed-business build inputs\n"))
        candidate_delivery = next(step for step in steps if step.startswith(
            "      - name: Verify original candidate delivery with pinned archive permissions\n"))
        business_supply = checkout + build + upload
        self.assertIn(business_supply, raw)
        mutations = [
            raw.replace(checkout, checkout.replace("ref: 3f5b1ce792616b01b38fe4320c6d4d83fbcc22a0", "ref: main", 1), 1),
            raw.replace(checkout, checkout.replace("persist-credentials: false", "persist-credentials: true", 1), 1),
            raw.replace(build, build.replace("github.event_name == 'push'", "github.event_name == 'workflow_dispatch'", 1), 1),
            raw.replace(build, build.replace("timeout-minutes: 3", "timeout-minutes: 6", 1), 1),
            raw.replace(build, build.replace("build -p 1 -trimpath -mod=readonly", "test -p 1 -trimpath", 1), 1),
            raw.replace(build, build.replace("'4762ac0be18454c3504939cb2d9e232cdbfc1114'", "'0000000000000000000000000000000000000000'", 1), 1),
            raw.replace(build, build.replace("read_record(runtime / 'SOURCE.json', os.environ['YNX_RUNTIME_MANIFEST_SHA'])", "json.loads((runtime / 'SOURCE.json').read_text())", 1), 1),
            raw.replace(build, build.replace("copy(remote / 'consensus.test'", "copy(runtime / 'ynx-comet'", 1), 1),
            raw.replace(build, build.replace("'ynx-bft-gatewayd', 'ynx-consensus-perf-client'", "'ynx-comet', 'ynx-consensus-perf-client'", 1), 1),
            raw.replace(build, build.replace("sourceRoot=str(source_root)", "sourceRoot='/old-runner/source'", 1), 1),
            raw.replace(build, build.replace("relocatedAbsoluteManifestRunnable=False", "relocatedAbsoluteManifestRunnable=True", 1), 1),
            raw.replace(build, build.replace("nodesStarted=False", "nodesStarted=True", 1), 1),
            raw.replace(build, build.replace("          python3 -B - <<'PY'\n", "          YNX_PQ_NETWORK_BUSINESS_E2E=authorized-four-node-business-window\n          python3 -B - <<'PY'\n", 1), 1),
            raw.replace(upload, upload.replace("steps.pqsignedbusinessbuild.outcome == 'success'", "true", 1), 1),
            raw.replace(upload, upload.replace("          if-no-files-found: error", "          if-no-files-found: warn", 1), 1),
            raw.replace(upload, upload.replace("/source/internal/consensus/pq_network_business_test.go", "/private/validator-key.json", 1), 1),
            raw.replace(upload, upload.replace("          path: |\n", "          path: ${{ runner.temp }}/ynx-pq-signed-business-build\n          unused-path: |\n", 1), 1),
            raw.replace(build, "", 1).replace(checkout, build + checkout, 1),
            raw.replace(business_supply, "", 1).replace(candidate_delivery, business_supply + candidate_delivery, 1),
        ]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_signed_business_supply_workflow_contract(changed)

    def test_macos_source_registration_supply_requires_real_build_closed_artifact_and_data_only(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_macos_source_register_workflow_contract(raw)
        _, steps = workflow_steps(raw, "proof-verifier-macos")
        build = next(step for step in steps if step.startswith(
            "      - name: Build the normal macOS SourceOwner registration CLI without executing it\n"))
        upload = next(step for step in steps if step.startswith(
            "      - name: Upload only public macOS SourceOwner registration executables and exact source pins\n"))
        changes = [
            raw.replace(build, "", 1),
            raw.replace(build, build.replace("        timeout-minutes: 5\n", "        timeout-minutes: 10\n", 1), 1),
            raw.replace(build, build.replace("        run: |\n", "        if: false\n        run: |\n", 1), 1),
            raw.replace(build, build.replace("in arm64 amd64; do", "in arm64; do", 1), 1),
            raw.replace(build, build.replace("go build -p 1 -trimpath", "echo pretend-build -p 1 -trimpath", 1), 1),
            raw.replace(build, build.replace("          python3 -B - <<'PY'\n", '          "$YNX_MAC_REGISTER/ynx-comet-darwin-arm64" register-proof-host-source\n' + "          python3 -B - <<'PY'\n", 1), 1),
            raw.replace(build, build.replace("binaries[name] = pin(path)", "binaries[name] = dict(bytes=1, sha256='0'*64)", 1), 1),
            raw.replace(build, build.replace("gitBlob=subprocess.check_output(['git','rev-parse','HEAD:'+name], text=True).strip()", "gitBlob='unobserved'", 1), 1),
            raw.replace(build, build.replace("requestMaxBytes=4096", "requestMaxBytes=65536", 1), 1),
            raw.replace(build, build.replace("publicDataOnly=True, nativeRootAuthorized=False", "publicDataOnly=True, nativeRootAuthorized=True", 1), 1),
            raw.replace(upload, upload.replace("          path: |\n", "          path: ${{ runner.temp }}/ynx-pq-macos-proof-source-register\n", 1), 1),
            raw.replace(upload, upload.replace("          if-no-files-found: error\n", "            ${{ runner.temp }}/original/priv_validator_key.json\n          if-no-files-found: error\n", 1), 1),
        ]
        for index, changed in enumerate(changes):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_macos_source_register_workflow_contract(changed)

    def test_runtime_gateway_identity_rejects_old_labels_and_unobserved_binary(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_runtime_gateway_identity_workflow_contract(raw)
        _, steps = workflow_steps(raw, "protocol-delivery")
        build = next(step for step in steps if step.startswith(
            "      - name: Build public Linux runtime candidate without starting services\n"))
        mutations = (
            ('YNX_RUNTIME_GATEWAY_COMMIT=$GITHUB_SHA', 'YNX_RUNTIME_GATEWAY_COMMIT=${GITHUB_SHA:0:12}'),
            ('main.buildRelease=ynx-bft-gateway-${YNX_RUNTIME_GATEWAY_COMMIT:0:12}', 'main.buildRelease=pq-source-candidate-$GITHUB_SHA'),
            ('main.buildRelease=ynx-bft-gateway-${YNX_RUNTIME_GATEWAY_COMMIT:0:12}', 'main.buildRelease=ynx-bft-gateway-$YNX_RUNTIME_GATEWAY_COMMIT'),
            ('main.buildCommit=$YNX_RUNTIME_GATEWAY_COMMIT', 'main.buildCommit=${GITHUB_SHA:0:12}'),
            ("expected_build = dict(commit=os.environ['GITHUB_SHA'],", "expected_build = dict(commit=os.environ['GITHUB_SHA'][:12],"),
            ("release='ynx-bft-gateway-' + os.environ['GITHUB_SHA'][:12],", "release='ynx-bft-gateway-' + os.environ['GITHUB_SHA'],"),
            ('timeout 5s "$YNX_RUNTIME_CANDIDATE/ynx-bft-gatewayd" --build-info', 'echo synthetic-build-info'),
            ('--comet-rpc not-a-url --http invalid-address --migration-height 1', '--comet-rpc http://127.0.0.1:27757'),
            ("gateway_build = json.loads(observation.read_text(encoding='utf8'))", 'gateway_build = expected_build'),
            ('if gateway_build != expected_build:', 'if False:'),
            ("binary=binaries['ynx-bft-gatewayd'], build=gateway_build,", "binary=binaries['ynx-comet'], build=gateway_build,"),
            ('git init "$YNX_RUNTIME_SOURCE"', 'git worktree add --detach "$YNX_RUNTIME_SOURCE" "$GITHUB_SHA"'),
            ('fetch --no-tags --depth=1 "$GITHUB_WORKSPACE" "$GITHUB_SHA"', 'fetch --no-tags --depth=1 "$GITHUB_WORKSPACE" main'),
            ('git -C "$YNX_RUNTIME_SOURCE" checkout --detach "$GITHUB_SHA"', 'git -C "$YNX_RUNTIME_SOURCE" checkout --detach main'),
            ('test -d "$YNX_RUNTIME_SOURCE/.git" && test ! -L "$YNX_RUNTIME_SOURCE/.git"', 'true # omitted actual Git directory check'),
            ('test ! -e "$YNX_RUNTIME_SOURCE/.git/objects/info/alternates"', 'true # omitted independent object store check'),
            ('cd "$YNX_RUNTIME_SOURCE"', 'cd "$GITHUB_WORKSPACE"'),
            ('YNX_RUNTIME_BEFORE_STATUS=$(git status --porcelain --untracked-files=all)', "YNX_RUNTIME_BEFORE_STATUS=''"),
            ('test "$YNX_RUNTIME_BEFORE_TREE" = "$YNX_RUNTIME_EXPECTED_TREE"', 'true # omitted original tree check'),
            ('ynx-consensus-proof-verify ynx-consensus-pq-remote-signer; do', 'ynx-consensus-proof-verify; do'),
            ('-buildvcs=true', '-buildvcs=false'),
            ("settings.get('vcs.revision') != os.environ['GITHUB_SHA']", 'False'),
            ("settings.get('vcs.modified') != 'false'", "settings.get('vcs.modified') != 'true'"),
            ('go_infos[name] = go_info(path)', 'go_infos[name] = {}'),
            ('source_after = source_observation()', 'source_after = source_before'),
            ('if source_after != source_before:', 'if False:'),
            ("print('YNX_LINUX_RUNTIME_CLEAN_BUILD '", "print('OLD_UNPINNED_RUNTIME '"),
        )
        for before, after in mutations:
            self.assertIn(before, build)
            changed = raw.replace(build, build.replace(before, after, 1), 1)
            with self.subTest(before=before), self.assertRaises(AssertionError):
                assert_runtime_gateway_identity_workflow_contract(changed)

    def test_native_cabi_push_matrix_rejects_skipped_actual_calls_and_private_artifacts(self):
        # These mutations establish the source contract only. Actual native
        # C signing and independent Go verification execute in the matrix job.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_native_cabi_workflow_contract(raw)
        native, steps = workflow_steps(raw, "artifact-release-cabi")
        def named(name):
            found = [step for step in steps if step.startswith("      - name: " + name + "\n")]
            self.assertEqual(len(found), 1)
            return found[0]

        data_runtime = named("Install the original pinned operator DATA test runtime")
        data_control = named("Verify original operator runtime preparation on the actual platform")
        actual = named("Execute actual C ABI and independently verify both signatures")
        transaction = named("Execute Wallet transaction ABI from the same native archive")
        initial = named("Execute initial-account ABI from the same native archive")
        arm = named("Verify the executed original Main arm64 target")
        runtime = named("Install pinned contract runtime for Darwin migration callers")
        contracts = named("Prepare same-source compiled contracts for Darwin migration callers")
        darwin = named("Verify complete Darwin migration package CLI against original contract inputs")
        seal = named("Seal only native library public outputs and exact compile inputs")
        upload = named("Upload only public native host archive header and evidence")
        arm_upload = named("Upload only public Main arm64 archive header and executed target evidence")
        control = named("Verify fixed CONTROL key lifecycle and actual C ABI dual signatures")
        control_seal = named("Seal only executed CONTROL archive and fixed public inputs")
        control_upload = named("Upload only public fixed CONTROL native archive header and evidence")

        def change(before, after):
            self.assertIn(before, native)
            return raw.replace(native, native.replace(before, after, 1), 1)

        command = 'bash scripts/verify/artifact-release-cabi-check.sh "$RUNNER_TEMP/ynx-artifact-release-cabi"'
        mutations = [raw.replace(native, "", 1),
            change("github.event_name == 'push'", "github.event_name == 'workflow_dispatch'"),
            change("refs/heads/codex/ynx-pq-perf-integration", "refs/heads/main"),
            change("    strategy:\n", "    needs: focused-go\n    strategy:\n"),
            change("fail-fast: false", "fail-fast: true"),
            change("runner: [ubuntu-24.04, macos-15]", "runner: [ubuntu-24.04]"),
            change("runner: [ubuntu-24.04, macos-15]", "runner: [ubuntu-24.04, macos-14]"),
            change("          ref: ${{ github.sha }}", "          ref: refs/heads/main"),
            change("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v4"),
            change("          fetch-depth: 0", "          fetch-depth: 1"),
            change("          filter: blob:none", "          filter: tree:0"),
            change(data_runtime, ""), change(data_control, ""),
            change(data_control, data_control + data_control),
            change(data_runtime, data_runtime.replace("node-version: '24.19.0'", "node-version: latest", 1)),
            change(data_control, data_control.replace("        run:", "        if: false\n        run:", 1)),
            change(data_control, data_control.replace("node --test", "true # node --test", 1)),
            raw.replace(native, native.replace(data_control, "", 1).replace(actual, actual + data_control, 1), 1),
            change("          go-version-file: go.mod", "          go-version: latest"),
            change("      CGO_ENABLED: '1'", "      CGO_ENABLED: '0'"),
            change("      MACOSX_DEPLOYMENT_TARGET: '13.0'", "      MACOSX_DEPLOYMENT_TARGET: '15.0'"),
            change("          git diff --exit-code", "          git diff --exit-code || true"),
            change("go test -p 1 ./cmd/ynx-artifact-release-cabi -count=1", "true # skipped native core tests"),
            change(darwin, darwin.replace("if: runner.os == 'macOS'", "if: false", 1)),
            change("go test -p 1 -count=1 -timeout=90s ./cmd/ynx-consensus-package", "true # skipped actual Darwin migration caller"),
            change(runtime, ""), change(contracts, ""), change(darwin, ""),
            change(runtime, runtime.replace("if: runner.os == 'macOS'", "if: always()", 1)),
            change(contracts, contracts.replace("if: runner.os == 'macOS'", "if: false", 1)),
            change(runtime, runtime.replace("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v4", 1)),
            change(runtime, runtime.replace("node-version: '24.19.0'", "node-version: latest", 1)),
            change(contracts, contracts.replace("npm ci --ignore-scripts --no-audit --no-fund", "true # skipped fixed dependencies", 1)),
            change(contracts, contracts.replace("npm run hardhat:build -- contracts/devtools/SampleEVMWriteCounter.sol contracts/tokens/SampleYNXTCompatibleERC20.sol", "test -s artifacts/old-fixture.json", 1)),
            change(contracts, contracts.replace("npm run contracts:selectors", "true # skipped actual selector generation", 1)),
            change(contracts, contracts.replace("git diff --exit-code -- artifacts", "git diff --exit-code -- artifacts || true", 1)),
            change(contracts, contracts.replace('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', "true # unbound contract source", 1)),
            change(darwin, darwin.replace("-timeout=90s ./cmd/ynx-consensus-package", "-timeout=90s -run '^TestMigrationPublicSummary' ./cmd/ynx-consensus-package", 1)),
            change(darwin, darwin.replace("        run: |\n", "        continue-on-error: true\n        run: |\n", 1)),
            raw.replace(native, native.replace(contracts, "", 1).replace(darwin, darwin + contracts, 1), 1),
            change(actual, ""), change(command, "# " + command), change(command, command + " || true"),
            change(actual, actual.replace("        run: |\n", "        if: false\n        run: |\n", 1)),
            change(actual, actual.replace("        run: |\n", "        continue-on-error: true\n        run: |\n", 1)),
            change(transaction, ""),
            change(transaction, transaction.replace("        run: |\n", "        if: false\n        run: |\n", 1)),
            change(transaction, transaction.replace("        run: |\n", "        continue-on-error: true\n        run: |\n", 1)),
            change(transaction, transaction.replace("transaction-batch-cabi-check.sh", "artifact-release-cabi-check.sh", 1)),
            change(transaction, transaction.replace("ynx-artifact-release-cabi/libynx_artifact_release.a", "other/libynx_artifact_release.a", 1)),
            raw.replace(native, native.replace(transaction, "", 1).replace(seal, seal + transaction, 1), 1),
            change(initial, ""),
            change(initial, initial.replace("        run: |\n", "        if: false\n        run: |\n", 1)),
            change(initial, initial.replace("        run: |\n", "        continue-on-error: true\n        run: |\n", 1)),
            change(initial, initial.replace("account-initial-cabi-check.sh", "transaction-batch-cabi-check.sh", 1)),
            change(initial, initial.replace("ynx-artifact-release-cabi/libynx_artifact_release.a", "other/libynx_artifact_release.a", 1)),
            raw.replace(native, native.replace(initial, "", 1).replace(seal, seal + initial, 1), 1),
            raw.replace(native, native.replace(actual, "", 1).replace(seal, seal + actual, 1), 1),
            change('test "$(go env GOHOSTARCH)" = arm64', 'test "$(go env GOHOSTARCH)" = amd64'),
            change('lipo "$RUNNER_TEMP/ynx-artifact-release-cabi/c-driver" -verify_arch arm64', "true # skipped caller architecture"),
            change('lipo "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a" -verify_arch arm64',
                   'lipo -verify_arch arm64 "$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a"'),
            change(arm, arm.replace("if: runner.os == 'macOS'", "if: false", 1)),
            change(seal, seal.replace("        run: |\n", "        if: always()\n        run: |\n", 1)),
            change("python3 -B - <<'PY'", "python3 -B - <<'PY' || true"),
            change("if module.get('Version') != 'v1.6.5' or module.get('Replace'):", "if False:"),
            change("targets.append(('darwin-arm64', case / 'libynx_artifact_release.a', 'darwin', 'arm64', True))",
                   "targets.append(('darwin-arm64', case / 'darwin-arm64/libynx_artifact_release.a', 'darwin', 'arm64', True))"),
            change("actualCABIExecuted=executed", "actualCABIExecuted=True"),
            change("independentGoDualANDVerified=executed", "independentGoDualANDVerified=True"),
            change("actualTransactionCABIExecuted=executed", "actualTransactionCABIExecuted=True"),
            change("transactionIndependentGoDualANDVerified=executed", "transactionIndependentGoDualANDVerified=True"),
            change("transactionAccountAuthorized=False", "transactionAccountAuthorized=True"),
            change("actualInitialAccountCABIExecuted=executed", "actualInitialAccountCABIExecuted=True"),
            change("initialAccountIndependentGoDualANDVerified=executed", "initialAccountIndependentGoDualANDVerified=True"),
            change("initialAccountAuthorized=False", "initialAccountAuthorized=True"),
            change("publicEvidenceTarget=dict(os=native_os, arch=native_arch)", "publicEvidenceTarget=dict(os=target_os, arch=target_arch)"),
            change("minimumSystemVersion='13.0' if target_os == 'darwin' else None,", "minimumSystemVersion='15.0' if target_os == 'darwin' else None,"),
            change("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512", "ML-DSA-87/OR/SLH-DSA-SHA2-256f"),
            change("privateMaterialIncluded=False", "privateMaterialIncluded=True"),
            change("nativeRootAuthorized=False", "nativeRootAuthorized=True"),
            change("productInstalled=False", "productInstalled=True"),
            change(upload, upload.replace("if-no-files-found: error", "if-no-files-found: ignore", 1)),
            change(upload, upload.replace("            ${{ runner.temp }}/ynx-artifact-release-cabi/delivery/native-host/SOURCE.json\n",
                                          "            ${{ runner.temp }}/ynx-artifact-release-cabi\n", 1)),
            change(upload, upload.replace("          if-no-files-found:", "            ${{ runner.temp }}/ynx-artifact-release-cabi/input/SYNTHETIC-ONLY-a.der\n          if-no-files-found:", 1)),
            change(arm_upload, arm_upload.replace("/delivery/darwin-arm64/SOURCE.json", "/input/SYNTHETIC-ONLY-b.der", 1)),
            change(arm_upload, arm_upload.replace("        if: runner.os == 'macOS'\n", "", 1)),
            raw.replace(native, native.replace(upload, "", 1).replace(seal, upload + seal, 1), 1),
            raw.replace("      - 'scripts/fixtures/verify-artifact-release-cabi/**'\n", "", 1),
            change(control, ""), change(control_seal, ""), change(control_upload, ""),
            change(control, control.replace("        run: |\n", "        if: false\n        run: |\n", 1)),
            change("go test -p 1 -count=1 -timeout=90s ./internal/ynxbatch -run '^TestProjectControl'", "true # skipped CONTROL original lifecycle"),
            change('bash scripts/verify/project-control-cabi-check.sh "$RUNNER_TEMP/ynx-project-control-cabi"', "true # skipped actual CONTROL C caller"),
            change(control_seal, control_seal.replace("        run: |\n", "        if: always()\n        run: |\n", 1)),
            change(control_upload, control_upload.replace("if-no-files-found: error", "if-no-files-found: ignore", 1)),
            change(control_upload, control_upload.replace("/delivery/SOURCE.json", "/input/SYNTHETIC-ONLY-a.der", 1)),
            raw.replace(native, native.replace(control, "", 1).replace(control_upload, control_upload + control, 1), 1),
            raw.replace("      - 'scripts/fixtures/verify-project-control-cabi/**'\n", "", 1)]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_native_cabi_workflow_contract(changed)

    def test_publisher_native_cabi_requires_actual_shared_archive_before_closed_public_seal(self):
        # Source-contract mutations only. The unchanged real C caller retains
        # its four positives/sixty negatives; this test executes no C/Go/SDK.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_native_cabi_workflow_contract(raw)
        _, steps = workflow_steps(raw, "artifact-release-cabi")

        def named(name):
            found = [step for step in steps if step.startswith("      - name: " + name + "\n")]
            self.assertEqual(len(found), 1)
            return found[0]

        actual = named("Execute actual C ABI and independently verify both signatures")
        execute = named("Execute fixed publisher generation and both registration proofs from the same archive")
        original_seal = named("Seal only native library public outputs and exact compile inputs")
        seal = named("Seal the same executed archive with dedicated publisher public evidence")
        upload = named("Upload only public publisher archive headers and real native evidence")
        arm = named("Verify the executed original Main arm64 target")

        def change(step, before, after):
            self.assertIn(before, step)
            self.assertEqual(raw.count(step), 1)
            return raw.replace(step, step.replace(before, after, 1), 1)

        command = "bash scripts/verify/publisher-registration-cabi-check.sh"
        mutations = [
            raw.replace(execute, "", 1), raw.replace(execute, execute + execute, 1),
            raw.replace(seal, "", 1), raw.replace(seal, seal + seal, 1),
            raw.replace(upload, "", 1), raw.replace(upload, upload + upload, 1),
            change(execute, command, "true # " + command),
            change(execute, '"$RUNNER_TEMP/ynx-publisher-registration-cabi"',
                   '"$RUNNER_TEMP/ynx-publisher-registration-cabi" || true'),
            change(execute, '"$RUNNER_TEMP/ynx-artifact-release-cabi/libynx_artifact_release.a"',
                   '"$RUNNER_TEMP/other/libynx_artifact_release.a"'),
            change(execute, "        run: |\n", "        if: false\n        run: |\n"),
            change(execute, "        run: |\n", "        continue-on-error: true\n        run: |\n"),
            raw.replace(execute, "", 1).replace(actual, execute + actual, 1),
            raw.replace(execute, "", 1).replace(seal, seal + execute, 1),
            raw.replace(seal, "", 1).replace(original_seal, seal + original_seal, 1),
            raw.replace(upload, "", 1).replace(seal, upload + seal, 1),
            change(arm, '          lipo "$RUNNER_TEMP/ynx-publisher-registration-cabi/publisher-c-driver" -verify_arch arm64\n', ""),
            raw.replace("      - 'scripts/fixtures/verify-publisher-registration-cabi/**'\n", "", 1),
            raw.replace("      - 'scripts/verify/publisher-registration-cabi-check.sh'\n", "", 1),
            change(original_seal, "'scripts/fixtures/verify-publisher-registration-cabi'", "'scripts/fixtures/old-public-fixture'"),
            change(original_seal, "'scripts/verify/publisher-registration-cabi-check.sh'", "'scripts/verify/old-caller.sh'"),
            change(seal, "        run: |\n", "        if: always()\n        run: |\n"),
            change(seal, "python3 -B - <<'PY'", "python3 -B - <<'PY' || true"),
            change(seal, "parent['commit'] != os.environ['GITHUB_SHA']", "False"),
            change(seal, "parent['runId'] != os.environ['GITHUB_RUN_ID']", "False"),
            change(seal, "not parent['actualCABIExecuted']", "False"),
            change(seal, "not parent['nativeHostCoreTestsPassed']", "False"),
            change(seal, "parent['crossCompiled'] or parent['privateMaterialIncluded']", "False"),
            change(seal, "pin(out / 'libynx_artifact_release.a') != parent['archive']", "False"),
            change(seal, "'publisher_registration.h'", "'account_initial.h'"),
            change(seal, "public_names = ('PUBLIC-INTEROP.json', 'PUBLIC-RECEIPT.json')",
                   "public_names = ('PUBLIC-INTEROP.json', 'SYNTHETIC-ONLY-custodian-a.der')"),
            change(seal, "sources=parent['sources']", "sources={}"),
            change(seal, "originalArchiveSource=pin(original / 'SOURCE.json')", "originalArchiveSource={}"),
            change(seal, "'YNXPublisherCustodianSignV1'", "'YNXArtifactPublicationSignV1'"),
            change(seal, "capacities=dict(private=16384, public=8192, member=131072)",
                   "capacities=dict(private=32768, public=8192, member=131072)"),
            change(seal, "syntheticTestKeysOnly=True", "syntheticTestKeysOnly=False"),
            change(seal, "if {p.name for p in out.iterdir()} != set(names) | set(public_names) | {'SOURCE.json','libynx_artifact_release.a'}:", "if False:"),
            change(seal, "          PY\n", "          shutil.copyfile(case / 'input/SYNTHETIC-ONLY-custodian-a.der', out / 'PRIVATE.der')\n          PY\n"),
            change(upload, "/ynx-publisher-registration-cabi/delivery/*", "/ynx-publisher-registration-cabi/**"),
            change(upload, "/ynx-publisher-registration-cabi/delivery/*", "/ynx-publisher-registration-cabi/input/*"),
            change(upload, "if-no-files-found: error", "if-no-files-found: ignore"),
            change(upload, "        with:\n", "        if: always()\n        with:\n"),
        ]
        for field in ("privateMaterialIncluded", "crossCompiled", "protectedMainCustodyVerified", "sourceOwnerQualified",
                      "publisherAuthorized", "nativeRootAuthorized", "productInstalled", "publicDeployment", "pqActivation"):
            mutations.append(change(seal, field + "=False", field + "=True"))
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(publisher_native=index), self.assertRaises(AssertionError):
                assert_native_cabi_workflow_contract(changed)

    def test_independent_caddy_source_failure_or_wrong_source_cannot_qualify_delivery(self):
        # Mutate the real source job and its consumers. These are contract
        # counterexamples, not evidence that GitHub ran any Caddy operation.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        caddy, steps = workflow_steps(raw, "caddy-source")
        delivery, _ = workflow_steps(raw, "protocol-delivery")
        source = next(step for step in steps if "        id: source\n" in step)
        guard = next(step for step in steps if step.startswith(
            "      - name: Verify existing Caddyfile and JSON ingress source controls\n"))
        fd_guard = next(step for step in steps if step.startswith(
            "      - name: Verify real FD transitions in the original bounded process guard\n"))
        control_seal = next(step for step in steps if step.startswith(
            "      - name: Seal only the normal bounded Caddy DATA control sources\n"))
        guard_command = "timeout 120s bash scripts/verify/public-bft-gateway-ingress-check.sh"
        mutations = [
            raw.replace(caddy, "", 1),
            raw.replace(caddy, caddy.replace("github.event_name == 'push'", "false", 1), 1),
            raw.replace(caddy, caddy.replace("github.event_name == 'push'", "github.event_name == 'workflow_dispatch'", 1), 1),
            raw.replace(caddy, caddy.replace("refs/heads/codex/ynx-pq-perf-integration", "refs/heads/main", 1), 1),
            raw.replace(caddy, caddy.replace("    runs-on: ubuntu-24.04\n", "    needs: focused-go\n    runs-on: ubuntu-24.04\n", 1), 1),
            raw.replace(caddy, caddy.replace("          ref: ${{ github.sha }}", "          ref: refs/heads/main", 1), 1),
            raw.replace(caddy, caddy.replace("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v4", 1), 1),
            raw.replace(source, source.replace("test \"$(git rev-parse HEAD)\" = '${{ github.sha }}'", "true # source check omitted", 1), 1),
            raw.replace(source, source.replace("git diff --exit-code", "git diff --exit-code || true", 1), 1),
            raw.replace(source, source.replace("        id: source\n", "        id: oldsource\n", 1), 1),
            raw.replace(guard, "", 1),
            raw.replace(guard, guard.replace(guard_command, "# " + guard_command, 1), 1),
            raw.replace(guard, guard.replace(guard_command, guard_command + " || true", 1), 1),
            raw.replace(guard, guard.replace(guard_command, guard_command + "; true", 1), 1),
            raw.replace(guard, guard.replace("        timeout-minutes: 3\n", "        continue-on-error: true\n        timeout-minutes: 3\n", 1), 1),
            raw.replace(guard, guard.replace("!cancelled() && steps.source.outcome == 'success'", "false", 1), 1),
            raw.replace(guard, guard.replace("steps.source.outcome == 'success'", "true", 1), 1),
            raw.replace(guard, guard + guard, 1),
            raw.replace(delivery, delivery.replace("    needs: [focused-go, caddy-source]\n", "    needs: focused-go\n", 1), 1),
            raw.replace(delivery, delivery.replace("    needs: [focused-go, caddy-source]\n", "    needs: caddy-source\n", 1), 1),
            raw.replace(delivery, delivery.replace(" && needs.focused-go.result == 'success'", "", 1), 1),
            raw.replace(delivery, delivery.replace(" && needs.caddy-source.result == 'success'", "", 1), 1),
            raw.replace(delivery, delivery.replace("needs.caddy-source.result == 'success'", "needs.caddy-source.result != 'failure'", 1), 1),
            raw.replace(delivery, delivery.replace("needs.caddy-source.result == 'success'", "true", 1), 1),
            raw.replace(delivery, delivery.replace("    timeout-minutes: 12\n", "    continue-on-error: true\n    timeout-minutes: 12\n", 1), 1),
            raw.replace("      - 'codex/ynx-pq-perf-integration'\n", "      - 'main'\n", 1),
            raw.replace(fd_guard, "", 1),
            raw.replace(fd_guard, fd_guard.replace("!cancelled() && steps.source.outcome == 'success'", "false", 1), 1),
            raw.replace(fd_guard, fd_guard.replace("test_original_native_copy_guard.py -v", "test_original_native_copy_guard.py -v || true", 1), 1),
            raw.replace(fd_guard, fd_guard.replace("        timeout-minutes: 3\n", "        continue-on-error: true\n        timeout-minutes: 3\n", 1), 1),
            raw.replace(caddy, caddy.replace(fd_guard, "", 1).replace(control_seal, control_seal + fd_guard, 1), 1),
            raw.replace(control_seal, control_seal.replace("        env:\n", "        if: ${{ always() }}\n        env:\n", 1), 1),
            raw.replace(control_seal, "", 1)]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_source_and_cross_ref_heavy_groups_keep_all_actual_windows_serial(self):
        # Match the actual closed Actions expression. This is a source check,
        # not evidence that GitHub scheduled or admitted an execution window.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        job, _ = workflow_steps(raw)
        paired, _ = workflow_steps(raw, "pq-paired-n1")
        group_line = next(line for line in job.splitlines() if line.startswith("      group: "))
        modes = ("paired_n1", "consensus_e2e", "consensus_e2e_retained_history",
                 "consensus_remote_e2e_retained_history", "remote_signer_process", "consensus_fresh_paired_business")
        mutations = []
        for mode in modes:
            token = "inputs." + mode
            # Require each complete identifier, including consensus_e2e which
            # is also a prefix of two distinct retained-history identifiers.
            changed = re.sub(re.escape(token) + r"(?![a-z0-9_])", "false", group_line)
            self.assertNotEqual(changed, group_line)
            mutations.append(raw.replace(group_line, changed, 1))
        mutations.extend([
            raw.replace(group_line, group_line.replace("format('ynx-pq-source-{0}-{1}-{2}', github.workflow, github.ref, github.sha)", "format('ynx-pq-source-{0}-{1}', github.workflow, github.ref)", 1), 1),
            raw.replace(group_line, group_line.replace("github.event_name == 'workflow_dispatch'", "true", 1), 1),
            raw.replace(group_line, group_line.replace("'ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade'", "format('ynx-pq-heavy-{0}', github.ref)", 1), 1),
            raw.replace(group_line, "      group: ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade", 1),
            raw.replace(job, job.replace("      cancel-in-progress: false", "      cancel-in-progress: true", 1), 1),
            raw.replace(paired, paired.replace("    concurrency:\n      group: ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade\n      cancel-in-progress: false\n", "", 1), 1),
            raw.replace(paired, paired.replace("      group: ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade", "      group: ${{ github.ref }}", 1), 1),
            raw.replace(paired, paired.replace("      cancel-in-progress: false", "      cancel-in-progress: true", 1), 1),
            raw.replace(paired, paired.replace(" && inputs.paired_n1\n", "\n", 1), 1)])
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_contract_deploy_fixture_reuses_gateway_execution_and_uploads_only_real_public_output(self):
        # Source controls do not manufacture the fixture or claim Go passed.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        _, steps = workflow_steps(raw)
        gateway = next(step for step in steps if "        id: pqgateway\n" in step)
        upload = next(step for step in steps if step.startswith("      - name: Upload only public compiled contract deploy and finality interoperability fixture\n"))
        mutations = [raw.replace(gateway, gateway.replace("YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT:", "UNUSED_FIXTURE_OUT:", 1), 1),
            raw.replace(upload, "", 1),
            raw.replace(upload, upload.replace("steps.pqgateway.outcome == 'success'", "true", 1), 1),
            raw.replace(upload, upload.replace("/ynx-pq-contract-deploy-public-interop.json", "/ynx-proof-host-source-public/original", 1), 1),
            raw.replace(upload, upload.replace("if-no-files-found: error", "if-no-files-found: ignore", 1), 1),
            raw.replace(gateway, gateway.replace("./internal/bftgateway ./cmd/ynx-bft-gatewayd", "-run '^TestMissing$' ./internal/bftgateway", 1), 1),
            raw.replace(gateway + upload, upload + gateway, 1)]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_source_contract_rejects_missing_gate_injection_skipped_controls_and_cap_increase(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        changes = [
            ("          merge-multiple: true\n", "          merge-multiple: false\n"),
            ("      - name: Prepare same-source compiled contract inputs for delivery callers\n", "      - name: Silently omitted delivery compiler inputs\n"),
            ("bash scripts/verify/public-bft-gateway-ingress-check.sh", "# skipped public-bft-gateway-ingress-check.sh"),
            ("    needs: protocol-delivery\n", "    needs: focused-go\n"),
            ("artifact-ids: ${{ needs.focused-go.outputs.inputs-artifact-id }}", "name: old-same-name-artifact"),
            ('--manifest-sha256 "$YNX_STAGE_MANIFEST_SHA256"', '--manifest-sha256 "0000000000000000000000000000000000000000000000000000000000000000"'),
            ("      - name: Verify original public cutover caller preserves independent operator and runtime pins\n", "      - name: Silently skipped original caller\n"),
            ("-skip '^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$)'", "-skip '^(TestProofHost|TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$|TestABCI)'"),
            ("-run '^TestProofHost'", "-run '^TestProofHostMissing'"),
            ("-run '^TestTransactionProofInitialPreparedFundingOriginalCLI$'", "-run '^TestTransactionProofInitialPreparedFundingOriginalCLIMissing$'"),
            ("YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT: ${{ runner.temp }}/ynx-pq-initial-prepared-funding-public.json", "UNUSED_INITIAL_FUNDED_FIXTURE: ${{ runner.temp }}/ynx-pq-initial-prepared-funding-public.json"),
            ("      - name: Verify complete large original migration through normal package and cold recovery\n", "      - name: Silently omitted large migration recovery\n"),
            ("-run '^TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery$'", "-run '^TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecoveryMissing$'"),
            ("steps.normalci.outcome == 'success' && steps.pqnetworkcontracts.outcome == 'success'", "true"),
            ('--normal-run-id "$YNX_NORMAL_CI_RUN_ID"', "--normal-run-id '${{ inputs.normal_ci_run_id }}'"),
            ("    timeout-minutes: ${{ inputs.consensus_fresh_paired_business && 12 || 15 }}\n", "    timeout-minutes: ${{ inputs.consensus_fresh_paired_business && 12 || 18 }}\n"),
            ("activeMs=105000, cleanupMs=15000, totalMs=120000", "activeMs=120000, cleanupMs=15000, totalMs=135000"),
            ("if started > now or remaining < 150:", "if remaining < 120:"),
            ("remaining = started + 12*60 - now", "remaining = started + 15*60 - now"),
            ("receipt['currentRunStartedAt']", "datetime.datetime.now()"),
            ("steps.pqnetworkbuild.outcome == 'success'", "true"),
            ("scripts/loadtest/pq-paired-linux-window.py --consensus-remote-e2e-retained-history", "scripts/loadtest/pq-paired-linux-window.py --consensus-e2e"),
            ("      - name: Verify Linux window controls without starting a node\n", "      - name: Silently omitted controls\n"),
            ("          python3 -B -m unittest discover -s scripts/ops -p 'test_prepare_testnet_assets.py' -v\n", "          # test_prepare_testnet_assets.py deliberately omitted\n"),
            ("timeout 45s python3 -B scripts/ops/test_verify_original_native_copy_once.py", "timeout 90s python3 -B scripts/ops/test_verify_original_native_copy_once.py"),
            ("test_verify_original_native_copy_once.py -v 2>&1 | tee", "test_verify_original_native_copy_once.py -v 2>&1 || true | tee"),
            ("timeout 45s python3 -B scripts/ops/test_verify_retained_migration_preservation_once.py", "timeout 90s python3 -B scripts/ops/test_verify_retained_migration_preservation_once.py"),
            ("test_verify_retained_migration_preservation_once.py -v 2>&1 | tee", "test_verify_retained_migration_preservation_once.py -v 2>&1 || true | tee"),
            ("grep -F -c 'YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS'", "echo 'YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS'"),
            (".cleanupComplete == true", ".cleanupComplete != false"),
            ("    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/codex/ynx-pq-perf-integration')\n", "    if: false\n"),
        ]
        for before, after in changes:
            self.assertIn(before, raw)
            with self.subTest(before=before), self.assertRaises(AssertionError):
                assert_workflow_contract(raw.replace(before, after, 1))
        # The generic verify job has the same govuln command before focused-go.
        # Mutate the actual named runtime gate, not the first global occurrence.
        _, focused_steps = workflow_steps(raw, "focused-go")
        _, delivery_steps = workflow_steps(raw, "protocol-delivery")
        vulnerability = [step for step in focused_steps if step.startswith(
            "      - name: Check reachable vulnerabilities in the eight production runtime commands\n")]
        self.assertEqual(len(vulnerability), 1)
        command = "go run golang.org/x/vuln/cmd/govulncheck@v1.1.4"
        self.assertEqual(vulnerability[0].count(command), 1)
        self.assertEqual(raw.count(vulnerability[0]), 1)
        omitted_vulnerability = raw.replace(vulnerability[0], vulnerability[0].replace(
            command, "true # omitted production runtime vulnerability check", 1), 1)
        self.assertNotEqual(omitted_vulnerability, raw)
        self.assertEqual(workflow_steps(omitted_vulnerability, "verify"), workflow_steps(raw, "verify"))
        with self.subTest(before=command, job="focused-go"), self.assertRaises(AssertionError):
            assert_workflow_contract(omitted_vulnerability)
        vulnerability = vulnerability[0]
        pure = next(step for step in focused_steps if step.startswith(
            "      - name: Verify pure dual-PQ protocol and account authorization\n"))
        runtime = next(step for step in delivery_steps if step.startswith(
            "      - name: Build public Linux runtime candidate without starting services\n"))
        gate_changes = [raw.replace(vulnerability, "", 1),
            raw.replace(vulnerability, vulnerability + vulnerability, 1),
            raw.replace(vulnerability, vulnerability.replace("timeout-minutes: 3", "timeout-minutes: 4", 1), 1),
            raw.replace(vulnerability, vulnerability.replace("github.event_name == 'push'", "github.event_name == 'workflow_dispatch'", 1), 1),
            raw.replace(vulnerability, vulnerability.replace("steps.identity.outcome == 'success'", "true", 1), 1),
            raw.replace(vulnerability, vulnerability.replace("        run: >-\n", "        continue-on-error: true\n        run: >-\n", 1), 1),
            raw.replace(vulnerability, vulnerability.replace("./cmd/ynx-consensus-keycheck", "./cmd/ynx-consensus-keycheck || true", 1), 1),
            raw.replace(vulnerability, "", 1).replace(pure, pure + vulnerability, 1),
            raw.replace(vulnerability, "", 1).replace(runtime, vulnerability + runtime, 1),
            raw.replace(pure, pure.replace("!cancelled()", "success()", 1), 1)]
        for index, changed in enumerate(gate_changes):
            self.assertNotEqual(changed, raw)
            self.assertEqual(workflow_steps(changed, "verify"), workflow_steps(raw, "verify"))
            with self.subTest(runtime_vulnerability=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)
        # Keep the complete original controls block, its condition and every
        # command; changing only its position after pure PQ must be refused.
        assert_workflow_contract(raw)
        _, steps = workflow_steps(raw)
        controls = next(step for step in steps if step.startswith(
            "      - name: Verify Linux window controls without starting a node\n"))
        protocol = next(step for step in steps if step.startswith(
            "      - name: Verify pure dual-PQ protocol and account authorization\n"))
        late_controls = raw.replace(controls, "", 1).replace(protocol, protocol + controls, 1)
        self.assertNotEqual(late_controls, raw)
        self.assertEqual(late_controls.count(controls), 1)
        self.assertGreater(late_controls.index(controls), late_controls.index(protocol))
        with self.subTest(late_controls=True), self.assertRaises(AssertionError):
            assert_workflow_contract(late_controls)

    def test_remote_contract_prerequisite_is_generated_from_same_source_before_any_network_start(self):
        # This tests the real workflow source contract, not a GitHub scheduler,
        # compiler execution, artifact validity or successful Node.Start.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        _, steps = workflow_steps(raw)
        runtime = next(step for step in steps if "        id: pqnetworknode\n" in step)
        prepared = next(step for step in steps if "        id: pqnetworkcontracts\n" in step)
        build = next(step for step in steps if "        id: pqnetworkbuild\n" in step)
        compile_command = "npm run hardhat:build -- contracts/devtools/SampleEVMWriteCounter.sol contracts/tokens/SampleYNXTCompatibleERC20.sol"
        mutations = [
            raw.replace(runtime, "", 1),
            raw.replace(prepared, "", 1),
            raw.replace(prepared, prepared.replace("steps.normalci.outcome == 'success'", "true", 1), 1),
            raw.replace(prepared, prepared.replace('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', 'test "$(git rev-parse HEAD)" = "old-source"', 1), 1),
            raw.replace(prepared, prepared.replace(compile_command, "# " + compile_command, 1), 1),
            raw.replace(prepared, prepared.replace(compile_command, "test -s artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json", 1), 1),
            raw.replace(prepared, prepared.replace("npm ci --ignore-scripts --no-audit --no-fund", "cp /tmp/old-artifact.json artifacts/old.json", 1), 1),
            raw.replace(prepared, "", 1).replace(build, build + prepared, 1),
            raw.replace(" && steps.pqnetworkcontracts.outcome == 'success'", "", 1),
        ]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_single_and_typed_host_rounds_use_original_full_plans_and_only_public_catalogs(self):
        # Source counterexamples, not execution or a trust grant. The normal
        # ELF validates both real retained originals in the delivery job.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        _, steps = workflow_steps(raw, "protocol-delivery")
        publisher = next(step for step in steps if "        id: pqhostsourcecli\n" in step)
        upload = next(step for step in steps if step.startswith("      - name: Upload only public Host delivery and normal CLI receipt\n"))
        typed_call = "typed_plan = run_case('typed-', 'pq_action', 'ynx-proof-host-typed-source-cli-public-receipt.json')"
        mutations = [
            raw.replace(publisher, publisher.replace(typed_call, "# omitted typed proof round", 1), 1),
            raw.replace(publisher, publisher.replace("run_case('typed-', 'pq_action'", "run_case('typed-', 'pq_transfer'", 1), 1),
            raw.replace(publisher, publisher.replace("plan['expectedTransaction']['transactionType'] != expected_type", "False", 1), 1),
            raw.replace(publisher, publisher.replace("path = case / (prefix + name)", "path = case / name", 1), 1),
            raw.replace(publisher, publisher.replace("public_catalog.get(item['role']) != item['name']", "False", 1), 1),
            raw.replace(publisher, publisher.replace("str(len(raw)) != item['bytes'] or sha(raw) != item['sha256']", "False", 1), 1),
            raw.replace(publisher, publisher.replace("timeout-minutes: 2", "timeout-minutes: 4", 1), 1),
            raw.replace(upload, upload.replace("            ${{ runner.temp }}/ynx-proof-host-source-public/typed-delivery\n", "", 1), 1)]
        for private_path in ('source-plan.json', 'typed-source-plan.json', 'metadata.json', 'typed-metadata.json',
                             'original', 'original/application-state', 'original/data/state.db',
                             'original/data/blockstore.db', 'original/pq-signing-state.lock',
                             'original/validator-key.json', 'target-original-envelope', 'typed-target-original-native-wire', ''):
            forbidden = '            ${{ runner.temp }}/ynx-proof-host-source-public/' + private_path + '\n'
            mutations.append(raw.replace(upload, upload.replace("          if-no-files-found:", forbidden + "          if-no-files-found:", 1), 1))
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)

    def test_retained_target_cmd_and_actual_pinned_elf_cannot_be_skipped_or_adopt_trust(self):
        # Source mutation controls only. Actual CLI execution is the separate
        # normal delivery job, using its original retained stores and clock.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        _, steps = workflow_steps(raw, "protocol-delivery")
        command = next(step for step in steps if "        id: pqprooftargetcmd\n" in step)
        publisher = next(step for step in steps if "        id: pqhostsourcecli\n" in step)
        inspect_call = "              inspected = invoke('inspect-stopped-original-target', inspect, b'', 48 << 20)\n"
        export_call = "              delivery = invoke('export-stopped-original-source', publish, b'', 16384)\n"
        mutations = [raw.replace(command, "", 1),
            raw.replace(command, command.replace("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT:", "UNUSED_FIXTURE_PATH:", 1), 1),
            raw.replace(command, command.replace("grep -F -- '--- PASS:", "echo '--- PASS:", 1), 1),
            raw.replace(publisher, publisher.replace("'inspect-proof-host-target'", "'export-proof-host-source'", 1), 1),
            raw.replace(publisher, publisher.replace("'--engine-app-hash', plan['engineAppHash']", "'--engine-app-hash', 'adopted-observation'", 1), 1),
            raw.replace(publisher, publisher.replace("'--trusting-period-nanoseconds', plan['trustingPeriodNanoseconds']", "'--trusting-period-nanoseconds', '7200000000000'", 1), 1),
            raw.replace(publisher, publisher.replace("inspected['expectedTransaction'] != expected_target", "False", 1), 1),
            raw.replace(publisher, publisher.replace("target_verification['nativeGrant'] is not False", "False", 1), 1),
            raw.replace(publisher, publisher.replace(inspect_call, "", 1).replace(export_call, export_call + inspect_call, 1), 1)]
        for index, changed in enumerate(mutations):
            self.assertNotEqual(changed, raw)
            with self.subTest(index=index), self.assertRaises(AssertionError):
                assert_workflow_contract(changed)


if __name__ == "__main__":
    unittest.main()
