#!/usr/bin/env python3
"""Actual Arti adapter start boundaries with an unlaunched in-memory Process."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[3] /
                        'native/Sources/YNXBrowserNative/PrivacyTorPlatform.swift')
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    original = args.source.read_bytes()
    text = original.decode()
    fixture = args.output / 'ActualManagedStartOwnership.swift'
    fixture.write_text('''import CryptoKit
import Darwin
import Foundation

enum TorPlatformError: Error {
    case alreadyRunning, invalidPin, binaryUnavailable, binaryMismatch
}

@MainActor final class ActualManagedStartOwnership {
    static let pinnedVersion = "2.7.0"
    struct BinaryPin {
        let executable: URL
        let binarySHA256: String
        let sourceArchiveSHA256: String
        let version: String
    }
    struct BridgeConfiguration { let transport: URL; func validateExecutable() throws {} }
    private var process: Process?
    private var publicPolicyFatalEnabled = true
    private var sharedStartCalls = 0
    static func configuration(port: UInt16, sessionDirectory: URL, deferBootstrap: Bool, bridge: BridgeConfiguration?) throws -> String { "" }
    func startVerifiedProcess(pin: BinaryPin, sessionDirectory: URL, deferBootstrap: Bool, config: String,
                              additionalArguments: [String], environment: [String: String], traceTransport: URL? = nil,
                              policyFatalEnabled: Bool = false) throws {
        sharedStartCalls += 1
        throw TorPlatformError.binaryUnavailable
    }
''' + segment(text, 'private func validateStartPin(') + '\n' + segment(text, 'func start(pin:') + '''
    func rejectStart(occupied: Bool) throws -> Bool {
        let original = Process()
        if occupied { process = original }
        let path = URL(fileURLWithPath: "/synthetic-not-executed")
        let invalid = BinaryPin(executable: path, binarySHA256: "", sourceArchiveSHA256: "", version: "2.7.0")
        var matchingRejection = false
        do { try start(pin: invalid, port: 19150, sessionDirectory: path) }
        catch TorPlatformError.alreadyRunning { matchingRejection = occupied }
        catch TorPlatformError.invalidPin { matchingRejection = !occupied }
        return matchingRejection && publicPolicyFatalEnabled && sharedStartCalls == 0
            && (occupied ? process === original : process == nil)
    }
}
@main struct ManagedStartOwnershipProbe {
    @MainActor static func main() {
        let occupied = try! ActualManagedStartOwnership().rejectStart(occupied: true)
        let invalid = try! ActualManagedStartOwnership().rejectStart(occupied: false)
        print("currentManagedPolicyPreserved=\\(occupied) invalidPinPreservedPolicy=\\(invalid)")
        exit(occupied && invalid ? 0 : 1)
    }
}
''')
    binary = args.output / 'probe'
    stages = []
    commands = [
        ('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target',
                     platform.machine() + '-apple-macosx14.0', '-DYNX_PRIVACY_ACCEPTANCE', '-j', '1',
                     '-module-cache-path', str(args.output / 'module-cache'), '-parse-as-library',
                     str(fixture), '-o', str(binary)], 20),
        ('actual', [str(binary)], 8),
    ]
    for name, command, budget in commands:
        with (args.output / (name + '.stdout')).open('xb') as stdout, (args.output / (name + '.stderr')).open('xb') as stderr:
            child = subprocess.Popen(command, stdout=stdout, stderr=stderr)
            timed_out = False
            try:
                code = child.wait(timeout=budget)
            except subprocess.TimeoutExpired:
                timed_out = True
                child.terminate()
                try:
                    code = child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    code = child.wait(timeout=2)
        stages.append(dict(name=name, pid=child.pid, exit=code, timeout=timed_out, reaped=True))
        if code or timed_out:
            break
    passed = len(stages) == 2 and code == 0 and not timed_out and args.source.read_bytes() == original
    result = dict(status='PASS' if passed else 'FAIL', stages=stages, sourceSHA256=hashlib.sha256(original).hexdigest(),
                  network='NOT_RUN', realBackend='NOT_RUN')
    (args.output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
