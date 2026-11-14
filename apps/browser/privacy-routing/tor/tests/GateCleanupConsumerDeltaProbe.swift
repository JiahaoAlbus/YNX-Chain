import Foundation
import Darwin

// PUBLIC synthetic values only; none is a process/Root/NE receipt.
struct PublicPrepared { let pid: Int32 }
struct PublicExit { let pid: Int32; let childReaped: Bool }
enum PublicFailure: Error { case pollFailed, cleanupUnconfirmed, originalFirstCause }
@MainActor final class PublicGate {
    var prepared: PublicPrepared? = .init(pid: 4242)
    var cleanupChildPID: Int32? = 4242 // Cleanup-only identity, never a resume/graph permit.
    var exit: PublicExit? = .init(pid: 4242, childReaped: true)
    var cleanupConfirmed = true
    var throwsOnPoll = false
    var afterPoll: (@MainActor () -> Void)?
    func stop() async {}
    func poll() async throws -> PublicExit? {
        await Task.yield()
        afterPoll?()
        if throwsOnPoll { throw PublicFailure.pollFailed }
        return exit
    }
}
@MainActor final class PublicTransport {
    enum Cleanup { case notStarted, reaped, unconfirmed }
    var cleanupStatus: Cleanup = .reaped
    func stop() async {}
}

