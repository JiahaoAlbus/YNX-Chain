#!/usr/bin/env python3
"""One fixed source703 ready/timings synthetic cohort using the original Perf executor.

Source703 includes other production changes. It is not a pure-cache A/B or fdc
before. Qualification here is previous-source DATA, not remote/current-run or
Root authorization. No protocol, signing or proof implementation is replaced.
"""
import argparse
import datetime
import io
import time
import zipfile
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

PROFILE = "current703-online-100x5-readytimings"
REF = "refs/heads/codex/ynx-pq-current75-baseline-20261101"
WORKFLOW = ".github/workflows/pq-normal-process.yml"
GO_SOURCE = "7037966eb2ce7a7167f02a09ee1f3bc0eebd1026"
GO_TREE = "d15f6dc63ee4c69460273d348637e135c8005922"
FORK_TREE = "54e88e6aba735eaceeb2d00bb40731248c673bd7"
NORMAL_RUN = "41272858949"
TOOLS = "11acbc96202dd5885e4bbdc0ac34318bcfd8567e"
TOOLS_TREE = "dcafad8d35eacc47837ef867d05995371590759d"
CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
            newBytes=8 << 30, initialMemoryBytes=6 << 30,
            initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
SOURCE_PINS = {
    ".github/workflows/resource-market-ci.yml": "381b8e30f93c7087af8a911037fb9d45afa85f7ee756bdfeba7ccf0097ee5e70",
    "go.mod": "2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858",
    "go.sum": "cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad",
    "scripts/ops/validate-pq-remote-normal-ci.py": "6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475",
    "scripts/loadtest/pq-source-artifact-intake.py": "ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef",
}
TOOL_PINS = {
    "pq-independent-load.py": "c0d4c777b5b00215e28250f08ef729e3cb02ab2c15a776920dc6424a179cf922",
    "pq-independent-scheduler.py": "6a4aa31dd4198f152d748b4441edbfb50a078e64c51233fd165f87d4557faef1",
    "pq-normal-process-lab.py": "6810b02608e54fe0dfde05555073c8f01463ac182f4dea76a9dfb6a2af4e1195",
    "consensus-linux-cohort.py": "ffc7e02e1d37adc28f4d94c262d30a45e91eb594307931b482dcdd39ccc82591",
    "pq-paired-linux-window.py": "b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2",
}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def fixed_options(source):
    # 500 is the complete demand. Four additional preparation accounts are
    # never recycled into these 8 independently leased signing accounts.
    return argparse.Namespace(source=str(source), commit=GO_SOURCE, mode="online",
                              rate=100, seconds=5, accounts=8, per_account=63,
                              tail_seconds=30, proof_timeout=30,
                              wire_observation=False, network_accounting=False,
                              prior_result=None, prior_result_sha256=None, execute=True)


