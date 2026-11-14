#!/usr/bin/env python3
"""Prepare and verify the isolated Nym 1.1.88 cache-observation QA CLI."""

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
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
BASE = Path("/REDACTED_VOLUME/YNX-large-work")
P05 = BASE / "coordination-v5-20261031/owners/P05/privacy-routing"
CASE = P05 / "nym-directory-body-idle-20261113"
ORIGINAL = CASE / "exact-qa-release"
WORK = CASE / "cache-observation-vendor-successor-20261114"
SHARED_LOCK = BASE / "original-a-builds/.original-a-normal-heavy.lock"
OWNER = HERE.parent / "body-idle-observation/build-release.py"
GUARD = P05 / "nym-qa-cdn-fullfeature-20261108/run_fullfeature_v4.py"
SOURCE_MANIFEST = ORIGINAL / "source-manifest.json"
CACHE_MANIFEST = ORIGINAL / "cargo-home-manifest.json"
OLD_PLAN = ORIGINAL / "BUILD_RESUME_PROPOSAL.json"
OLD_RECEIPT = ORIGINAL / "build-reconciled/receipt.json"
OLD_BINARY = OLD_RECEIPT.parent / "artifacts/qa-feature-on/nym-socks5-client"
PATCH = HERE / "cache-observation.patch"
SOURCE_PIN = HERE / "source-pin.json"
COMPONENT = CASE / "cache-observation-formatter-20261114/HANDOFF.json"
REAL_ROUTE = CASE / "fresh-profile-https-tls-rebound-20261114.xQwsFTac/HANDOFF.json"
PLAN = WORK.parent / "CACHE_OBSERVATION_VENDOR_BUILD_PLAN.json"
ENV_REWRITE = "envs/mainnet.env"  # Existing network-defaults build.rs rewrites this file.
PROGRAM = "nym-socks5-client"
OBSERVATION_MARKER = b"YNX_NYM_QA_DIRECTORY_HTTP_V1"
GIB = 1024 ** 3
WORK_SECONDS = 885
WHOLE_SECONDS = 900
LIMITS = {
    "wholeSecondsPerPhase": WHOLE_SECONDS, "workSecondsPerPhase": WORK_SECONDS,
    "cleanupSeconds": 15, "cargoSeconds": 870, "jobs": 1,
    "groupRSSBytes": 4 * GIB, "ownerAllocatedGrowthBytes": 4 * GIB,
    "globalWDUnattributedDropBytes": 4 * GIB, "logBytes": 32 * 1024 ** 2,
    "startHostBytes": 9 * GIB // 4, "runHostBytes": 2 * GIB,
    "minimumWDBytes": 16 * GIB, "startMemoryPercent": 35, "runMemoryPercent": 20,
    "stageCopySeconds": {"clone-source": 180, "clone-registry": 240, "clone-git": 240, "clone-target": 240},
}
PINS = {
    OWNER: "c21dc9a5f1111c73da927ef066f5e0aead2da3fce172beb8f6b436909368466e",
    GUARD: "b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05",
    SOURCE_MANIFEST: "65838e1371153c3ac7a497bf628082115c5b1a7fbe87426effe0a9d9c0951055",
    CACHE_MANIFEST: "43afee89b79dd8f3608a34bc7fad41bf8d0b80312805617e1aa3995fab5663b4",
    OLD_PLAN: "b419bfb5c48e122c5cd8ddf742496fb2e5ad6b8385c1e821f9de78904801e986",
    OLD_RECEIPT: "842f5ae703082b8a1c0cda5a715cc8e74b4369ed9a09473f52a8564b6ab41906",
    ORIGINAL / "POSTBUILD_SOURCE_READBACK.json": "a05e8c12e0062b28721607849225c6e93fa4bae82da0acc7924b2f408339462d",
    OLD_BINARY: "855806ef6f5d22ad00ca5f144f4b5fb1a06f21e5a082e44984d02642cecc5798",
    SOURCE_PIN: "ff337aa423eceee23437e61963738686f9b3347785da3561bd70ece183b0adea",
    PATCH: "5b9112e8061de894fde4ad9537e752601f44d5f68aab3d837d633c2c96896a2f",
    HERE / "observe-headers.py": "cd7a9bebd2d557242502eaa3ddd0cb2bbc0a00398f3c37fe4c7efae9f4226a39",
    COMPONENT: "f0026228bac1ba7369ffcebb198e53197dc4432f4e96a13824662417becd15db",
    REAL_ROUTE: "72a6f764c0a042b132fe820a76e0ee4a9466408c3298fb70376ad7b33a92a50d",
}
LOCK_SHA = "29275bf9e41f6d6acad87f4737b5640e89ada39e0d7752a9211d04fec7871558"
PINS[ORIGINAL / "source/Cargo.lock"] = LOCK_SHA
ARTIFACT = WORK / "build/artifacts/qa-feature-on" / PROGRAM


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def read(path):
    return json.loads(path.read_text())


