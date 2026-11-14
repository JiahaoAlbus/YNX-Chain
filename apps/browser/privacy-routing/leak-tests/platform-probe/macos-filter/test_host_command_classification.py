#!/usr/bin/env python3
"""Exercise Host preference and callback classification without contacting the NE manager."""

import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import subprocess


HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700)
    output = args.output.resolve()
    source = HERE / "HostMain.swift"
    probe = HERE / "HostCommandClassificationProbe.swift"
    policy = HERE / "RunPolicy.swift"
    source_files = (source, probe, policy, Path(__file__))
    inputs = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in source_files}
    host = source.read_text()
    read_start = host.index("private func privateData(")
    read_end = host.index("private func digest(", read_start)
    start = host.index("enum ReviewedFilterHostEvidence {")
    end = host.index("private final class Activation", start)
    policy_text = policy.read_text()
    error_start = policy_text.index("enum FilterFailure:")
    error_end = policy_text.index("extension Data", error_start)
    classifier = output / "ReviewedFilterHostEvidence.swift"
    classifier.write_text(
        "import Foundation\nimport NetworkExtension\nimport SystemExtensions\nimport Darwin\n\n"
        + policy_text[error_start:error_end]
        + host[read_start:read_end]
        + host[start:end]
        + "func readManifestFixture(_ path: String) throws -> Data { try privateData(path, limit: 131072) }\n"
    )
    temporary = args.output.absolute() / "tmp"
    temporary.mkdir(mode=0o700)
    env = dict(os.environ, TMPDIR=str(temporary))
    sdk = subprocess.check_output(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"],
                                  env=env, text=True, timeout=15).strip()
    binary = output / "HostCommandClassificationProbe"
    command = ["/usr/bin/xcrun", "swiftc", "-j", "1", "-sdk", sdk, "-swift-version", "5", "-parse-as-library",
               "-target", f"{platform.machine()}-apple-macosx15.0", "-module-cache-path", str(output / "module-cache"),
               str(classifier), str(probe), "-o", str(binary)]
    receipt = {
        "sourceSHA256": inputs,
        "scope": "Extracted Host classifier, reviewed file reader, and public Apple SDK data types",
        "systemExtensionRequestSubmitted": False,
        "networkExtensionPreferencesAccessed": False,
        "networkIsolationAcceptance": "NOT_TESTED",
        "compileCommand": command,
    }
    try:
        for stage, args, timeout in (("compile", command, 60), ("classify", [str(binary)], 15)):
            with (output / f"{stage}.stdout").open("wb") as stdout, (output / f"{stage}.stderr").open("wb") as stderr:
                completed = subprocess.run(args, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
            receipt[f"{stage}Exit"] = completed.returncode
            if completed.returncode:
                return completed.returncode if completed.returncode > 0 else 1
        fixtures = output / "fixtures"
        fixtures.mkdir(mode=0o700)
        valid = fixtures / "valid.json"
        valid.write_bytes(b"x" * 131072)
        oversized = fixtures / "oversized.json"
        oversized.write_bytes(b"x" * 131073)
        pipe = fixtures / "no-writer.fifo"
        os.mkfifo(pipe, mode=0o600)
        symlink = fixtures / "symlink.json"
        symlink.symlink_to(valid)
        cases = (
            ("limit", valid, 0, b"131072"),
            ("oversized", oversized, 78, b"regular non-writable file"),
            ("fifo", pipe, 78, b"regular non-writable file"),
            ("symlink", symlink, 78, b"Review open failed"),
        )
        receipt["reviewCases"] = {}
        for name, path, expected_exit, expected_output in cases:
            case = subprocess.run([str(binary), "--read-manifest-fixture", str(path)], env=env,
                                  capture_output=True, timeout=3)
            (output / f"review-{name}.stdout").write_bytes(case.stdout)
            (output / f"review-{name}.stderr").write_bytes(case.stderr)
            match = case.returncode == expected_exit and expected_output in case.stdout and not case.stderr
            receipt["reviewCases"][name] = {"exit": case.returncode, "pass": match}
            if not match:
                return 1
        if any(hashlib.sha256(file.read_bytes()).hexdigest() != inputs[file.name] for file in source_files):
            raise RuntimeError("Host classification source changed during verification")
        return 0
    except subprocess.TimeoutExpired as failure:
        receipt["timeoutCommand"] = failure.cmd
        return 1
    finally:
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
