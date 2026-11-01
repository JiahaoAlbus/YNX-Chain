#!/usr/bin/env python3
"""Exact optional source composition. No production fork, node or wire enable."""
import argparse, hashlib, json, os, re, stat, subprocess, tarfile, tempfile
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
LOSSLESS = ["TestOperatorLosslessHexDefaultOffAndClosedFlags",
 "TestOperatorLosslessPairOriginalPQTimeIsConsensusState",
 "TestOperatorLosslessHexTypedNormalConstructorBeforeStart",
 "TestOperatorLosslessHexTypedScopeAndSourceRefusals"]
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
LOSSLESS_BUDGET = BUDGET + [
 "TestLosslessHexBudgetInitialPeerReadinessDeadline",
 "TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier"]

def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])

def require_supplier_source(root, supplier_commit=FORK_COMMIT, supplier_tree=FORK_TREE):
    # Source preparation is offline. Only the workflow may explicitly acquire
    # this independently fixed commit; a local common-dir object is not proof
    # that an Actions shallow checkout received it.
    try:
        commit = git(root, "rev-parse", "--verify", supplier_commit + "^{commit}").decode().strip()
        tree = git(root, "rev-parse", "--verify", supplier_commit + ":third_party/cometbft").decode().strip()
    except subprocess.CalledProcessError as error:
        raise RuntimeError("fixed supplier source unavailable locally: " + supplier_commit +
                           "; caller must explicitly acquire that immutable object before offline preparation") from error
    require(commit == supplier_commit and tree == supplier_tree, "fixed supplier commit/fork tree changed")

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


def require_lossless_pair_fullheight_equal(before, before_sha256, after, after_sha256):
    """Compare old/new replay of ONE complete original Finalize trajectory.

    The caller must first validate each replay with its normal ledger/proof reader;
    this is only the additional byte-equality gate, never evidence of authority,
    finality, source qualification, or a successfully executed network window.
    No timestamp, height, commit, state history, result, or error is projected out.
    This gate MUST NOT compare two independently timed live network legs. Each
    live OFF/ON leg retains and validates its own actual Time and full AppHash
    chain, against the same canonical requests and complete business outcomes.
    """
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
                info.st_mtime_ns, info.st_ctime_ns)
    paths = [Path(before), Path(after)]
    pins = [before_sha256, after_sha256]
    for path, pin in zip(paths, pins):
        require(path.is_absolute() and path.resolve(strict=True) == path,
                "original canonical full-height readback required")
        require(type(pin) is str and re.fullmatch("[0-9a-f]{64}", pin) and pin != "0" * 64,
                "independent full-height readback SHA required")
    handles = []
    try:
        initial = []
        for path in paths:
            handle = os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb")
            handles.append(handle)
            info = os.fstat(handle.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= 256 << 20,
                    "bounded complete original readback required; no truncation")
            initial.append(identity(info))
        require(initial[0][:2] != initial[1][:2], "two distinct original arm files required")
        digests = [hashlib.sha256(), hashlib.sha256()]
        sizes = [0, 0]
        equal = True
        while True:
            chunks = [handle.read(1 << 20) for handle in handles]
            if not any(chunks):
                break
            equal = equal and chunks[0] == chunks[1]
            for i, chunk in enumerate(chunks):
                sizes[i] += len(chunk)
                require(sizes[i] <= 256 << 20, "readback grew beyond original bound")
                digests[i].update(chunk)
        for i, handle in enumerate(handles):
            require(initial[i] == identity(os.fstat(handle.fileno())) == identity(paths[i].lstat())
                    and sizes[i] == initial[i][4], "readback changed during exact comparison")
            require(digests[i].hexdigest() == pins[i], "original readback external pin differs")
        require(equal, "LOSSLESS_PAIR_EQUALITY_FAIL_CLOSED: complete original height/state/result bytes differ")
        return dict(completeOriginalBytesEqual=True, bytes=sizes[0], sha256=pins[0],
                    normalizationApplied=False, networkExecutionQualified=False,
                    independentFinalityVerified=False, authorityGranted=False)
    finally:
        for handle in handles:
            handle.close()


