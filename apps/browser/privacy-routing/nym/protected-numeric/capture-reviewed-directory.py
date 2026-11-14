#!/usr/bin/env python3
"""Owned normal-validator QA capture used by fetch-reviewed-directory.mjs."""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "directory-progress"))
from normal_directory_capture import DirectoryCaptureError, MAX_BODY, summarize_terminal

BASE = Path("/REDACTED_VOLUME/YNX-large-work")
P05 = BASE / "coordination-v5-20261031/owners/P05/privacy-routing"
SUPPLY = P05 / "supply/nym/protected-numeric-overlay"
GUARD_PATH = P05 / "nym-qa-cdn-fullfeature-20261108/run_fullfeature_v4.py"
GUARD_SHA = "b66d0f7e39649885d38281ad44edec5720e2105dff87f052309779653414cb05"
SCOPE_KEYS = {"schema", "binarySHA256", "notBefore", "latestStart"}
LIMITS = {"stdout": MAX_BODY + 1, "stderr": 524_288}
VALIDATOR = {"purpose": "directoryHTTPS", "scheme": "https", "host": "validator.nymtech.net",
             "port": 443, "addresses": ["92.39.63.14"]}
RPC = {"purpose": "chainRPC", "scheme": "https", "host": "rpc.nymtech.net", "port": 443,
       "addresses": ["194.182.169.49", "91.92.200.116", "2a04:c43:e00:6f28:400:d8ff:fe00:1483",
                     "2a04:c46:e00:6f28:4b3:68ff:fe00:460"]}


def sha(path):
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_guard():
    if sha(GUARD_PATH) != GUARD_SHA:
        raise RuntimeError("directory-owner-guard-pin")
    spec = importlib.util.spec_from_file_location("frozen_directory_owner", GUARD_PATH)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    return guard


def load_network_fingerprint():
    path = P05.parent / "r2-20261107/nym/r2_executor.py"
    if sha(path) != "330470c332d4cea28d7593c6fb787262b76342196f42c4d0e1db3ad734b0af67":
        raise RuntimeError("directory-network-observer-pin")
    spec = importlib.util.spec_from_file_location("frozen_network_fingerprint", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.network_fingerprint


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=True, separators=(",", ":"))
        stream.write("\n")


