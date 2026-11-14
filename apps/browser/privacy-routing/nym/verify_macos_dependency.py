#!/usr/bin/env python3
"""Bounded real-binary CLI/startup negatives; no gateway registration or website request."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    binary = args.binary.resolve()
    actual = hashlib.sha256(binary.read_bytes()).hexdigest()
    if actual != args.sha256:
        raise SystemExit("Binary binding mismatch; not executed")
    client_id = "ynx-route-startup-negative-" + uuid.uuid4().hex
    profile = Path.home() / ".nym/socks5-clients" / client_id
    if profile.exists():
        raise SystemExit("Negative profile unexpectedly exists; preserved and not used")
    calls = [
        ("version", ["--version"]),
        ("init_help", ["init", "--help"]),
        ("run_help", ["run", "--help"]),
        ("missing_profile", ["run", "--id", client_id, "--host", "127.0.0.1", "--port", "1087", "--use-anonymous-replies", "true"]),
    ]
    results = {}
    for name, argv in calls:
        result = subprocess.run([str(binary)] + argv, env={"PATH": "/usr/bin:/bin", "RUST_LOG": "error", "NO_COLOR": "1"},
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=20)
        results[name] = {"argv": argv, "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    checks = {
        "pinnedVersion": results["version"]["exitCode"] == 0 and "1.1.88" in results["version"]["stdout"],
        "initSURBFlag": results["init_help"]["exitCode"] == 0 and "--use-reply-surbs" in results["init_help"]["stdout"],
        "runAnonymousFlag": results["run_help"]["exitCode"] == 0 and "--use-anonymous-replies" in results["run_help"]["stdout"],
        "missingProfileFails": results["missing_profile"]["exitCode"] != 0,
        "missingProfileNotCreated": not profile.exists(),
    }
    receipt = {"binary": str(binary), "binarySHA256": actual, "checks": checks, "calls": results,
               "class": "actual macOS dependency startup-negative only; no route connection, packet capture or browser admission"}
    args.output.write_text(json.dumps(receipt, indent=2) + "\n")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