def load_owner():
    require(hashlib.sha256(OWNER.read_bytes()).hexdigest() == PINS[OWNER], "owner-controller-pin")
    spec = importlib.util.spec_from_file_location("frozen_body_release", OWNER)
    body = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(body)
    return body, body.load_guard()


def checked_plan(body, g):
    body.require_hashes(g, PINS)
    old = read(OLD_PLAN)
    pin = read(SOURCE_PIN)
    manifest = old["toolchainManifest"]
    tool = Path(old["environment"]["RUSTC"]).parent
    body.require_hashes(g, {Path(manifest["path"]): manifest["SHA256"],
                            tool / "cargo": manifest["cargoSHA256"],
                            tool / "rustc": manifest["rustcSHA256"],
                            tool / "rustdoc": manifest["rustdocSHA256"]})
    overlay = {HERE / "overlay" / name: row["after"] for name, row in pin["files"].items()}
    body.require_hashes(g, overlay)
    require(Path(old["environment"]["SDKROOT"]).is_dir(), "exact-sdk-unavailable")
    require(OWNER.stat().st_uid == os.getuid(), "controller-owner")
    env = dict(old["environment"], CARGO_HOME=str(WORK / "cargo-home"),
               CARGO_TARGET_DIR=str(WORK / "target"))
    argv = old["immutableRecipeArgv"]
    require(argv == [str(tool / "cargo"), "build", "--offline", "--release", "--locked",
                     "-p", PROGRAM, "--jobs", "1", "--features", "ynx-qa-directory"], "cargo-argv")
    script = Path("REVIEWED_SNAPSHOT/apps/browser/privacy-routing/nym/qa-cdn-directory"
                  "/successors/cache-observation") / Path(__file__).name

    def command(operation):
        return ["/usr/bin/python3", "-IB", str(script), operation, "--proposal-sha256", "PLAN_SHA256"]

    return {
        "schema": "P05_NYM_QA_CACHE_OBSERVATION_VENDOR_PLAN_V1",
        "status": "PREPARED_NOT_RUN",
        "controllerSHA256": g.sha(__file__),
        "sourceDelta": pin["files"], "CargoLockSHA256": LOCK_SHA,
        "inputSHA256": {
            "repo-successors:" + str(path.relative_to(HERE.parent)) if path.is_relative_to(HERE.parent)
            else str(path): value for path, value in {**PINS, **overlay}.items()
        },
        "toolchain": manifest, "workspace": str(WORK), "sharedLock": str(SHARED_LOCK),
        "limits": LIMITS, "environment": env, "cargoArgv": argv,
        "commands": {"stage": command("stage"),
                     "execute": command("execute") + ["--preparation-sha256", "STAGE_RECEIPT_SHA256"],
                     "verify": command("verify") + ["--preparation-sha256", "STAGE_RECEIPT_SHA256",
                                                   "--receipt-sha256", "BUILD_RECEIPT_SHA256"]},
        "stageInputs": {"source": str(ORIGINAL / "source"), "registryAndGit": str(ORIGINAL / "cargo-home"),
                        "targetOptimization": str(ORIGINAL / "target")},
        "publicNetwork": False, "productionRelease": False,
    }


def continuity(body, root):
    answer = {}
    for name, (_, st) in body.inventory(root).items():
        require(st.st_nlink == 1 and st.st_uid == os.getuid(), "non-private-file:" + name)
        answer[name] = [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns, stat.S_IMODE(st.st_mode)]
    return answer


def verified_files(body, g, root, expected, tick=lambda: None):
    actual = body.inventory(root)
    require(actual.keys() == expected.keys(), "staged-inventory")
    for index, (name, (path, st)) in enumerate(actual.items()):
        if index % 32 == 0:
            tick()
        row = expected[name]
        require(st.st_nlink == 1 and st.st_uid == os.getuid()
                and st.st_size == row["bytes"] and oct(stat.S_IMODE(st.st_mode)) == row["mode"]
                and g.sha(path) == row["sha256"], "staged-file:" + name)