def lossless_budget_tests(source):
    # Enumerate only tests in the independently pinned source, require every
    # historical gate AND both fixes from the explicit ed628e successor. New
    # named gates are also required to execute; a skip cannot qualify them.
    names = []
    for path in sorted((source / "third_party/cometbft/mempool").glob("lossless_hex*_test.go")):
        names.extend(re.findall(r"^func (TestLosslessHexBudget\w+)\(t \*testing\.T\)", path.read_text(), re.M))
    names += [name for name in BUDGET if name.startswith("TestLosslessHexTransport")]
    require(len(names) == len(set(names)) and set(LOSSLESS_BUDGET) <= set(names),
            "fixed successor removed/duplicated an original or mandatory readiness budget gate")
    return names

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
    return _prepare_wire_source(root, fresh_output, expected_commit, expected_tree,
                                FORK_COMMIT, FORK_TREE, False)


def prepare_wire_lossless_source(root, fresh_output, expected_commit, expected_tree,
                                 *, supplier_commit, supplier_tree):
    """Explicitly pinned successor only; original four-argument OFF API is unchanged.

    These pins are selected by the original source owner/CI caller, never by an
    RPC, branch, environment default or helper fetch. The old supplier has a
    known pending-deadline defect and cannot qualify this ON capability.
    """
    require(type(supplier_commit) is str and re.fullmatch("[0-9a-f]{40}", supplier_commit)
            and type(supplier_tree) is str and re.fullmatch("[0-9a-f]{40}", supplier_tree)
            and supplier_commit != "0" * 40 and supplier_tree != "0" * 40,
            "explicit immutable lossless supplier commit/tree required")
    require(supplier_commit != FORK_COMMIT and supplier_tree not in (FORK_TREE, PRODUCTION_TREE),
            "old/production supplier cannot qualify the corrected ON carrier")
    return _prepare_wire_source(root, fresh_output, expected_commit, expected_tree,
                                supplier_commit, supplier_tree, True)