def prepared_data():
    return dict(profile=PROFILE, controllerRef=REF, goSource=GO_SOURCE, goTree=GO_TREE, tools=TOOLS,
                sourceQualificationRun=NORMAL_RUN, sourceQualificationContinuation=CONTINUATION_RUN, configuredDemand=500,
                offeredTPS=100, seconds=5, measuredAccounts=8, capacityPerAccount=63,
                preparationAccounts=4, sameSourceBinaryCount=3, caps=CAPS,
                label="source703 normal ready/timings cohort; includes other production changes, not pure-cache A/B or old75 ratio",
                untouchedFdcBefore=False, combinedABBaseline=False, executed=False,
                previous16SenderRun="41264965296", previous16SenderLoadExecuted=False,
                previous8RSSExitRun="41266674073", previous8RSSExitLoadExecuted=False,
                previous8OnlineCorpusRun="41267267458", previous8OnlineCorpusLoadExecuted=False,
                previousActual500Run="41268140726", previousActual500Unknown=8,
                coldInitializationRetainedSeparately=True, noOld75Qualification=True,
                accountSelection="Root fixed eight independent accounts, each at most one pending; all500 demand retained",
                helperMaximumLive=3, originalOwnedPIDLimit=16,
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


JOINT_SPEC = {'resourceSHA256': '381b8e30f93c7087af8a911037fb9d45afa85f7ee756bdfeba7ccf0097ee5e70', 'priorPrefix': [[1, 'Set up job', 'success'], [2, 'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'success'], [3, 'Run actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e', 'success'], [4, 'Verify exact public TLS fixture and fail-closed secret scanning', 'success'], [5, 'Record exact candidate identity', 'success'], [6, 'Check reachable vulnerabilities in the eight production runtime commands', 'success'], [7, 'Verify same-source completed normal CI before remote network execution', 'skipped'], [8, 'Verify original-copy observation controls without touching the original case', 'success'], [9, 'Verify Linux window controls without starting a node', 'success'], [10, 'Verify pure dual-PQ protocol and account authorization', 'success'], [11, 'Upload only actual Go public artifact-purpose vectors', 'success'], [12, 'Upload public canonical action vectors from the actual Go codec', 'success'], [13, 'Verify forked engine keys and actual consensus objects', 'success'], [14, 'Compile forked state and consensus engine without starting nodes', 'success'], [15, 'Verify exact-height maintenance stop with real engine commit and cold stores', 'success'], [16, 'Reproduce and repair same-directory database ownership without starting nodes', 'success'], [17, 'Verify real profile state transition and historical store without starting nodes', 'success'], [18, 'Reproduce and repair real Commit and engine checkpoint read ordering', 'success'], [19, 'Verify bounded remote signer transport and unchanged legacy protobuf vectors', 'success'], [20, 'Verify actual engine signing caller uses committed height key and round context', 'success'], [21, 'Measure fresh single and bounded concurrent dual signature paths', 'success'], [22, 'Measure actual policy certificate cache consumer cold and warm paths', 'success'], [23, 'Install pinned contract build runtime', 'success'], [24, 'Verify failed candidate deployment preserves services and signing history', 'success'], [25, 'Verify original-state operator transition preserves custody and uncertain attempts', 'success'], [26, 'Verify original key ceremony retains partial custody and never creates during resume', 'success'], [27, 'Compile frozen measured production overlay without executing cases', 'success'], [28, 'Generate canonical IDE contract fixture', 'success'], [29, 'Verify actual IDE compiler materials with original Go deployment callees', 'success'], [30, 'Verify existing Wallet inbox materials with original Go deployment callees', 'success'], [31, 'Upload only public contract deployment registry from the actual Go caller', 'success'], [32, 'Verify native ledger and HTTP PQ integration', 'success'], [33, 'Compile production entry points', 'success'], [34, 'Exercise original lab callee readiness and actual cold costs', 'success'], [35, 'Reproduce opaque classic staking refusal with original successful transactions', 'success'], [36, 'Reproduce the original missing PQ validator staking entry', 'success'], [37, 'Reproduce source log response budget overrun before later records', 'success'], [38, 'Verify complete state bridge and sponsor continuity', 'success'], [39, 'Reproduce signed-history overwrite and unsafe rollback callers', 'success'], [40, 'Reproduce source-authority initialization coupling and verify independent execution', 'success'], [41, 'Reproduce JSON-only signing source and verify real journal recovery', 'success'], [42, 'Reproduce atomic-only Comet operator startup and verify normal journal selection', 'success'], [43, 'Reproduce Ethereum mutable-lot provenance counterexamples and verify cold recovery', 'success'], [44, 'Reproduce historical AA policy counterexamples against the original state validator', 'success'], [45, 'Reproduce source evidence rehash counterexamples and verify original-label coverage', 'success'], [46, 'Reproduce history pagination movement across real application commits', 'success'], [47, 'Reproduce the existing Wallet health refusal with the complete original Gateway', 'success']], 'dependency': {'index': 26, 'name': 'Generate canonical IDE contract fixture', 'bodySHA256': '2da64f78d08e69a92e3432e7a38775d5d4520951a9d47fa762ea3c73476d1404', 'env': {'NODE_OPTIONS': '--max-old-space-size=1536'}}, 'steps': [{'index': 46, 'name': 'Verify Whole BFT gateway and native container readback', 'bodySHA256': '12c80eec149efe88637f02c42e368ce94df84d0a61bbd1512e25ce54ba124e85', 'env': {'YNX_PQ_STAKING_ORIGINALS_FIXTURE_OUT': '${{ runner.temp }}/ynx-pq-staking-originals-public-interop.json', 'YNX_PQ_CONTRACT_DEPLOY_FIXTURE_OUT': '${{ runner.temp }}/ynx-pq-contract-deploy-public-interop.json'}}, {'index': 49, 'name': 'Verify existing Chain readback and recovery after protocol integration', 'bodySHA256': '6df8ea01f41f88ab8f7baf49adcab457ffc1b49b4fc4db7daa932cb1dc9e0841', 'env': {}}, {'index': 50, 'name': 'Verify existing Chain SDK after protocol integration', 'bodySHA256': 'efc51916ac5bda49f2376f02acb54e7a361dc5952152f1df5d2f505a58e792ca', 'env': {}}, {'index': 51, 'name': 'Emit application-backed public Wallet HTTP fixture', 'bodySHA256': 'f363ab0e424107e3b13c6efc6e458f1075bc68b71532a105c92f836a67995d53', 'env': {'YNX_PQ_WALLET_FIXTURE_OUT': '${{ runner.temp }}/ynx-pq-wallet-public-http-fixture.json'}}, {'index': 53, 'name': 'Verify shared Wallet policy and Chain payment authorization regressions', 'bodySHA256': '3baa35ffc144ee79a40ee8b245619fcab6d9922fa7595338685ebb2562360b2c', 'env': {}}, {'index': 54, 'name': 'Reproduce private verifier process-exit telemetry counterexample', 'bodySHA256': '375c437b4adba9b882b90b9f079023d85d9632f9d63e4d80b7beeca8eda1e519', 'env': {}}, {'index': 55, 'name': 'Verify operator checkpoint format and original read-lock admission', 'bodySHA256': '20701caa5e7308adea90dc5f097dd46881b2bd7c1997fbd6591239da1e040224', 'env': {}}]}
CONTINUATION_CONTROLLER = "8558fb95d96a98815361385bc18dadcc4c99abb7"
CONTINUATION_TREE = "526aa6ae4909b4a40f857f6c89f89ebcd6118979"
CONTINUATION_RUN = 41278568036
CONTINUATION_JOB = 124765630747
CONTINUATION_BRANCH = "codex/ynx-pq-source703-continuation-20261101"
ARTIFACT = 13072721720
ARTIFACT_BYTES = 6255
ARTIFACT_SHA256 = "bec0fd10444606034fb1e338751fe01fd6e456bb936cd4f8a47ca76a579d3fa1"
REPO = "JiahaoAlbus/YNX-Chain"


def api_reader():
    allowed = {"actions/runs/41272858949", "actions/jobs/124749016396",
        "check-runs/124749016396/annotations?per_page=100", "actions/runs/41272858825",
        "actions/runs/41278568036", "actions/jobs/124765630747", "git/commits/"+GO_SOURCE,
        "git/commits/"+CONTINUATION_CONTROLLER, "actions/artifacts/13072721720",
        "actions/runs/41278568036/attempts/1/jobs?per_page=100&page=1"}
    deadline=time.monotonic()+60
    def fetch(path,binary=False):
        require(path in allowed or binary and path=="actions/artifacts/13072721720/zip", "fixed read-only API path required")
        remaining=deadline-time.monotonic();require(remaining>0,"finite qualification API deadline exceeded")
        result=subprocess.run(["gh","api","--hostname","github.com","--method","GET","repos/"+REPO+"/"+path],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(20,remaining))
        require(result.returncode==0 and len(result.stdout)<=(ARTIFACT_BYTES if binary else 2<<20),"fixed qualification read unavailable or oversized")
        return result.stdout if binary else json.loads(result.stdout)
    return fetch


def run_identity(value,identity,head,conclusion,path,branch):
    require(type(value.get("id")) is int and value["id"]==identity and value.get("head_sha")==head and type(value.get("run_attempt")) is int and value["run_attempt"]==1 and value.get("event")=="push" and value.get("status")=="completed" and value.get("conclusion")==conclusion and value.get("path")==path and value.get("head_branch")==branch,"fixed original run/source/attempt/terminal differs")


def prior_source_data(fetch):
    # Finite DATA closure: real original successful prefix plus exactly seven
    # missing steps, preserving cancellation. This is not whole-CI success.
    prior=fetch("actions/runs/41272858949");job=fetch("actions/jobs/124749016396")
    chain=fetch("actions/runs/41272858825");tailrun=fetch("actions/runs/41278568036");tailjob=fetch("actions/jobs/124765630747")
    run_identity(prior,41272858949,GO_SOURCE,"cancelled",".github/workflows/resource-market-ci.yml","codex/ynx-pq-perf-integration")
    run_identity(chain,41272858825,GO_SOURCE,"success",".github/workflows/chain-core.yml","codex/ynx-pq-perf-integration")
    run_identity(tailrun,CONTINUATION_RUN,CONTINUATION_CONTROLLER,"success",WORKFLOW,CONTINUATION_BRANCH)
    require(tailrun.get("workflow_id")==402774607,"original continuation workflow identity differs")
    for value,identity,run,head,name,end in [(job,124749016396,41272858949,GO_SOURCE,"focused-go","cancelled"),(tailjob,CONTINUATION_JOB,CONTINUATION_RUN,CONTINUATION_CONTROLLER,"source703-continuation","success")]:
        require(type(value.get("id")) is int and value["id"]==identity and value.get("run_id")==run and value.get("head_sha")==head and type(value.get("run_attempt")) is int and value["run_attempt"]==1 and value.get("name")==name and value.get("status")=="completed" and value.get("conclusion")==end,"fixed original job scope differs")
    prefix=[[s["number"],s["name"],s.get("conclusion")] for s in job["steps"] if s["number"]<48]
    require(prefix==JOINT_SPEC["priorPrefix"],"original source703 prefix changed; no inherited qualification")
    cancelled=[s for s in job["steps"] if s["number"]==48]
    require(len(cancelled)==1 and cancelled[0]["name"]==JOINT_SPEC["steps"][0]["name"] and cancelled[0]["conclusion"]=="cancelled","original cancellation must remain")
    annotations=fetch("check-runs/124749016396/annotations?per_page=100")
    require(any(a.get("annotation_level")=="failure" and a.get("message")=="The job has exceeded the maximum execution time of 15m0s" for a in annotations),"original official timeout evidence absent")
    parse=lambda v:datetime.datetime.strptime(v,"%Y-%m-%dT%H:%M:%SZ")
    require(900<=(parse(job["completed_at"])-parse(job["started_at"])).total_seconds()<=930,"original source timeout interval differs")
    for commit,tree,parent in [(GO_SOURCE,GO_TREE,None),(CONTINUATION_CONTROLLER,CONTINUATION_TREE,GO_SOURCE)]:
        value=fetch("git/commits/"+commit)
        require(value.get("sha")==commit and value.get("tree",{}).get("sha")==tree,"official Git graph differs")
        if parent:require([v["sha"] for v in value["parents"]]==[parent],"continuation is not sole original703 child")
    jobs=fetch("actions/runs/41278568036/attempts/1/jobs?per_page=100&page=1")
    require(jobs.get("total_count")==1 and [v.get("id") for v in jobs.get("jobs",[])]==[CONTINUATION_JOB],"continuation job graph changed")
    artifact=fetch("actions/artifacts/13072721720")
    require(artifact.get("id")==ARTIFACT and artifact.get("name")=="ynx-source703-continuation-"+CONTINUATION_CONTROLLER+"-"+str(CONTINUATION_RUN) and artifact.get("size_in_bytes")==ARTIFACT_BYTES and artifact.get("expired") is False and artifact.get("digest")=="sha256:"+ARTIFACT_SHA256,"original continuation artifact identity differs")
    link=artifact.get("workflow_run",{})
    require(link.get("id")==CONTINUATION_RUN and link.get("head_sha")==CONTINUATION_CONTROLLER and link.get("head_branch")==CONTINUATION_BRANCH and link.get("repository_id")==1285041796 and link.get("head_repository_id")==1285041796,"artifact original run/source binding differs")
    raw=fetch("actions/artifacts/13072721720/zip",binary=True)
    require(len(raw)==ARTIFACT_BYTES and hashlib.sha256(raw).hexdigest()==ARTIFACT_SHA256,"complete original continuation archive SHA256 differs")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=archive.namelist();require(len(names)==3 and set(names)=={"CONTINUATION-RECEIPT.json","PRIOR-SCOPE.json","SOURCE-STEPS.json"},"closed continuation archive changed")
        require(all(i.file_size<=1<<20 for i in archive.infolist()) and archive.testzip() is None,"bounded original archive CRC failure")
        documents={name:json.loads(archive.read(name)) for name in names}
    receipt=documents["CONTINUATION-RECEIPT.json"]
    require(receipt.get("version")=="YNX-SOURCE703-CONTINUATION-RESULT/v1" and receipt.get("actualCalleeSHA")==GO_SOURCE and receipt.get("actualCalleeTree")==GO_TREE and receipt.get("controllerSHA")==CONTINUATION_CONTROLLER and receipt.get("currentRunId")==CONTINUATION_RUN and receipt.get("currentJobId")==CONTINUATION_JOB and receipt.get("currentRunAttempt")==1,"original continuation receipt source/controller differs")
    for flag in ["continuationScopePassed","sevenTailActualPassed","sourceUnchanged","controllerUnchanged"]:require(receipt.get(flag) is True,"continuation scope incomplete")
    for flag in ["originalResourceWholeSuccess","actual500Window","newNetworkWindow","authorityGranted","deploymentQualified","realFunds"]:require(receipt.get(flag) is False,"source-only DATA cannot grant execution or rewrite original cancellation")
    require(receipt.get("sourceWorkflowSHA256")==JOINT_SPEC["resourceSHA256"] and receipt.get("prior",{}).get("resourceConclusion")=="cancelled" and receipt["prior"].get("resourceRunId")==41272858949 and receipt["prior"].get("prefix")==prefix,"original source prefix/archive differs")
    require(documents["SOURCE-STEPS.json"].get("requiredNewTail")==JOINT_SPEC["steps"] and documents["SOURCE-STEPS.json"].get("oldSuccessfulVerificationGroupsRerun") is False,"finite original seven-body/env catalog differs")
    scope=documents["PRIOR-SCOPE.json"]
    require(scope.get("actualCalleeSHA")==GO_SOURCE and scope.get("controllerSHA")==CONTINUATION_CONTROLLER and scope.get("prior")==receipt["prior"],"original prior-scope binding differs")
    require(len(receipt.get("tailSteps",[]))==7,"complete seven-step receipt required")
    for actual,spec in zip(receipt["tailSteps"],JOINT_SPEC["steps"]):
        require({k:actual[k] for k in ("index","name","bodySHA256","env")}==spec,"original source body/env catalog changed")
        found=[s for s in tailjob["steps"] if s["name"]==spec["name"]]
        require(len(found)==1 and found[0].get("status")=="completed" and found[0].get("conclusion")=="success" and actual.get("actual")==found[0],"actual original tail missing/skipped/changed")
    dependency=[s for s in tailjob["steps"] if s["name"]==JOINT_SPEC["dependency"]["name"]]
    require(len(dependency)==1 and dependency[0].get("conclusion")=="success" and receipt.get("dependencyActual")==dependency[0] and receipt.get("dependencyMaterialRebuildOnly")==JOINT_SPEC["dependency"],"original dependency material scope incomplete")
    # Reconcile the original operation again, never replace it with a rerun.
    for identity,head,end,path,branch in [(41272858949,GO_SOURCE,"cancelled",".github/workflows/resource-market-ci.yml","codex/ynx-pq-perf-integration"),(41272858825,GO_SOURCE,"success",".github/workflows/chain-core.yml","codex/ynx-pq-perf-integration"),(CONTINUATION_RUN,CONTINUATION_CONTROLLER,"success",WORKFLOW,CONTINUATION_BRANCH)]:
        run_identity(fetch("actions/runs/"+str(identity)),identity,head,end,path,branch)
    return dict(version="YNX-CURRENT703-JOINT-SOURCE-QUALIFICATION-DATA/v1",classification="data",sourceCommit=GO_SOURCE,sourceTree=GO_TREE,priorResourceRunId=41272858949,priorResourceConclusion="cancelled",originalResourceWholeSuccess=False,chainRunId=41272858825,continuationRunId=CONTINUATION_RUN,continuationJobId=CONTINUATION_JOB,continuationController=CONTINUATION_CONTROLLER,continuationArtifact=ARTIFACT,continuationArtifactSHA256=ARTIFACT_SHA256,source703PrefixAndSevenTailScopePassed=True,actual500Window=False,currentControllerRemoteGatePassed=False,nodeStartAuthorized=False,authorityGranted=False,publicNetwork=False)


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
        driver.lab.write_new(work / "public/CURRENT703-BASELINE-CI.json", record)
        calls.append(window)
        return window

    driver.lab.Window = counted_window
    return original, calls


def require_complete(result):
    ready=result.get("senderPoolPreparation",{})
    measures=result.get("normalCalleeMeasurements",{})
    require(result.get("source",{}).get("commit")==GO_SOURCE and result.get("caps")==CAPS and ready.get("readyCount")==8 and ready.get("signed") is False and ready.get("nonceReserved") is False and ready.get("sourceGrant") is False and ready.get("loadClockStarted") is False and measures.get("source")==GO_SOURCE,"exact source703 DATA-ready and original metrics required")
    for kind,n in [("startup",8),("live_setup",4),("sign",500),("confirm",500),("live_publish",500),("live_result",500)]:
        value=measures.get("groups",{}).get(kind,{}).get("calleeElapsed",{})
        require(value.get("denominator")==n and value.get("observed")==n and value.get("censoredOrNotReached")==0,"full original callee timing denominator incomplete")
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
    data_path = parent / ("pq-current703-source-qualification-" + os.environ["GITHUB_RUN_ID"] + "-1.json")
    require(not data_path.exists() and not data_path.is_symlink(), "original source DATA must be fresh and exclusive")
    data = prior_source_data(api_reader())
    with open(data_path, "x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(data, out, sort_keys=True); out.write("\n"); out.flush(); os.fsync(out.fileno())
    # Read-only qualification credentials are never inherited by Go/node/key
    # processes or copied into public original operation receipts.
    os.environ.pop("GH_TOKEN", None)
    os.environ.pop("GITHUB_TOKEN", None)
    driver = pinned_module("current703_original_load", tools / "scripts/loadtest/pq-independent-load.py",
                           TOOL_PINS["pq-independent-load.py"])
    intake = pinned_module("current703_original_storage", source / "scripts/loadtest/pq-source-artifact-intake.py",
                           SOURCE_PINS["scripts/loadtest/pq-source-artifact-intake.py"])
    require(driver.CALLEE_SOURCE == GO_SOURCE,"frozen11ac exact ready/timings source must remain703")
    require(driver.lab.CAPS == CAPS and driver.lab.RSS_OBSERVER_VERSION == "same-process-rss-v4-pidfd-any-state",
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
