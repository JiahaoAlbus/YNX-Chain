#!/usr/bin/env python3
"""Extend the same owned offline build under a separately scheduled 915-second window."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREVIOUS = HERE / "resume-normal-successor.py"
PREVIOUS_SHA = "0d31c5914b1aeb84c8453fae71c45903dbf13b5c9306c8e9992222d0bb209f8e"
PREVIOUS_PLAN_SHA = "9c8dfb599148d0a297c1a203d88ba0b338c7a96b2ff0f759af38503684b28ac6"
PREVIOUS_CONTROLLER = 86035
PREVIOUS_CARGO = 92095
WORK_SECONDS = 900
CLEANUP_SECONDS = 15
TOTAL_SECONDS = WORK_SECONDS + CLEANUP_SECONDS
CARGO_SECONDS = 800
PINS = {
    "receipt.json": "20c91f2a42192f31f8b90f38e639bacacb311b92512bf4970b25e5d75f398e8b",
    "start.json": "21a43b30f700db636d5be936e4e16e3561559c21adf6626de59dbbb0c814f3ed",
    "steps.json": "d960b2f96f539ec16741ff7abc35ba982791a3aa13b0b0fde586fb017703d704",
    "samples.json": "009f9566a7e866a0746a709b99ee1a77d712216f0df05314bbd8ed58f8d2b685",
    "offline-cargo.stdout.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "offline-cargo.stderr.log": "a8c15fa5870e8c317c7a16857216fa80e97fe653ab8c013ad712dc2d44c0db52",
}


def load_previous():
    if hashlib.sha256(PREVIOUS.read_bytes()).hexdigest() != PREVIOUS_SHA:
        raise RuntimeError("prior-resume-controller-pin")
    spec = importlib.util.spec_from_file_location("frozen_cold_resume", PREVIOUS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def confirm_previous(gate, body, guard, plan):
    case = gate.WORK / "build-resumed"
    body.require_hashes(guard, {case / name: digest for name, digest in PINS.items()})
    data = gate.read(case / "receipt.json")
    require = gate.require
    require(data["schema"] == "P05_NYM_NORMAL_OFFLINE_TERMINAL_V1"
            and data["phase"] == "build-resumed" and data["planSHA256"] == plan["basePlanSHA256"]
            and data["firstFailure"] == {"type": "RuntimeError", "cause": "RESOURCE_INTERRUPTED_PHASE_DEADLINE:offline-cargo"}
            and data["remainingOwned"] == [] and data["cleanupFailure"] is None
            and data["childOutcomeRecordingFailure"] is None and data["cancelSignals"] == []
            and data["result"] is None and data["publicNetwork"] is False and data["productionRelease"] is False
            and 0 < data["elapsedSeconds"] <= 465, "previous-resume-not-clean")
    require(len(data["steps"]) == 1 and gate.read(case / "steps.json") == data["steps"]
            and gate.read(case / "start.json")["PID"] == PREVIOUS_CONTROLLER, "previous-owner")
    child = data["steps"][0]
    require(child["name"] == "offline-cargo" and child["argv"] == plan["argv"]
            and child["pid"] == child["pgid"] == PREVIOUS_CARGO and child["exit"] == -2
            and child["reaped"] is True and child["terminalOutcome"] == "ORIGINAL_POPEN_WAIT",
            "previous-wait")
    require(not (case / "artifact/nym-socks5-client").exists(), "previous-artifact")
    processes = guard.processes()
    require(not any(pid in processes for pid in (PREVIOUS_CONTROLLER, PREVIOUS_CARGO))
            and all(row["pgid"] != PREVIOUS_CARGO for row in processes.values()), "previous-process-live")
    return data


def scoped_gate(gate):
    """Reuse frozen ownership, monitoring and verification outside the original closures."""
    create_owner = gate.make_owner

    def make_owner(body, guard, _phase, _case, action):
        return create_owner(body, guard, "build-continued", gate.WORK / "build-continued", action)

    observe = gate.observed_step

    def observed_step(owner, env, name, argv, expected_exit=0, limit=5):
        return observe(owner, env, name, argv, expected_exit, CARGO_SECONDS if name == "offline-cargo" else limit)

    terminal = gate.terminal

    def verify_terminal(body, guard, phase, digest, steps):
        return terminal(body, guard, "build-continued" if phase == "build-resumed" else phase, digest, steps)

    proof = gate.runtime_proof

    def runtime_proof(guard, case):
        return proof(guard, case.with_name("build-continued") if case.name == "build-resumed" else case)

    gate.WORK_SECONDS = WORK_SECONDS
    gate.TOTAL_SECONDS = TOTAL_SECONDS
    gate.ARTIFACT = gate.WORK / "build-continued/artifact/nym-socks5-client"
    gate.make_owner = make_owner
    gate.observed_step = observed_step
    gate.terminal = verify_terminal
    gate.runtime_proof = runtime_proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "check", "build", "verify"))
    parser.add_argument("--continuation-plan-sha256")
    parser.add_argument("--build-receipt-sha256")
    args = parser.parse_args()
    previous = load_previous()
    gate = previous.load_gate()
    body, guard = gate.load_owner()
    gate.require_workspace()
    plan = gate.checked_plan(body, guard)
    plan["basePlanSHA256"] = previous.BASE_PLAN_SHA
    previous_path = gate.INPUTS / "OFFLINE_BUILD_RESUME_V1.json"
    previous_data, _ = previous.resume_plan(gate, body, guard, plan, previous_path, PREVIOUS_PLAN_SHA)
    stage = gate.terminal(body, guard, "stage", previous.STAGE_SHA, gate.cache_stage_steps())
    previous.confirm_original(gate, body, guard, plan)
    confirm_previous(gate, body, guard, plan)
    path = gate.INPUTS / "OFFLINE_BUILD_CONTINUATION_V1.json"
    ledger = gate.WORK / "continuation-continuity.json"
    policy = {**plan["budgetEachStageAndBuild"], "workSeconds": WORK_SECONDS, "wholeSeconds": TOTAL_SECONDS,
              "cleanupSeconds": CLEANUP_SECONDS, "maxCargoSeconds": CARGO_SECONDS}
    expected = {"schema": "P05_NYM_OFFLINE_NORMAL_CONTINUATION_V1", "controllerSHA256": guard.sha(__file__),
                "priorResumePlanSHA256": PREVIOUS_PLAN_SHA, "priorBuildReceiptSHA256": PINS["receipt.json"],
                "originalBuildReceiptSHA256": previous.ORIGINAL_BUILD_PINS["receipt.json"],
                "budget": policy, "sourceTreeSHA256": plan["candidateTreeSHA256"],
                "environment": previous_data["environment"], "argv": plan["argv"], "sharedLock": plan["sharedLock"],
                "publicNetwork": False, "productionRelease": False}
    if args.operation == "prepare":
        gate.require(not path.exists() and not ledger.exists(), "continuation-already-prepared")
        state = previous.cache_state(gate, body, guard)
        changes = previous.check_source(gate, body, guard, stage, lambda: None)
        body.dump_new(ledger, state)
        body.dump_new(path, {**expected, "ledgerSHA256": guard.sha(ledger),
                            "sourceMetadataChanges": changes,
                            "fileCounts": {name: len(files) for name, files in state["files"].items()}})
        print(json.dumps({"path": str(path), "SHA256": guard.sha(path),
                          "ledgerSHA256": guard.sha(ledger), "CargoStarted": False}))
        return 0
    body.require_hashes(guard, {path: args.continuation_plan_sha256})
    data = gate.read(path)
    gate.require(all(data[key] == value for key, value in expected.items()), "continuation-plan-drift")
    body.require_hashes(guard, {ledger: data["ledgerSHA256"]})
    state = gate.read(ledger)
    pin = args.continuation_plan_sha256
    terminal_data = {**previous_data, "environment": data["environment"],
                     "sourceMetadataChanges": data["sourceMetadataChanges"],
                     "originalBuildReceiptSHA256": data["originalBuildReceiptSHA256"]}
    if args.operation == "check":
        gate.require(previous.cache_state(gate, body, guard) == state, "continuation-cache-drift")
        gate.require(previous.check_source(gate, body, guard, stage, lambda: None) == data["sourceMetadataChanges"],
                     "continuation-source-drift")
        print(json.dumps({"state": "SAME_PATH_CONTINUITY_VERIFIED", "CargoStarted": False, "budget": policy}))
        return 0
    scoped_gate(gate)
    if args.operation == "verify":
        previous.verify(gate, body, guard, plan, stage, terminal_data, pin, args.build_receipt_sha256)
        return 0
    fd = body.take_shared_lock()
    try:
        return previous.build(gate, body, guard, plan, stage, terminal_data, state, pin)
    finally:
        import os
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