def _prepare_wire_source(root, fresh_output, expected_commit, expected_tree,
                         supplier_commit, supplier_tree, lossless):
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
    require_supplier_source(root, supplier_commit, supplier_tree)
    changes = set(git(root, "diff", "--name-only", PRODUCTION_TREE, supplier_tree).decode().splitlines())
    require(changes == DIFF, "unapproved delta outside exact optional observer/transport module")
    require(not git(root, "diff", "--diff-filter=D", "--name-only", PRODUCTION_TREE, supplier_tree).strip(),
            "optional fork cannot remove original files")
    fresh_output.mkdir(mode=0o700)
    source = fresh_output / "source"
    source.mkdir(mode=0o700)
    extract(root, commit, source, ("go.mod", "go.sum", "cmd", "internal", "contracts", "third_party"))
    extract(root, supplier_commit + ":third_party/cometbft", source / "third_party/cometbft")
    require(not (source / ".git").exists(), "composition cannot manufacture original VCS identity")
    require((source / "go.mod").read_bytes() == git(root, "show", commit + ":go.mod") and
            (source / "go.sum").read_bytes() == git(root, "show", commit + ":go.sum"),
            "original module descriptors changed")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal").strip(), "original source checkout changed")
    receipt = dict(version=("YNX-WIRE-LOSSLESS-EXACT-SOURCE-SELECTION/v1" if lossless else "YNX-WIRE-LIVE-EXACT-SOURCE-SELECTION/v1"), originalSourceCommit=commit,
        originalSourceTree=tree, originalProductionForkTree=PRODUCTION_TREE,
        selectedOptionalForkCommit=supplier_commit, selectedOptionalForkTree=supplier_tree,
        sourceDirectory=str(source), buildTags=(["ynx_live_wire_observation", "ynx_lossless_hex"] if lossless else ["ynx_live_wire_observation"]),
        fakeVCSIdentity=False, originalCheckoutWritten=False, originalModuleDescriptorsChanged=False,
        exactOptionalDifference=sorted(DIFF), sourceOnly=True, nodeStarted=False,
        carrierEnabled=False, publicActivation=False,
        buildReceiptRequired="actual argv/cwd/go BuildInfo/binary SHA and this source-selection pin")
    if lossless:
        receipt.update(losslessOptInSupported=True, actualOnExecution=False)
    path = fresh_output / "SOURCE-SELECTION.json"
    path.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")
    return dict(sourceDirectory=str(source), sourceSelection=receipt, receiptPath=str(path),
                receiptBytes=path.stat().st_size, receiptSHA256=hashlib.sha256(path.read_bytes()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--lossless-supplier-commit")
    parser.add_argument("--lossless-supplier-tree")
    args = parser.parse_args()
    require((args.lossless_supplier_commit is None) == (args.lossless_supplier_tree is None),
            "lossless source requires both independent immutable supplier pins")
    lossless = args.lossless_supplier_commit is not None
    root = Path(__file__).resolve().parents[2]
    require(os.environ.get("RUNNER_OS") == "Linux", "actual Linux source runner required")
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    require(commit == os.environ["GITHUB_SHA"], "exact current source commit required")
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    parent = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    output = Path(tempfile.mkdtemp(prefix="wire-lossless-source-" if lossless else "wire-live-source-", dir=parent))
    if lossless:
        prepared = prepare_wire_lossless_source(root, output / "composition", commit, tree,
            supplier_commit=args.lossless_supplier_commit, supplier_tree=args.lossless_supplier_tree)
    else:
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
    tags = prepared["sourceSelection"]["buildTags"]
    live = run_go(source, output, "normal-lossless-caller" if lossless else "normal-live-caller", ["-mod=readonly", "-modfile=" + str(module),
        "-json", "-p", "1", "-count=1", "-timeout=120s", "-tags=" + ",".join(tags),
        "-run", "^TestOperatorLossless" if lossless else "^TestOperatorWireLive", "./cmd/ynx-comet"], LOSSLESS if lossless else LIVE, env)
    env["CGO_ENABLED"] = "1"
    budget_names = BUDGET
    if lossless:
        budget_names = lossless_budget_tests(source)
    budget = run_go(source, output, "corrected-peer-budget" if lossless else "original-peer-budget", ["-mod=readonly", "-modfile=" + str(module),
        "-race", "-json", "-p", "1", "-count=1", "-timeout=90s", "-run",
        "^(TestLosslessHexBudget.*|TestLosslessHexTransport(DefaultOffAndSingleCarrier|RestoresBeforeOriginalPrecheckCacheAndTxKey|RejectsBeforeCheckTxNoRawFallback|QueuedRetryKeepsSelectedFormat|LegacyEmptyUnknownAndMalformedKeepOriginalEntry))$",
        "github.com/cometbft/cometbft/mempool"], budget_names, env)
    require((source / "go.mod").read_bytes() == original_mod and (source / "go.sum").read_bytes() == original_sum,
            "production module descriptors were changed")
    require(not git(root, "status", "--porcelain", "--untracked-files=normal").strip(), "original source checkout changed")
    record = dict(version=("YNX-NORMAL-LOSSLESS-WIRE-SOURCE-COMPOSITION/v1" if lossless else "YNX-NORMAL-LIVE-WIRE-SOURCE-COMPOSITION/v1"), sourceCommit=commit,
        sourceTree=git(root, "rev-parse", "HEAD^{tree}").decode().strip(),
        productionForkTree=PRODUCTION_TREE, optionalForkCommit=prepared["sourceSelection"]["selectedOptionalForkCommit"], optionalForkTree=prepared["sourceSelection"]["selectedOptionalForkTree"],
        preparedSourceSelection=prepared,
        buildTags=tags, exactOptionalDifference=sorted(DIFF),
        normalProducer=live, originalSupplierBudget=budget, sourceOnly=True,
        actualKernelAndPrivateControlTests=not lossless, actualPreStartNodeGetter=not lossless,
        nodeProcessesStarted=0, actualRunningWindow=False, physicalBytesMeasured=False,
        carrierEnabled=False, productionForkModified=False, publicActivation=False)
    if lossless:
        record.update(actualPreStartCarrierRegistration=True, actualOnRunningWindow=False,
                      commonOriginalFinalizeReplayByteEqualityRequired=True,
                      liveLegsRequireIndependentActualTimeAndAppHashChains=True,
                      crossLiveLegAppHashEqualityRequired=False,
                      normalNetworkAppHashEqualityEstablished=False)
    (output / "SOURCE.json").write_text(json.dumps(record, sort_keys=True, indent=2) + "\n")
    print(("YNX_NORMAL_LOSSLESS_WIRE_SOURCE " if lossless else "YNX_NORMAL_LIVE_WIRE_SOURCE ") + json.dumps(record, sort_keys=True))

if __name__ == "__main__":
    main()
