#!/usr/bin/env python3
"""One explicitly identified free official bootstrap/cancel operation. Never overwrites a profile."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import signal
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--operation-root", type=Path, required=True)
    parser.add_argument("--cancel-after", type=float)
    args = parser.parse_args()
    if not re.fullmatch(r"ynx-route-[a-z0-9-]{1,64}", args.profile_id):
        raise SystemExit("Invalid controlled profile ID")
    if hashlib.sha256(args.binary.read_bytes()).hexdigest() != args.sha256:
        raise SystemExit("Pinned binary mismatch")
    profile = Path.home() / ".nym/socks5-clients" / args.profile_id
    if profile.exists() or args.operation_root.exists():
        raise SystemExit("Original operation/profile already exists; reconcile rather than replace keys")
    args.operation_root.mkdir(parents=True, exist_ok=False)
    command = [str(args.binary), "init", "--id", args.profile_id, "--provider", args.provider,
               "--host", "127.0.0.1", "--port", "1087", "--force-tls-gateway",
               "--use-reply-surbs", "true", "--enabled-credentials-mode", "false", "--output", "json"]
    receipt = {"command": command, "profile": str(profile), "binarySHA256": args.sha256,
               "state": "starting", "credentialsMode": False, "targetWebsiteRequests": "none",
               "class": "explicit synthetic free bootstrap/cancel operation, not installed Browser or Mixnet readiness",
               "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    result_file = args.operation_root / "operation.json"
    result_file.write_text(json.dumps(receipt, indent=2) + "\n")
    started = time.monotonic()
    with (args.operation_root / "stdout.log").open("wb") as out, (args.operation_root / "stderr.log").open("wb") as err:
        child = subprocess.Popen(command, cwd=args.operation_root,
                                 env={"PATH": "/usr/bin:/bin", "RUST_LOG": "error", "NO_COLOR": "1"},
                                 stdin=subprocess.DEVNULL, stdout=out, stderr=err)
        receipt.update(pid=child.pid, state="running")
        result_file.write_text(json.dumps(receipt, indent=2) + "\n")
        try:
            receipt["exitCode"] = child.wait(timeout=args.cancel_after if args.cancel_after is not None else 120)
            receipt["state"] = "completed" if receipt["exitCode"] == 0 else "failed"
            if args.cancel_after is not None:
                receipt["cancelExercised"] = False
        except subprocess.TimeoutExpired:
            child.send_signal(signal.SIGINT)
            try:
                receipt["exitCode"] = child.wait(timeout=12)
                receipt["termination"] = "SIGINT (official graceful shutdown)"
            except subprocess.TimeoutExpired:
                child.kill()
                receipt["exitCode"] = child.wait(timeout=5)
                receipt["termination"] = "SIGKILL"
            receipt.update(state="cancelled_original_profile_retained_reconcile_before_retry", cancelExercised=True)
    receipt.update(elapsedSeconds=time.monotonic() - started, processReaped=child.poll() is not None,
                   profileExists=profile.exists(), configExists=(profile / "config/config.toml").exists())
    # No keys are read, copied, removed, or regenerated; a cancelled registration is not replayed.
    result_file.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: receipt.get(key) for key in ["state", "exitCode", "elapsedSeconds", "cancelExercised", "processReaped", "profileExists", "configExists"]}))
    return 0 if receipt.get("cancelExercised") and receipt["processReaped"] else (0 if receipt["state"] == "completed" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