def verified_source_manifest(plan, source):
    original = read(SOURCE_MANIFEST)
    require(source.keys() == original.keys() | plan["sourceDelta"].keys(), "source-file-set")
    for name, row in source.items():
        if name in plan["sourceDelta"]:
            pinned = plan["sourceDelta"][name]
            before = original.get(name)
            require((before["sha256"] if before else None) == pinned["before"]
                    and row["sha256"] == pinned["after"]
                    and row["mode"] == (before["mode"] if before else "0o644"), "overlay-pin:" + name)
        else:
            require(row == original[name], "unrelated-source-delta:" + name)


def allow_env_rewrite(g, expected, observed, source_manifest):
    require(observed.keys() == expected.keys(), "source-inventory-drift")
    for name, before in expected.items():
        after = observed[name]
        if after == before:
            continue
        require(name == ENV_REWRITE and after[:3] == before[:3] and after[5:] == before[5:]
                and g.sha(WORK / "source" / name) == source_manifest[name]["sha256"], "source-drift:" + name)


def supervised(body, g, plan, case, action):
    g.ROOT = WORK
    g.allocation = lambda: body.allocated_bytes(WORK)
    capacity = body.facts(g)
    body.require_floors(capacity)
    case.mkdir(mode=0o700)
    (case / "tmp").mkdir(mode=0o700)
    began = time.monotonic()
    # The frozen Build constructor accepts only its historic proposal shape.
    # This controller immediately sets the existing body-release 885 s limit.
    owner = g.Build({"requestedLimitsNotYetGranted": {"aggregateSeconds": 1800,
                     "cleanupReserveSeconds": 15}}, case, began)
    owner.work_seconds = WORK_SECONDS
    owner.baseline = {**capacity, "ownAllocatedSumNotUniquePhysical": g.allocation()}
    initial_monitor = owner.monitor
    cancellations = []

    def monitor():
        require(not cancellations, "caller-cancelled")
        initial_monitor()

    owner.monitor = monitor
    old_handlers = {sig: signal.signal(sig, lambda signum, _: cancellations.append(signum))
                    for sig in (signal.SIGINT, signal.SIGTERM)}
    body.dump_new(case / "start.json", {"UTC": g.utc(), "controllerPID": os.getpid(), "facts": capacity,
                                        "planSHA256": g.sha(PLAN), "resources": LIMITS})
    primary = cleanup = None
    remaining, result = [], None
    alias = None
    try:
        alias = Path(tempfile.mkdtemp(prefix="ynx-nym-observation.", dir="/private/tmp"))
        (alias / "tmp").symlink_to(case / "tmp")
        env = dict(plan["environment"], TMPDIR=str(alias / "tmp") + "/")
        if "HOME" in os.environ:
            env["HOME"] = os.environ["HOME"]
        g.immutable_source = lambda _: None
        result = action(owner, env)
        monitor()
    except BaseException as error:
        primary = {"type": type(error).__name__, "cause": str(error)}
    finally:
        try:
            remaining = owner.cleanup()
            if alias is not None and not remaining:
                (alias / "tmp").unlink(missing_ok=True)
                alias.rmdir()
        except BaseException as error:
            cleanup = {"type": type(error).__name__, "cause": str(error)}
            if remaining is None or owner.groups:
                remaining = [{"state": "UNKNOWN", "ownedRecordedGroups": sorted(owner.groups)}]
        cleanup_pending = bool(remaining)
        if cleanup_pending:
            # Preserving the original child takes precedence over receipt I/O.
            # If the output itself fails, custody remains tied to start.json.
            custody_anchor = case / "start.json"
        path = case / "receipt.json"
        receipt = {
            "schema": "P05_NYM_QA_CACHE_OBSERVATION_VENDOR_TERMINAL_V1",
            "phase": case.name, "buildPlanSHA256": g.sha(PLAN), "firstFailure": primary,
            "cleanupFailure": cleanup, "childOutcomeRecordingFailure": owner.child_outcome_recording_failure,
            "remainingOwned": remaining, "callerSignals": cancellations, "steps": owner.steps,
            "elapsedSeconds": time.monotonic() - began, "groupRSSPeakBytes": owner.peak,
            "resourceSamples": owner.samples, "result": result,
            "productionRelease": False, "publicNetwork": False,
        }
        try:
            body.dump_new(path, receipt)
            if cleanup_pending:
                custody_anchor = path
            print(json.dumps({"receipt": str(path), "SHA256": g.sha(path),
                              "firstFailure": primary, "remainingOwned": remaining}), flush=True)
        finally:
            try:
                if cleanup_pending:
                    owner.custody(custody_anchor, cancellations)
                    if alias is not None:
                        (alias / "tmp").unlink(missing_ok=True)
                        alias.rmdir()
            finally:
                for sig, handler in old_handlers.items():
                    signal.signal(sig, handler)
    return int(bool(primary or cleanup or remaining or owner.child_outcome_recording_failure or not result))


