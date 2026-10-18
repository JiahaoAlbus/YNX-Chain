#!/usr/bin/env python3
"""Read-only normal-CI reuse DATA; never authorization to start a node/window.

Only GitHub's fixed repository/workflow/run/attempt endpoints are consulted.
No redirect, proxy, artifact execution, retry, process operation or token output.
"""
import argparse
import datetime
import http.client
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request


REPOSITORY = "JiahaoAlbus/YNX-Chain"
API = "https://api.github.com"
WORKFLOW_FILE = "resource-market-ci.yml"
WORKFLOW_PATH = ".github/workflows/" + WORKFLOW_FILE
NORMAL_BRANCHES = frozenset(("codex/ynx-pq-public-upgrade", "codex/ynx-pq-perf-integration"))
REQUIRED_JOBS = ("focused-go", "proof-verifier-macos")
MAX_RESPONSE_BYTES = 2 << 20
PAGE_SIZE = 100
MAX_JOB_PAGES = 3
REQUEST_TIMEOUT_SECONDS = 10
API_BUDGET_SECONDS = 45


class NormalCIError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise NormalCIError(code)


def canonical_run_id(value):
    return type(value) is str and re.fullmatch(r"[1-9][0-9]{0,19}", value) is not None


def validate_request(repo, candidate, normal_run_id, current_run_id):
    require(repo == REPOSITORY, "repository_not_allowed")
    require(type(candidate) is str and re.fullmatch(r"[0-9a-f]{40}", candidate) is not None
            and candidate != "0" * 40, "candidate_identity_invalid")
    require(canonical_run_id(normal_run_id) and canonical_run_id(current_run_id), "run_identity_invalid")
    require(normal_run_id != current_run_id, "current_run_cannot_prove_itself")


def positive_integer(value):
    return type(value) is int and value > 0


def repository_identity(run):
    source, head = run.get("repository"), run.get("head_repository")
    require(type(source) is dict and type(head) is dict
            and source.get("full_name") == REPOSITORY and head.get("full_name") == REPOSITORY
            and source.get("fork") is False and head.get("fork") is False
            and positive_integer(source.get("id")) and positive_integer(head.get("id"))
            and head["id"] == source["id"], "repository_or_fork_mismatch")
    return source["id"]


def validate_run(run, candidate, normal_run_id):
    require(type(run) is dict, "run_metadata_invalid")
    require(positive_integer(run.get("id")) and str(run["id"]) == normal_run_id,
            "run_identity_mismatch")
    require(run.get("head_sha") == candidate and run.get("event") == "push"
            and type(run.get("head_branch")) is str
            and run["head_branch"] in NORMAL_BRANCHES, "normal_source_mismatch")
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "normal_run_not_successful")
    require(run.get("path") == WORKFLOW_PATH and positive_integer(run.get("workflow_id")),
            "workflow_identity_mismatch")
    require(positive_integer(run.get("run_attempt")), "run_attempt_invalid")
    source_id = repository_identity(run)
    return (run["id"], run["head_sha"], run["head_branch"], run["run_attempt"],
            run["workflow_id"], source_id)


