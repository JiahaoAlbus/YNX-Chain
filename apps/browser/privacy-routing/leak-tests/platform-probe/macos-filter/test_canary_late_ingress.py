#!/usr/bin/env python3
"""Exercise the exact canary readback and socket owner with controlled loopback traffic."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
CORE = HERE.parents[3] / "native/Sources/YNXBrowserCore"
AUTHORITY = "SyntheticTrialAuthority.swift"
PROBE = HERE / "SyntheticCanaryLateIngressProbe.swift"
SHELL = """
@MainActor final class CanaryObservationFixture {
    let transport = CanaryStatusFixture()
    let request: SyntheticCanaryRequest
    private let sockets: [OwnedSyntheticCanarySocket]
    private let expectedProviderSHA256 = String(repeating: "b", count: 64)
    var currentRequest: SyntheticCanaryRequest? { request }
    var binding: SyntheticTrialBinding { request.binding }
    let withdrawal = FailureObserver()

    init() throws {
        sockets = try ["127.0.0.1", "::1"].map {
            try OwnedSyntheticCanarySocket(host: $0, transport: IPPROTO_UDP)
        }
        let pin = String(repeating: "a", count: 64)
        let binding = SyntheticTrialBinding(mode: .tor, runID: "loopback-only", epoch: UUID().uuidString,
            profileID: "synthetic-loopback-only", profileSHA256: pin, providerGeneration: UUID().uuidString,
            rootAuditTokenSHA256: pin, manifestSHA256: pin, bootstrapSHA256: pin, executableSHA256: pin)
        request = SyntheticCanaryRequest(schema: "P05_SYNTHETIC_CANARY_ARM_V1", nonce: UUID().uuidString,
            stage: "self", binding: binding, targets: sockets.map(\\.target))
    }
    func schedule(host: String?, afterDeadline: Bool) {
        let sender = sockets.first { $0.target.host == host }
        transport.beforeReturning = {
            if afterDeadline { try await Task.sleep(for: .milliseconds(8100)) }
            if let sender {
                try sender.sendSelf()
                try await Task.sleep(for: .milliseconds(20))
            }
        }
    }
    func verify(binding: SyntheticTrialBinding) throws {
        guard binding == self.binding else { throw SyntheticTrialFailure.bindingMismatch }
    }
    func check() async throws { try await verifyCanary(stage: "self") }
    func close() { for socket in sockets { socket.close() } }
    final class FailureObserver {
        private(set) var failure: (any Error)?
        func withdraw(_ reason: any Error) { if failure == nil { failure = reason } }
    }
"""


def between(source, start, end):
    return source[source.index(start):source.index(end, source.index(start) + len(start))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    out = args.output
    if not out.is_absolute():
        parser.error("Fresh absolute evidence directory required")
    out.mkdir(mode=0o700)
    mode_source = CORE / "ProtectionLease.swift"
    paths = [CORE / AUTHORITY, HERE / AUTHORITY, HERE / "SyntheticCanaryProtocol.swift", mode_source, PROBE, Path(__file__).resolve()]
    inputs = {path: path.read_bytes() for path in paths}
    if inputs[paths[0]] != inputs[paths[1]]:
        raise ValueError("Canonical and Core authority differ")
    for path, contents in inputs.items():
        name = ("canonical-" + path.name) if path == paths[1] else path.name
        (out / name).write_bytes(contents)
    text = inputs[paths[0]].decode()
    verify = between(text, "    private func verifyCanary(", "\n}\n\n@MainActor private final class OwnedSyntheticCanarySocket")
    socket = between(text, "@MainActor private final class OwnedSyntheticCanarySocket", "@MainActor private final class SyntheticCanaryTransport")
    protocol = inputs[paths[2]].decode()
    mode_file = inputs[mode_source].decode()
    mode_start = mode_file.index("public enum RoutedIsolationMode:")
    mode = mode_file[mode_start:mode_file.index("\n}", mode_start) + 2] + "\n"
    binding = between(protocol, "public struct SyntheticTrialBinding:", "public struct SyntheticTrialScope:")
    types = between(protocol, "public enum SyntheticTrialFailure:", "#endif")
    (out / "ActualCanaryReadback.swift").write_text(
        "import Foundation\nimport Darwin\n" + mode + binding + types + socket + SHELL + verify + "\n}\n"
    )
    (out / "tmp").mkdir(mode=0o700)
    receipt = {"schema": "P05_CANARY_LATE_INGRESS_DELTA_V1",
               "inputs": {str(path): sha256(data).hexdigest() for path, data in inputs.items()},
               "commands": [], "actualSignedXPCAndNE": "NOT_RUN", "productionRouteAdmission": False}
    try:
        with tempfile.TemporaryDirectory(prefix="p05-canary-await-", dir="/tmp") as alias_dir:
            build = Path(alias_dir) / "evidence"
            build.symlink_to(out)
            env = dict(os.environ, TMPDIR=str(build / "tmp"))

            def run(label, command, timeout):
                with subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
                    row = {"step": label, "argv": command, "pid": child.pid}
                    receipt["commands"].append(row)
                    try:
                        stdout, stderr = child.communicate(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        row["timedOut"] = True
                        child.kill()
                        stdout, stderr = child.communicate(timeout=5)
                    row.update(exit=child.returncode, reaped=True, pipeEOF=True)
                (out / f"{label}.stdout").write_bytes(stdout)
                (out / f"{label}.stderr").write_bytes(stderr)
                return stdout, row["exit"]

            sdk, status = run("sdk", ["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"], 15)
            if status != 0:
                raise SystemExit(status)
            binary = build / "CanaryLateIngressProbe"
            _, status = run("compile", ["/usr/bin/xcrun", "swiftc", "-j", "1", "-parse-as-library", "-swift-version", "6",
                "-target", platform.machine() + "-apple-macosx14.0", "-sdk", sdk.decode().strip(),
                "-module-cache-path", str(build / "cache"), str(build / "ActualCanaryReadback.swift"),
                str(build / PROBE.name), "-o", str(binary)], 45)
            if status != 0:
                raise SystemExit(status)
            stdout, status = run("probe", [str(binary)], 18)
            receipt["probe"] = json.loads(stdout) if stdout else None
            if status != 0:
                raise SystemExit(status)
            if len(receipt["probe"]["checks"]) != 4 or receipt["probe"]["failures"] != 0:
                raise RuntimeError("Incomplete actual readback evidence")
    finally:
        receipt["sourceDrift"] = [str(path) for path, data in inputs.items() if path.read_bytes() != data]
        (out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    if receipt["sourceDrift"]:
        raise RuntimeError("Input changed after evidence snapshot")
    print(out / "receipt.json")


if __name__ == "__main__":
    main()
