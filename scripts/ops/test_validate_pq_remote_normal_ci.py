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


class NormalCIMetadataControls(unittest.TestCase):
    def validate(self, fixture=None, **inputs):
        fixture = api_fixture() if fixture is None else fixture
        calls = []

        def fetch(path):
            calls.append(path)
            if path not in fixture:
                self.fail("validator requested an unexpected endpoint")
            return copy.deepcopy(fixture[path])

        result = gate.validate_normal_ci(inputs.get("repo", gate.REPOSITORY),
                                         inputs.get("candidate", SHA),
                                         inputs.get("normal", PRIOR), inputs.get("current", CURRENT), fetch)
        return result, calls

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


def assert_workflow_contract(raw):
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

    expected_job_if = ("((github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
        "github.ref == 'refs/heads/codex/ynx-pq-perf-integration') && (github.event_name == 'push' || "
        "(github.event_name == 'workflow_dispatch' && inputs.candidate_sha == github.sha))) || "
        "(github.event_name == 'workflow_dispatch' && (startsWith(github.ref, "
        "'refs/heads/codex/ynx-pq-remote-') || inputs.consensus_remote_e2e_retained_history))")
    need("    if: " + expected_job_if + "\n" in job)
    heavy_group = "ynx-pq-fixed-source-refs/heads/codex/ynx-pq-public-upgrade"
    heavy_modes = ("paired_n1", "consensus_e2e", "consensus_e2e_retained_history",
                   "consensus_remote_e2e_retained_history", "remote_signer_process")
    focused_group = ("${{ github.event_name == 'workflow_dispatch' && ("
                     + " || ".join("inputs." + name for name in heavy_modes)
                     + ") && '" + heavy_group
                     + "' || format('ynx-pq-source-{0}-{1}', github.workflow, github.ref) }}")
    need("      group: " + focused_group + "\n      cancel-in-progress: false\n" in job)
    paired_job, _ = workflow_steps(raw, "pq-paired-n1")
    need("    concurrency:\n      group: " + heavy_group + "\n      cancel-in-progress: false\n" in paired_job)
    need("    needs: focused-go\n" in paired_job)
    need("    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' && inputs.candidate_sha == github.sha && inputs.paired_n1\n" in paired_job)
    need("    timeout-minutes: 5\n" in paired_job)
    need("    timeout-minutes: 12\n" in job)
    need("permissions:\n  contents: read\n  actions: read\n" in raw)
    need("      normal_ci_run_id:\n" in raw)
    for leaf in ("scripts/ops/validate-pq-remote-normal-ci.py", "scripts/ops/test_validate_pq_remote_normal_ci.py"):
        need("      - '" + leaf + "'\n" in raw)
    normal = by_id("normalci")
    need(condition(normal) == "${{ !cancelled() && steps.identity.outcome == 'success' && github.event_name == 'workflow_dispatch' && inputs.consensus_remote_e2e_retained_history }}")
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
    need(condition(network) == base_condition.replace("success() && ", "success() && steps.pqnetworkbuild.outcome == 'success' && ", 1))
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
    receipts = [step for step in steps if step.startswith((
        "      - name: Record public retained network-file size metadata after owned cleanup\n",
        "      - name: Preserve only public network-test logs and guard receipt\n"))]
    need(len(receipts) == 2)
    need(all(condition(step) == "${{ always() && (steps.pqnetwork.outcome == 'success' || steps.pqnetwork.outcome == 'failure') }}" for step in receipts))
    need(".cleanupComplete == true" in receipts[0])
    delivery_job, delivery_steps = workflow_steps(raw, "protocol-delivery")
    mac_job, _ = workflow_steps(raw, "proof-verifier-macos")
    push_condition = ("github.event_name == 'push' && (github.ref == 'refs/heads/codex/ynx-pq-public-upgrade' || "
                      "github.ref == 'refs/heads/codex/ynx-pq-perf-integration')")
    need(re.findall(r"(?m)^    needs: (.+)$", delivery_job) == ["[focused-go, caddy-source]"]
         and "    timeout-minutes: 12\n" in delivery_job)
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
    need(branches == ["      - 'codex/ynx-pq-public-upgrade'\n      - 'codex/ynx-pq-perf-integration'\n"])
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
         "timeout 90s python3 -B scripts/verify/test_install_public_bft_caddy_json_baseline.py -v"))
    for name, command in caddy_commands:
        found = [step for step in caddy_steps if step.startswith("      - name: " + name + "\n")]
        need(len(found) == 1)
        need(lines(found[0]) == ["      - name: " + name,
            "        if: ${{ !cancelled() && steps.source.outcome == 'success' }}",
            "        timeout-minutes: 3", "        run: " + command])
        need(caddy_steps.index(source) < caddy_steps.index(found[0]))
    need(raw.count("bash scripts/verify/public-bft-gateway-ingress-check.sh") == 1)
    need("    needs: protocol-delivery\n" in mac_job and "    timeout-minutes: 6\n" in mac_job)
    need("    if: github.event_name == 'push' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration'\n" in mac_job)
    need("          ref: ${{ github.sha }}\n" in delivery_job and "          ref: ${{ github.sha }}\n" in mac_job)
    combined = steps + delivery_steps
    by_name = lambda name: [step for step in combined if step.startswith("      - name: " + name + "\n")]
    signer_name = "Build and pin normal signer process binaries without running them"
    for name in NORMAL_STEP_NAMES:
        found = by_name(name)
        need(len(found) == (2 if name == signer_name else 1))
        for step in found:
            need(condition(step).startswith("${{ !inputs.consensus_remote_e2e_retained_history && (")
                 and condition(step).endswith(") }}"))
    non_host = by_name("Verify complete state bridge and sponsor continuity")[0]
    host = by_name("Verify original Host source, live lifecycle and delivery persistence")[0]
    need("-skip '^TestProofHost' ./internal/consensus" in non_host)
    need("-run '^TestProofHost' ./internal/consensus" in host)
    need("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT: ${{ runner.temp }}/ynx-proof-host-source-public" in host)
    cutover = by_name("Verify original public cutover caller preserves independent operator and runtime pins")[0]
    for script in ("public-bft-production-driver-check.sh --snapshot-only", "owner-handover-check.sh",
                   "production-service-signer-ceremony-check.sh", "production-custody-review-check.sh",
                   "public-bft-production-candidate-check.sh", "public-bft-cutover-transaction-check.sh",
                   "public-bft-gateway-dependencies-check.sh",
                   "public-bft-validator-registration-check.sh"):
        need("bash scripts/verify/" + script in cutover)
    need("bash scripts/verify/public-bft-gateway-ingress-check.sh" not in cutover)
    need("PUBLIC_BFT_FINAL_SNAPSHOT_PARTIAL_ERASED" in cutover)
    # Both complementary current consensus groups still execute once, with
    # the original whole selectors. Private Host stores stay on their runner.
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
    need(condition(deploy_upload) == "${{ !inputs.consensus_remote_e2e_retained_history && (!cancelled() && steps.pqgateway.outcome == 'success') }}")
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
    need(condition(target_test) == "${{ !inputs.consensus_remote_e2e_retained_history && (success() && steps.identity.outcome == 'success') }}")
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
                   '${{ runner.temp }}/ynx-proof-host-typed-source-cli-public-receipt.json'])
    need("test_pq_ci_stage_inputs.py" in controls[0])


