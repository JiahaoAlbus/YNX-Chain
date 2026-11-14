#!/usr/bin/env python3
"""Verify the originally completed Cargo output in a fresh, offline receipt."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import time

SOURCE_GATE_SHA = "9ac7d66ec080bb6742aedb7ab4937da52591a81a73c4d7df115948fee5ed972b"
PLAN_SHA = "77937f5583bbc51e86ef985413bf037430792d3be18c5626511f889eaf8f365a"
INPUT_SHA = "387c9ffec0516933fe7fd955aabdbd17aaca58db1509d2c119a2e1288c3e9174"
TERMINAL_SHA = "4d9172c1d079335b014c13d5147e1dfdebd20f19a6d4bb07ce7c9f5dc8fc46b7"
STEPS_SHA = "d773a696bea11edab112ac9173c6fec90f8d973cb95947ac0a34e863af053c9f"
CARGO_LOG_SHA = "06b4fa6e862732c6a11c650fbcf165c6c55b8396c27c3a174196ec16dd051428"
ARTIFACT_SHA = "bfcf8838bf48e452917d543554c5366c750c10ccd4bd2619b5d038a10bf0a928"
ARTIFACT_BYTES = 22476176
PHASE = "verify-phased-v2-original-artifact"
VERIFY_SECONDS = 150


def load_source_gate():
    path = Path(__file__).with_name("phased-normal-successor-v2.py")
    if hashlib.sha256(path.read_bytes()).hexdigest() != SOURCE_GATE_SHA:
        raise RuntimeError("source-gate-changed")
    spec = importlib.util.spec_from_file_location("frozen_phased_v2", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_wait(step, name, argv, pid):
    if not (step["name"] == name and step["argv"] == argv
            and step["pid"] == step["pgid"] == pid and step["exit"] == 0
            and step["reaped"] is True and step["terminalOutcome"] == "ORIGINAL_POPEN_WAIT"):
        raise RuntimeError("original-wait:" + name)


def same_artifact(module, path):
    fd = os.open(path, module.READ_FILE)
    try:
        before = os.fstat(fd)
        module.require(stat.S_ISREG(before.st_mode) and before.st_size == ARTIFACT_BYTES
                       and before.st_uid == os.getuid() and before.st_nlink == 1
                       and bool(before.st_mode & 0o100) and not before.st_mode & 0o022,
                       "original-artifact-type")
        module.require(module.read_digest(fd, lambda: None) == ARTIFACT_SHA
                       and module.identity(before) == module.identity(os.fstat(fd)) == module.identity(path.lstat()),
                       "original-artifact-bytes")
    finally:
        os.close(fd)


def original_evidence(module, gate, body, guard, base, expected):
    plan = module.sealed_data(gate.INPUTS / module.PLAN_NAME, PLAN_SHA)
    gate.require(all(plan.get(key) == value for key, value in expected.items()), "original-phase-plan")
    case = gate.WORK / module.PHASE
    gate.ARTIFACT = case / "artifact" / gate.TARGET_PROGRAM
    input_record = module.sealed_data(gate.WORK / (module.PHASE + "-input.json"), INPUT_SHA)
    gate.require(input_record["PID"] == 61163 and input_record["firstFailure"] is None
                 and input_record["CargoStarted"] is False and input_record["cancelSignals"] == []
                 and 0 < input_record["elapsedSeconds"] <= module.INPUT_SECONDS
                 and [row["name"] for row in input_record["records"]]
                 == ["target", "tmp", "source", "cargo-registry-and-git", "toolchain"],
                 "original-locked-input-verify")
    for sample in input_record["resourceSamples"]:
        module.allocation_budget(sample, input_record["allocationBaseline"])
    result = module.sealed_data(case / "receipt.json", TERMINAL_SHA)
    gate.require(result["phase"] == module.PHASE and result["result"] is None
                 and result["remainingOwned"] == [] and result["cancelSignals"] == []
                 and result["cleanupFailure"] is None and result["childOutcomeRecordingFailure"] is None
                 and result["publicNetwork"] is False and result["productionRelease"] is False
                 and result["firstFailure"] == {"cause": "Owned process group has no live original identity anchor: 72607",
                                               "type": "RuntimeError"}
                 and result["steps"] == module.sealed_data(case / "steps.json", STEPS_SHA),
                 "original-probe-race-receipt")
    body.require_hashes(guard, {case / "offline-cargo.stderr.log": CARGO_LOG_SHA})
    cargo, seal = result["steps"]
    require_wait(cargo, "offline-cargo", base["argv"], 63918)
    require_wait(seal, *gate.probes()[0][:2], 72607)
    processes = guard.processes()
    gate.require(all(pid not in processes for pid in (61163, 63918, 72607))
                 and all(row["pgid"] not in (63918, 72607) for row in processes.values()), "original-owner-live")
    same_artifact(module, gate.ARTIFACT)
    same_artifact(module, gate.TARGET / "release" / gate.TARGET_PROGRAM)
    return cargo, seal


def retry_exited_child_census(owner):
    original = owner.owned

    def owned():
        try:
            return original()
        except RuntimeError as error:
            tracked = [child for child in owner.children if child.pid in owner.groups]
            if len(tracked) != 1:
                raise
            child, = tracked
            allowed = {"Owned original process observation is UNKNOWN",
                       f"Owned process group has no live original identity anchor: {child.pid}"}
            if str(error) not in allowed or child.poll() is None:
                raise
            # Require a new full census of the same group; do not turn UNKNOWN
            # into empty, manufacture old success or signal a PID we did not own.
            return original()
    owner.owned = owned


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("verify-only",))
    parser.parse_args()
    module = load_source_gate()
    gate, body, guard, previous, base, stage, expected = module.locate()
    cargo, seal = original_evidence(module, gate, body, guard, base, expected)
    target = gate.ARTIFACT
    case = gate.WORK / PHASE
    gate.require(not case.exists(), "verification-output-exists")
    fd = body.take_shared_lock()
    try:
        gate.WORK_SECONDS = VERIFY_SECONDS
        gate.TOTAL_SECONDS = VERIFY_SECONDS + 15

        def action(owner, tmp):
            retry_exited_child_census(owner)
            gate.require(module.identity(os.fstat(fd)) == module.identity(body.LOCK.lstat()), "shared-lock-changed")
            pins = module.sealed_data(gate.MANIFEST, gate.PINS[gate.MANIFEST])
            staged = gate.confirm_source(body, guard, stage["sourceReceiptSHA256"])
            group_mode = module.approved_group_write(gate, staged, pins)
            clock = 0

            def tick():
                nonlocal clock
                now = time.monotonic()
                if now >= clock:
                    owner.monitor()
                    clock = now + 1

            observed = module.snapshot(gate.SOURCE, pins, tick, exact_group_write=group_mode)
            source_changes = gate.verify_source_after(staged, module.source_metadata(observed))
            same_artifact(module, target)
            home = case / "probe-home"
            home.mkdir(mode=0o700)
            env = {"PATH": "/usr/bin:/bin", "TMPDIR": str(tmp), "NYM_HOME_DIR": str(home)}
            for name, argv, code in gate.probes():
                gate.observed_step(owner, env, name, argv, code)
            gate.require(not any(home.iterdir()), "verify-only-profile-side-effects")
            artifacts = gate.runtime_proof(guard, case)
            body.require_hashes(guard, {gate.SOURCE / "Cargo.lock": base["CargoLockSHA256"],
                                        gate.WORK / module.PHASE / "receipt.json": TERMINAL_SHA})
            same_artifact(module, target)
            return {"artifact": {"path": str(target), "sha256": ARTIFACT_SHA, "bytes": ARTIFACT_BYTES},
                    "originalCargo": cargo, "originalSealProbe": seal,
                    "originalSupervisorFailurePreserved": True, "originalReceiptSHA256": TERMINAL_SHA,
                    "inputReceiptSHA256": INPUT_SHA, "planSHA256": PLAN_SHA,
                    "sourceMetadataChanges": source_changes, "sourceManifestSHA256": gate.PINS[gate.MANIFEST],
                    "CargoLockSHA256": base["CargoLockSHA256"], "runtimeProof": artifacts,
                    "newCargoInvocation": False, "network": False, "productionEligibility": False}

        return gate.make_owner(body, guard, PHASE, case, action)
    finally:
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
