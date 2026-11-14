#!/usr/bin/env python3
"""Run only the actual Swift dispatcher in-flight evidence predicate with local DATA."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--download-evidence-only", action="store_true")
    args = parser.parse_args()
    out = args.output
    if not out.is_absolute():
        parser.error("--output must be a fresh absolute directory")
    out.mkdir(mode=0o700)
    here = Path(__file__).resolve().parent
    dispatcher = here.parents[2] / "native/Sources/YNXBrowserNative/ProtectedAcceptanceDispatcher.swift"
    page = dispatcher.with_name("RoutedBrowserPage.swift")
    source = page if args.download_evidence_only else dispatcher
    probe = here / ("native-download-evidence-probe.swift" if args.download_evidence_only else "native-inflight-probe.swift")
    sources = {path: path.read_bytes() for path in (source, probe, Path(__file__).resolve())}
    for path, contents in sources.items():
        (out / path.name).write_bytes(contents)
    text = sources[source].decode()
    if args.download_evidence_only:
        section = text[text.index("    private func recordAcceptanceDownloadFailure("):text.index("    #endif\n\n    init(")]
        section = """@MainActor final class AcceptanceDownloadEvidenceFixture {
    var acceptanceDownloads: [ObjectIdentifier: UUID] = [:]
    var acceptanceProgress: [ObjectIdentifier: NSObject] = [:]
    var acceptanceRecord: ((String, [String: String]) -> Void)?
    func retire(_ id: ObjectIdentifier) { recordAcceptanceDownloadFailure(id) }
""" + section + "}\n"
    else:
        section = text[text.index("enum ProtectedAcceptanceInFlightEvidence {"):text.index("/// Host partial ownership")]
    (out / "ActualInFlightEvidence.swift").write_text("import Foundation\n\n" + section)
    (out / "tmp").mkdir()
    receipt = {"schema": "P05_NATIVE_INFLIGHT_SWIFT_DELTA_V1",
               "inputs": {str(path): sha256(data).hexdigest() for path, data in sources.items()},
               "commands": [], "actualWebKitRoute": "NOT_RUN", "productionRouteAdmission": False}
    try:
        with tempfile.TemporaryDirectory(prefix="p05-swift-inflight-", dir="/tmp") as temporary:
            work = Path(temporary) / "output"
            work.symlink_to(out)
            env = dict(os.environ, TMPDIR=str(work / "tmp"))
            def run(label, argv, timeout):
                with subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env) as child:
                    row = {"step": label, "argv": argv, "pid": child.pid}
                    receipt["commands"].append(row)
                    try:
                        stdout, stderr = child.communicate(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        row["timedOut"] = True
                        child.kill()
                        stdout, stderr = child.communicate(timeout=5)
                    row.update(exit=child.returncode, reaped=True, pipeEOF=True)
                (out / (label + ".stdout")).write_bytes(stdout)
                (out / (label + ".stderr")).write_bytes(stderr)
                return stdout, row["exit"]

            sdk_bytes, sdk_exit = run("sdk", ["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"], 15)
            if sdk_exit != 0:
                raise SystemExit(sdk_exit)
            binary = work / "ProtectedAcceptanceInFlightProbe"
            _, compile_exit = run("compile", ["/usr/bin/xcrun", "swiftc", "-j", "1", "-parse-as-library",
                "-swift-version", "6", "-target", platform.machine() + "-apple-macosx14.0",
                "-sdk", sdk_bytes.decode().strip(), "-module-cache-path", str(work / "cache"),
                str(work / "ActualInFlightEvidence.swift"), str(work / probe.name), "-o", str(binary)], 45)
            if compile_exit != 0:
                raise SystemExit(compile_exit)
            data, probe_exit = run("probe", [str(binary)], 10)
            receipt["probe"] = json.loads(data) if data else None
            if probe_exit != 0:
                raise SystemExit(probe_exit)
            if args.download_evidence_only and receipt["probe"]["schema"] != "P05_SWIFT_DOWNLOAD_EVIDENCE_RETIRE_V1":
                raise RuntimeError("Incomplete actual download evidence regression")
            if not args.download_evidence_only and (len(receipt["probe"]["cases"]) != 15 or receipt["probe"]["failures"] != 0):
                raise RuntimeError("Incomplete actual in-flight regression")
    finally:
        receipt["sourceDrift"] = [str(path) for path, before in sources.items() if path.read_bytes() != before]
        (out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    if receipt["sourceDrift"]:
        raise RuntimeError("Input drift after source snapshot")
    print(out / "receipt.json")


if __name__ == "__main__":
    main()
