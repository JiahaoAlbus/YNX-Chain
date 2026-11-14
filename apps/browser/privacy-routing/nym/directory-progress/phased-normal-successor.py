#!/usr/bin/env python3
"""Verify the warmed normal vendor inputs and run Cargo in separate bounded phases."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import time

HERE = Path(__file__).resolve().parent
CONTINUATION = HERE / "continue-normal-successor.py"
CONTINUATION_SHA = "565a02eb82c0d97a88b83c9b496fa65aa8e9fc44d31b7adbc95773f327d7aa34"
CONTINUATION_PLAN_SHA = "7432c8ce67d5778c4c5b58bc73a15eaea34c38da42ec765b3fcdcd0857706173"
PRIOR_PINS = {
    "receipt.json": "3d3ebd9f65fde28cfec3e6e3d257ee7d66441a0939dbfe82b602667ed2675197",
    "start.json": "d9664718877131d60d3f791a0708129c6e48db9581938aeb719ddfc773f9eba8",
    "steps.json": "4cc741a05c7a08daf9945194b1e9cc387102d23965bc3280fe42b9b808371f6f",
    "samples.json": "42d0dac487d406048b6cdc9e6386b31cd53929e8ec7d1ac12ee4e49eac551dfc",
    "offline-cargo.stderr.log": "f086bc01672c4e2d3b4ec3cadb9e679351e03f06175cc762c6b872c6926dbd04",
    "offline-cargo.stdout.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
}
PREPARE_SECONDS = 300
INPUT_SECONDS = 720
CARGO_SECONDS = 900
COMPILE_AND_VERIFY_SECONDS = 1020
CLEANUP_SECONDS = 15
LOCKED_TOTAL_SECONDS = INPUT_SECONDS + COMPILE_AND_VERIFY_SECONDS + CLEANUP_SECONDS
PHASE = "build-phased"
GIB = 1024 ** 3
READ_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC

def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def identity(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def read_digest(descriptor, tick):
    digest = hashlib.sha256()
    while True:
        tick()
        data = os.read(descriptor, 1024 * 1024)
        if not data:
            return digest.hexdigest()
        digest.update(data)


def sealed_data(path, expected, limit=64 * 1024 ** 2):
    require(isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected), "missing-sealed-data-pin")
    fd = os.open(path, READ_FILE)
    try:
        start = os.fstat(fd)
        require(stat.S_ISREG(start.st_mode) and start.st_size <= limit, "invalid-sealed-data")
        with os.fdopen(os.dup(fd), "rb") as stream:
            raw = stream.read(limit + 1)
        require(len(raw) == start.st_size and identity(start) == identity(os.fstat(fd))
                and identity(start) == identity(path.lstat()), "unstable-sealed-data")
        require(hashlib.sha256(raw).hexdigest() == expected, "sealed-data-pin")
        return json.loads(raw)
    finally:
        os.close(fd)


def snapshot(root, expected, tick, mutable_names=(), require_single_link=True):
    """Read from directory-relative FDs and compare exact pins before accepting each tree."""
    files = {}
    directories = {}
    allocated = hashed = 0
    physical_root = root.resolve(strict=True)
    require(physical_root == root, "snapshot-root-symlink")

    def visit(fd, prefix):
        nonlocal allocated, hashed
        tick()
        start = os.fstat(fd)
        require(stat.S_ISDIR(start.st_mode) and start.st_uid == os.getuid()
                and not start.st_mode & 0o022, "snapshot-dir-owner-or-mode:" + prefix)
        directories[prefix] = identity(start)
        with os.scandir(fd) as entries:
            for entry in entries:
                tick()
                name = prefix + "/" + entry.name if prefix else entry.name
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(entry.name, READ_FILE | os.O_DIRECTORY, dir_fd=fd)
                    try:
                        require(identity(info) == identity(os.fstat(child)), "snapshot-dir-replaced:" + name)
                        visit(child, name)
                    finally:
                        os.close(child)
                    continue
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022
                        and (not require_single_link or info.st_nlink == 1), "snapshot-file-owner-or-type:" + name)
                before = identity(info)
                files[name] = before
                allocated += info.st_blocks * 512
                if expected is None or name in mutable_names:
                    continue
                row = expected.get(name)
                require(row is not None and info.st_size == row["bytes"], "snapshot-input-size-or-name:" + name)
                child = os.open(entry.name, READ_FILE, dir_fd=fd)
                try:
                    require(before == identity(os.fstat(child)), "snapshot-file-replaced:" + name)
                    require(row["sha256"] == read_digest(child, tick), "snapshot-content-mismatch:" + name)
                    require(before == identity(os.fstat(child))
                            and before == identity(os.stat(entry.name, dir_fd=fd, follow_symlinks=False)),
                            "snapshot-file-changed:" + name)
                finally:
                    os.close(child)
                hashed += info.st_size
        require(identity(start) == identity(os.fstat(fd)), "snapshot-directory-changed:" + prefix)

    fd = os.open(root, READ_FILE | os.O_DIRECTORY)
    try:
        visit(fd, "")
        require(directories[""] == identity(root.lstat()), "snapshot-root-replaced")
    finally:
        os.close(fd)
    if expected is not None:
        require(files.keys() == expected.keys() | set(mutable_names), "snapshot-input-inventory:" + root.name)
    return {"root": str(root), "directories": directories, "files": files,
            "allocatedSumBytes": allocated, "hashedBytes": hashed}


def verify_continuity(before, after):
    for key in ("root", "directories", "files"):
        require(before[key] == after[key], "warm-cache-continuity:" + key)


def allocated_tree(root, tick):
    def walk(fd):
        total = 0
        with os.scandir(fd) as entries:
            for entry in entries:
                tick()
                try:
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(entry.name, READ_FILE | os.O_DIRECTORY, dir_fd=fd)
                        try:
                            total += walk(child)
                        finally:
                            os.close(child)
                    elif stat.S_ISREG(info.st_mode):
                        total += info.st_blocks * 512
                except FileNotFoundError:
                    continue
        return total

    fd = os.open(root, READ_FILE | os.O_DIRECTORY)
    try:
        return walk(fd)
    finally:
        os.close(fd)


def allocation_budget(sample, baseline):
    require(sample["ownAllocatedSumNotUniquePhysical"] - baseline["ownAllocatedSumNotUniquePhysical"] <= 4 * GIB,
            "resource-interrupted-input-own-allocated-growth")
    require(baseline["WDFreeBytes"] - sample["WDFreeBytes"] <= 4 * GIB,
            "resource-interrupted-input-global-wd-growth")
    require(sample["homeFreeBytes"] >= 2 * GIB and sample["WDFreeBytes"] >= 16 * GIB
            and sample["memoryFreePercent"] >= 20, "resource-interrupted-input-host-floor")


class ReadPhase:
    """Bound read-only verification without triggering another recursive monitor scan."""

    def __init__(self, body, guard, seconds, work=None):
        self.body = body
        self.guard = guard
        self.started = time.monotonic()
        self.deadline = self.started + seconds
        self.last_sample = self.started
        self.capacity = body.facts(guard)
        body.require_floors(self.capacity)
        self.samples = []
        self.records = []
        self.cancelled = []
        self.work = work
        self.allocationScanSeconds = []
        self.baseline = None

    def check_time(self):
        require(not self.cancelled, "caller-cancelled")
        require(time.monotonic() < self.deadline, "resource-interrupted-input-verification-deadline")

    def sample(self, baseline=False):
        self.check_time()
        sample = self.body.facts(self.guard)
        allocation_budget({**sample, "ownAllocatedSumNotUniquePhysical": 0},
                          {**self.capacity, "ownAllocatedSumNotUniquePhysical": 0})
        began = time.monotonic()
        try:
            sample["ownAllocatedSumNotUniquePhysical"] = allocated_tree(self.work, self.check_time) if self.work else 0
        finally:
            self.allocationScanSeconds.append(time.monotonic() - began)
        self.last_sample = time.monotonic()
        self.samples.append(sample)
        if baseline:
            self.baseline = {**self.capacity, "ownAllocatedSumNotUniquePhysical": sample["ownAllocatedSumNotUniquePhysical"]}
        allocation_budget(sample, self.baseline)

    def tick(self):
        self.check_time()
        if time.monotonic() - self.last_sample >= 5:
            self.sample()

    def scan(self, name, root, expected=None, **kwargs):
        began = time.monotonic()
        cpu = time.process_time()
        record = {"name": name, "startedSeconds": began - self.started}
        self.records.append(record)
        try:
            result = snapshot(root, expected, self.tick, **kwargs)
        finally:
            record.update(elapsedSeconds=time.monotonic() - began, cpuSeconds=time.process_time() - cpu)
        record.update(files=len(result["files"]), directories=len(result["directories"]),
                      hashedBytes=result["hashedBytes"], allocatedSumBytes=result["allocatedSumBytes"])
        return result


def source_metadata(data):
    return {name: [row[0], row[1], row[6], row[7], row[8], row[2]]
            for name, row in data["files"].items()}


def confirm_prior(gate, body, guard, plan):
    case = gate.WORK / "build-continued"
    body.require_hashes(guard, {case / name: digest for name, digest in PRIOR_PINS.items()})
    terminal = gate.read(case / "receipt.json")
    require(terminal["schema"] == "P05_NYM_NORMAL_OFFLINE_TERMINAL_V1"
            and terminal["phase"] == "build-continued"
            and terminal["firstFailure"] == {"type": "RuntimeError", "cause": "resource-interrupted-450s-work"}
            and terminal["remainingOwned"] == [] and terminal["cancelSignals"] == []
            and terminal["cleanupFailure"] is None and terminal["childOutcomeRecordingFailure"] is None
            and terminal["publicNetwork"] is False and terminal["productionRelease"] is False
            and 900 <= terminal["elapsedSeconds"] <= 915 and terminal["result"] is None,
            "prior-900-terminal")
    require(gate.read(case / "start.json")["PID"] == 83885
            and len(terminal["steps"]) == 1 and gate.read(case / "steps.json") == terminal["steps"],
            "prior-900-controller")
    child, = terminal["steps"]
    require(child["name"] == "offline-cargo" and child["argv"] == plan["argv"]
            and child["pid"] == child["pgid"] == 97695 and child["exit"] == -2
            and child["reaped"] is True and child["terminalOutcome"] == "ORIGINAL_POPEN_WAIT",
            "prior-900-wait")
    processes = guard.processes()
    require(83885 not in processes and 97695 not in processes
            and all(value["pgid"] != 97695 for value in processes.values()), "prior-900-process-live")
    require(not (case / "artifact/nym-socks5-client").exists(), "prior-900-artifact")


def locate():
    require(hashlib.sha256(CONTINUATION.read_bytes()).hexdigest() == CONTINUATION_SHA, "continuation-controller-pin")
    spec = importlib.util.spec_from_file_location("frozen_normal_continuation", CONTINUATION)
    continuation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(continuation)
    previous = continuation.load_previous()
    gate = previous.load_gate()
    body, guard = gate.load_owner()
    gate.require_workspace()
    base = gate.checked_plan(body, guard)
    require(base == sealed_data(gate.PLAN, previous.BASE_PLAN_SHA), "original-build-plan-drift")
    base["basePlanSHA256"] = previous.BASE_PLAN_SHA
    stage = gate.terminal(body, guard, "stage", previous.STAGE_SHA, gate.cache_stage_steps())
    previous.confirm_original(gate, body, guard, base)
    continuation.confirm_previous(gate, body, guard, base)
    confirm_prior(gate, body, guard, base)
    old = sealed_data(gate.INPUTS / "OFFLINE_BUILD_CONTINUATION_V1.json", CONTINUATION_PLAN_SHA)
    require(old["argv"] == base["argv"]
            and old["environment"] == dict(base["environment"], HOME=previous.ORIGINAL_HOME,
                                          TMPDIR=str(previous.roots(gate)["tmp"]) + "/"),
            "same-path-cargo-contract")
    proposal = {
        "schema": "P05_NYM_OFFLINE_NORMAL_PHASED_V1", "controllerSHA256": guard.sha(__file__),
        "sourceTreeSHA256": base["candidateTreeSHA256"], "sourceManifestSHA256": gate.PINS[gate.MANIFEST],
        "CargoLockSHA256": base["CargoLockSHA256"], "previousBuildReceiptSHA256": PRIOR_PINS["receipt.json"],
        "previousContinuationPlanSHA256": CONTINUATION_PLAN_SHA,
        "sharedLock": str(body.LOCK), "workspace": str(gate.WORK), "source": str(gate.SOURCE),
        "argv": base["argv"], "environment": old["environment"], "stageSHA256": previous.STAGE_SHA,
        "readOnlyWarmLedgerSeconds": PREPARE_SECONDS, "lockedInputVerificationSeconds": INPUT_SECONDS,
        "lockedCompileAndVerificationSeconds": COMPILE_AND_VERIFY_SECONDS, "cleanupSeconds": CLEANUP_SECONDS,
        "lockedTotalSeconds": LOCKED_TOTAL_SECONDS, "maxCargoSeconds": CARGO_SECONDS,
        "resourceLimits": {key: val for key, val in base["budgetEachStageAndBuild"].items()
                           if key not in ("workSeconds", "cleanupSeconds", "wholeSeconds", "maxCargoSeconds")},
        "publicNetwork": False, "productionRelease": False, "QAFeature": False,
    }
    return gate, body, guard, previous, base, stage, proposal


def mutable_cargo_state(root):
    return {name: identity((root / name).lstat()) for name in
            (".global-cache", ".package-cache", ".package-cache-mutate")}


def warm_views(reader, gate, previous):
    paths = previous.roots(gate)
    return {name: reader.scan(name, paths[name]) for name in ("target", "tmp")}


def prepare(path, gate, body, guard, previous, proposal):
    require(not path.exists() and not path.with_suffix(".warm.json").exists(), "phase-plan-already-prepared")
    reader = ReadPhase(body, guard, PREPARE_SECONDS)
    reader.sample(baseline=True)
    warm = warm_views(reader, gate, previous)
    warm["mutableCargoState"] = mutable_cargo_state(gate.CARGO_HOME)
    body.require_hashes(guard, {gate.TARGET / previous.FINGERPRINT: previous.FINGERPRINT_SHA})
    reader.tick()
    ledger = path.with_suffix(".warm.json")
    body.dump_new(ledger, warm)
    body.dump_new(path, {**proposal, "warmLedgerSHA256": guard.sha(ledger),
                         "warmLedgerScans": reader.records, "warmLedgerResourceSamples": reader.samples,
                         "measuredWarmLedgerSeconds": time.monotonic() - reader.started})
    print(json.dumps({"phasePlan": str(path), "SHA256": guard.sha(path),
                      "warmLedger": str(ledger), "warmLedgerSHA256": guard.sha(ledger), "CargoStarted": False}))


def locked_input(case, gate, body, guard, previous, base, stage, warm, fd):
    reader = ReadPhase(body, guard, INPUT_SECONDS, work=gate.WORK)
    verify_lock = lambda: require(identity(os.fstat(fd)) == identity(body.LOCK.lstat()), "shared-lock-replaced")
    failure = None
    original = {}
    handlers = {sig: signal.signal(sig, lambda signum, _: reader.cancelled.append(signum))
                for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        verify_lock()
        reader.sample(baseline=True)
        source_pins = sealed_data(gate.MANIFEST, gate.PINS[gate.MANIFEST])
        require(warm["mutableCargoState"] == mutable_cargo_state(gate.CARGO_HOME), "warm-cargo-mutable-state")
        for name, data in warm_views(reader, gate, previous).items():
            verify_continuity(warm[name], data)
        # Source, dependency and toolchain checks remain strong SHA checks under the original lock.
        source = reader.scan("source", gate.SOURCE, source_pins)
        original = gate.confirm_source(body, guard, stage["sourceReceiptSHA256"])
        gate.verify_source_after(original, source_metadata(source))
        dependencies = sealed_data(gate.CACHE_MANIFEST, gate.PINS[gate.CACHE_MANIFEST])
        immutable = {name: row for name, row in dependencies.items() if name.startswith(("registry/", "git/"))}
        reader.scan("cargo-registry-and-git", gate.CARGO_HOME, immutable,
                    mutable_names=(".global-cache", ".package-cache", ".package-cache-mutate"))
        tool = Path(base["environment"]["RUSTC"]).parent.parent
        tool_pins = sealed_data(Path(base["toolchain"]["path"]), base["toolchain"]["SHA256"])
        reader.scan("toolchain", tool, tool_pins, require_single_link=False)
        body.require_hashes(guard, {gate.SOURCE / "Cargo.lock": base["CargoLockSHA256"],
                                    gate.TARGET / previous.FINGERPRINT: previous.FINGERPRINT_SHA})
        require(Path(base["environment"]["SDKROOT"]).is_dir(), "exact-sdk-unavailable-at-build")
        verify_lock()
        reader.sample()
    except BaseException as error:
        failure = {"type": type(error).__name__, "cause": str(error)}
        raise
    finally:
        try:
            body.dump_new(case, {"schema": "P05_NYM_OFFLINE_NORMAL_LOCKED_INPUT_V1",
                                 "PID": os.getpid(), "elapsedSeconds": time.monotonic() - reader.started,
                                 "records": reader.records, "resourceSamples": reader.samples,
                                 "allocationScanSeconds": reader.allocationScanSeconds,
                                 "allocationBaseline": reader.baseline,
                                 "cancelSignals": reader.cancelled, "firstFailure": failure, "CargoStarted": False})
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
    return original, source_pins, verify_lock, reader.baseline


def build(gate, body, guard, previous, base, stage, proposal, warm, plan_sha):
    case = gate.WORK / PHASE
    input_receipt = gate.WORK / (PHASE + "-input.json")
    require(not case.exists() and not input_receipt.exists(), "phased-build-already-started")
    require(os.environ.get("HOME") == previous.ORIGINAL_HOME, "original-environment-home")
    fd = body.take_shared_lock()
    try:
        original, source_pins, verify_lock, baseline = locked_input(input_receipt, gate, body, guard, previous, base, stage, warm, fd)
        gate.ARTIFACT = case / "artifact" / gate.TARGET_PROGRAM
        gate.WORK_SECONDS = COMPILE_AND_VERIFY_SECONDS
        gate.TOTAL_SECONDS = COMPILE_AND_VERIFY_SECONDS + CLEANUP_SECONDS

        def action(owner, tmp):
            owner.baseline.update({key: baseline[key] for key in ("WDFreeBytes", "ownAllocatedSumNotUniquePhysical")})
            verify_lock()
            body.require_hashes(guard, {gate.SOURCE / "Cargo.lock": base["CargoLockSHA256"]})
            gate.observed_step(owner, proposal["environment"], "offline-cargo", base["argv"], 0, CARGO_SECONDS)
            target = gate.TARGET / "release" / gate.TARGET_PROGRAM
            require(target.is_file() and not target.is_symlink(), "build-target")
            gate.ARTIFACT.parent.mkdir(mode=0o700)
            with target.open("rb") as source, gate.ARTIFACT.open("xb") as output:
                shutil.copyfileobj(source, output)
            gate.ARTIFACT.chmod(0o500)
            digest = guard.sha(gate.ARTIFACT)
            require(digest not in (gate.PINS[gate.OLD_RUNTIME], gate.PINS[gate.QA_RUNTIME]), "artifact-is-prior-supply")
            private_home = case / "probe-home"
            private_home.mkdir(mode=0o700)
            env = {"PATH": "/usr/bin:/bin", "TMPDIR": str(tmp), "NYM_HOME_DIR": str(private_home)}
            for name, argv, exit_code in gate.probes():
                gate.observed_step(owner, env, name, argv, exit_code)
            require(not any(private_home.iterdir()), "probe-profile-side-effects")
            proof = gate.runtime_proof(guard, case)
            next_sample = 0

            def post_build_tick():
                nonlocal next_sample
                now = time.monotonic()
                if now >= next_sample:
                    owner.monitor()
                    next_sample = now + 1

            observed = snapshot(gate.SOURCE, source_pins, post_build_tick)
            changes = gate.verify_source_after(original, source_metadata(observed))
            body.require_hashes(guard, {**gate.PINS, gate.ARTIFACT: digest})
            verify_lock()
            return {"artifact": {"path": str(gate.ARTIFACT), "sha256": digest,
                                 "bytes": gate.ARTIFACT.stat().st_size},
                    "phasePlanSHA256": plan_sha, "lockedInputReceiptSHA256": guard.sha(input_receipt),
                    "sourceManifestSHA256": gate.PINS[gate.MANIFEST], "sourceMetadataChanges": changes,
                    "CargoLockSHA256": base["CargoLockSHA256"], "runtimeProof": proof,
                    "upstreamTLSOrNetworkRun": False, "productionEligibility": False}

        return gate.make_owner(body, guard, PHASE, case, action)
    finally:
        os.close(fd)


def verify(gate, body, guard, base, stage, plan_sha, terminal_sha, input_sha):
    case = gate.WORK / PHASE
    gate.ARTIFACT = case / "artifact" / gate.TARGET_PROGRAM
    gate.TOTAL_SECONDS = COMPILE_AND_VERIFY_SECONDS + CLEANUP_SECONDS
    input_receipt = sealed_data(gate.WORK / (PHASE + "-input.json"), input_sha)
    require(input_receipt["schema"] == "P05_NYM_OFFLINE_NORMAL_LOCKED_INPUT_V1"
            and input_receipt["firstFailure"] is None and input_receipt["cancelSignals"] == []
            and input_receipt["CargoStarted"] is False
            and 0 < input_receipt["elapsedSeconds"] <= INPUT_SECONDS
            and [row["name"] for row in input_receipt["records"]]
            == ["target", "tmp", "source", "cargo-registry-and-git", "toolchain"], "locked-input-receipt")
    require(input_receipt["resourceSamples"] and input_receipt["allocationScanSeconds"], "missing-input-resource-samples")
    for sample in input_receipt["resourceSamples"]:
        allocation_budget(sample, input_receipt["allocationBaseline"])
    result = gate.terminal(body, guard, PHASE, terminal_sha,
                           [("offline-cargo", base["argv"], 0), *gate.probes()])
    binary = result["artifact"]
    meta = gate.ARTIFACT.lstat()
    require(result["phasePlanSHA256"] == plan_sha and result["lockedInputReceiptSHA256"] == input_sha
            and result["sourceManifestSHA256"] == gate.PINS[gate.MANIFEST]
            and result["CargoLockSHA256"] == base["CargoLockSHA256"]
            and result["sourceMetadataChanges"] in ([], [gate.ENV_BUILD_SCRIPT_REWRITE])
            and result["upstreamTLSOrNetworkRun"] is False and result["productionEligibility"] is False
            and binary["path"] == str(gate.ARTIFACT) and meta.st_size == binary["bytes"]
            and meta.st_nlink == 1 and meta.st_uid == os.getuid()
            and stat.S_ISREG(meta.st_mode) and stat.S_IMODE(meta.st_mode) == 0o500
            and binary["sha256"] not in (gate.PINS[gate.OLD_RUNTIME], gate.PINS[gate.QA_RUNTIME]), "artifact-receipt")
    body.require_hashes(guard, {gate.ARTIFACT: binary["sha256"]})
    reader = ReadPhase(body, guard, PREPARE_SECONDS)
    reader.sample(baseline=True)
    current = reader.scan("source", gate.SOURCE, sealed_data(gate.MANIFEST, gate.PINS[gate.MANIFEST]))
    original = gate.confirm_source(body, guard, stage["sourceReceiptSHA256"])
    require(result["sourceMetadataChanges"] == gate.verify_source_after(original, source_metadata(current)),
            "verified-source-metadata-drift")
    require(gate.runtime_proof(guard, case) == result["runtimeProof"], "runtime-proof-drift")
    print(json.dumps({"status": "OFFLINE_NORMAL_CANDIDATE_VERIFIED", "artifact": binary,
                      "lockedInputReceiptSHA256": input_sha, "buildReceiptSHA256": terminal_sha,
                      "productionEligibility": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "check", "build", "verify"))
    parser.add_argument("--proposal-sha256")
    parser.add_argument("--build-receipt-sha256")
    parser.add_argument("--locked-input-receipt-sha256")
    args = parser.parse_args()
    for option in (args.proposal_sha256, args.build_receipt_sha256, args.locked_input_receipt_sha256):
        require(option is None or re.fullmatch(r"[0-9a-f]{64}", option), "invalid-sha256")
    gate, body, guard, previous, base, stage, expected = locate()
    path = gate.INPUTS / "OFFLINE_BUILD_PHASED_V1.json"
    if args.operation == "prepare":
        return prepare(path, gate, body, guard, previous, expected)
    proposal = sealed_data(path, args.proposal_sha256)
    require(all(proposal.get(key) == value for key, value in expected.items()), "phase-plan-drift")
    warm = sealed_data(path.with_suffix(".warm.json"), proposal["warmLedgerSHA256"])
    if args.operation == "check":
        print(json.dumps({"status": "PHASE_PLAN_PIN_VERIFIED", "CargoStarted": False}))
        return 0
    if args.operation == "verify":
        return verify(gate, body, guard, base, stage, args.proposal_sha256,
                      args.build_receipt_sha256, args.locked_input_receipt_sha256)
    return build(gate, body, guard, previous, base, stage, proposal, warm, args.proposal_sha256)


if __name__ == "__main__":
    raise SystemExit(main())
