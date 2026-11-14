#!/usr/bin/env python3
"""Real fresh-domain CFPreferences writer/exit/independent-reader delta; no UI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


def reconcile(directory):
    """Read-only classification of preserved v4 receipts, never a new runtime PASS."""
    directory = directory.resolve()
    original = json.loads((directory / "RESULT.json").read_text())
    plan = json.loads((directory / "plan.json").read_text())
    owner = str(uuid.UUID(plan["owner"]))
    if uuid.UUID(owner).version != 4 or plan["suite"] != "com.ynx.browser.p05-cold-session." + owner:
        raise RuntimeError("Unowned reconciliation plan")
    events = {event["stage"]: event for event in original["processes"]}
    receipts = {}
    required = ["fresh", "writer", "reader-initial", "clear-writer", "reader-empty", "explicit-writer", "reader-new", "cleanup"]
    for name in required:
        raw = json.loads((directory / (name + ".stdout")).read_bytes())
        saved = json.loads((directory / "receipts" / (name + ".json")).read_text())
        event = events[name]
        if raw != saved or raw.get("status") != "PASS" or raw.get("pid") != event["pid"]:
            raise RuntimeError("Missing/mismatched actual original receipt: " + name)
        if event["returncode"] != 0 or event["timeout"] or not event["reaped"]:
            raise RuntimeError("Original official API process failed: " + name)
        if raw.get("suite") != plan["suite"] or raw.get("owner") != owner or raw.get("uid") != os.getuid():
            raise RuntimeError("Original fixture identity mismatch: " + name)
        receipts[name] = raw
    fresh = receipts["fresh"]
    if not fresh.get("exactDomainAbsent") or not fresh.get("exactDiskFileAbsent"):
        raise RuntimeError("Original domain freshness was not proven")
    for writer, reader, ids in [("writer", "reader-initial", [plan["firstTabID"], plan["homeTabID"]]),
                                ("clear-writer", "reader-empty", []),
                                ("explicit-writer", "reader-new", [plan["newTabID"], plan["homeTabID"]])]:
        w, r = receipts[writer], receipts[reader]
        raw = (directory / "observations" / (reader + "-tabs.json")).read_bytes()
        tabs = json.loads(raw)
        if w["tabsSHA256"] != r["tabsSHA256"] or hashlib.sha256(raw).hexdigest() != r["tabsSHA256"]:
            raise RuntimeError("Same original tabs key bytes did not survive writer exit")
        if r["restoredCount"] != len(ids) or r["tabIDs"] != [i.upper() for i in ids]:
            raise RuntimeError("Original independent restore 2/0/2 mismatch")
        if any(t.get("isPrivate") or t["id"].lower() == plan["secretTabID"].lower() for t in tabs):
            raise RuntimeError("Private data entered persisted session")
        if not r.get("CFPreferencesEqualsUserDefaults"):
            raise RuntimeError("Original official stores disagree")
    cleanup = receipts["cleanup"]
    if cleanup.get("remainingOwnKeys") != [] or not cleanup.get("userDefaultsSynchronize") or not cleanup.get("CFPreferencesAppSynchronize"):
        raise RuntimeError("Official cleanup did not empty the owned domain")
    # The preserved failed tail is allowed only for the private-file clock observation.
    failed = json.loads((directory / "cleanup-verify.stdout").read_bytes())
    failed_event = events["cleanup-verify"]
    if failed.get("error") != "diskMismatch" or failed.get("pid") != failed_event["pid"] or failed_event["timeout"] or not failed_event["reaped"]:
        raise RuntimeError("Original failure is not the isolated physical observation")
    later = json.loads((directory / "cleanup-recheck.stdout").read_bytes())
    later_event = json.loads((directory / "CLEANUP-RECHECK.json").read_text())
    if later.get("status") != "PASS" or not later.get("ownedDomainAbsent") or later.get("pid") != later_event["pid"] or later_event["returncode"] != 0 or not later_event["reaped"] or later_event["timeout"]:
        raise RuntimeError("No actual later independent official empty-domain confirmation")
    if later.get("suite") != plan["suite"] or later.get("owner") != owner or later.get("uid") != os.getuid():
        raise RuntimeError("Late cleanup proof fixture mismatch")
    if len(set(e["pid"] for e in events.values())) != len(events):
        raise RuntimeError("Original process identities were not independent")
    result = {"schema": "YNX_BROWSER_COLD_SESSION_OFFLINE_RECONCILIATION_V1", "officialAPIFunctionalStatus": "PASS",
              "kind": "offline reconciliation of actual preserved v4; NOT a new runtime exit0",
              "originalWholeRunStatus": original["status"], "originalFirstCause": original["firstCause"],
              "originalResultSHA256": hashlib.sha256((directory / "RESULT.json").read_bytes()).hexdigest(),
              "physicalObservations": {"threeReaderTabsPlists": "PASS", "cleanupAt10s": "UNKNOWN/NOT_PASS", "cleanupLater": "SETTLED_LATE"},
              "allOriginalAndRecheckProcessesReaped": True, "officialReaderCounts": [2, 0, 2],
              "classificationDriverSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "newProfileOrProcessStarted": False, "GUI": "NOT_RUN", "powerLossDurability": "NOT_RUN", "secureErase": "NOT_RUN"}
    target = directory / "API-RECONCILIATION.json"
    with target.open("x") as f:
        json.dump(result, f, indent=2); f.write("\n")
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path, nargs="?", help="new managed scratch directory")
    parser.add_argument("--reconcile", type=Path, help="read-only classify preserved v4 evidence; no new profile/process")
    args = parser.parse_args()
    if args.reconcile:
        if args.output:
            parser.error("output and --reconcile are mutually exclusive")
        reconcile(args.reconcile)
        return
    if not args.output:
        parser.error("new output directory or --reconcile is required")
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    (output / "receipts").mkdir(mode=0o700)
    (output / "observations").mkdir(mode=0o700)
    browser = Path(__file__).resolve().parents[3]
    sources = [browser / "native/Sources/YNXBrowserCore/BrowserSession.swift",
               browser / "native/Sources/YNXBrowserCore/Omnibox.swift",
               Path(__file__).with_name("Probe.swift").resolve()]
    inputs, copied = {}, []
    for source in sources:
        data = source.read_bytes()
        target = output / source.name
        target.write_bytes(data)
        copied.append(str(target))
        inputs[str(source.relative_to(browser))] = hashlib.sha256(data).hexdigest()
    (output / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")
    owner = str(uuid.uuid4())
    suite = "com.ynx.browser.p05-cold-session." + owner
    assert re.fullmatch(r"com\.ynx\.browser\.p05-cold-session\.[a-f0-9-]{36}", suite)
    plan = {"owner": owner, "suite": suite, "firstTabID": str(uuid.uuid4()), "homeTabID": str(uuid.uuid4()),
            "secretTabID": str(uuid.uuid4()), "newTabID": str(uuid.uuid4())}
    plan_path = output / "plan.json"
    with plan_path.open("x") as f:
        json.dump(plan, f, indent=2)
    os.chmod(plan_path, 0o600)
    compile_command = ["/usr/bin/xcrun", "swiftc", "-swift-version", "6", "-target", "arm64-apple-macosx14.0",
                       "-j", "1", "-module-cache-path", str(output / "module-cache"), "-parse-as-library"] + copied + ["-o", str(output / "cold-probe")]
    (output / "compile-command.json").write_text(json.dumps(compile_command, indent=2) + "\n")
    with (output / "compile.log").open("wb") as log:
        compiled = subprocess.run(compile_command, stdout=log, stderr=subprocess.STDOUT)
    if compiled.returncode:
        print((output / "compile.log").read_text())
        raise SystemExit(compiled.returncode)
    for source in sources:
        if hashlib.sha256(source.read_bytes()).hexdigest() != inputs[str(source.relative_to(browser))]:
            raise RuntimeError("Actual source drift after snapshot: " + str(source))
    events = []
    fresh_proven = False
    failure = None

    def stage(name):
        command = [str(output / "cold-probe"), name, str(plan_path)]
        started = time.monotonic()
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            timed_out = True
            process.terminate()  # Only this exact owned probe handle; preserve UNKNOWN writes.
            try:
                stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate(timeout=2)
        (output / (name + ".stdout")).write_bytes(stdout)
        (output / (name + ".stderr")).write_bytes(stderr)
        event = {"stage": name, "pid": process.pid, "returncode": process.returncode,
                 "timeout": timed_out, "reaped": process.poll() is not None, "seconds": round(time.monotonic() - started, 4), "command": command}
        events.append(event)
        (output / "processes.json").write_text(json.dumps(events, indent=2) + "\n")
        try:
            receipt = json.loads(stdout)
        except (ValueError, UnicodeError):
            raise RuntimeError(name + " produced no complete receipt; first process evidence preserved")
        (output / "receipts" / (name + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
        if timed_out or process.returncode != 0 or receipt.get("status") != "PASS" or receipt.get("pid") != process.pid:
            raise RuntimeError(name + " failed/UNKNOWN: " + str(receipt))
        if receipt.get("suite") != suite or receipt.get("owner") != owner or receipt.get("uid") != os.getuid():
            raise RuntimeError("Receipt binding mismatch")
        return receipt

    try:
        fresh = stage("fresh")
        if not fresh.get("exactDomainAbsent") or not fresh.get("exactDiskFileAbsent"):
            raise RuntimeError("Fresh suite not proven; never delete/reuse")
        fresh_proven = True
        initial_writer = stage("writer")
        initial_reader = stage("reader-initial")
        clear_writer = stage("clear-writer")
        empty_reader = stage("reader-empty")
        new_writer = stage("explicit-writer")
        new_reader = stage("reader-new")
        if len({item["pid"] for item in events}) != len(events):
            raise RuntimeError("Independent process identities not distinct")
        for writer, reader, expected_count in [(initial_writer, initial_reader, 2), (clear_writer, empty_reader, 0), (new_writer, new_reader, 2)]:
            if writer["tabsSHA256"] != reader["tabsSHA256"] or reader["restoredCount"] != expected_count:
                raise RuntimeError("Independent cold reader differs from synchronized writer")
        if initial_reader["tabIDs"] != [plan["firstTabID"].upper(), plan["homeTabID"].upper()] or new_reader["tabIDs"] != [plan["newTabID"].upper(), plan["homeTabID"].upper()]:
            raise RuntimeError("Original A/home or explicit new/home restore mismatch")
    except Exception as error:
        failure = str(error)
    finally:
        # Only a domain independently proven absent is eligible. The Swift cleanup also
        # requires its exact nonce marker and refuses any foreign/unknown keys. No direct
        # preference-file removal, cfprefsd reset or other suite cleanup is permitted.
        cleanup = None
        if fresh_proven:
            try:
                cleanup_writer = stage("cleanup")
                cleanup = stage("cleanup-verify")
                cleanup["writerPID"] = cleanup_writer["pid"]
            except Exception as error:
                if failure is None:
                    failure = "cleanup UNKNOWN: " + str(error)
        result = {"schema": "YNX_PUBLIC_COLD_SESSION_MULTIPROCESS_V1", "status": "FAIL" if failure else "PASS",
                  "firstCause": failure, "suite": suite, "owner": owner, "freshProven": fresh_proven,
                  "processes": events, "ownedCleanup": cleanup, "officialAPIFunctionalStatus": "FAIL" if failure else "PASS",
                  "physicalPlistObservationPolicy": "independent <=10s observation, UNKNOWN never implies immediate flush/power-loss/secure-erase",
                  "physicalPlistObservations": {name: json.loads((output / "receipts" / (name + ".json")).read_text()).get("physicalPlistObservation", "PENDING") for name in ["reader-initial", "reader-empty", "reader-new", "cleanup-verify"] if (output / "receipts" / (name + ".json")).exists()},
                  "GUI": "NOT_RUN", "network": "NOT_RUN",
                  "RootSourceGrant": "NOT_RUN", "old25And4GroupsRepeated": False,
                  "qualification": "official API functional gate: actual fresh independent UserDefaults/CFPreferences 2/0/2, same tabs key/private exclusion and empty owned cleanup; physical plist is a separate observation; no GUI/power-loss/secure-erase claim"}
        (output / "RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if failure else 0)


if __name__ == "__main__":
    main()