class NormalCIWorkflowSourceControls(unittest.TestCase):
    def test_actual_workflow_source_keeps_gate_guard_caps_receipts_and_normal_push(self):
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        assert_workflow_contract(raw)

    def test_independent_caddy_source_failure_or_wrong_source_cannot_qualify_delivery(self):
        # Mutate the real source job and its consumers. These are contract
        # counterexamples, not evidence that GitHub ran any Caddy operation.
        raw = (Path(__file__).resolve().parents[2]/".github/workflows/resource-market-ci.yml").read_text()
        caddy, steps = workflow_steps(raw, "caddy-source")
        delivery, _ = workflow_steps(raw, "protocol-delivery")
        source = next(step for step in steps if "        id: source\n" in step)
        guard = next(step for step in steps if step.startswith(
            "      - name: Verify existing Caddyfile and JSON ingress source controls\n"))
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
            raw.replace("      - 'codex/ynx-pq-perf-integration'\n", "      - 'main'\n", 1)]
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
                 "consensus_remote_e2e_retained_history", "remote_signer_process")
        mutations = []
        for mode in modes:
            token = "inputs." + mode
            # Require each complete identifier, including consensus_e2e which
            # is also a prefix of two distinct retained-history identifiers.
            changed = re.sub(re.escape(token) + r"(?![a-z0-9_])", "false", group_line)
            self.assertNotEqual(changed, group_line)
            mutations.append(raw.replace(group_line, changed, 1))
        mutations.extend([
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
            ("-skip '^TestProofHost'", "-skip '^TestProofHost|TestABCI'"),
            ("-run '^TestProofHost'", "-run '^TestProofHostMissing'"),
            ("steps.normalci.outcome == 'success' && steps.pqnetworkcontracts.outcome == 'success'", "true"),
            ('--normal-run-id "$YNX_NORMAL_CI_RUN_ID"', "--normal-run-id '${{ inputs.normal_ci_run_id }}'"),
            ("    timeout-minutes: 12\n", "    timeout-minutes: 15\n"),
            ("activeMs=105000, cleanupMs=15000, totalMs=120000", "activeMs=120000, cleanupMs=15000, totalMs=135000"),
            ("if started > now or remaining < 150:", "if remaining < 120:"),
            ("remaining = started + 12*60 - now", "remaining = started + 15*60 - now"),
            ("receipt['currentRunStartedAt']", "datetime.datetime.now()"),
            ("steps.pqnetworkbuild.outcome == 'success'", "true"),
            ("scripts/loadtest/pq-paired-linux-window.py --consensus-remote-e2e-retained-history", "scripts/loadtest/pq-paired-linux-window.py --consensus-e2e"),
            ("      - name: Verify Linux window controls without starting a node\n", "      - name: Silently omitted controls\n"),
            (".cleanupComplete == true", ".cleanupComplete != false"),
            ("    if: github.event_name == 'push' && github.ref == 'refs/heads/codex/ynx-pq-perf-integration'\n", "    if: false\n"),
        ]
        for before, after in changes:
            self.assertIn(before, raw)
            with self.subTest(before=before), self.assertRaises(AssertionError):
                assert_workflow_contract(raw.replace(before, after, 1))

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
            raw.replace(prepared + build, build + prepared, 1),
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
