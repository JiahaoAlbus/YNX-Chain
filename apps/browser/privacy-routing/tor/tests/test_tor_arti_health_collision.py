#!/usr/bin/env python3
"""Exercise the production Tor status across a delayed PT poll without starting a backend."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--expect-legacy-collision', action='store_true')
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).resolve().parents[3] / 'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift'
    raw = source.read_bytes()
    text = raw.decode()
    helpers = [] if args.expect_legacy_collision else [
        segment(text, 'private func pollArtiHealth('),
        segment(text, 'private func requireArtiHealth('),
    ]
    fixture = out / 'ActualArtiHealthStatus.swift'
    fixture.write_text('''import Foundation

enum PrivacyRouteStatus: Equatable { case connecting, connected, blocked(String) }
enum LeasePhase { case blocked, routeEntryConnected }
struct Lease { let phase: LeasePhase }

@MainActor final class BrowserRouteProtection {
    var bootstrapControlLease: Lease { get throws { Lease(phase: .routeEntryConnected) } }
}
struct BackendProcessExit: Sendable {
    let pid: Int32, code: Int32?, signal: Int32?, childReaped: Bool
}
@MainActor final class OwnedBackendStartGate {
    var cleanupChildPID: Int32? = 123
    var outputDiscardAcknowledgement: Int? = 1
    var observedExit: BackendProcessExit?
    var isRunning = true
    var pollError: (any Error)?
    func poll() async throws -> BackendProcessExit? {
        if let pollError { throw pollError }
        return observedExit
    }
}
@MainActor final class PT {
    enum State { case protocolAvailable }
    var outputDiscardAcknowledgement: Int? = 1
    var continuation: CheckedContinuation<Void, Never>?
    func poll(onFailure: @MainActor (Error) -> Void) async throws -> State {
        await withCheckedContinuation { continuation = $0 }
        return .protocolAvailable
    }
    func finish() { continuation?.resume(); continuation = nil }
}

enum RoutedQualificationFailure: Error {
    case signingNotConfigured, wrongMode, invalidSignature, helperNotBound, qualificationIssuerNotSupplied
    case installationChanged, expired, revoked, closed
}
enum TorTransportFailure: Error {
    case startupTimedOut, processExited, protocolRejected, outputLimit, protectionUnavailable, alreadyRunning, unsafeState, invalidBridgePeer
}
enum ProtectionLeaseFailure: Error { case systemSleep }
enum PrivacyRouteError: Error { case invalidEndpoint, blocked, stale, unsafeTarget }
''' + segment(text, 'enum TorCoordinatorFailure:') + '''
@MainActor final class ActualProvider {
    enum Phase { case backendReady, connected, starting, blocked }
    var generation = UUID(), phase = Phase.connected
    var protection: BrowserRouteProtection? = BrowserRouteProtection()
    var artiGate: OwnedBackendStartGate? = OwnedBackendStartGate()
    let transport = PT()
    var firstFailure: TorCoordinatorFailure?
    func fenceObservedStatusFailure(_ error: Error, expected: UUID) {
        guard generation == expected else { return }
        firstFailure = firstFailure ?? TorCoordinatorFailure.classify(error)
        generation = UUID(); phase = .blocked
    }
''' + segment(text, 'func status() async -> PrivacyRouteStatus') + '\n' + '\n'.join(helpers) + '''
}

@main struct Probe {
    @MainActor static func suspendedStatus(_ owner: ActualProvider) async throws -> Task<PrivacyRouteStatus, Never> {
        let task = Task { @MainActor in await owner.status() }
        let limit = ContinuousClock.now.advanced(by: .seconds(2))
        while owner.transport.continuation == nil {
            if ContinuousClock.now >= limit { throw NSError(domain: "PT not polled", code: 1) }
            try await Task.sleep(for: .milliseconds(1))
        }
        return task
    }
    @MainActor static func main() async throws {
        let legacy = CommandLine.arguments.contains("--legacy")
        let exits: [(BackendProcessExit?, Bool, String?)] = [
            (.init(pid: 123, code: 0, signal: nil, childReaped: true), false, "processExited"),
            (.init(pid: 123, code: 1, signal: nil, childReaped: true), false, "artiExitNonzero"),
            (.init(pid: 123, code: nil, signal: 9, childReaped: true), false, "artiTerminatedBySignal"),
            (.init(pid: 123, code: 0, signal: nil, childReaped: false), false, "artiHealthUnconfirmed"),
            (.init(pid: 124, code: 0, signal: nil, childReaped: true), false, "artiHealthUnconfirmed"),
            (.init(pid: 123, code: 0, signal: 9, childReaped: true), false, "artiHealthUnconfirmed"),
            (nil, false, "artiHealthUnconfirmed"),
            (nil, true, nil),
        ]
        for (exit, live, failure) in legacy ? Array(exits.prefix(1)) : exits {
            let owner = ActualProvider()
            let task = try await suspendedStatus(owner)
            owner.artiGate!.observedExit = exit
            owner.artiGate!.isRunning = live
            owner.transport.finish()
            let status = await task.value
            if legacy {
                guard status == .connected, owner.firstFailure == nil else { exitWith(1) }
                print("Observed original late-exit HEALTHY collision")
                return
            }
            guard status == (failure.map(PrivacyRouteStatus.blocked) ?? .connected),
                owner.firstFailure?.rawValue == failure else { exitWith(1) }
        }
        let owner = ActualProvider()
        owner.artiGate!.observedExit = .init(pid: 123, code: nil, signal: 15, childReaped: true)
        owner.artiGate!.pollError = NSError(domain: "synthetic", code: 1)
        guard await owner.status() == .blocked("artiTerminatedBySignal") else { exitWith(1) }
        let missing = ActualProvider()
        missing.artiGate!.pollError = NSError(domain: "synthetic", code: 1)
        guard await missing.status() == .blocked("artiHealthUnconfirmed") else { exitWith(1) }
        let stale = ActualProvider()
        let task = try await suspendedStatus(stale)
        stale.generation = UUID()
        stale.transport.finish()
        guard await task.value != .connected, stale.phase == .connected,
            stale.firstFailure == nil else { exitWith(1) }
        print("11 Arti health/exit collision controls PASS")
    }
    static func exitWith(_ code: Int32) -> Never { Foundation.exit(code) }
}
''')
    binary = out / 'probe'
    commands = [
        ('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target',
                     platform.machine() + '-apple-macosx14.0', '-j', '1', '-parse-as-library',
                     '-module-cache-path', str(out / 'module-cache'), str(fixture), '-o', str(binary)], 30),
        ('actual', [str(binary)] + (['--legacy'] if args.expect_legacy_collision else []), 6),
    ]
    stages = []
    for name, argv, budget in commands:
        with (out / (name + '.stdout')).open('xb') as stdout, (out / (name + '.stderr')).open('xb') as stderr:
            child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
            try:
                code = child.wait(timeout=budget)
            except subprocess.TimeoutExpired:
                child.kill()
                code = child.wait(timeout=2)
        stages.append(dict(name=name, argv=argv, pid=child.pid, exit=code, reaped=True))
        if code:
            break
    passed = len(stages) == 2 and code == 0 and source.read_bytes() == raw
    status = ('LEGACY_COLLISION_OBSERVED' if args.expect_legacy_collision else 'PASS') if passed else 'FAIL'
    result = dict(status=status, stages=stages, sourceSHA256=hashlib.sha256(raw).hexdigest(),
                  realBackend='NOT_RUN', network='NOT_RUN')
    (out / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(status, [(stage['pid'], stage['exit']) for stage in stages])
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
