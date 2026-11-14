#!/usr/bin/env python3
"""Check real owned loopback processes against the original filter policy without NE."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--listener-loss-only", action="store_true")
    scope.add_argument("--listener-generation-only", action="store_true")
    scope.add_argument("--tor-listener-generation-only", action="store_true")
    scope.add_argument("--existing-flow-revoke-only", action="store_true")
    scope.add_argument("--proof-flow-authorization-only", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(mode=0o700)
    out = args.output.resolve()
    tmp = args.output.absolute() / "tmp"
    tmp.mkdir(mode=0o700)
    env = dict(os.environ, TMPDIR=str(tmp))
    names = ("IdentityBridge.c", "IdentityBridge.h", "RunPolicy.swift", "ControlProtocol.swift",
             "ProtectionLease.swift", "RoutedEnrollment.swift", "BootstrapGraphPolicy.swift",
             "NymEntryBindingSelfTest.swift", "Provider.swift")

    def hashes():
        return {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in names}

    result = {"sources": hashes(), "steps": [], "kernelNECallback": "NOT_TESTED",
              "browserOrNymStarted": False, "networkScope": "owned local loopback only"}

    def run(label, command, seconds):
        row = {"label": label, "argv": command}
        result["steps"].append(row)
        with (out / f"{label}.stdout").open("wb") as stdout, (out / f"{label}.stderr").open("wb") as stderr:
            with subprocess.Popen(command, stdout=stdout, stderr=stderr, env=env, start_new_session=True) as child:
                row["pid"] = child.pid
                try:
                    child.wait(timeout=seconds)
                except subprocess.TimeoutExpired:
                    row["timeout"] = True
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
                row["exit"] = child.returncode
        if row["exit"]:
            raise SystemExit(row["exit"] if row["exit"] > 0 else 1)

    try:
        sdk = subprocess.check_output(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"],
                                      text=True, env=env, timeout=10).strip()
        bridge = out / "IdentityBridge.o"
        run("compile-identity", ["/usr/bin/xcrun", "clang", "-isysroot", sdk, "-mmacosx-version-min=15.0",
                                 "-Wno-deprecated-declarations", "-c", str(HERE / names[0]), "-o", str(bridge)], 30)
        executable = out / "NymEntryBindingSelfTest"
        run("compile-policy", ["/usr/bin/xcrun", "swiftc", "-j", "1", "-swift-version", "5", "-sdk", sdk,
                               "-target", f"{platform.machine()}-apple-macosx15.0", "-parse-as-library",
                               "-module-cache-path", str(out / "module-cache"), "-import-objc-header",
                               str(HERE / "IdentityBridge.h"), "-framework", "Security", "-lbsm",
                               *[str(HERE / name) for name in names[2:-1]], str(bridge), "-o", str(executable)], 60)
        options = [flag for flag, selected in (("--listener-loss-only", args.listener_loss_only),
                   ("--listener-generation-only", args.listener_generation_only),
                   ("--tor-listener-generation-only", args.tor_listener_generation_only),
                   ("--existing-flow-revoke-only", args.existing_flow_revoke_only),
                   ("--proof-flow-authorization-only", args.proof_flow_authorization_only)) if selected]
        run("owned-identity-policy", [str(executable), *options], 20)
    finally:
        result["sourceChanged"] = hashes() != result["sources"]
        (out / "receipt.json").write_text(json.dumps(result, indent=2) + "\n")
    if result["sourceChanged"]:
        raise RuntimeError("Filter source changed during the check")


if __name__ == "__main__":
    main()
