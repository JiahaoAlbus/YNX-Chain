#!/usr/bin/env python3
"""Exact optional source composition. No production fork, node or wire enable."""
import hashlib, json, os, stat, subprocess, tarfile, tempfile
from pathlib import Path, PurePosixPath

FORK_COMMIT = "54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076"
FORK_TREE = "b1e9a83ab11ed141fda90bc47521faa412176caa"
PRODUCTION_TREE = "54e88e6aba735eaceeb2d00bb40731248c673bd7"
DIFF = {
 "mempool/live_wire_observer.go", "mempool/live_wire_observer_clock_unix.go",
 "mempool/live_wire_observer_clock_unsupported.go", "mempool/live_wire_observer_test.go",
 "mempool/live_wire_observer_unsupported_test.go", "mempool/lossless_hex_budget.go",
 "mempool/lossless_hex_budget_test.go", "mempool/lossless_hex_codec.go",
 "mempool/lossless_hex_codec_test.go", "mempool/lossless_hex_retry_budget_test.go",
 "mempool/lossless_hex_transport.go", "mempool/lossless_hex_transport_test.go",
 "mempool/reactor.go", "mempool/wire_observer.go", "node/lossless_hex_test.go",
 "node/node.go", "proto/tendermint/mempool/types.pb.go", "proto/tendermint/mempool/types.proto"}
LIVE = ["TestOperatorWireLivePrivateControlTwoEndpointsAndNoReplay",
 "TestOperatorWireLiveUnknownPreservesOriginalAndRetires",
 "TestOperatorWireLiveCloseJoinsOriginalCaptureWithoutNodeQuit",
 "TestOperatorWireLivePermissionsIdentityAndResiduals",
 "TestOperatorWireLiveRequesterUnknownAndProducerIdentity",
 "TestOperatorWireLiveSelfProcParsingAndDefaultOff",
 "TestOperatorWireLiveTypedNormalNodeBeforeStartIsUnknown"]
BUDGET = ["TestLosslessHexBudget" + n for n in (
 "FullQueueElapsedDeadline", "FullQueueStopsWithoutRawReplay", "InvalidEnableStaysDefaultOff",
 "LocalExhaustionDoesNotDisconnectAndRedial", "Normalize", "PackFailureNeverFallsBack",
 "PackReservesBeforeFrameAllocation", "ParallelAttemptsAndClose", "ParallelReservations",
 "PeerBytes", "PeerClock", "PeerIdentityAndLifetime", "ReceiveBeforeOriginalCheckTx",
 "SendAttemptsAndAtomicCharge", "SendClockRollback", "SendIdentityAndClock",
 "TypedNilPeerCannotClaimCapability")]
BUDGET += ["TestLosslessHexTransport" + n for n in (
 "DefaultOffAndSingleCarrier", "LegacyEmptyUnknownAndMalformedKeepOriginalEntry",
 "QueuedRetryKeepsSelectedFormat", "RejectsBeforeCheckTxNoRawFallback",
 "RestoresBeforeOriginalPrecheckCacheAndTxKey")]

def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])

def require_supplier_source(root):
    # Source preparation is offline. Only the workflow may explicitly acquire
    # this independently fixed commit; a local common-dir object is not proof
    # that an Actions shallow checkout received it.
    try:
        commit = git(root, "rev-parse", "--verify", FORK_COMMIT + "^{commit}").decode().strip()
        tree = git(root, "rev-parse", "--verify", FORK_COMMIT + ":third_party/cometbft").decode().strip()
    except subprocess.CalledProcessError as error:
        raise RuntimeError("fixed supplier source unavailable locally: " + FORK_COMMIT +
                           "; caller must explicitly acquire that immutable object before offline preparation") from error
    require(commit == FORK_COMMIT and tree == FORK_TREE, "fixed supplier commit/fork tree changed")

