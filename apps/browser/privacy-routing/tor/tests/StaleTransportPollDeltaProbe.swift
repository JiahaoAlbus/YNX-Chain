import Foundation
import Darwin

@MainActor final class PublicPollPause {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var waiting = false
    func wait() async { await withCheckedContinuation { continuation = $0; waiting = true } }
    func release() { let original = continuation; continuation = nil; original?.resume() }
}
@MainActor final class PublicPollGate {
    var pause: PublicPollPause?
    var stops = 0
    var exit: Int?
    func poll() async throws -> Int? { if let pause { await pause.wait() }; return exit }
    func stop() async { stops += 1 }
}

// Minimal error mapping for the production fence slice; no startup/authority graph.
enum TorCoordinatorFailure: Error {
    case processExited
    static func classify(_ error: Error) -> Self { .processExited }
}

/// Actual PT poll body, PUBLIC delayed-memory gates only. No Root/process/NE is made.
@main struct StaleTransportPollDeltaProbe {
    @MainActor static func run() async throws -> Int {
        let legacy = CommandLine.arguments.contains("--legacy-counterexample")
        var checks = 0
        func check(_ condition: Bool) throws {
            guard condition else { throw NSError(domain: "TorStalePollDelta", code: checks) }
            checks += 1
        }
        func wait(_ condition: @MainActor () -> Bool) async throws {
            let limit = ContinuousClock.now.advanced(by: .seconds(2))
            while !condition() {
                guard ContinuousClock.now < limit else { throw NSError(domain: "TorStalePollWait", code: 1) }
                try await Task.sleep(for: .milliseconds(1))
            }
        }
        if CommandLine.arguments.contains("--disconnect-fence-only") {
            let transport = ActualTransportPoll(), gate = PublicPollGate(), cleanup = PublicPollPause()
            let route = ActualDisconnectFence()
            let expected = route.generation
            transport.gate = gate; transport.stopPause = cleanup; gate.exit = 0
            let pending = Task { @MainActor in
                try await transport.poll { error in
                    route.fenceObservedStatusFailure(error, expected: expected)
                }
            }
            try await wait { cleanup.waiting }
            try check(route.phase == .blocked && route.protection?.closed == true && route.preparation?.closed == true)
            try check(route.firstFailure == .processExited && route.generation != expected)
            try check(transport.gate === gate && transport.ownerStops == 1)
            cleanup.release()
            do { _ = try await pending.value; throw NSError(domain: "unexpected-healthy-status", code: 1) }
            catch TorTransportFailure.processExited { checks += 1 }

            let stale = ActualTransportPoll(), old = PublicPollGate(), replacement = PublicPollGate(), pause = PublicPollPause()
            let newer = ActualDisconnectFence()
            let current = newer.generation
            old.pause = pause; old.exit = 0; stale.gate = old
            let stalePoll = Task { @MainActor in
                try await stale.poll { error in
                    newer.fenceObservedStatusFailure(error, expected: current)
                }
            }
            try await wait { pause.waiting }
            stale.generation = UUID(); stale.gate = replacement
            pause.release()
            do { _ = try await stalePoll.value; throw NSError(domain: "unexpected-stale-status", code: 1) }
            catch TorTransportFailure.processExited { checks += 1 }
            try check(newer.phase == .connected && newer.protection?.closed == false && newer.preparation?.closed == false)
            try check(old.stops == 1 && replacement.stops == 0 && stale.gate === replacement)

            newer.generation = UUID()
            newer.fenceObservedStatusFailure(TorTransportFailure.processExited, expected: current)
            try check(newer.phase == .connected && newer.protection?.closed == false && newer.firstFailure == nil)
            return checks
        }
        do {
            let transport = ActualTransportPoll(), old = PublicPollGate(), next = PublicPollGate(), pause = PublicPollPause()
            old.pause = pause; transport.gate = old
            let pending = Task { @MainActor in try await transport.poll { _ in } }
            try await wait { pause.waiting }
            // Model explicit new-owner preparation while an old STATUS reply is delayed.
            transport.generation = UUID(); transport.gate = next; transport.state = .protocolAvailable(2222)
            pause.release()
            if legacy {
                try check(try await pending.value == .protocolAvailable(2222))
                try check(old.stops == 0 && next.stops == 0)
                return checks
            }
            do { _ = try await pending.value; throw NSError(domain: "stale-result", code: 1) }
            catch TorTransportFailure.processExited { checks += 1 }
            try check(old.stops == 1 && next.stops == 0 && transport.gate === next)
            try check(transport.state == .protocolAvailable(2222) && transport.ownerStops == 0)
        }
        do {
            let transport = ActualTransportPoll(), gate = PublicPollGate(), pause = PublicPollPause()
            gate.pause = pause; transport.gate = gate
            let pending = Task { @MainActor in try await transport.poll { _ in } }
            try await wait { pause.waiting }
            transport.generation = UUID(); transport.state = .stopping
            pause.release()
            do { _ = try await pending.value; throw NSError(domain: "stopping-result", code: 1) }
            catch TorTransportFailure.processExited { checks += 1 }
            try check(transport.gate == nil && transport.ownerStops == 1 && transport.state == .failed)
        }
        do {
            let transport = ActualTransportPoll(), gate = PublicPollGate(), pause = PublicPollPause()
            gate.pause = pause; transport.gate = gate
            var live = true, calls = 0
            transport.freshControlLease = { calls += 1; if !live { throw TorTransportFailure.protectionUnavailable } }
            let pending = Task { @MainActor in try await transport.poll { _ in } }
            try await wait { pause.waiting }
            live = false; pause.release()
            do { _ = try await pending.value; throw NSError(domain: "expired-result", code: 1) }
            catch TorTransportFailure.protectionUnavailable { checks += 1 }
            try check(calls == 2 && transport.gate == nil && transport.state == .failed)
        }
        do {
            let transport = ActualTransportPoll(), gate = PublicPollGate()
            transport.gate = gate
            var calls = 0; transport.freshControlLease = { calls += 1 }
            try check(try await transport.poll { _ in } == .protocolAvailable(1111))
            try check(calls == 2 && gate.stops == 0 && transport.ownerStops == 0)
        }
        return checks
    }
    static func main() async {
        do {
            let count = try await run()
            print("TOR_STALE_POLL_\(CommandLine.arguments.contains("--legacy-counterexample") ? "BUG_REPRODUCED" : "DELTA") \(count) checks; actual poll body, PUBLIC delayed gates; no child/Root/NE/route qualification")
        } catch { FileHandle.standardError.write(Data("TOR_STALE_POLL_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
