#!/usr/bin/env python3
"""Stage, build and verify the isolated protected Nym 1.1.88 directory successor."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time

HERE = Path(__file__).resolve().parent
BASE = Path("/REDACTED_VOLUME/YNX-large-work")
P05 = BASE / "coordination-v5-20261031/owners/P05/privacy-routing"
CASE = P05 / "nym-directory-body-idle-20261113"
INPUTS = CASE / "normal-directory-progress-from-9cf032-20261114"
WORK = CASE / "normal-directory-successor-offline-release-20261114"
MANIFEST = INPUTS / "source-manifest.json"
NORMAL_PATCH = INPUTS / "normal-directory-progress-from-9cf032.patch"
ARCHIVE = P05 / "supply/nym/source-f92749.tar.gz"
ORIGINAL = P05 / "supply/nym/protected-numeric-overlay/runtime-9cf0324880bdb8d8b8909581c81b91f750174b6ff0569e4f5270426c0dacb5a6"
BASE_PATCH = ORIGINAL / "source.patch"
BASE_MANIFEST = ORIGINAL / "source-before-build.json"
CACHE = CASE / "exact-qa-release"
CACHE_MANIFEST = CACHE / "cargo-home-manifest.json"
OLD_TOOL_PLAN = CACHE / "BUILD_RESUME_PROPOSAL.json"
OWNER = HERE.parent / "qa-cdn-directory/successors/body-idle-observation/build-release.py"
GIB = 1024 ** 3
WORK_SECONDS = 450
CLEANUP_SECONDS = 15
TOTAL_SECONDS = WORK_SECONDS + CLEANUP_SECONDS
SOURCE = WORK / "source"
TARGET = WORK / "target"
CARGO_HOME = WORK / "cargo-home"
ARTIFACT = WORK / "build/artifact/nym-socks5-client"
PLAN = INPUTS / "OFFLINE_BUILD_GATE_V3.json"
WORKSPACE_ARCHIVE_ROOT = "nym-f92749c5f45bf1fdaacb824f9796bca2d641c6f9"
ENV_BUILD_SCRIPT_REWRITE = "envs/mainnet.env"
TARGET_PROGRAM = "nym-socks5-client"
OLD_RUNTIME = ORIGINAL / TARGET_PROGRAM
QA_RUNTIME = CACHE / "target/release" / TARGET_PROGRAM

PINS = {
    INPUTS / "INPUTS.json": "0f7ed0441bed73514fd117d8ef5772b694bf28a9a7182307790374ac55379c60",
    MANIFEST: "2ac15c8759b7935721a9901d969bbcc04520ba7d83d088a55c15d2a16c8145ac",
    NORMAL_PATCH: "bd7e793d89ad0beb0647be9de00be1e147ae462229a3a7fe9be1258502aae761",
    BASE_MANIFEST: "6b74dee00f6c84eecf49dd1dc20f8709fc2f66bfa2dc11ef5d54427964694bd1",
    BASE_PATCH: "382895ca68660776a0d92ad99e448c4289c8234e8075d24fb4c199cdbb6e69a3",
    ARCHIVE: "a8f1d3f61247487feedbb8a4408e123ab2198091ac36829be598a2ab8e342485",
    OLD_RUNTIME: "9cf0324880bdb8d8b8909581c81b91f750174b6ff0569e4f5270426c0dacb5a6",
    QA_RUNTIME: "855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798",
    CACHE_MANIFEST: "43afee89b79dd8f3608a34bc7fad41bf8d0b80312805617e1aa3995fab5663b4",
    OLD_TOOL_PLAN: "b419bfb5c48e122c5cd8ddf742496fb2e5ad6b8385c1e821f9de78904801e986",
}
OWNER_SHA = "c21dc9a5f1111c73da927ef066f5e0aead2da3fce172beb8f6b436909368466e"


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def read(path):
    return json.loads(path.read_text())


def load_owner():
    import hashlib
    require(hashlib.sha256(OWNER.read_bytes()).hexdigest() == OWNER_SHA, "owner-controller-pin")
    spec = importlib.util.spec_from_file_location("original_body_idle_builder", OWNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, module.load_guard()


def checked_plan(body, g):
    body.require_hashes(g, PINS)
    inputs = read(INPUTS / "INPUTS.json")
    old = read(OLD_TOOL_PLAN)
    toolchain = old["toolchainManifest"]
    compiler = Path(old["environment"]["RUSTC"])
    tool = compiler.parent
    body.require_hashes(g, {Path(toolchain["path"]): toolchain["SHA256"],
        tool / "cargo": toolchain["cargoSHA256"], compiler: toolchain["rustcSHA256"],
        tool / "rustdoc": toolchain["rustdocSHA256"]})
    require(Path(old["environment"]["SDKROOT"]).is_dir(), "exact-sdk-unavailable")
    command = [str(tool / "cargo"), *inputs["cargoArgvAfterExecutable"]]
    require(command[1:] == ["build", "--offline", "--release", "--locked", "-p", TARGET_PROGRAM,
                            "--jobs", "1"], "non-default-cargo-build")
    environment = {
        "PATH": str(tool) + ":/usr/bin:/bin",
        "RUSTC": str(compiler), "RUSTDOC": str(tool / "rustdoc"),
        "RUSTFLAGS": "-Cstrip=none", "SDKROOT": old["environment"]["SDKROOT"],
        "CARGO_BUILD_JOBS": "1", "CARGO_NET_OFFLINE": "true",
        "CARGO_HOME": str(CARGO_HOME), "CARGO_TARGET_DIR": str(TARGET),
    }
    script = Path(__file__).name

    def run(operation):
        return ["/usr/bin/python3", "-IB", "DIRECTORY_PROGRESS/" + script, operation,
                "--proposal-sha256", "PLAN_SHA256"]

    return {
        "schema": "P05_NYM_NORMAL_DIRECTORY_OFFLINE_GATE_V1",
        "status": "PREPARED_NOT_RUN",
        "controllerSHA256": g.sha(__file__),
        "originalResourceControllerSHA256": OWNER_SHA,
        "workspace": str(WORK),
        "inputPins": {str(path): sha for path, sha in PINS.items()},
        "candidateTreeSHA256": inputs["successorSourceTreeSHA256"],
        "CargoLockSHA256": inputs["cargoLockSHA256"],
        "toolchain": toolchain,
        "sharedLock": str(body.LOCK),
        "argv": command, "environment": environment,
        "commands": {
            "source": run("source"),
            "stage": run("stage") + ["--source-receipt-sha256", "SOURCE_SHA256"],
            "build": run("build") + ["--stage-receipt-sha256", "STAGE_SHA256"],
            "verify": run("verify") + ["--stage-receipt-sha256", "STAGE_SHA256",
                                     "--build-receipt-sha256", "BUILD_SHA256"],
        },
        "budgetEachStageAndBuild": {
            "workSeconds": WORK_SECONDS, "cleanupSeconds": CLEANUP_SECONDS, "wholeSeconds": TOTAL_SECONDS,
            "maxCargoSeconds": 420, "groupRSSBytes": 4 * GIB,
            "ownerAllocatedGrowthBytes": 4 * GIB, "globalWDUnattributedDropBytes": 4 * GIB,
            "startHostBytes": 9 * GIB // 4, "runHostBytes": 2 * GIB,
            "minimumWDBytes": 16 * GIB, "startFreeMemoryPercent": 35,
            "runFreeMemoryPercent": 20, "logBytes": 32 * 1024 ** 2,
        },
        "sourcePreparationSeconds": 60,
        "immutablePolicy": {"defaultFeatures": True, "qaFeature": False, "publicNetwork": False,
                            "profilesOrKeys": False, "formalSigning": False, "productionRelease": False},
    }


def require_workspace():
    require(WORK.resolve() == WORK and WORK.is_dir() and WORK.stat().st_uid == os.getuid()
            and stat.S_IMODE(WORK.stat().st_mode) == 0o700, "private-external-workspace")


def inventory(body, root):
    require(root.resolve() == root and root.is_dir(), "non-private-inventory-root")
    result = body.inventory(root)
    for name, (_, st) in result.items():
        require(st.st_nlink == 1 and st.st_uid == os.getuid(), "non-private-file:" + name)
    return result


def metadata(rows):
    return {name: [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns, st.st_mode]
            for name, (_, st) in rows.items()}


def verify_bytes(body, g, root, expected, monitor):
    actual = inventory(body, root)
    require(actual.keys() == expected.keys(), "inventory-mismatch:" + root.name)
    for index, (name, (path, st)) in enumerate(actual.items()):
        if index % 128 == 0:
            monitor()
        row = expected[name]
        require(st.st_size == row["bytes"] and g.sha(path) == row["sha256"], "content-mismatch:" + name)
    return metadata(actual)


def extract_pinned_archive(out, monitor):
    with tarfile.open(ARCHIVE, "r:gz") as archive:
        for index, member in enumerate(archive):
            if index % 128 == 0:
                monitor()
            parts = Path(member.name).parts
            require(parts and parts[0] == WORKSPACE_ARCHIVE_ROOT
                    and ".." not in parts and (member.isdir() or member.isfile()), "unsupported-archive-member")
            path = out.joinpath(*parts[1:])
            if member.isdir():
                path.mkdir(mode=0o755, parents=True, exist_ok=True)
                continue
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with archive.extractfile(member) as source, path.open("xb") as dest:
                shutil.copyfileobj(source, dest)
            path.chmod(member.mode & 0o777)


def stage_source(body, g):
    capacity = body.facts(g)
    body.require_floors(capacity)
    began = time.monotonic()

    def monitor():
        require(time.monotonic() - began < 60, "source-staging-deadline")

    WORK.mkdir(mode=0o700)
    require_workspace()
    SOURCE.mkdir(mode=0o700)
    frozen = WORK / "source-continuity.json"
    receipt = WORK / "source-receipt.json"
    try:
        extract_pinned_archive(SOURCE, monitor)
        for patch in (BASE_PATCH, NORMAL_PATCH):
            # The audited original patch contains an extra blank EOF line.
            # Retain the original bytes and verify the entire manifest afterward.
            whitespace = "nowarn" if patch == BASE_PATCH else "error"
            command = ["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "apply", "--whitespace=" + whitespace, str(patch)]
            env = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
            subprocess.run(command, cwd=SOURCE, env=env, stdin=subprocess.DEVNULL, check=True, timeout=5)
        rows = verify_bytes(body, g, SOURCE, read(MANIFEST), monitor)
        # The pinned build.rs rewrites mainnet.env with identical bytes. All
        # other source leaves are read-only in the private staging directory.
        for path, st in inventory(body, SOURCE).values():
            if path != SOURCE / ENV_BUILD_SCRIPT_REWRITE:
                path.chmod(stat.S_IMODE(st.st_mode) & ~0o222)
        body.dump_new(frozen, metadata(inventory(body, SOURCE)))
        monitor()
    except BaseException as error:
        body.dump_new(WORK / "source-failure.json", {"type": type(error).__name__, "cause": str(error),
            "planSHA256": g.sha(PLAN), "cargoStarted": False, "network": False})
        raise
    body.dump_new(receipt, {"schema": "P05_NYM_NORMAL_SUCCESSOR_SOURCE_STAGED_V1",
        "planSHA256": g.sha(PLAN), "manifestSHA256": PINS[MANIFEST], "sourceFiles": len(rows),
        "archiveSHA256": PINS[ARCHIVE], "appliedPatchSHA256": [PINS[BASE_PATCH], PINS[NORMAL_PATCH]],
        "sourceContinuitySHA256": g.sha(frozen), "elapsedSeconds": time.monotonic() - began,
        "cargoStarted": False, "network": False})
    print(json.dumps({"receipt": str(receipt), "SHA256": g.sha(receipt), "sourceFiles": len(rows)}))


def observed_step(owner, env, name, argv, expected_exit=0, limit=5):
    try:
        owner.run(name, argv, limit, env)
    except RuntimeError as error:
        if str(error) != f"COMMAND_FAILED:{name}:{expected_exit}" or expected_exit == 0:
            raise
        rows = owner.owned()
        require(not rows, "unexpected-owned-descendants")
        owner.groups.clear()
        owner.identities.clear()
    observed = owner.steps[-1]
    require(observed["name"] == name and observed["argv"] == argv and observed["exit"] == expected_exit
            and observed["terminalOutcome"] == "ORIGINAL_POPEN_WAIT" and observed["reaped"] is True,
            "unexpected-command-outcome:" + name)


def probes():
    return [
        ("strict-signature", ["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", str(ARTIFACT)], 0),
        ("handler-symbols", ["/usr/bin/nm", str(ARTIFACT)], 0),
        ("exact-version", [str(ARTIFACT), "--no-banner", "--version"], 0),
        ("normal-directory-help", [str(ARTIFACT), "--no-banner", "ynx-reviewed-directory", "--help"], 0),
        ("normal-directory-without-policy", [str(ARTIFACT), "--no-banner", "ynx-reviewed-directory"], 1),
        ("qa-command-absent", [str(ARTIFACT), "--no-banner", "ynx-qa-cdn-directory", "--help"], 2),
    ]


def runtime_proof(g, case):
    names = {
        "handler-symbols": ("stdout", (r"nym_socks5_client8commands8reviewed3get",
                                       r"nym_socks5_client8commands8reviewed21directory_diagnostics12BodyProgress7advance")),
        "exact-version": ("stdout", (r"(?m)^Build Version:[ \t]+1\.1\.88[ \t]*$",
                                     r"(?m)^cargo Profile:[ \t]+release[ \t]*$")),
        "normal-directory-help": ("stdout", (r"Usage:.*ynx-reviewed-directory",)),
        "normal-directory-without-policy": ("stderr", (r"Directory requires reviewed policy",)),
        "qa-command-absent": ("stderr", (r"unrecognized subcommand 'ynx-qa-cdn-directory'",)),
    }
    receipts = {}
    for name, (stream, patterns) in names.items():
        path = case / f"{name}.{stream}.log"
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16 * 1024 ** 2,
                "probe-log:" + name)
        value = path.read_text()
        require(all(re.search(pattern, value) for pattern in patterns), "compiled-handler-or-cli:" + name)
        receipts[path.name] = g.sha(path)
    return receipts


def make_owner(body, g, phase, case, action):
    capacity = body.facts(g)
    body.require_floors(capacity)
    began = time.monotonic()
    case.mkdir(mode=0o700)
    tmp = case / "tmp"
    tmp.mkdir(mode=0o700)
    g.ROOT = WORK
    g.allocation = lambda: body.allocated_bytes(WORK)
    g.immutable_source = lambda _: None
    owner = g.Build({"requestedLimitsNotYetGranted": {"aggregateSeconds": 1800,
                      "cleanupReserveSeconds": CLEANUP_SECONDS}}, case, began)
    owner.work_seconds = WORK_SECONDS
    owner.baseline = {**capacity, "ownAllocatedSumNotUniquePhysical": g.allocation()}
    initial_monitor = owner.monitor
    cancelled = []

    def monitor():
        require(not cancelled, "caller-cancelled")
        require(time.monotonic() - began < WORK_SECONDS, "resource-interrupted-450s-work")
        initial_monitor()

    owner.monitor = monitor
    failure = cleanup_failure = result = None
    remaining = []
    started_path = case / "start.json"
    body.dump_new(started_path, {"phase": phase, "planSHA256": g.sha(PLAN), "UTC": g.utc(),
                                "PID": os.getpid(), "capacity": capacity})
    handlers = {sig: signal.signal(sig, lambda signum, _: cancelled.append(signum))
                for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        result = action(owner, tmp)
        monitor()
    except BaseException as error:
        failure = {"type": type(error).__name__, "cause": str(error)}
    finally:
        try:
            remaining = owner.cleanup()
        except BaseException as error:
            remaining = [{"state": "UNKNOWN", "recordedGroups": sorted(owner.groups)}]
            cleanup_failure = {"type": type(error).__name__, "cause": str(error)}
        receipt_path = case / "receipt.json"
        custody_anchor = started_path
        try:
            receipt = {"schema": "P05_NYM_NORMAL_OFFLINE_TERMINAL_V1", "phase": phase,
                       "planSHA256": g.sha(PLAN), "steps": owner.steps, "result": result,
                       "firstFailure": failure, "cleanupFailure": cleanup_failure,
                       "childOutcomeRecordingFailure": owner.child_outcome_recording_failure,
                       "cancelSignals": cancelled, "remainingOwned": remaining,
                       "elapsedSeconds": time.monotonic() - began, "groupRSSPeakBytes": owner.peak,
                       "resourceSamples": owner.samples, "publicNetwork": False, "productionRelease": False}
            body.dump_new(receipt_path, receipt)
            custody_anchor = receipt_path
            print(json.dumps({"receipt": str(receipt_path), "SHA256": g.sha(receipt_path),
                              "firstFailure": failure, "remainingOwned": remaining}), flush=True)
        finally:
            try:
                if remaining:
                    owner.custody(custody_anchor, cancelled)
            finally:
                for sig, handler in handlers.items():
                    signal.signal(sig, handler)
    return int(bool(failure or cleanup_failure or remaining or owner.child_outcome_recording_failure or not result))


def confirm_source(body, g, digest):
    path = WORK / "source-receipt.json"
    body.require_hashes(g, {path: digest})
    receipt = read(path)
    require(receipt["schema"] == "P05_NYM_NORMAL_SUCCESSOR_SOURCE_STAGED_V1"
            and receipt["planSHA256"] == g.sha(PLAN) and receipt["manifestSHA256"] == PINS[MANIFEST]
            and receipt["sourceFiles"] == 6612 and receipt["cargoStarted"] is False
            and receipt["network"] is False, "source-receipt")
    frozen = WORK / "source-continuity.json"
    body.require_hashes(g, {frozen: receipt["sourceContinuitySHA256"]})
    return read(frozen)


def cache_stage_steps():
    return [
        ("clone-registry", ["/bin/cp", "-cRp", str(CACHE / "cargo-home/registry"), str(CARGO_HOME / "registry")], 0),
        ("clone-git", ["/bin/cp", "-cRp", str(CACHE / "cargo-home/git"), str(CARGO_HOME / "git")], 0),
        ("clone-target", ["/bin/cp", "-cRp", str(CACHE / "target"), str(TARGET)], 0),
    ]


def stage_cache(body, g, source_digest):
    expected_source = confirm_source(body, g, source_digest)

    def action(owner, tmp):
        require(metadata(inventory(body, SOURCE)) == expected_source, "source-metadata-drift")
        CARGO_HOME.mkdir(mode=0o700)
        env = {"PATH": "/usr/bin:/bin", "TMPDIR": str(tmp)}
        cache = {name: row for name, row in read(CACHE_MANIFEST).items() if name.startswith(("registry/", "git/"))}
        for name, argv, expected in cache_stage_steps():
            observed_step(owner, env, name, argv, expected, 150)
        dependencies = verify_bytes(body, g, CARGO_HOME, cache, owner.monitor)
        body.require_hashes(g, {TARGET / "release" / TARGET_PROGRAM: PINS[QA_RUNTIME]})
        target = metadata(inventory(body, TARGET))
        for root, imported, original in ((CARGO_HOME, dependencies, CACHE / "cargo-home"),
                                         (TARGET, target, CACHE / "target")):
            old = metadata(inventory(body, original))
            require(all(row[:2] != old[name][:2] for name, row in imported.items()), "shared-cache-inode:" + root.name)
        continuity = WORK / "cache-continuity.json"
        body.dump_new(continuity, {"cargo-home": dependencies, "target": target})
        return {"sourceReceiptSHA256": source_digest, "cacheContinuitySHA256": g.sha(continuity)}

    return make_owner(body, g, "stage", WORK / "stage", action)


def terminal(body, g, phase, digest, steps):
    path = WORK / phase / "receipt.json"
    body.require_hashes(g, {path: digest})
    value = read(path)
    require(value["schema"] == "P05_NYM_NORMAL_OFFLINE_TERMINAL_V1"
            and value["phase"] == phase and value["planSHA256"] == g.sha(PLAN)
            and value["firstFailure"] is None and value["cleanupFailure"] is None
            and value["childOutcomeRecordingFailure"] is None and value["cancelSignals"] == []
            and value["remainingOwned"] == [] and value["publicNetwork"] is False
            and value["productionRelease"] is False and 0 < value["elapsedSeconds"] <= TOTAL_SECONDS
            and 0 <= value["groupRSSPeakBytes"] <= 4 * GIB, "terminal-not-clean:" + phase)
    require(value["resourceSamples"] and all(
        row["homeFreeBytes"] >= 2 * GIB and row["WDFreeBytes"] >= 16 * GIB
        and row["memoryFreePercent"] >= 20 and row["ownAllocatedGrowth"] <= 4 * GIB
        and row["globalWDFreeDropUnattributed"] <= 4 * GIB for row in value["resourceSamples"]),
        "terminal-resource-samples:" + phase)
    require([(row["name"], row["argv"], row["exit"]) for row in value["steps"]] == steps
            and all(type(row["pid"]) is int and row["pid"] > 1 and row["pgid"] == row["pid"]
                    and type(row["exit"]) is int and row["reaped"] is True
                    and row["terminalOutcome"] == "ORIGINAL_POPEN_WAIT" for row in value["steps"]),
            "terminal-original-wait:" + phase)
    return value["result"]


def verify_source_after(expected, current):
    require(current.keys() == expected.keys(), "source-inventory-drift")
    modified = []
    for name, before in expected.items():
        after = current[name]
        if after == before:
            continue
        require(name == ENV_BUILD_SCRIPT_REWRITE and before[:3] == after[:3] and before[5] == after[5],
                "unexpected-source-metadata-drift:" + name)
        modified.append(name)
    return modified


def build(body, g, plan, stage_digest):
    staged = terminal(body, g, "stage", stage_digest, cache_stage_steps())
    source_meta = confirm_source(body, g, staged["sourceReceiptSHA256"])
    continuity = WORK / "cache-continuity.json"
    body.require_hashes(g, {continuity: staged["cacheContinuitySHA256"]})
    expected_cache = read(continuity)
    source_manifest = read(MANIFEST)

    def action(owner, tmp):
        for key, root in (("cargo-home", CARGO_HOME), ("target", TARGET)):
            require(metadata(inventory(body, root)) == expected_cache[key], "staged-cache-drift:" + key)
            owner.monitor()
        require(verify_bytes(body, g, SOURCE, source_manifest, owner.monitor) == source_meta, "staged-source-drift")
        tool = Path(plan["environment"]["RUSTC"]).parent.parent
        g.verify_manifest(tool, plan["toolchain"]["path"])
        env = dict(plan["environment"], TMPDIR=str(tmp) + "/")
        # Cargo's PATH/CARGO_HOME are explicit. Keep original HOME for the SDK,
        # and never pass the user's inherited profile, proxy or rustup configuration.
        if "HOME" in os.environ:
            env["HOME"] = os.environ["HOME"]
        observed_step(owner, env, "offline-cargo", plan["argv"], 0, 420)
        target = TARGET / "release" / TARGET_PROGRAM
        require(target.is_file() and not target.is_symlink(), "build-target")
        ARTIFACT.parent.mkdir(mode=0o700)
        with target.open("rb") as source, ARTIFACT.open("xb") as output:
            shutil.copyfileobj(source, output)
        ARTIFACT.chmod(0o500)
        digest = g.sha(ARTIFACT)
        require(digest not in (PINS[OLD_RUNTIME], PINS[QA_RUNTIME]), "artifact-is-prior-supply")

        private_home = WORK / "build/probe-home"
        private_home.mkdir(mode=0o700)
        probe_env = {"PATH": "/usr/bin:/bin", "TMPDIR": str(tmp), "NYM_HOME_DIR": str(private_home)}
        for name, argv, expected in probes():
            observed_step(owner, probe_env, name, argv, expected)
        require(not any(private_home.iterdir()), "probe-profile-side-effects")
        proof = runtime_proof(g, WORK / "build")
        final = verify_bytes(body, g, SOURCE, source_manifest, owner.monitor)
        body.require_hashes(g, PINS)
        require(g.sha(ARTIFACT) == digest, "artifact-changed-during-probes")
        return {"artifact": {"path": str(ARTIFACT), "sha256": digest, "bytes": ARTIFACT.stat().st_size},
                "stageReceiptSHA256": stage_digest, "sourceManifestSHA256": PINS[MANIFEST],
                "sourceMetadataChanges": verify_source_after(source_meta, final),
                "CargoLockSHA256": plan["CargoLockSHA256"], "runtimeProof": proof,
                "upstreamTLSOrNetworkRun": False, "productionEligibility": False}

    return make_owner(body, g, "build", WORK / "build", action)


def verify(body, g, plan, stage_digest, build_digest):
    terminal(body, g, "stage", stage_digest, cache_stage_steps())
    receipt = terminal(body, g, "build", build_digest, [("offline-cargo", plan["argv"], 0), *probes()])
    binary = receipt["artifact"]
    st = ARTIFACT.lstat()
    require(receipt["stageReceiptSHA256"] == stage_digest and receipt["sourceManifestSHA256"] == PINS[MANIFEST]
            and receipt["CargoLockSHA256"] == plan["CargoLockSHA256"]
            and receipt["sourceMetadataChanges"] in ([], [ENV_BUILD_SCRIPT_REWRITE])
            and receipt["upstreamTLSOrNetworkRun"] is False and receipt["productionEligibility"] is False
            and binary["path"] == str(ARTIFACT) and st.st_size == binary["bytes"] and st.st_nlink == 1
            and st.st_uid == os.getuid() and stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o500,
            "artifact-receipt")
    body.require_hashes(g, {ARTIFACT: binary["sha256"]})
    require(runtime_proof(g, WORK / "build") == receipt["runtimeProof"], "runtime-proof-drift")
    print(json.dumps({"status": "OFFLINE_NORMAL_CANDIDATE_VERIFIED", "artifact": binary,
                      "buildReceiptSHA256": build_digest, "productionEligibility": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("plan", "source", "stage", "build", "verify"))
    parser.add_argument("--proposal-sha256")
    parser.add_argument("--source-receipt-sha256")
    parser.add_argument("--stage-receipt-sha256")
    parser.add_argument("--build-receipt-sha256")
    args = parser.parse_args()
    body, g = load_owner()
    plan = checked_plan(body, g)
    if args.operation == "plan":
        body.dump_new(PLAN, plan)
        print(json.dumps({"path": str(PLAN), "SHA256": g.sha(PLAN), "cargoStarted": False}))
        return 0
    body.require_hashes(g, {PLAN: args.proposal_sha256})
    require(read(PLAN) == plan, "proposal-bytes")
    if args.operation == "source":
        stage_source(body, g)
        return 0
    require_workspace()
    if args.operation == "verify":
        verify(body, g, plan, args.stage_receipt_sha256, args.build_receipt_sha256)
        return 0
    fd = body.take_shared_lock()
    try:
        if args.operation == "stage":
            return stage_cache(body, g, args.source_receipt_sha256)
        return build(body, g, plan, args.stage_receipt_sha256)
    finally:
        os.close(fd)


if __name__ == "__main__":
    sys.exit(main())