def extract(root, revision, destination, paths=()):
    process = subprocess.Popen(["git", "-C", str(root), "archive", "--format=tar", revision, *paths], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
            for member in archive:
                parts = PurePosixPath(member.name).parts
                require(parts and not member.name.startswith("/") and ".." not in parts,
                        "source archive path rejected")
                require(member.isdir() or member.isreg(), "only original regular source files allowed")
                archive.extract(member, path=destination, filter="data")
    finally:
        process.stdout.close()
    require(process.wait() == 0, "fixed source git archive failed")

def original_log_pin(path):
    raw = path.read_bytes()
    return dict(path=str(path), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())

def validate_go_jsonl(path, expected):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate field in original Go stdout JSONL: " + key)
            result[key] = value
        return result
    # Do not filter non-JSON stdout, even if it resembles a download diagnostic.
    # Original Go diagnostics belong to the separately retained stderr file.
    rows = [json.loads(line, object_pairs_hook=unique_object)
            for line in path.read_bytes().decode("utf-8").splitlines()]
    require(rows and all(isinstance(row, dict) and isinstance(row.get("Action"), str) for row in rows),
            "original Go stdout must contain JSON event objects")
    require(not any(row["Action"] == "fail" for row in rows), "original Go stdout contains a failed event")
    for test in expected:
        terminal = [r["Action"] for r in rows if r.get("Test") == test and r["Action"] in ("pass", "fail", "skip")]
        require(terminal == ["pass"], "original named test missing/skipped/failed: " + test)

def run_go(source, output, name, arguments, expected, env):
    path = output / (name + ".jsonl")
    stderr_path = output / (name + ".stderr.log")
    record_path = output / (name + ".result.json")
    record = dict(version="YNX-WIRE-LIVE-GO-RESULT/v1", returnCode=None, timedOut=False,
                  validationPassed=False, requiredPassed=[], firstFailure=None)
    # All three outputs are exclusive. Failed, timed-out and malformed runs
    # keep both original streams and their hashes, without inventing a PASS.
    with record_path.open("x") as receipt:
        try:
            with path.open("xb") as log, stderr_path.open("xb") as diagnostics:
                try:
                    result = subprocess.run(["go", "test", *arguments], cwd=source, env=env,
                                            stdout=log, stderr=diagnostics, timeout=240)
                except subprocess.TimeoutExpired:
                    record["timedOut"] = True
                    raise
            record["returnCode"] = result.returncode
            require(result.returncode == 0, "original " + name + " failed; retain original stdout and stderr")
            validate_go_jsonl(path, expected)
            record.update(validationPassed=True, requiredPassed=expected)
        except Exception as error:
            record["firstFailure"] = str(error)
            raise
        finally:
            record["stdout"] = original_log_pin(path) if path.is_file() else None
            record["stderr"] = original_log_pin(stderr_path) if stderr_path.is_file() else None
            receipt.write(json.dumps(record, sort_keys=True, indent=2) + "\n")
    return dict(**record["stdout"], requiredPassed=expected, stderr=record["stderr"],
                result=original_log_pin(record_path))

def prepare_wire_live_source(root, fresh_output, expected_commit, expected_tree):
    """Shared normal-runner/CI source builder; no build, node, reset or grant.

    The caller owns fresh_output inside its already-counted private work area.
    Original source identity is retained separately from the selected module.
    The archive has no manufactured .git/VCS identity; the normal caller must
    retain this receipt plus actual go BuildInfo and binary hashes.
    """
    root = Path(root).resolve(strict=True)
    fresh_output = Path(fresh_output)
    require(fresh_output.is_absolute() and str(fresh_output.parent.resolve(strict=True)) == str(fresh_output.parent),
            "fresh composition must have an original canonical existing parent")
    require(not fresh_output.exists() and not fresh_output.is_symlink(), "retain previous composition/partial; no retry overwrite")
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    require(commit == expected_commit and tree == expected_tree, "exact independently selected original source required")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal").strip(), "original source must stay clean")
    require(git(root, "rev-parse", "HEAD:third_party/cometbft").decode().strip() == PRODUCTION_TREE,
            "production fork changed; refresh explicit source composition")
    require_supplier_source(root)
    changes = set(git(root, "diff", "--name-only", PRODUCTION_TREE, FORK_TREE).decode().splitlines())
    require(changes == DIFF, "unapproved delta outside exact optional observer/transport module")
    require(not git(root, "diff", "--diff-filter=D", "--name-only", PRODUCTION_TREE, FORK_TREE).strip(),
            "optional fork cannot remove original files")
    fresh_output.mkdir(mode=0o700)
    source = fresh_output / "source"
    source.mkdir(mode=0o700)
    extract(root, commit, source, ("go.mod", "go.sum", "cmd", "internal", "contracts", "third_party"))
    extract(root, FORK_COMMIT + ":third_party/cometbft", source / "third_party/cometbft")
    require(not (source / ".git").exists(), "composition cannot manufacture original VCS identity")
    require((source / "go.mod").read_bytes() == git(root, "show", commit + ":go.mod") and
            (source / "go.sum").read_bytes() == git(root, "show", commit + ":go.sum"),
            "original module descriptors changed")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal").strip(), "original source checkout changed")
    receipt = dict(version="YNX-WIRE-LIVE-EXACT-SOURCE-SELECTION/v1", originalSourceCommit=commit,
        originalSourceTree=tree, originalProductionForkTree=PRODUCTION_TREE,
        selectedOptionalForkCommit=FORK_COMMIT, selectedOptionalForkTree=FORK_TREE,
        sourceDirectory=str(source), buildTags=["ynx_live_wire_observation"],
        fakeVCSIdentity=False, originalCheckoutWritten=False, originalModuleDescriptorsChanged=False,
        exactOptionalDifference=sorted(DIFF), sourceOnly=True, nodeStarted=False,
        carrierEnabled=False, publicActivation=False,
        buildReceiptRequired="actual argv/cwd/go BuildInfo/binary SHA and this source-selection pin")
    path = fresh_output / "SOURCE-SELECTION.json"
    path.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
    return dict(sourceDirectory=str(source), sourceSelection=receipt, receiptPath=str(path),
                receiptBytes=path.stat().st_size, receiptSHA256=hashlib.sha256(path.read_bytes()).hexdigest())


def main():
    root = Path(__file__).resolve().parents[2]
    require(os.environ.get("RUNNER_OS") == "Linux", "actual Linux source runner required")
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    require(commit == os.environ["GITHUB_SHA"], "exact current source commit required")
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    parent = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    output = Path(tempfile.mkdtemp(prefix="wire-live-source-", dir=parent))
    prepared = prepare_wire_live_source(root, output / "composition", commit, tree)
    source = Path(prepared["sourceDirectory"])
    original_mod = (source / "go.mod").read_bytes()
    original_sum = (source / "go.sum").read_bytes()
    module = output / "test.mod"
    sums = output / "test.sum"
    module.write_bytes(original_mod)
    sums.write_bytes(original_sum)
    subprocess.run(["go", "mod", "edit", "-modfile=" + str(module), "-require=github.com/stretchr/objx@v0.5.2"], cwd=source, check=True)
    lines = [line for line in (source / "third_party/cometbft/go.sum").read_text().splitlines()
             if line.startswith("github.com/stretchr/objx v0.5.2")]
    require(len(lines) == 2, "original pinned Comet mock dependency pair required")
    with sums.open("a") as handle:
        handle.write("\n" + "\n".join(lines) + "\n")
    env = os.environ.copy()
    env.update(GOMAXPROCS="2", GOMEMLIMIT="1536MiB", CGO_ENABLED="0")
    live = run_go(source, output, "normal-live-caller", ["-mod=readonly", "-modfile=" + str(module),
        "-json", "-p", "1", "-count=1", "-timeout=120s", "-tags=ynx_live_wire_observation",
        "-run", "^TestOperatorWireLive", "./cmd/ynx-comet"], LIVE, env)
    env["CGO_ENABLED"] = "1"
    budget = run_go(source, output, "original-peer-budget", ["-mod=readonly", "-modfile=" + str(module),
        "-race", "-json", "-p", "1", "-count=1", "-timeout=90s", "-run",
        "^(TestLosslessHexBudget.*|TestLosslessHexTransport(DefaultOffAndSingleCarrier|RestoresBeforeOriginalPrecheckCacheAndTxKey|RejectsBeforeCheckTxNoRawFallback|QueuedRetryKeepsSelectedFormat|LegacyEmptyUnknownAndMalformedKeepOriginalEntry))$",
        "github.com/cometbft/cometbft/mempool"], BUDGET, env)
    require((source / "go.mod").read_bytes() == original_mod and (source / "go.sum").read_bytes() == original_sum,
            "production module descriptors were changed")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal").strip(), "original source checkout changed")
    record = dict(version="YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1", sourceCommit=commit,
        sourceTree=git(root, "rev-parse", "HEAD^{tree}").decode().strip(),
        productionForkTree=PRODUCTION_TREE, optionalForkCommit=FORK_COMMIT, optionalForkTree=FORK_TREE,
        preparedSourceSelection=prepared,
        buildTags=["ynx_live_wire_observation"], exactOptionalDifference=sorted(DIFF),
        normalProducer=live, originalSupplierBudget=budget, sourceOnly=True,
        actualKernelAndPrivateControlTests=True, actualPreStartNodeGetter=True,
        nodeProcessesStarted=0, actualRunningWindow=False, physicalBytesMeasured=False,
        carrierEnabled=False, productionForkModified=False, publicActivation=False)
    (output / "SOURCE.json").write_text(json.dumps(record, sort_keys=True, indent=2) + "\n")
    print("YNX_NORMAL_LIVE_WIRE_SOURCE " + json.dumps(record, sort_keys=True))

if __name__ == "__main__":
    main()
