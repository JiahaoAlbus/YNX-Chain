#!/usr/bin/env python3
"""Build and exercise the affected Swift readers with owned local files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[1]
CORE = NATIVE / "Sources" / "YNXBrowserCore"
CANONICAL = NATIVE.parent / "privacy-routing/leak-tests/platform-probe/macos-filter"
OLD_SHA = "dfe2cf09c4b44b45d2c311cbf8e8b6c295e34dc8c887139402d3c873dfb9fb72"
READER = "enum NormalCaptureArtifactReader {"
DIGEST = "    static func digest(_ url:URL) throws -> String {"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def section(source, start, end):
    return source[source.index(start):source.index(end, source.index(start) + len(start))]


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected a single fixture anchor: {old}")
    return source.replace(old, new, 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--previous-source", type=Path)
    args = parser.parse_args()
    out = args.output
    if not out.is_absolute():
        raise ValueError("Fresh absolute output required")
    out.mkdir(mode=0o700)
    (out / "tmp").mkdir(mode=0o700)
    result = {
        "schema": "P05_ARTIFACT_DIGEST_DELTA_V1", "commands": [],
        "inputs": {}, "verifiedCases": [], "qualificationAcquired": False,
        "originalApproval": "NOT_SUPPLIED", "actualNEOrApp": "NOT_RUN",
    }

    def save():
        (out / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

    def read(path):
        data = path.read_bytes()
        result["inputs"][str(path)] = sha(data)
        return data.decode()

    try:
        capture = read(CORE / "NormalCaptureProtocol.swift")
        canonical = read(CANONICAL / "NormalCaptureProtocol.swift")
        qualification = read(CORE / "RoutedProductionQualification.swift")
        probe = read(HERE / "ArtifactDigestDeltaProbe.swift")
        if capture != canonical:
            raise ValueError("Standalone and Core readers differ")
        reader = capture[capture.index(READER):]
        capture_failure = section(capture, "public enum RoutedNormalCaptureFailure:", "/// A generation pin")
        qualification_failure = section(qualification, "public enum RoutedQualificationFailure:", "// DATA binding only.")
        digest_file = section(qualification, "    static func digestFile(", "\n}\n")

        # The ordinary and FIFO cases call the unchanged source bodies. For the
        # race cases, schedule one mutation after fstat and record the read sizes.
        scheduled = replace_once(reader, READER, "enum ScheduledArtifactReader {")
        scheduled = replace_once(scheduled, DIGEST,
                                 "    static func digest(_ url: URL, afterStat: () throws -> Void, beforeRead: (Int) -> Void) throws -> String {")
        scheduled = replace_once(scheduled, "        let file = FileHandle(", "        try afterStat()\n        let file = FileHandle(")
        scheduled = replace_once(scheduled, "            guard let chunk = try file.read", "            beforeRead(count)\n            guard let chunk = try file.read")
        scheduled = replace_once(scheduled, "        let extra = try file.read", "        beforeRead(1)\n        let extra = try file.read")
        wrapper = "enum RoutedQualificationIdentity {\n" + digest_file + "\n}\n"
        sources = ["import Foundation\nimport CryptoKit\nimport Security\nimport Darwin",
                   capture_failure, qualification_failure, reader, wrapper, scheduled]
        defines = []
        if args.previous_source:
            old = read(args.previous_source)
            if result["inputs"][str(args.previous_source)] != OLD_SHA:
                raise ValueError("Exact original capture reader required")
            sources.append(replace_once(old[old.index(READER):], READER, "enum OriginalArtifactReader {"))
            defines = ["-D", "P05_ORIGINAL_DIGEST"]
        (out / "ActualArtifactDigest.swift").write_text("\n".join(sources + [probe]))

        with tempfile.TemporaryDirectory(prefix="p05-artifact-", dir="/tmp") as temporary:
            alias = Path(temporary) / "external"
            alias.symlink_to(out)
            env = dict(os.environ, TMPDIR=str(alias / "tmp"))

            def run(command, label, timeout, expect_timeout=False):
                row = {"label": label, "argv": command}
                result["commands"].append(row)
                with subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      start_new_session=True) as child:
                    row["pid"] = child.pid
                    try:
                        stdout, stderr = child.communicate(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        row["timeout"] = True
                        try:
                            os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        stdout, stderr = child.communicate(timeout=5)
                    row.update(exit=child.returncode, originalReaped=child.returncode is not None, pipeEOF=True)
                (out / f"{label}.stdout").write_bytes(stdout)
                (out / f"{label}.stderr").write_bytes(stderr)
                save()
                if expect_timeout:
                    if not row.get("timeout") or stdout != b"ABOUT_TO_OPEN_ORIGINAL\n":
                        raise RuntimeError("Original FIFO block not reproduced")
                elif child.returncode or row.get("timeout"):
                    raise RuntimeError(f"{label} failed")
                return stdout.decode().strip()

            sdk = run(["/usr/bin/xcodebuild", "-version", "-sdk", "macosx", "Path"], "sdk", 15)
            swift = run(["/usr/bin/xcrun", "--find", "swiftc"], "swift", 15)
            executable = str(alias / "ArtifactDigestProbe")
            run([swift, "-j", "1", "-parse-as-library", "-swift-version", "6",
                 "-sdk", sdk, "-target", platform.machine() + "-apple-macosx14.0",
                 "-module-cache-path", str(alias / "cache"), *defines,
                 str(alias / "ActualArtifactDigest.swift"), "-o", executable], "compile", 40)
            data = bytes(range(256)) * 280
            artifact = alias / "artifact"
            artifact.write_bytes(data)
            run([executable, "regular", str(artifact), sha(data)], "regular", 5)
            result["verifiedCases"].append("unchanged file matches independent SHA-256 via both production callees")
            fifo = alias / "substitute"
            os.mkfifo(fifo, 0o600)
            fifo.replace(artifact)
            if args.previous_source:
                run([executable, "old-fifo", str(artifact)], "original-fifo", 1.5, expect_timeout=True)
                result["verifiedCases"].append("exact original source blocks on no-writer FIFO after entry")
            run([executable, "fifo", str(artifact)], "fifo", 5)
            result["verifiedCases"].append("both fixed callees reject no-writer FIFO replacement")
            artifact.unlink()
            artifact.write_bytes(data)
            run([executable, "growth", str(artifact), str(len(data))], "growth", 5)
            result["verifiedCases"].append("scheduled growth rejected with exactly one extra byte requested")
            artifact.write_bytes(data)
            fifo.write_bytes(data)
            run([executable, "replacement", str(artifact), str(len(data)), str(fifo)], "replacement", 5)
            result["verifiedCases"].append("scheduled same-content inode replacement rejected")
        result["sourceDrift"] = {path: sha(Path(path).read_bytes()) for path, expected in result["inputs"].items()
                                 if sha(Path(path).read_bytes()) != expected}
        if result["sourceDrift"]:
            raise RuntimeError("Input source drift")
    except Exception as error:
        result["firstFailure"] = str(error)
        raise
    finally:
        save()
    print(json.dumps({"receipt": str(out / "receipt.json"), "verifiedCases": len(result["verifiedCases"])}))


if __name__ == "__main__":
    main()