def stage(body, g, plan):
    # Ownership is acquired before any staging writes. No cache is writable in
    # common with the original. A target clone is a Cargo optimization only.
    body.require_floors(body.facts(g))
    WORK.mkdir(mode=0o700)
    (WORK / "source").mkdir(mode=0o700)
    (WORK / "cargo-home").mkdir(mode=0o700)

    def action(owner, env):
        steps = stage_steps()

        def clone(name):
            owner.run(name, steps[name], LIMITS["stageCopySeconds"][name], env)

        clone("clone-source")
        original = read(SOURCE_MANIFEST)
        verified_files(body, g, WORK / "source", original, owner.monitor)
        for name in ("registry", "git"):
            clone("clone-" + name)
        cache = {name: row for name, row in read(CACHE_MANIFEST).items() if name.startswith(("registry/", "git/"))}
        verified_files(body, g, WORK / "cargo-home", cache, owner.monitor)
        body.require_hashes(g, {ORIGINAL / "target/release" / PROGRAM: PINS[OLD_BINARY]})
        clone("clone-target")
        body.require_hashes(g, {WORK / "target/release" / PROGRAM: PINS[OLD_BINARY]})
        for name, pin in plan["sourceDelta"].items():
            source = HERE / "overlay" / name
            dest = WORK / "source" / name
            if pin["before"] is None:
                require(not dest.exists() and name not in original, "unexpected-overlay-predecessor")
                with dest.open("xb") as output, source.open("rb") as input_file:
                    shutil.copyfileobj(input_file, output)
                dest.chmod(0o644)
            else:
                require(original[name]["sha256"] == pin["before"], "overlay-predecessor-pin")
                shutil.copyfile(source, dest)
            original[name] = {"bytes": source.stat().st_size, "mode": oct(stat.S_IMODE(dest.stat().st_mode)),
                              "sha256": pin["after"]}
        verified_files(body, g, WORK / "source", original, owner.monitor)
        maps = {name: continuity(body, WORK / name) for name in ("source", "cargo-home", "target")}
        body.dump_new(WORK / "source-manifest.json", original)
        body.dump_new(WORK / "continuity.json", maps)
        return {"sourceManifestSHA256": g.sha(WORK / "source-manifest.json"),
                "continuitySHA256": g.sha(WORK / "continuity.json"), "sourceFiles": len(original),
                "cachedPublicDependencyFiles": len(cache), "byteDelta": sorted(plan["sourceDelta"])}

    return supervised(body, g, plan, WORK / "stage", action)


def stage_steps():
    return {
        "clone-source": ["/bin/cp", "-cRp", str(ORIGINAL / "source") + "/.", str(WORK / "source")],
        "clone-registry": ["/bin/cp", "-cRp", str(ORIGINAL / "cargo-home/registry"), str(WORK / "cargo-home/registry")],
        "clone-git": ["/bin/cp", "-cRp", str(ORIGINAL / "cargo-home/git"), str(WORK / "cargo-home/git")],
        "clone-target": ["/bin/cp", "-cRp", str(ORIGINAL / "target"), str(WORK / "target")],
    }


