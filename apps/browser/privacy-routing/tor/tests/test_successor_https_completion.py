#!/usr/bin/env python3
"""Run the exact Snowflake QA request/observation callee without real network children."""

import argparse
import hashlib
import json
from pathlib import Path
import platform

from test_r2_https_completion import execute
from test_worker_ownership import segment


FIXTURE = r'''
import CryptoKit
import Darwin
import Foundation

enum TorPlatformError: Error { case unsafeSessionDirectory }
@MainActor final class Cancellation { var requested = false }
@MainActor final class SuccessorIndependentArti {
    enum State { case bootstrapReady, exited }
    var state = State.bootstrapReady
    func pollProcess() -> State { state }
}

@MainActor final class Process {
    static var starts = 0
    static var statusLine = ""
    static var body = Data()
    static var onRun: (() -> Void)?
    var executableURL: URL?
    var arguments: [String]?
    var environment: [String: String]?
    var standardInput: FileHandle?
    var standardOutput: FileHandle?
    var standardError: FileHandle?
    let processIdentifier: Int32 = 0
    let terminationStatus: Int32 = 0
    let terminationReason = Foundation.Process.TerminationReason.exit
    let isRunning = false
    func run() throws {
        let args = arguments!
        precondition(executableURL?.path == "/usr/bin/curl")
        precondition(args.contains("socks5h://127.0.0.1:63782"))
        precondition(args.contains("=https"))
        precondition(!args.contains("--insecure") && !args.contains("--location"))
        try standardOutput!.write(contentsOf: Data(Self.statusLine.utf8))
        try Self.body.write(to: URL(fileURLWithPath: args[args.firstIndex(of: "--output")! + 1]))
        Self.starts += 1
        Self.onRun?()
    }
    func terminate() { preconditionFailure("fixture process is already stopped") }
}

@main struct Probe {
    static let port = 63782
    static let https = "https://www.iana.org/domains/reserved"
    static let ddg = "https://html.duckduckgo.com/html/?q=YNX%20browser"
    @MainActor static var retainedCurl: Process?
    static func environment(profile: URL) -> [String: String] { [:] }
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let rawCaptcha = CommandLine.arguments.count == 3 ? try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
            : Data(#"<form id="challenge-form"></form><script src="anomaly.js"></script>"#.utf8)
        typealias Check = (name: String, status: String, body: Data, target: FixedTarget, website: String, transport: Bool, valid: Bool, cause: String?, starts: Int)
        let resultHTML = Data(#"<a class="result__a" href="https://example.org/">Test</a>"#.utf8)
        let cases: [Check] = [
            ("healthy-https", "200\n0\n", Data("site".utf8), .iana, "NOT_APPLICABLE", true, true, nil, 1),
            ("pre-cancel", "200\n0\n", resultHTML, .ddg, "UNREACHABLE", false, false, "callerCancelled", 0),
            ("pre-exit", "200\n0\n", resultHTML, .ddg, "UNREACHABLE", false, false, "routeFencedBeforeRequest", 0),
            ("late-cancel", "200\n0\n", resultHTML, .ddg, "UNREACHABLE", false, false, "callerCancelled", 1),
            ("late-exit", "200\n0\n", resultHTML, .ddg, "UNREACHABLE", false, false, "routeFencedDuringRequest", 1),
            ("unmarked-202", "202\n0\n", Data("accepted".utf8), .ddg, "HTTP_RESPONSE_UNCLASSIFIED", true, false, nil, 1),
            ("captcha-202", "202\n0\n", rawCaptcha, .ddg, "CAPTCHA", true, false, nil, 1),
            ("captcha-bad-tls", "202\n1\n", rawCaptcha, .ddg, "UNREACHABLE", false, false, nil, 1),
            ("ddg-refused", "403\n0\n", Data("refused".utf8), .ddg, "HTTP_REFUSED", true, false, nil, 1),
            ("ddg-result", "200\n0\n", resultHTML, .ddg, "RESULTS_OBSERVED", true, true, nil, 1),
        ]
        var record: [String: Bool] = [:]
        for check in cases {
            let output = root.appendingPathComponent(check.name, isDirectory: true)
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false)
            try Data("/synthetic-profile\n".utf8).write(to: output.appendingPathComponent("CLI-PROFILE-PATH.txt"))
            let adapter = SuccessorIndependentArti()
            let cancellation = Cancellation()
            if check.name == "pre-cancel" { cancellation.requested = true }
            if check.name == "pre-exit" { adapter.state = .exited }
            Process.onRun = {
                if check.name == "late-cancel" { cancellation.requested = true }
                if check.name == "late-exit" { adapter.state = .exited }
            }
            (Process.statusLine, Process.body) = (check.status, check.body)
            let starts = Process.starts
            let result = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation, target: check.target)
            let oldOutcomeWasCredited = check.name == "late-exit" && result["websiteState"] as? String == "RESULTS_OBSERVED"
            if oldOutcomeWasCredited { print("Original observation incorrectly credited a result after route exit.") }
            record[check.name] = result["websiteState"] as? String == check.website
                && result["transportObserved"] as? Bool == check.transport
                && result["validated"] as? Bool == check.valid
                && result["firstCause"] as? String == check.cause
                && Process.starts - starts == check.starts && retainedCurl == nil
        }
        print(String(decoding: try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]), as: UTF8.self))
        exit(record.values.allSatisfy { $0 } ? 0 : 1)
    }
__SOURCE__
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preserved-captcha-body", type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).with_name("SuccessorPublicQA.swift")
    raw = source.read_bytes()
    names = ("enum FixedTarget {", "@MainActor static func requestHTTPS(")
    declarations = [segment(raw.decode(), name) for name in names]
    probe = out / "Probe.swift"
    probe.write_text(FIXTURE.replace("__SOURCE__", "\n".join(declarations)))
    (out / source.name).write_bytes(raw)
    binary = out / "probe"
    events = {"compile": execute(["/usr/bin/xcrun", "swiftc", "-j", "1", "-swift-version", "6",
        "-target", f"{platform.machine()}-apple-macosx14.0", "-parse-as-library",
        "-module-cache-path", str(out / "module-cache"), str(probe), "-o", str(binary)], 30, out, "compile")}
    body = args.preserved_captcha_body.resolve(strict=True) if args.preserved_captcha_body else None
    if events["compile"]["originalWait"] == 0:
        argv = [str(binary), str(out)] + ([str(body)] if body else [])
        events["probe"] = execute(argv, 8, out, "probe")
    status = "PASS" if "probe" in events and events["probe"]["originalWait"] == 0 and source.read_bytes() == raw else "FAIL"
    (out / "RESULT.json").write_text(json.dumps({
        "status": status, "sourceSHA256": hashlib.sha256(raw).hexdigest(),
        "actualPreservedCaptchaBodySHA256": hashlib.sha256(body.read_bytes()).hexdigest() if body else None,
        "processes": events, "realCurl": "NOT_RUN", "realArti": "NOT_RUN", "network": "NOT_RUN",
    }, indent=2) + "\n")
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