def process_capture(guard, case, argv, env, expires, deadline_ns, *, before_launch=lambda: None,
                    before_publish=lambda: None, require_owner=lambda: None, binding=None):
    """Keep the original child and actual pipe endpoints through wait and cleanup."""
    began = time.monotonic()
    owner = guard.Build({"requestedLimitsNotYetGranted": {"aggregateSeconds": 1800,
                         "cleanupReserveSeconds": 15}}, case, began)
    data = {stream: bytearray() for stream in LIMITS}
    eof = set()
    cancelled = []
    child = None
    complete_eof = False
    first = cleanup_failure = summary = descriptions = None
    published = None
    remaining = []
    selectors_owner = selectors.DefaultSelector()

    def live():
        if cancelled:
            raise DirectoryCaptureError("directory-cancelled")
        if time.monotonic_ns() >= deadline_ns or datetime.now(timezone.utc) >= expires:
            raise DirectoryCaptureError("directory-capture-expired")
        require_owner()

    def cancel(signum, _frame):
        cancelled.append(signum)

    def owned_rows():
        try:
            return owner.owned()
        except RuntimeError as error:
            # A fast original child may exit at the first process census. Only
            # that exact transition permits a fresh read of the same group.
            transient = {"Owned original process observation is UNKNOWN",
                         f"Owned process group has no live original identity anchor: {child.pid}"}
            if str(error) not in transient or child.poll() is None:
                raise
            return owner.owned()

    start = case / "capture-start.json"
    write_new(start, {"controllerPID": os.getpid(), "startedUTC": datetime.now(timezone.utc).isoformat()})
    receipt = case / "operation.json"
    handlers = {sig: signal.signal(sig, cancel) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        live()
        before_launch()
        live()
        child = subprocess.Popen(argv, env=env, cwd=case, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        owner.children.append(child)
        owner.groups.add(child.pid)
        record = {"name": "normal-validator-directory", "pid": child.pid, "pgid": child.pid,
                  "utc": guard.utc(), "monotonicStarted": time.monotonic()}
        owner.child_records[child] = record
        owner.steps.append(record)
        write_new(case / "child-start.json", record)
        for name, pipe in (("stdout", child.stdout), ("stderr", child.stderr)):
            os.set_blocking(pipe.fileno(), False)
            selectors_owner.register(pipe, selectors.EVENT_READ, name)

        next_owner_check = began
        while child.poll() is None or len(eof) != 2:
            live()
            now = time.monotonic()
            if now >= next_owner_check:
                if sum(row["rss"] for row in owned_rows()) > guard.GIB:
                    raise DirectoryCaptureError("directory-resource-limit")
                next_owner_check = now + 1
            for key, _ in selectors_owner.select(.05):
                name = key.data
                try:
                    chunk = os.read(key.fd, 65_536)
                except BlockingIOError:
                    continue
                if not chunk:
                    selectors_owner.unregister(key.fileobj)
                    key.fileobj.close()
                    eof.add(name)
                elif len(data[name]) + len(chunk) > LIMITS[name]:
                    raise DirectoryCaptureError("directory-output-limit-" + name)
                else:
                    data[name].extend(chunk)

        live()
        code = child.wait()
        complete_eof = eof == {"stderr", "stdout"} and child.stdout.closed and child.stderr.closed
        if code != 0:
            raise DirectoryCaptureError("directory-original-exit-" + str(code))
        if owner.owned():
            raise DirectoryCaptureError("directory-owned-descendants-remain")

    except DirectoryCaptureError as error:
        first = str(error)
    except Exception as error:
        first = "directory-supervisor-" + type(error).__name__
    finally:
        # Close read ends before cleanup so a writer blocked on overflow can
        # receive EPIPE as well as the original owner's cancellation signal.
        selectors_owner.close()
        if child is not None:
            child.stdout.close()
            child.stderr.close()
        try:
            remaining = owner.cleanup()
        except Exception as error:
            remaining = [{"state": "UNKNOWN", "recordedGroups": sorted(owner.groups)}]
            cleanup_failure = type(error).__name__
        if first is None and not remaining and cleanup_failure is None and not owner.child_outcome_recording_failure:
            try:
                before_publish()
                live()
                raw = bytes(data["stdout"])
                result = summarize_terminal(
                    raw, process=owner.steps[0], stdout_eof="stdout" in eof, stderr_eof="stderr" in eof,
                    fds_closed=complete_eof, supervisor_live=not cancelled,
                    observed_utc=datetime.now(timezone.utc), expires_utc=expires,
                    now_monotonic_ns=time.monotonic_ns(), deadline_monotonic_ns=deadline_ns)
                tables = json.loads(raw)
                staging = case / "private-tables"
                staging.mkdir(mode=0o700)
                descriptions = {}
                for name in ("basic", "described", "epoch"):
                    path = staging / (name + ".json")
                    write_new(path, tables[name])
                    descriptions[name] = sha(path)
                live()
                published = staging.rename(case / "tables")
                summary = result.receipt_data()
            except DirectoryCaptureError as error:
                first = str(error)
            except Exception as error:
                first = "directory-publication-" + type(error).__name__
        if (remaining or cleanup_failure or owner.child_outcome_recording_failure) and first is None:
            first = "directory-cleanup-unconfirmed"
        if summary is not None:
            try:
                live()
            except DirectoryCaptureError as error:
                first = first or str(error)
                summary = None
        if published is not None and summary is None:
            try:
                # Keep the original captured bytes private for reconciliation.
                # A failed operation must leave nothing at the consumer path.
                published.rename(case / "withheld-tables")
            except OSError as error:
                cleanup_failure = cleanup_failure or "directory-retire-export-" + type(error).__name__
        result = {
            "schema": "P05_NYM_NORMAL_DIRECTORY_OWNED_CAPTURE_V1",
            "state": "fetched" if summary is not None else "failed",
            "out": str(case / "tables") if summary is not None else None,
            "summary": summary, "sha256": descriptions if summary is not None else None,
            "firstFailure": first, "cleanupFailure": cleanup_failure,
            "childOutcomeRecordingFailure": owner.child_outcome_recording_failure,
            "capturedEOF": sorted(eof), "completeEOFBeforeCleanup": complete_eof,
            "capturedLengths": {name: len(value) for name, value in data.items()},
            "processes": owner.steps, "remainingOwned": remaining, "signals": cancelled,
            "productionQualification": False,
        }
        if binding is not None:
            result.update(binding, expiresAt=int(expires.timestamp()))
        anchor = start
        try:
            write_new(receipt, result)
            anchor = receipt
        finally:
            try:
                if remaining:
                    owner.custody(anchor, cancelled)
            finally:
                for sig, handler in handlers.items():
                    signal.signal(sig, handler)
    return result


def checked_scope(path, digest, binary):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC), "rb") as stream:
        st = os.fstat(stream.fileno())
        if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid()
                or stat.S_IMODE(st.st_mode) != 0o600 or not 0 < st.st_size <= 4096):
            raise RuntimeError("directory-scope-file")
        raw = stream.read(4097)
        named = path.lstat()
        if len(raw) != st.st_size or (st.st_dev, st.st_ino, st.st_mode, st.st_nlink, st.st_mtime_ns, st.st_ctime_ns) != (
                named.st_dev, named.st_ino, named.st_mode, named.st_nlink, named.st_mtime_ns, named.st_ctime_ns):
            raise RuntimeError("directory-scope-replaced")
    if hashlib.sha256(raw).hexdigest() != digest:
        raise RuntimeError("directory-scope-pin")
    scope = json.loads(raw)
    now = time.time()
    if (not isinstance(scope, dict) or set(scope) != SCOPE_KEYS
            or scope["schema"] != "P05_NYM_NORMAL_VALIDATOR_DIRECTORY_QA_V1"
            or type(scope["notBefore"]) is not int or type(scope["latestStart"]) is not int
            or not 0 < scope["latestStart"] - scope["notBefore"] <= 900
            or not scope["notBefore"] <= now < scope["latestStart"]
            or binary.is_symlink() or not binary.is_file() or sha(binary) != scope["binarySHA256"]):
        raise RuntimeError("directory-scope-or-artifact")
    return scope


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--scope", type=Path, required=True)
    parser.add_argument("--scope-sha256", required=True)
    args = parser.parse_args()
    if (not args.binary.is_absolute() or not args.scope.is_absolute()
            or not re.fullmatch(r"[0-9a-f]{64}", args.scope_sha256)):
        raise SystemExit("directory-required-binary-and-scope-pins")
    scope = checked_scope(args.scope, args.scope_sha256, args.binary)
    guard = load_guard()
    if (guard.free(guard.HOME_VOLUME_PATH) < int(2.25 * guard.GIB)
            or guard.free(SUPPLY) < 16 * guard.GIB or guard.memory() < 35):
        raise SystemExit("directory-fresh-resource-floor")
    subprocess.run(["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", str(args.binary)],
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, check=True, timeout=5)
    observe_network = load_network_fingerprint()
    network = observe_network()
    if not all(component["exit"] == 0 for component in network["components"].values()):
        raise SystemExit("directory-network-state-unavailable")
    # CAS claim is scoped to this reviewed document hash and survives failure/cancellation.
    case = SUPPLY / ("normal-directory-once-" + args.scope_sha256)
    case.mkdir(mode=0o700)
    empty = case / "empty-home"
    empty.mkdir(mode=0o700)
    tmp = case / "tmp"
    tmp.mkdir(mode=0o700)
    run_id = "directory-" + uuid4().hex
    issued = int(time.time())
    expires = datetime.fromtimestamp(issued + 110, timezone.utc)
    policy = case / "policy.json"
    write_new(policy, {"schema": "YNX_NYM_REVIEWED_NETWORK_V1", "runID": run_id,
                       "stage": "directory-bootstrap", "issuedAt": issued, "expiresAt": issued + 110,
                       "networkDefaultsSHA256": "596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b",
                       "endpoints": [VALIDATOR, RPC]})
    policy_sha = sha(policy)
    argv = [str(args.binary), "--no-banner", "--ynx-reviewed-network", str(policy),
            "--ynx-reviewed-network-sha256", policy_sha, "--ynx-reviewed-run-id", run_id, "ynx-reviewed-directory"]
    env = {key: os.environ[key] for key in ("HOME", "LANG", "TZ") if key in os.environ}
    env.update(PATH="/usr/bin:/bin", NYM_HOME_DIR=str(empty), TMPDIR=str(tmp) + "/", NO_COLOR="1")
    parent = os.getppid()
    next_check = time.monotonic()

    def require_owner():
        nonlocal next_check
        if os.getppid() != parent:
            raise DirectoryCaptureError("directory-cancelled")
        now = time.monotonic()
        if now >= next_check:
            next_check = now + 5
            observed = observe_network()
            if (observed["fingerprintSHA256"] != network["fingerprintSHA256"]
                    or not all(component["exit"] == 0 for component in observed["components"].values())):
                raise DirectoryCaptureError("directory-network-state-changed")

    def before_launch():
        checked_scope(args.scope, args.scope_sha256, args.binary)

    def before_publish():
        if sha(args.binary) != scope["binarySHA256"] or sha(policy) != policy_sha or any(empty.iterdir()):
            raise DirectoryCaptureError("directory-artifact-policy-or-profile")
        observed = observe_network()
        if observed["fingerprintSHA256"] != network["fingerprintSHA256"]:
            raise DirectoryCaptureError("directory-network-state-changed")

    # The historical CLI has 95 seconds of work, including EOF capture. The
    # policy's absolute socket deadline remains a separate stricter bound if reached.
    deadline_ns = time.monotonic_ns() + 95_000_000_000
    result = process_capture(guard, case, argv, env, expires, deadline_ns,
                             before_launch=before_launch, before_publish=before_publish,
                             require_owner=require_owner,
                             binding={"scopeSHA256": args.scope_sha256, "binarySHA256": scope["binarySHA256"]})
    print(json.dumps({"out": result["out"], "state": result["state"],
                      "firstFailure": result["firstFailure"], "receipt": str(case / "operation.json"),
                      "receiptSHA256": sha(case / "operation.json")}))
    return int(result["summary"] is None)


if __name__ == "__main__":
    raise SystemExit(main())
