#!/usr/bin/env python3
"""One fixed c06 diagnostic synthetic cohort using the original Perf executor.

C06 diagnostic includes other production changes. It is not a pure-cache A/B or fdc
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

PROFILE = "currentc06-online-100x5-commitstages"
REF = "refs/heads/codex/ynx-pq-current75-baseline-20261101"
WORKFLOW = ".github/workflows/pq-normal-process.yml"
GO_SOURCE = "c06b4607247a1fdf7e485337ab03206984baa71c"
GO_TREE = "4fdb9def5256e30108a0f29396eef1e67618fee1"
FORK_TREE = "54e88e6aba735eaceeb2d00bb40731248c673bd7"
NORMAL_RUN = "41285983813"
TOOLS = "36d937f45fa9a144aa0d7520633a5654755b454c"
TOOLS_TREE = "a19a4dd0e29af18b9ca566329b00ecc5d5b19926"
# Exact final consumer source/normal qualification and paired per-height state evidence pending CORE.
SOURCE_EQUIVALENCE_QUALIFICATION = dict(before='01a2fcb6c727f8842327f2f4883d17fdbfaf0b3b',after=GO_SOURCE,scope='diagnostic-N1-only',freezeSHA256='6329ead63e498324d0ba25021c7fd7c616f84f2717c3273a6f3b5c30ea51dd8f')
MEASUREMENT_SCOPE = 'current-c06-diagnostic-baseline'
PERFORMANCE_SOURCE_PAIR_QUALIFICATION = None
CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
            newBytes=8 << 30, initialMemoryBytes=6 << 30,
            initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
SOURCE_PINS = {'.github/workflows/resource-market-ci.yml': '97ec73238d4774a5729a9bd8c88bd22d3a5854e8045064832bc701964f51ed76', 'go.mod': '2892248959ac73f0aaf16197ba18c78594ad956a2e9b9617404c2ebb50818858', 'go.sum': 'cfa98a228afc945aa54730a821b80cfc31cb1b8c0aa57aa0bd1e7cf3827d23ad', 'scripts/ops/validate-pq-remote-normal-ci.py': '6d617c4ba97f82d59db512962873df1202fabfc6f5422c1b56452f020fbb8475', 'scripts/loadtest/pq-source-artifact-intake.py': 'ab75f9748a05523f5719ee42a8a99b576d3444a30481b0e07253956e3e5943ef'}
TOOL_PINS = {'pq-network-window.py': 'd415e10ba6df19e03280ea8fcfe44f7c5dedb943a16ca8c537fe4cbbceb9b273', 'owned-tcp-accounting.py': '612da9404e0ec52b77e6160aa29d39e020fed96695be4b6633f8d1dffc9ac440', 'network-layer-accounting.py': '1b9d16539b711ca7e490c8c4bc01984beba5efa474caeca187dee2f19a5e7635', 'pq-hop-byte-accounting.py': '663c072e11f777d5119f87fa9e200548c117f937427c46295277e722c7d3744b', 'test_pq_hop_byte_accounting.py': '2116cdb12f52f2e8f6500d5e54e3d20248b0d29eef88081962b3ce6ff1984e67', 'pq-owned-header-capture.py': '56c7e0766f771db49d547f98b5e571c654ba8db568153c35d35f9ab2f0c5a070', 'test_pq_owned_header_capture.py': '03417bc6881e4e7f2e9cfb8493f51352f2064d5a6821b5688fdef053a72c19dd', 'fixtures/commit-observation-public-schema.json': '9dc8dbf4820d04068b2272e4dd16f202d6fb106b82cecf8aef6d544517680c06', 'test_pq_commit_observation.py': 'f959a619f163b8af46081aa9c8629da4db4930e356a8bec3b722de7266bca1e8', 'pq-commit-observation.py': 'dc0c830f8e8281a15de2c5c77a278e68419909843af90fde93230e919c9e2ff0', 'test_pq_independent_load.py': '2ed9461c1eb2cf9dd2cd060dde7c68d63b196b65590fa6e7945dee722690ab1f', 'test_pq_public_proof_readback.py': '4b412446c26186ce925a2cfc5896901a58df64067c15e36e9b3d07a3b33ad019', 'pq-public-proof-readback.py': '50ad1dbb6eadb494cfac180f84fd9deb13051abae58f3acfb055d32541decc53', 'test_pq_helper_lifecycle.py': '00774fc00404074d59f7eb09839b1bf25830ab60771ed2fac83884da37a37629', 'test_pq_ready_metrics.py': 'c963092242dc7a63fb50e973949e18f35fb362be9dc78c37ca51fd0b9c155e1e', 'pq-independent-load.py': 'cf7d6cd53458a0ead3fc32a1c206a81cf85a6994ad75ccb3887bf20d7e38e265', 'pq-independent-scheduler.py': 'd0ceb2bfee4d64cd49818afb2a2bec995b9a7e3d8fe32124e79478a1c0d4bfa1', 'pq-normal-process-lab.py': '6810b02608e54fe0dfde05555073c8f01463ac182f4dea76a9dfb6a2af4e1195', 'consensus-linux-cohort.py': 'ffc7e02e1d37adc28f4d94c262d30a45e91eb594307931b482dcdd39ccc82591', 'pq-paired-linux-window.py': 'b87a895d7c625ae15834a73b19196310dfbba13335707b9fdb4a3e50d9ad69e2', 'pq-c06-source-qualification.py': '385b34200486ede3045bea1e37d2cc0ea057481c0294257da4e825126975d37c', 'test_pq_c06_source_qualification.py': 'f112c861af7ffeaa966c24fd516ed84be308e6af64c9ce913a963eb7c3a582a3', 'fixtures/c06-functional-readback.json': '23c0639ababad3e041810ba9d21e96e754c618da7a14ee546aa9bf2ddabd7146', 'fixtures/c06-named-cases-original.zip': '65df3771ab668be1b6a8c044dbcc3cc0a024bea416b08547ba0d8eb9cb51d1fe', 'pq-owned-storage-window.py': '67e96cda53201b32b0ab1ca10707abb5e885645b51cbceaf2f3c8c77ac81f7c3', 'test_pq_owned_storage_window.py': '1dc1419b69361cbd604aef8c9b055b42b96567d181c3315ed1ce56395865cf33'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def fixed_options(source):
    # 500 is the complete demand. Four additional preparation accounts are
    # never recycled into these 8 independently leased signing accounts.
    return argparse.Namespace(source=str(source), commit=GO_SOURCE, mode="online",
                              rate=100, seconds=5, accounts=8, per_account=63,
                              tail_seconds=30, proof_timeout=30,
                              wire_observation=False, network_accounting=True, header_hop_capture=True, owned_storage_accounting=True, commit_observation=True,
                              prior_result=None, prior_result_sha256=None, execute=True)


def prepared_data():
    return dict(profile=PROFILE,controllerRef=REF,goSource=GO_SOURCE,goTree=GO_TREE,tools=TOOLS,
                sourceQualificationRun=41285983813,sourceNamedSupplementRun=41288482948,configuredDemand=500,
                offeredTPS=100,seconds=5,measuredAccounts=8,capacityPerAccount=63,preparationAccounts=4,
                sameSourceBinaryCount=3,caps=CAPS,label='current c06 diagnostic baseline only',
                measurementScope=MEASUREMENT_SCOPE,comparisonEligible=False,performanceSourcePairQualified=False,
                untouchedFdcBefore=False,combinedABBaseline=False,executed=False,sameHost=True,physicalFaultDomains=1,
                coldInitializationRetainedSeparately=True,noOld75Qualification=True,
                helperMaximumLive=3,originalOwnedPIDLimit=16,nodeStartAuthorized=False,publicNetwork=False,authorityGranted=False)


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


def c06_qualification():
    path=Path(os.environ['GITHUB_WORKSPACE'])/'tools/scripts/loadtest/pq-c06-source-qualification.py'
    return pinned_module('original_c06_source_data',path,TOOL_PINS['pq-c06-source-qualification.py'])


def api_reader():
    return c06_qualification().api_reader()


def prior_source_data(fetch):
    return c06_qualification().qualify(fetch)


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


def intake_original_public_closures(driver, result, public):
    load=result.get("loadResult",{});rows=load.get("rows",[])
    require(load.get("configuredDemand")==500 and len(rows)==500,"all500 original ledger rows required for public proof intake")
    qualified=[row for row in rows if row.get("status")=="qualified"]
    require(len(qualified)==load.get("qualified"),"original qualified ledger count differs")
    retained=[];required_commit_heights=set();expected_commit_hashes={}
    for row in qualified:
        case=public/"load-operations"/("%05d"%row["index"])
        expected="load-operations/%05d/qualified-receipt.json"%row["index"]
        require(row.get("proofReference")==expected,"original qualified receipt location differs")
        original=driver.proof_readback.strict(driver.proof_readback.read_original(case/"qualified-receipt.json",1<<20))
        require(original["operationId"]==row["operationId"] and original["transaction"]["ownerIndex"]==row["ownerIndex"] and original["transaction"]["firstNonce"]==str(row["nonce"]),"original operation identity differs")
        ref=original["originalPublicProofClosure"]
        require(ref["path"]=="load-operations/%05d/original-public-proof-manifest.json"%row["index"],"original public closure location differs")
        first,_,_=driver.proof_readback.read_original_closure(public/ref["path"],ref["sha256"])
        path=case/"normal-portable-originals.json";pin=hashlib.sha256(driver.proof_readback.read_original(path,256<<10)).hexdigest()
        portable,_,_=driver.proof_readback.read_portable_archive(path,pin)
        require(portable["sourceCommit"]==first["sourceCommit"]==GO_SOURCE and portable["verifierBinarySHA256"]==first["verifierBinarySHA256"]==result["binaries"]["ynx-consensus-proof-verify"],"original public source/binary pins differ")
        require(portable["actualOwnerIndex"]==row["ownerIndex"] and portable["actualOperationId"]==row["operationId"] and portable["actualNonce"]==str(row["nonce"]),"legacy carrier label cannot replace actual original owner")
        require(portable["originalContextSHA256"]==original["normalLiveResult"]["verified"]["context"]["sha256"] and portable["originalRequestSHA256"]==original["normalLiveResult"]["verified"]["request"]["sha256"],"original verifier context/request pins differ")
        verified=original["normalVerifier"]["result"]
        height=int(verified["block"]["headerHeight"]);successor=int(verified["successor"]["headerHeight"])
        require(height>0 and successor==height+1 and int(verified["successor"]["stateHeight"])==height,"original proof adjacent heights differ")
        app_hash=verified["successor"]["stateAppHash"]
        require(type(app_hash) is str and re.fullmatch("[0-9a-f]{64}",app_hash) is not None,"original committed proof AppHash differs")
        require(height not in expected_commit_hashes or expected_commit_hashes[height]==app_hash,"same-height qualified transaction state AppHash conflicts")
        expected_commit_hashes[height]=app_hash;required_commit_heights.update((height,successor))
        retained.append(dict(index=row["index"],ownerIndex=row["ownerIndex"],operationId=row["operationId"],manifest=str(path.relative_to(public)),sha256=pin,catalogSHA256=portable["catalogSHA256"]))
    return dict(schema="YNX-PERF-NORMAL-PUBLIC-CLOSURE-INTAKE/v1",configuredDemand=500,qualifiedOriginalRows=len(qualified),retainedCompletePortableClosures=len(retained),closures=retained,requiredCommitHeights=sorted(required_commit_heights),expectedCommitAppHashByHeight={str(k):v for k,v in sorted(expected_commit_hashes.items())},independentCryptographicReverification=False,sourceGrant=False,nativeRootAuthorized=False,meaning="Original bytes/catalog preserved only. Use the same normal portable-import then normal verifier with its actual clock; no original authority or full500 success inferred.")


def require_complete(result):
    ready=result.get("senderPoolPreparation",{})
    measures=result.get("normalCalleeMeasurements",{})
    require(result.get("source",{}).get("commit")==GO_SOURCE and result.get("caps")==CAPS and ready.get("readyCount")==8 and ready.get("signed") is False and ready.get("nonceReserved") is False and ready.get("sourceGrant") is False and ready.get("loadClockStarted") is False and measures.get("source")==GO_SOURCE,"exact sourcec06 DATA-ready and original metrics required")
    for kind,n in [("startup",8),("live_setup",4),("sign",500),("confirm",500),("live_publish",500),("live_result",500)]:
        value=measures.get("groups",{}).get(kind,{}).get("calleeElapsed",{})
        require(value.get("denominator")==n and value.get("observed")==n and value.get("censoredOrNotReached")==0,"full original callee timing denominator incomplete")
    require(result["firstCause"] is None and result["cleanupComplete"] is True and
            result.get("loadExecuted") is True and result.get("normalLiveCalleeUsed") is True and
            result.get("configuredDemand") == 500 and result.get("requestedOfferedTPS") == 100 and
            result.get("loadResult", {}).get("windowCompleted") is True and
            result["loadResult"]["configuredDemand"] == 500 and result["loadResult"]["notQualified"] == 0,
            "original fixed load incomplete or UNKNOWN; preserve partial and never replay")
    observed=result.get("normalCommitObservation",{})
    require(observed.get("fourOriginalSnapshotsValid") is True and observed.get("expectedNodes")==4 and observed.get("validOriginalNodes")==4 and len(observed.get("originalSnapshots",[]))==4,"four stopped normal Commit snapshots required; signer fsync cannot substitute")
    require(observed.get("independentFinality") is False and observed.get("signerFsyncMeasured") is False and observed.get("allCommitAttemptsCovered") is False and observed.get("replayCoverageComplete") is False and observed.get("unreportedStagesAreUnknown") is True,"Commit scope/coverage cannot become whole replay or finality")
    proof_intake=result.get("publicProofClosureIntake",{})
    heights=proof_intake.get("requiredCommitHeights",[]);hashes=proof_intake.get("expectedCommitAppHashByHeight",{})
    require(proof_intake.get("qualifiedOriginalRows")==500 and proof_intake.get("retainedCompletePortableClosures")==500 and heights and hashes,"all500 original proof heights/AppHash required for Commit sample linkage")
    for node in observed["originalSnapshots"]:
        raw=node.get("rawOriginalObservation",{})
        require(node.get("usable") is True and raw.get("sampleOverflow") is False and raw.get("latestTimingAvailable") is True and raw.get("droppedSuccessSamples")==0 and raw.get("rejectedNotifications")=={} and raw.get("errorNotifications")==0 and raw.get("lastFailure") is None and raw.get("unobservedLatest") is None,"partial/overflow/failed Commit observations cannot imply complete requested stages")
        points={sample["height"]:sample for sample in raw.get("samples",[])}
        require(all(height in points for height in heights),"requested business H/H+1 Commit sample missing; never fill zero or infer from other height")
        require(all(points[int(height)]["appHash"]==app_hash for height,app_hash in hashes.items()),"original Commit AppHash differs from successful transaction H/H+1 proof state")




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
    data_path = parent / ("pq-currentc06-source-qualification-" + os.environ["GITHUB_RUN_ID"] + "-1.json")
    require(not data_path.exists() and not data_path.is_symlink(), "original source DATA must be fresh and exclusive")
    data = prior_source_data(api_reader())
    with open(data_path, "x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(data, out, sort_keys=True); out.write("\n"); out.flush(); os.fsync(out.fileno())
    # Read-only qualification credentials are never inherited by Go/node/key
    # processes or copied into public original operation receipts.
    os.environ.pop("GH_TOKEN", None)
    os.environ.pop("GITHUB_TOKEN", None)
    driver = pinned_module("currentc06_original_load", tools / "scripts/loadtest/pq-independent-load.py",
                           TOOL_PINS["pq-independent-load.py"])
    intake = pinned_module("currentc06_original_storage", source / "scripts/loadtest/pq-source-artifact-intake.py",
                           SOURCE_PINS["scripts/loadtest/pq-source-artifact-intake.py"])
    require(driver.CALLEE_SOURCE == GO_SOURCE,"explicit exact normal consumer source pin differs")
    require(driver.COMMIT_OBSERVATION_SOURCE is not None and driver.COMMIT_OBSERVATION_SOURCE==GO_SOURCE,"final exact Commit consumer source/producer ABI/normal CI NOT_SUPPLIED; no703 continuation substitution")
    require(MEASUREMENT_SCOPE=='current-c06-diagnostic-baseline' and data['functionalDiagnostic']['before']==SOURCE_EQUIVALENCE_QUALIFICATION['before'] and data['functionalDiagnostic']['after']==GO_SOURCE,'exact diagnostic source pair differs; no unrelated performance comparison')
    require(PERFORMANCE_SOURCE_PAIR_QUALIFICATION is None,'diagnostic entry cannot become a before/after performance experiment')
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
    if result.get("loadExecuted") is True:
        public=calls[0].work/"public"
        closure_intake=intake_original_public_closures(driver,result,public)
        result["publicProofClosureIntake"]=closure_intake
        driver.lab.write_new(public/"PUBLIC-PROOF-CLOSURE-INTAKE.json",closure_intake)
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