def terminal_ok(receipt, phase, plan_sha, expected_steps):
    require(receipt["schema"] == "P05_NYM_QA_CACHE_OBSERVATION_VENDOR_TERMINAL_V1"
            and receipt["phase"] == phase and receipt["buildPlanSHA256"] == plan_sha, "receipt-binding")
    require(receipt["firstFailure"] is None and receipt["cleanupFailure"] is None
            and receipt["childOutcomeRecordingFailure"] is None and receipt["remainingOwned"] == []
            and receipt["callerSignals"] == [] and receipt["productionRelease"] is False
            and receipt["publicNetwork"] is False, "receipt-unclosed-or-unqualified")
    require(0 < receipt["elapsedSeconds"] <= WHOLE_SECONDS
            and 0 <= receipt["groupRSSPeakBytes"] <= LIMITS["groupRSSBytes"], "receipt-resource-limit")
    require(receipt["resourceSamples"] and all(
        row["homeFreeBytes"] >= LIMITS["runHostBytes"] and row["WDFreeBytes"] >= LIMITS["minimumWDBytes"]
        and row["memoryFreePercent"] >= LIMITS["runMemoryPercent"]
        and row["ownAllocatedGrowth"] <= LIMITS["ownerAllocatedGrowthBytes"]
        and row["globalWDFreeDropUnattributed"] <= LIMITS["globalWDUnattributedDropBytes"]
        for row in receipt["resourceSamples"]), "receipt-resource-samples")
    budgets = {**LIMITS["stageCopySeconds"], "qa-release-build": LIMITS["cargoSeconds"]}
    require(receipt["steps"] and all(
        type(row["pid"]) is int and row["pid"] > 1 and row["pgid"] == row["pid"]
        and type(row["exit"]) is int and row["exit"] == 0 and row["reaped"] is True
        and 0 < row["elapsed"] <= budgets.get(row["name"], 5)
        and row["terminalOutcome"] == "ORIGINAL_POPEN_WAIT"
        for row in receipt["steps"]), "receipt-original-child-wait")
    require([(row["name"], row["argv"]) for row in receipt["steps"]] == list(expected_steps.items()),
            "receipt-command-order")


def build_steps(plan):
    return {
        "qa-release-build": plan["cargoArgv"],
        "qa-release-version": [str(ARTIFACT), "--no-banner", "--version"],
        "qa-release-code-signature": ["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", str(ARTIFACT)],
        "qa-release-feature-help": [str(ARTIFACT), "--no-banner", "ynx-qa-cdn-directory", "--help"],
    }


def binary_observation_marker(artifact):
    with artifact.open("rb") as stream:
        tail = b""
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            current = tail + chunk
            if OBSERVATION_MARKER in current:
                return True
            tail = current[-(len(OBSERVATION_MARKER) - 1):]
        return False


def proof_logs():
    folder = WORK / "build"
    version_path = folder / "qa-release-version.stdout.log"
    help_path = folder / "qa-release-feature-help.stdout.log"
    for path in (version_path, help_path):
        st = path.lstat()
        require(stat.S_ISREG(st.st_mode) and 0 < st.st_size <= 65536, "offline-proof-log")
    version = version_path.read_text()
    help_text = help_path.read_text()
    require(re.search(r"(?m)^Build Version:\s+1\.1\.88[ \t]*$", version)
            and re.search(r"(?m)^cargo Profile:\s+release[ \t]*$", version)
            and "--plan-sha256" in help_text and "--run-id" in help_text,
            "actual-version-or-cli-feature")
    return version_path, help_path


