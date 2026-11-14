#!/usr/bin/env python3
"""Real recovery-binary negative tests using only new synthetic rejection fixtures."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

KEYS = ["private_identity.pem", "public_identity.pem", "private_encryption.pem", "public_encryption.pem", "ack_key.pem"]


def binding(directory):
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in KEYS if (directory / name).exists()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = []
    for case in ["missing-keys", "corrupt-keys", "existing-config"]:
        profile_id = "ynx-route-resume-reject-" + case + "-20261031"
        profile = Path.home() / ".nym/socks5-clients" / profile_id
        if profile.exists():
            raise SystemExit("Existing fixture retained; not overwritten: " + case)
        (profile / "config").mkdir(parents=True)
        (profile / "data").mkdir()
        if case == "corrupt-keys":
            for name in KEYS:
                (profile / "data" / name).write_bytes(b"PUBLIC INVALID KEY REJECTION FIXTURE\n")
        config = profile / "config/config.toml"
        if case == "existing-config":
            config.write_bytes(b"# PUBLIC EXISTING-CONFIG REJECTION FIXTURE, never loaded as a route\n")
        before_keys = binding(profile / "data")
        before_config = config.read_bytes() if config.exists() else None
        command = [str(args.binary), "init", "--resume-unconfigured", "--id", profile_id,
                   "--provider", args.provider, "--host", "127.0.0.1", "--port", "1087",
                   "--force-tls-gateway", "--use-reply-surbs", "true", "--enabled-credentials-mode", "false", "--output", "json"]
        result = subprocess.run(command, env={"PATH": "/usr/bin:/bin", "RUST_LOG": "error", "NO_COLOR": "1"},
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)
        after_config = config.read_bytes() if config.exists() else None
        results.append({"case": case, "exitCode": result.returncode,
                        "keysUnchanged": before_keys == binding(profile / "data"),
                        "configUnchanged": before_config == after_config,
                        "stderr": result.stderr, "class": "synthetic rejection fixture only"})
    args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps([{k: row[k] for k in ["case", "exitCode", "keysUnchanged", "configUnchanged"]} for row in results]))
    return 0 if all(row["exitCode"] != 0 and row["keysUnchanged"] and row["configUnchanged"] for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
