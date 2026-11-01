#!/usr/bin/env python3
"""One fixed current75 synthetic baseline using the original Perf executor.

Current75 includes 77e907 production improvements. It is not the untouched fdc
before. Qualification here is previous-source DATA, not remote/current-run or
Root authorization. No protocol, signing or proof implementation is replaced.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import types

PROFILE = "current75-online-100x5"
REF = "refs/heads/codex/ynx-pq-current75-baseline-20261101"
WORKFLOW = ".github/workflows/pq-normal-process.yml"
GO_SOURCE = "7593d691bafa6e7e5bb40511464aed27a41b416d"
GO_TREE = "eb3eda31c0b59cb14d6db62f0deaa4940c3d41c6"
FORK_TREE = "54e88e6aba735eaceeb2d00bb40731248c673bd7"
NORMAL_RUN = "41228262522"
TOOLS = "fb994160c121a0e83c91e91f1318fa2a7b5adcca"
TOOLS_TREE = "5ad544c2b0bf5bc889bd3baeb233b6c98872c5e3"
CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
            newBytes=8 << 30, initialMemoryBytes=6 << 30,
            initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
SOURCE_PINS = {
    "go.mod": "2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858",
    "go.sum": "cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad",
    "scripts/ops/validate-pq-remote-normal-ci.py": "6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475",
    "scripts/loadtest/pq-source-artifact-intake.py": "ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef",
}
TOOL_PINS = {
    "pq-independent-load.py": "a8dccfec40bcb9b7d50a40490712a395e099ab6c98b7a556254bb46a646fc83f",
    "pq-independent-scheduler.py": "8f4bdd7ad66e75a02c0e4f54b96b18862e87939957090ef82de3888a0dd1d234",
    "pq-normal-process-lab.py": "1de70d0e970090c2b6c9cd600f6cbdde565a12b8ddbcccb8325791b12e94078f",
    "consensus-linux-cohort.py": "d7c657a1aa9787fa62a580f0f83caf71e17ba261697389322de521fef8902eaf",
    "pq-paired-linux-window.py": "b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2",
}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def fixed_options(source):
    # 500 is the complete demand. Four additional preparation accounts are
    # never recycled into these 16 independently leased signing accounts.
    return argparse.Namespace(source=str(source), commit=GO_SOURCE, mode="online",
                              rate=100, seconds=5, accounts=16, per_account=32,
                              tail_seconds=30, proof_timeout=30,
                              wire_observation=False, network_accounting=False,
                              prior_result=None, prior_result_sha256=None, execute=True)


def prepared_data():
    return dict(profile=PROFILE, controllerRef=REF, goSource=GO_SOURCE, goTree=GO_TREE, tools=TOOLS,
                sourceQualificationRun=NORMAL_RUN, configuredDemand=500,
                offeredTPS=100, seconds=5, measuredAccounts=16, capacityPerAccount=32,
                preparationAccounts=4, sameSourceBinaryCount=3, caps=CAPS,
                label="current75 nonexperimental baseline; contains previous production improvements",
                untouchedFdcBefore=False, combinedABBaseline=False, executed=False,
                nodeStartAuthorized=False, publicNetwork=False, authorityGranted=False)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], timeout=10).decode().strip()


def checked_source(root, commit, tree):
    require(root.is_absolute() and root.resolve(strict=True) == root and not root.is_symlink(),
            "canonical exact checkout required")
    require(git(root, "rev-parse", "HEAD") == commit and
            git(root, "rev-parse", "HEAD^{tree}") == tree and
            git(root, "status", "--porcelain", "--untracked-files=all") == "",
            "exact clean original checkout required")


def pinned_bytes(path, expected):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= 1 << 20,
            "bounded regular original source required")
    raw = path.read_bytes()
    require(len(raw) == info.st_size and hashlib.sha256(raw).hexdigest() == expected,
            "fixed original source bytes changed")
    return raw


def pinned_module(name, path, pin):
    raw = pinned_bytes(path, pin)
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def prior_source_data(lib, fetch):
    # Reuse the actual fixed validator's prior-run and repository semantics.
    # Do not call its remote/current-dispatch gate with a different workflow.
    prefix = "/repos/" + lib.REPOSITORY + "/actions/"
    path = prefix + "runs/" + NORMAL_RUN
    run = fetch(path)
    identity = lib.validate_run(run, GO_SOURCE, NORMAL_RUN)
    workflow = fetch(prefix + "workflows/resource-market-ci.yml")
    require(workflow.get("id") == run["workflow_id"] and workflow.get("path") == lib.WORKFLOW_PATH,
            "original source qualification workflow changed")
    selected, seen, total, consumed = {}, set(), None, 0
    for page in range(1, lib.MAX_JOB_PAGES + 1):
        batch = fetch(path + "/attempts/" + str(run["run_attempt"]) +
                      "/jobs?per_page=100&page=" + str(page))
        count = batch.get("total_count")
        rows = batch.get("jobs")
        require(type(count) is int and 0 < count <= 300 and type(rows) is list,
                "original source job page invalid")
        total = count if total is None else total
        require(total == count and len(rows) == min(100, total - consumed) and len(rows) > 0,
                "original source job page incomplete")
        consumed += len(rows)
        for row in rows:
            require(type(row) is dict and type(row.get("id")) is int and row["id"] > 0 and
                    row["id"] not in seen, "original source job identity duplicate or invalid")
            seen.add(row["id"])
            name = row.get("name")
            if name not in lib.REQUIRED_JOBS:
                continue
            require(name not in selected and row.get("head_sha") == GO_SOURCE and
                    type(row.get("run_id")) is int and row["run_id"] == run["id"] and
                    type(row.get("run_attempt")) is int and row["run_attempt"] == run["run_attempt"] and
                    row.get("run_url") == lib.API + path and row.get("status") == "completed" and
                    row.get("conclusion") == "success", "required original source job not qualified")
            selected[name] = row["id"]
        if consumed == total:
            break
    require(consumed == total and set(selected) == set(lib.REQUIRED_JOBS),
            "complete original source qualification jobs required")
    require(lib.validate_run(fetch(path), GO_SOURCE, NORMAL_RUN) == identity,
            "original source qualification changed during read")
    return dict(version="YNX-CURRENT75-PRIOR-SOURCE-QUALIFICATION-DATA/v1", classification="data",
                sourceCommit=GO_SOURCE, sourceTree=GO_TREE, normalRunId=NORMAL_RUN,
                normalRunAttempt=run["run_attempt"], requiredJobs=selected,
                previousSourceQualificationOnly=True, currentControllerRemoteGatePassed=False,
                nodeStartAuthorized=False, authorityGranted=False, publicNetwork=False)


def validate_host(environment):
    require(sys.platform == "linux" and environment.get("GITHUB_ACTIONS") == "true" and
            environment.get("RUNNER_ENVIRONMENT") == "github-hosted" and
            environment.get("GITHUB_REPOSITORY") == "JiahaoAlbus/YNX-Chain" and
            environment.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch") and
            environment.get("GITHUB_REF") == REF and environment.get("GITHUB_RUN_ATTEMPT") == "1" and
            environment.get("PQ_BASELINE_PROFILE") == PROFILE and
            environment.get("GITHUB_WORKFLOW_REF") == "JiahaoAlbus/YNX-Chain/" + WORKFLOW + "@" + REF,
            "only the fixed first-attempt hosted synthetic profile may execute")
    require(re.fullmatch("[0-9a-f]{40}", environment.get("GITHUB_SHA", "")) is not None and
            environment["GITHUB_SHA"] != "0" * 40 and
            re.fullmatch("[1-9][0-9]*", environment.get("GITHUB_RUN_ID", "")) is not None,
            "actual current controller and run identity required")


def install_counted_window(driver, intake, additional_roots, adapter):
    original = driver.lab.Window
    calls = []

    def counted_window(source, work, additional_storage=()):
        require(not calls, "the fixed profile may create only one original Window")
        roots = intake.nonoverlapping_roots([*additional_storage, *additional_roots])
        window = original(source, work, additional_storage=tuple(roots))
        # The original helper resolves strictly and removes only real overlap.
        # Its failures propagate; no root or capacity error is suppressed.
        window.storage_roots = intake.nonoverlapping_roots(window.storage_roots)
        record = dict(adapter, additionalRoots=[str(p) for p in additional_roots],
                      actualStorageRoots=[str(p) for p in window.storage_roots],
                      originalWindowImplementationUnchanged=True, onlyStorageRootAdapter=True)
        driver.lab.write_new(work / "public/CURRENT75-BASELINE-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls


def require_complete(result):
    require(result["firstCause"] is None and result["cleanupComplete"] is True and
            result.get("loadExecuted") is True and result.get("normalLiveCalleeUsed") is True and
            result.get("configuredDemand") == 500 and result.get("requestedOfferedTPS") == 100 and
            result.get("loadResult", {}).get("windowCompleted") is True and
            result["loadResult"]["configuredDemand"] == 500 and result["loadResult"]["notQualified"] == 0,
            "original fixed load incomplete or UNKNOWN; preserve partial and never replay")


def execute(source, tools):
    validate_host(os.environ)
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    parent = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    controller = Path(__file__).resolve().parents[2]
    require(controller == workspace / "controller" and source == workspace / "source" and
            tools == workspace / "tools", "only the three exact owned checkout locations are allowed")
    require(git(controller, "rev-parse", "HEAD") == os.environ["GITHUB_SHA"] and
            git(controller, "status", "--porcelain", "--untracked-files=all") == "",
            "current controller must be the exact clean workflow checkout")
    checked_source(source, GO_SOURCE, GO_TREE)
    checked_source(tools, TOOLS, TOOLS_TREE)
    require(git(source, "rev-parse", "HEAD:third_party/cometbft") == FORK_TREE,
            "original Comet source graph differs")
    for path, pin in SOURCE_PINS.items():
        pinned_bytes(source / path, pin)
    for name, pin in TOOL_PINS.items():
        pinned_bytes(tools / "scripts/loadtest" / name, pin)
    # Normal imports must not read an ignored replacement bytecode cache.
    require(not any((tools / "scripts/loadtest").rglob("*.pyc")), "original tools must not contain bytecode substitutes")
    lib = pinned_module("normal75_source_gate", source / "scripts/ops/validate-pq-remote-normal-ci.py",
                        SOURCE_PINS["scripts/ops/validate-pq-remote-normal-ci.py"])
    data_path = parent / ("pq-current75-source-qualification-" + os.environ["GITHUB_RUN_ID"] + "-1.json")
    require(not data_path.exists() and not data_path.is_symlink(), "original source DATA must be fresh and exclusive")
    data = prior_source_data(lib, lib.github_fetcher(os.environ.get("GH_TOKEN", "")))
    with data_path.open("x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(data, out, sort_keys=True); out.write("\n"); out.flush(); os.fsync(out.fileno())
    # Read-only qualification credentials are never inherited by Go/node/key
    # processes or copied into public original operation receipts.
    os.environ.pop("GH_TOKEN", None)
    os.environ.pop("GITHUB_TOKEN", None)
    driver = pinned_module("current75_original_load", tools / "scripts/loadtest/pq-independent-load.py",
                           TOOL_PINS["pq-independent-load.py"])
    intake = pinned_module("current75_original_storage", source / "scripts/loadtest/pq-source-artifact-intake.py",
                           SOURCE_PINS["scripts/loadtest/pq-source-artifact-intake.py"])
    require(driver.lab.CAPS == CAPS and driver.lab.RSS_OBSERVER_VERSION == "same-process-rss-v3-pidfd",
            "original Window caps or pidfd guard differ")
    go = shutil.which("go")
    require(go is not None, "pinned original Go toolchain is required")
    go_root = Path(go).resolve(strict=True).parent.parent
    adapter = dict(prepared_data(), controllerCommit=os.environ["GITHUB_SHA"],
                   controllerSourceSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   goSourceCommit=GO_SOURCE, toolsSourceSHA256=TOOL_PINS["pq-independent-load.py"],
                   sourceQualificationPath=str(data_path), sourceQualificationOnly=True)
    original, calls = install_counted_window(driver, intake, (workspace, parent, go_root), adapter)
    try:
        options = fixed_options(source)
        require(driver.validate_options(options) == 500, "all 500 original logical requests are required")
        result = driver.run(options)
    finally:
        driver.lab.Window = original
    require(len(calls) == 1, "one actual original Window is required")
    require_complete(result)
    return result


def main(argv=None):
    values = sys.argv[1:] if argv is None else argv
    for flag in ("--source", "--tools", "--execute"):
        require(values.count(flag) <= 1, "duplicate fixed-profile argument")
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source"); parser.add_argument("--tools"); parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(values)
    if not args.execute:
        print(json.dumps(prepared_data(), sort_keys=True))
        return 0
    require(args.source and args.tools, "explicit exact source and tools checkouts required")
    # Preserve the original entry's signal -> exception -> original run/finally
    # cleanup path when invoking its function rather than its __main__ parser.
    def interrupted(signum, frame):
        raise RuntimeError("normal independent load received signal " + str(signum))
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    print(json.dumps(execute(Path(args.source), Path(args.tools)), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