def execute(body, g, plan, preparation_sha):
    stage_receipt = WORK / "stage/receipt.json"
    body.require_hashes(g, {stage_receipt: preparation_sha})
    staging = read(stage_receipt)
    terminal_ok(staging, "stage", g.sha(PLAN), stage_steps())
    prepared = staging["result"]
    manifest_path = WORK / "source-manifest.json"
    body.require_hashes(g, {manifest_path: prepared["sourceManifestSHA256"],
                            WORK / "continuity.json": prepared["continuitySHA256"]})
    source = read(manifest_path)
    verified_source_manifest(plan, source)
    maps = read(WORK / "continuity.json")

    def action(owner, env):
        for name in ("source", "cargo-home", "target"):
            require(continuity(body, WORK / name) == maps[name], "staged-continuity:" + name)
            owner.monitor()
        verified_files(body, g, WORK / "source", source, owner.monitor)
        body.require_hashes(g, {WORK / "source/Cargo.lock": LOCK_SHA})
        g.verify_manifest(Path(plan["environment"]["RUSTC"]).parent.parent, plan["toolchain"]["path"])
        for name, argv in build_steps(plan).items():
            owner.run(name, argv, LIMITS["cargoSeconds"] if name == "qa-release-build" else 5, env)
            if name == "qa-release-build":
                ARTIFACT.parent.mkdir(mode=0o700, parents=True)
                shutil.copyfile(WORK / "target/release" / PROGRAM, ARTIFACT)
                ARTIFACT.chmod(0o500)
        version, cli = proof_logs()
        after = continuity(body, WORK / "source")
        allow_env_rewrite(g, maps["source"], after, source)
        verified_files(body, g, WORK / "source", source, owner.monitor)
        body.require_hashes(g, PINS)
        digest = g.sha(ARTIFACT)
        require(digest != PINS[OLD_BINARY] and binary_observation_marker(ARTIFACT), "artifact-observer-marker")
        return {"artifact": {"path": str(ARTIFACT), "SHA256": digest, "bytes": ARTIFACT.stat().st_size},
                "stageReceiptSHA256": preparation_sha, "sourceManifestSHA256": g.sha(manifest_path),
                "sourceByteReadbackFiles": len(source), "CargoLockSHA256": LOCK_SHA,
                "sourceMetadataDelta": sorted(name for name in after if after[name] != maps["source"][name]),
                "offlineReadbackSHA256": {str(version): g.sha(version), str(cli): g.sha(cli)}}

    return supervised(body, g, plan, WORK / "build", action)


def verify_receipt(body, g, plan, preparation_sha, receipt_sha):
    preparation = WORK / "stage/receipt.json"
    path = WORK / "build/receipt.json"
    body.require_hashes(g, {preparation: preparation_sha, path: receipt_sha})
    staging, build = read(preparation), read(path)
    terminal_ok(staging, "stage", g.sha(PLAN), stage_steps())
    terminal_ok(build, "build", g.sha(PLAN), build_steps(plan))
    result = build["result"]
    require(result["stageReceiptSHA256"] == preparation_sha
            and result["sourceManifestSHA256"] == staging["result"]["sourceManifestSHA256"]
            and result["CargoLockSHA256"] == LOCK_SHA and result["sourceByteReadbackFiles"] == 6616
            and result["sourceMetadataDelta"] in ([], [ENV_REWRITE]), "receipt-source-readback")
    manifest = WORK / "source-manifest.json"
    proof = {str(path): g.sha(path) for path in proof_logs()}
    require(result["offlineReadbackSHA256"] == proof, "receipt-version-help-log-pin")
    artifact = result["artifact"]
    st = ARTIFACT.lstat()
    require(artifact["path"] == str(ARTIFACT) and stat.S_ISREG(st.st_mode) and st.st_nlink == 1
            and st.st_uid == os.getuid() and stat.S_IMODE(st.st_mode) == 0o500
            and st.st_size == artifact["bytes"] and artifact["SHA256"] != PINS[OLD_BINARY], "receipt-artifact")
    body.require_hashes(g, {ARTIFACT: artifact["SHA256"], manifest: result["sourceManifestSHA256"]})
    require(binary_observation_marker(ARTIFACT), "artifact-observer-marker")
    verified_source_manifest(plan, read(manifest))
    print(json.dumps({"status": "QA_ARTIFACT_VERIFIED", "receiptSHA256": receipt_sha,
                      "artifact": artifact, "publicNetwork": False, "productionRelease": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("plan", "stage", "execute", "verify"))
    parser.add_argument("--proposal-sha256")
    parser.add_argument("--preparation-sha256")
    parser.add_argument("--receipt-sha256")
    args = parser.parse_args()
    body, g = load_owner()
    plan = checked_plan(body, g)
    if args.operation == "plan":
        body.dump_new(PLAN, plan)
        print(json.dumps({"status": plan["status"], "path": str(PLAN), "SHA256": g.sha(PLAN),
                          "actualCargoStarted": False, "publicNetwork": False}))
        return 0
    body.require_hashes(g, {PLAN: args.proposal_sha256})
    require(read(PLAN) == plan, "proposal-content")
    if args.operation == "verify":
        verify_receipt(body, g, plan, args.preparation_sha256, args.receipt_sha256)
        return 0
    require(args.operation == "stage" or args.preparation_sha256, "preparation-pin-required")
    require(body.LOCK == SHARED_LOCK, "original-shared-lock")
    fd = body.take_shared_lock()
    try:
        if args.operation == "stage":
            return stage(body, g, plan)
        return execute(body, g, plan, args.preparation_sha256)
    finally:
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
