#!/usr/bin/env python3
"""Compile only the two actual acceptance input readers, then exercise owned files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[2] / "native/Sources/YNXBrowserNative"


def declaration(text, marker):
    start = text.index("\n" + marker) + 1
    lines = text[start:].splitlines(keepends=True)
    first = lines[0]
    closing = first[:len(first) - len(first.lstrip())] + "}"
    end = next(i for i, line in enumerate(lines[1:], 1) if line.rstrip() == closing)
    return "".join(lines[:end + 1])


def write(contents, path):
    path.write_text(contents)
    path.chmod(0o600)


def run(argv, output, label, timeout):
    with (output / (label + ".stdout")).open("xb") as stdout, (output / (label + ".stderr")).open("xb") as stderr:
        with subprocess.Popen(argv, stdout=stdout, stderr=stderr, start_new_session=True) as child:
            try:
                child.wait(timeout=timeout)
                timed_out = False
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                timed_out = True
            return {"pid": child.pid, "exit": child.returncode, "timedOut": timed_out}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--native", type=Path, default=NATIVE)
    parser.add_argument("--baseline-fifo-only", action="store_true")
    parser.add_argument("--directory-only", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700)
    sources = [args.native / "ProtectedAcceptanceConsumer.swift", args.native / "ProtectedAcceptanceDispatcher.swift",
               HERE / "native-private-input-probe.swift"]
    def hashes():
        return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    original = hashes()
    consumer, dispatcher = [p.read_text() for p in sources[:2]]
    input_type = declaration(consumer, "    struct Input {")
    reader = "" if args.baseline_fifo_only else declaration(consumer, "enum ProtectedAcceptancePrivateInput {")
    failure = next(row for row in consumer.splitlines() if row.startswith("enum ProtectedAcceptanceFailure:"))
    private_read = declaration(dispatcher, "    private static func readPrivate(")
    owner_state = ""
    if "in directory: ProtectedAcceptancePrivateInput.Directory" in private_read:
        owner_state = "    private static var heldDirectory: ProtectedAcceptancePrivateInput.Directory?\n"
        call = """let directory = try (sameDirectory ? heldDirectory : nil) ?? ProtectedAcceptancePrivateInput.Directory(containing: url)
        if sameDirectory { heldDirectory = directory }
        return try readPrivate(url, in: directory, maximum: maximum, atomicCommand: command)"""
    else:
        call = "readPrivate(url, maximum: maximum)" if args.baseline_fifo_only else "readPrivate(url, maximum: maximum, atomicCommand: command)"
    extracted = output / "ActualPrivateInput.swift"
    extracted.write_text(f"""import Foundation
import Darwin
import CryptoKit
{failure}
{reader}
@MainActor enum ProtectedAcceptanceConsumer {{
{input_type}
}}
enum ProtectedAcceptanceDispatchFailure: Error {{ case invalidLaunch }}
@MainActor enum ProtectedAcceptanceDispatcher {{
{private_read}
{owner_state}    static func probePrivate(_ url: URL, maximum: Int, command: Bool, sameDirectory: Bool) throws -> Data {{
        {call if owner_state else 'return try ' + call}
    }}
}}
""")
    cases = (
        "consumer-fifo", "dispatcher-launch-fifo", "dispatcher-command-fifo", "consumer-bootstrap-fifo",
        "consumer-valid", "consumer-oversized", "dispatcher-oversized", "dispatcher-symlink",
        "dispatcher-hardlink", "dispatcher-replace", "dispatcher-raced-replace", "dispatcher-raced-growth", "dispatcher-directory-replace",
    )
    if args.baseline_fifo_only:
        cases = cases[:3]
    if args.directory_only:
        cases = ("dispatcher-directory-replace", "dispatcher-replace")
    count = len(cases)
    rc = run(["/usr/bin/xcrun", "swiftc", "-j", "1", "-swift-version", "6", "-parse-as-library", "-target",
              platform.machine() + "-apple-macosx14.0", "-module-cache-path", str(output / "cache"),
              str(extracted), str(sources[-1]), "-o", str(output / "probe")], output, "compile", 45)
    result = {"sourceInputs": original, "compile": rc, "runtime": {}, "baselineFIFODiagnostic": args.baseline_fifo_only,
              "wholeNativeAppOrSignedNE": "NOT_TESTED"}
    if rc["exit"] == 0:
        runid = "native-input-bounds"
        origin = ["https://a.leak.test", "https://b.leak.test"]
        manifest = {"schema": "P05_PUBLIC_NONCE_FIXTURE_V1", "runID": runid,
                    "publicFixture": {"nonce": runid, "origins": origin}, "origins": origin,
                    "acceptance": {"schema": "P05_INFLIGHT_ACCEPTANCE_FLOWS_V1",
                                   "paths": {k: f"/ynx-route-probe/{runid}/{k}" for k in
                                             ("streamDownload", "longWss", "sameOriginRedirect", "crossOriginRedirect", "downgradeRedirect")}}}
        for case in cases:
            directory = output / case
            directory.mkdir(mode=0o700)
            write("<html></html>", directory / "bootstrap.html")
            write(json.dumps(manifest), directory / "manifest.json")
            command = directory / "command.json"
            if case.endswith("-fifo"):
                leaf = directory / ("bootstrap.html" if case == "consumer-bootstrap-fifo" else
                                    "manifest.json" if case == "consumer-fifo" else "command.json")
                if leaf.exists():
                    leaf.unlink()
                os.mkfifo(leaf, 0o600)
            elif case == "consumer-oversized":
                (directory / "manifest.json").write_bytes(b"x" * 65537)
            elif case == "dispatcher-oversized":
                write("x" * 4097, command)
            elif case in ("dispatcher-hardlink", "dispatcher-symlink"):
                original_file = directory / "command.original"
                write("old command", original_file)
                if case.endswith("hardlink"):
                    os.link(original_file, command)
                else:
                    command.symlink_to(original_file)
            elif case in ("dispatcher-replace", "dispatcher-raced-replace", "dispatcher-raced-growth"):
                write("old command", command)
                if case != "dispatcher-replace":
                    write("raced new command", directory / "before-read")
            elif case == "dispatcher-directory-replace":
                write("old command", command)
                replacement = directory.with_suffix(".replacement")
                replacement.mkdir(mode=0o700)
                write("replacement directory command", replacement / "command.json")
            result["runtime"][case] = run([str(output / "probe"), case, str(directory)], output, case, 1.5)
    result["sourceDrift"] = hashes() != original
    passed = rc["exit"] == 0 and len(result["runtime"]) == count and all(
        row["exit"] == 0 and not row["timedOut"] for row in result["runtime"].values()) and not result["sourceDrift"]
    result["status"] = "PASS" if passed else "FAIL"
    (output / "receipt.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "receipt": str(output / "receipt.json")}))
    return int(not passed)


if __name__ == "__main__":
    raise SystemExit(main())