@MainActor class PublicLock {
    var ownershipFD: Int32 = -1
    let path: URL
    init(root: URL) throws {
        path = root.appendingPathComponent("PUBLIC-cleanup-" + UUID().uuidString)
        ownershipFD = open(path.path, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard ownershipFD >= 0, flock(ownershipFD, LOCK_EX | LOCK_NB) == 0 else { throw PublicFailure.pollFailed }
    }
    func isHeld() throws -> Bool {
        let second = open(path.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard second >= 0 else { throw PublicFailure.pollFailed }; defer { close(second) }
        if flock(second, LOCK_EX | LOCK_NB) == 0 { _ = flock(second, LOCK_UN); return false }
        guard errno == EWOULDBLOCK || errno == EAGAIN else { throw PublicFailure.pollFailed }
        return true
    }
    func dispose() {
        if ownershipFD >= 0 { _ = flock(ownershipFD, LOCK_UN); close(ownershipFD); ownershipFD = -1 }
        try? FileManager.default.removeItem(at: path)
    }
}

// Generated source adds the actual two production stop method bodies to these
// fixtures. The test judges OS lock/owner postconditions, not a copied predicate.
@main struct GateCleanupConsumerDeltaProbe {
    @MainActor static func earlyCancel(root: URL) async throws -> Int {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        func check(_ condition: Bool) throws {
            guard condition else { throw NSError(domain: "TorGateConsumerDelta.early-cancel", code: checks) }
            checks += 1
        }
        // Same helper's authenticated post-exec frame may bind cleanupChildPID even
        // when cancelled preparation never creates a graph/resume identity.
        for mode in ["arti", "pt"] {
            for edge in ["confirmed", "missing-pid", "missing-exit", "wrong-pid"] {
                let gate = PublicGate(); gate.prepared = nil
                if edge == "missing-pid" { gate.cleanupChildPID = nil }
                if edge == "missing-exit" { gate.exit = nil }
                if edge == "wrong-pid" { gate.cleanupChildPID = 999 }
                if mode == "arti" {
                    let fixture = try ActualArtiStopConsumer(root: root, gate: gate)
                    defer { fixture.dispose() }
                    await fixture.stop()
                    try check(try fixture.isHeld() == (edge != "confirmed"))
                    try check(gate.prepared == nil && (fixture.artiGate == nil) == (edge == "confirmed"))
                } else {
                    let fixture = try ActualPTStopConsumer(root: root, gate: gate)
                    defer { fixture.dispose() }
                    await fixture.stop()
                    try check(try fixture.isHeld() == (edge != "confirmed"))
                    try check(gate.prepared == nil && (fixture.gate == nil) == (edge == "confirmed"))
                }
            }
        }
        return checks
    }
    @MainActor static func run(root: URL) async throws -> Int {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        func check(_ value: Bool, _ label: String) throws {
            guard value else { throw NSError(domain: "TorGateConsumerDelta." + label, code: 1) }
            checks += 1
        }
        for consumer in ["arti", "pt"] {
            for failure in ["pipes-pending", "wrong-pid", "not-reaped", "missing-exit", "poll-error", "late-pipe-loss"] {
                let gate = PublicGate()
                switch failure {
                case "pipes-pending": gate.cleanupConfirmed = false
                case "wrong-pid": gate.exit = .init(pid: 999, childReaped: true)
                case "not-reaped": gate.exit = .init(pid: 4242, childReaped: false)
                case "missing-exit": gate.exit = nil
                case "poll-error": gate.throwsOnPoll = true
                default: gate.afterPoll = { gate.cleanupConfirmed = false }
                }
                if consumer == "arti" {
                    let fixture = try ActualArtiStopConsumer(root: root, gate: gate)
                    defer { fixture.dispose() }
                    fixture.firstFailure = .originalFirstCause
                    await fixture.stop()
                    try check(try fixture.isHeld() && fixture.artiGate === gate && fixture.cleanupStatus == .unconfirmed,
                              consumer + failure + "-retains-original")
                    try check(fixture.firstFailure == .originalFirstCause, "first-cause-not-overwritten")
                    gate.afterPoll = nil; gate.cleanupConfirmed = true; gate.throwsOnPoll = false
                    gate.exit = .init(pid: 4242, childReaped: true)
                    await fixture.stop()
                    try check(try !fixture.isHeld() && fixture.artiGate == nil && fixture.cleanupStatus == .complete,
                              "arti-original-confirmed-retry")
                } else {
                    let fixture = try ActualPTStopConsumer(root: root, gate: gate)
                    defer { fixture.dispose() }
                    await fixture.stop()
                    try check(try fixture.isHeld() && fixture.gate === gate && fixture.cleanupStatus == .unconfirmed,
                              consumer + failure + "-retains-original")
                    try check(fixture.state == .failed, "pt-remains-failed")
                    gate.afterPoll = nil; gate.cleanupConfirmed = true; gate.throwsOnPoll = false
                    gate.exit = .init(pid: 4242, childReaped: true)
                    await fixture.stop()
                    try check(try !fixture.isHeld() && fixture.gate == nil && fixture.cleanupStatus == .reaped,
                              "pt-original-confirmed-retry")
                }
            }
        }
        do {
            let fixture = try ActualArtiStopConsumer(root: root, gate: PublicGate())
            defer { fixture.dispose() }
            fixture.transport.cleanupStatus = .unconfirmed
            await fixture.stop()
            try check(try fixture.isHeld() && fixture.artiGate != nil, "either-backend-unknown-retains-profile")
            fixture.transport.cleanupStatus = .reaped
            await fixture.stop()
            try check(try !fixture.isHeld(), "both-confirmed-release-profile")
        }
        return checks
    }
    static func main() async {
        guard [2, 3].contains(CommandLine.arguments.count) else { exit(64) }
        do {
            let root = URL(fileURLWithPath: CommandLine.arguments[1])
            if CommandLine.arguments.count == 3 {
                guard CommandLine.arguments[2] == "--early-cancel-only" else { exit(64) }
                let count = try await earlyCancel(root: root)
                print("TOR_GATE_EARLY_CANCEL_CONSUMER_DELTA \(count) checks PASS; cleanup-only PID, prepared remains nil; PUBLIC fixtures/owned flocks, Root/NE NOT_RUN; original38 NOT_REPEATED")
            } else {
                let count = try await run(root: root)
                print("TOR_GATE_CLEANUP_CONSUMER_DELTA \(count) checks PASS; actual stop methods + fresh owned OS flocks; process/Root/NE receipts are PUBLIC fixtures only")
            }
        } catch { FileHandle.standardError.write(Data("TOR_GATE_CLEANUP_CONSUMER_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