def validate_current_run(run, candidate, current_run_id, workflow_id, repository_id):
    require(type(run) is dict and positive_integer(run.get("id"))
            and str(run["id"]) == current_run_id and run.get("head_sha") == candidate,
            "current_run_identity_mismatch")
    require(run.get("event") == "workflow_dispatch" and run.get("status") == "in_progress"
            and "conclusion" in run and run["conclusion"] is None,
            "current_run_not_active_dispatch")
    require(type(run.get("workflow_id")) is int and run["workflow_id"] == workflow_id
            and run.get("path") == WORKFLOW_PATH and positive_integer(run.get("run_attempt"))
            and repository_identity(run) == repository_id, "current_workflow_or_repo_mismatch")
    started = run.get("run_started_at")
    require(type(started) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", started) is not None,
            "current_run_start_invalid")
    try:
        parsed = datetime.datetime.strptime(started, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise NormalCIError("current_run_start_invalid") from None
    require(parsed.strftime("%Y-%m-%dT%H:%M:%SZ") == started, "current_run_start_invalid")
    return (run["id"], run["head_sha"], run["run_attempt"], run["workflow_id"], started)


def validate_normal_ci(repo, candidate, normal_run_id, current_run_id, fetch_json):
    """The same admission function serves production and synthetic API controls."""
    validate_request(repo, candidate, normal_run_id, current_run_id)
    run_path = "/repos/" + REPOSITORY + "/actions/runs/" + normal_run_id
    run = fetch_json(run_path)
    identity = validate_run(run, candidate, normal_run_id)
    workflow = fetch_json("/repos/" + REPOSITORY + "/actions/workflows/" + WORKFLOW_FILE)
    require(type(workflow) is dict and workflow.get("id") == run["workflow_id"]
            and type(workflow.get("id")) is int and workflow.get("path") == WORKFLOW_PATH,
            "workflow_identity_mismatch")
    current_path = "/repos/" + REPOSITORY + "/actions/runs/" + current_run_id
    current = validate_current_run(fetch_json(current_path), candidate, current_run_id,
                                   run["workflow_id"], identity[-1])
    attempt = run["run_attempt"]
    jobs, total = [], None
    for page in range(1, MAX_JOB_PAGES + 1):
        # An explicit attempt endpoint prevents a second attempt's rows from
        # silently mixing with the completed attempt observed above.
        response = fetch_json(run_path + "/attempts/" + str(attempt)
                              + "/jobs?per_page=" + str(PAGE_SIZE) + "&page=" + str(page))
        require(type(response) is dict and type(response.get("total_count")) is int
                and 0 < response["total_count"] <= PAGE_SIZE * MAX_JOB_PAGES
                and type(response.get("jobs")) is list, "jobs_page_invalid")
        if total is None:
            total = response["total_count"]
        require(response["total_count"] == total, "jobs_total_changed")
        expected = min(PAGE_SIZE, total - len(jobs))
        require(len(response["jobs"]) == expected and expected > 0, "jobs_page_incomplete")
        jobs.extend(response["jobs"])
        if len(jobs) == total:
            break
    require(len(jobs) == total, "jobs_page_incomplete")
    seen, selected = set(), {}
    for job in jobs:
        require(type(job) is dict and positive_integer(job.get("id"))
                and type(job.get("name")) is str and job["id"] not in seen,
                "job_metadata_or_duplicate_invalid")
        seen.add(job["id"])
        name = job["name"]
        if name not in REQUIRED_JOBS:
            continue
        require(name not in selected, "required_job_duplicated")
        require(type(job.get("run_id")) is int and job["run_id"] == run["id"]
                and type(job.get("run_attempt")) is int and job["run_attempt"] == attempt
                and job.get("head_sha") == candidate and job.get("run_url") == API + run_path,
                "job_run_source_or_attempt_mismatch")
        require(job.get("status") == "completed" and job.get("conclusion") == "success",
                "required_job_not_successful")
        selected[name] = str(job["id"])
    require(set(selected) == set(REQUIRED_JOBS), "required_job_missing")
    # Do not race a rerun that changes the latest attempt during pagination.
    require(validate_run(fetch_json(run_path), candidate, normal_run_id) == identity,
            "normal_run_changed_during_read")
    require(validate_current_run(fetch_json(current_path), candidate, current_run_id,
                                 run["workflow_id"], identity[-1]) == current,
            "current_run_changed_during_read")
    return dict(version="YNX-PQ-REMOTE-NORMAL-CI/v1", classification="data",
                source="github-actions-api", repo=repo, candidateSha=candidate,
                normalRunId=normal_run_id, currentRunId=current_run_id,
                currentRunStartedAt=current[-1],
                normalRunAttempt=str(attempt), workflowPath=WORKFLOW_PATH,
                normalBranch=run["head_branch"], jobs=selected, normalCIReusable=True,
                nodeStartAuthorized=False, publicDeployment=False)


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, "api_duplicate_json_field")
        out[key] = value
    return out


def reject_constant(_value):
    raise NormalCIError("api_nonfinite_json_value")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _fp, _code, _message, _headers, _new_url):
        raise NormalCIError("api_redirect_refused")


def github_fetcher(token):
    require(type(token) is str and 0 < len(token) <= 4096
            and all(33 <= ord(c) <= 126 for c in token), "github_token_unavailable")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    deadline = time.monotonic() + API_BUDGET_SECONDS

    def fetch(path):
        # Never consume a URL supplied by a run, page, Link header or caller.
        prefix = "/repos/" + REPOSITORY + "/actions/"
        require(type(path) is str and path.startswith(prefix) and "#" not in path
                and re.fullmatch(re.escape(prefix) + r"(?:workflows/resource-market-ci\.yml|runs/[1-9][0-9]{0,19}(?:/attempts/[1-9][0-9]*/jobs\?per_page=100&page=[1-3])?)", path) is not None,
                "api_path_not_allowed")
        remaining = deadline - time.monotonic()
        require(remaining > 0, "api_deadline_exceeded")
        request = urllib.request.Request(API + path, method="GET", headers={
            "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ynx-normal-ci-read-only"})
        try:
            with opener.open(request, timeout=min(REQUEST_TIMEOUT_SECONDS, remaining)) as response:
                require(response.status == 200 and response.geturl() == API + path,
                        "api_response_identity_invalid")
                declared = response.headers.get("Content-Length")
                require(declared is None or re.fullmatch(r"[0-9]{1,10}", declared) is not None
                        and int(declared) <= MAX_RESPONSE_BYTES, "api_response_too_large")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                require(len(raw) <= MAX_RESPONSE_BYTES, "api_response_too_large")
                require(time.monotonic() <= deadline, "api_deadline_exceeded")
            return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                              parse_constant=reject_constant)
        except NormalCIError:
            raise
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError, UnicodeError):
            # Original response bodies, URLs and exception text may contain
            # diagnostics or credentials. Emit only this fixed failure code.
            raise NormalCIError("api_read_failed") from None

    return fetch


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--normal-run-id", required=True)
    parser.add_argument("--current-run-id", required=True)
    args = parser.parse_args(argv)
    try:
        validate_request(args.repo, args.candidate, args.normal_run_id, args.current_run_id)
        result = validate_normal_ci(args.repo, args.candidate, args.normal_run_id,
                                    args.current_run_id, github_fetcher(os.environ.get("GH_TOKEN")))
    except NormalCIError as error:
        print("YNX_REMOTE_NORMAL_CI_REJECTED: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
