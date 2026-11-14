#!/usr/bin/env python3
"""Exercise the actual fixed-public HTTPS completion logic without launching curl or Arti."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import time

from test_worker_ownership import segment


FIXTURE = r'''
import CryptoKit
import Darwin
import Foundation

enum TorPlatformError: Error { case unsafeSessionDirectory }

@MainActor final class Cancellation { var requested = false }
@MainActor final class R2IndependentArti {
    enum State { case bootstrapReady, exited }
    var state = State.bootstrapReady
    let trace = Trace()
    func pollProcess() -> State { state }
}

struct Trace { func record(_ name: String, _ fields: [String: Any]) {} }

// The OS-facing seam completes before the first isRunning check, with
// deterministic HTTP 200/TLS 0 metadata. No real executable is spawned.
@MainActor final class Process {
    static var onRun: (() throws -> Void)?
    static var starts = 0
    var executableURL: URL?
    var arguments: [String]?
    var environment: [String: String]?
    var standardInput: FileHandle?
    var standardOutput: FileHandle?
    var standardError: FileHandle?
    let processIdentifier: Int32 = 0
    let isRunning = false
    let terminationStatus: Int32 = 0
    let terminationReason = Foundation.Process.TerminationReason.exit

    func run() throws {
        guard let arguments, let index = arguments.firstIndex(of: "--output"),
              let standardOutput else { fatalError("missing fixed curl arguments") }
        precondition(executableURL?.path == "/usr/bin/curl")
        precondition(arguments.contains("socks5h://127.0.0.1:63780"))
        precondition(arguments.last == R2Test.https)
        Self.starts += 1
        try Data("PUBLIC FIXTURE".utf8).write(to: URL(fileURLWithPath: arguments[index + 1]))
        try standardOutput.write(contentsOf: Data("200\n0\n".utf8))
        try Self.onRun?()
    }

    func terminate() { fatalError("fixture process already exited") }
}

@main struct R2Test {
    static let port = 63780
    static let https = "https://www.iana.org/domains/reserved"
    @MainActor static var retainedCurl: Process?
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let cases = CommandLine.arguments.contains("--legacy")
            ? ["healthy", "late-cancel", "late-exit"]
            : ["healthy", "pre-cancel", "pre-exit", "late-cancel", "late-exit"]
        var failed = false
        for name in cases {
            let output = root.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: false)
            let cancellation = Cancellation()
            let adapter = R2IndependentArti()
            let starts = Process.starts
            if name == "pre-cancel" { cancellation.requested = true }
            if name == "pre-exit" { adapter.state = .exited }
            Process.onRun = {
                if name == "late-cancel" { cancellation.requested = true }
                if name == "late-exit" { adapter.state = .exited }
            }
            let result = try await requestHTTPS(output: output, adapter: adapter, cancellation: cancellation)
            Process.onRun = nil
            let expectedStarts = name.hasPrefix("pre-") ? 0 : 1
            let expectedCause = ["pre-cancel": "callerCancelled", "pre-exit": "routeFencedBeforeRequest",
                                 "late-cancel": "callerCancelled", "late-exit": "routeFencedDuringRequest"][name]
            let valid = result["validated"] as? Bool
            let cause = result["firstCause"] as? String
            let passed = valid == (name == "healthy") && cause == expectedCause && retainedCurl == nil
                && Process.starts - starts == expectedStarts
            print("\(name): validated=\(String(describing: valid)) cause=\(cause ?? "none") starts=\(Process.starts - starts) passed=\(passed)")
            failed = failed || !passed
        }
        Darwin.exit(failed ? 1 : 0)
    }

__PRODUCTION__
}
'''


def execute(argv, time_limit, output, stage):
    started = time.monotonic()
    with (output / f'{stage}.stdout').open('xb') as stdout, (output / f'{stage}.stderr').open('xb') as stderr:
        proc = subprocess.Popen(argv, stdout=stdout, stderr=stderr, start_new_session=True)
        timed_out = False
        try:
            proc.wait(timeout=time_limit)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=2)
    return dict(argv=argv, pid=proc.pid, processGroup=proc.pid, originalWait=proc.returncode,
                reaped=proc.poll() is not None, timedOut=timed_out, seconds=time.monotonic() - started)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--legacy', action='store_true', help='run the same completion assertions against the original source')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    source = Path(__file__).with_name('R2AdjacentCLI.swift')
    original = source.read_bytes()
    text = original.decode()
    snippet = '\n'.join(segment(text, declaration) for declaration in (
        '@MainActor static func requestHTTPS(', 'static func httpsFailure('))
    (output / source.name).write_bytes(original)
    probe = output / 'R2HTTPSCompletionProbe.swift'
    probe.write_text(FIXTURE.replace('__PRODUCTION__', snippet))
    exe = output / 'r2-https-completion'
    events = {'compile': execute([
        '/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-j', '1',
        '-target', f'{platform.machine()}-apple-macosx14.0', '-parse-as-library',
        '-module-cache-path', str(output / 'module-cache'), str(probe), '-o', str(exe),
    ], 30, output, 'compile')}
    if events['compile']['originalWait'] == 0:
        argv = [str(exe), str(output)] + (['--legacy'] if args.legacy else [])
        events['probe'] = execute(argv, 8, output, 'probe')
    source_drift = source.read_bytes() != original
    failed = ('probe' not in events or source_drift
              or any(event['timedOut'] or event['originalWait'] != 0 for event in events.values()))
    result = dict(status='FAIL' if failed else 'PASS', events=events, sourceDrift=source_drift,
                  sourceSHA256=hashlib.sha256(original).hexdigest(), network='NOT_RUN', backend='NOT_RUN')
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
