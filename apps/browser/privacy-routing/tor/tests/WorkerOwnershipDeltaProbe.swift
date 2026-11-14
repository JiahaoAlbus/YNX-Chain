import Foundation
import Darwin

@MainActor private final class Pause {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var waiting = false
    func wait() async { await withCheckedContinuation { continuation = $0; waiting = true } }
    func release() { let value = continuation; continuation = nil; value?.resume() }
}
@MainActor private final class PublicState {
    var events: [String] = []
    var adopted = false
    var reaped = false
    var cleanupConfirmed = false
    var lockHeld = true
    var first: TorCoordinatorFailure?
}

/// Only the provider's actual new ownership helper. Pauses model late callee returns;
/// they are PUBLIC memory fixtures, never Root/NE/child-process acknowledgements.
@main struct WorkerOwnershipDeltaProbe {
    @MainActor static func run() async throws -> Int {
        var checks = 0
        func check(_ value: Bool, _ label: String) throws {
            guard value else { throw NSError(domain: "TorWorkerDelta." + label, code: 1) }
            checks += 1
        }
        func until(_ condition: @MainActor () -> Bool) async throws {
            let end = ContinuousClock.now.advanced(by: .seconds(2))
            while !condition() {
                guard ContinuousClock.now < end else { throw NSError(domain: "TorWorkerDelta.bounded-wait", code: 1) }
                try await Task.sleep(for: .milliseconds(1))
            }
        }

        // Counterexample to the old stop contract: no original-start join means a
        // cleanup snapshot can be true before a late preparation is adopted.
        do {
            let pause = Pause(), state = PublicState()
            let startup = Task { @MainActor in await pause.wait(); state.adopted = true }
            try await until { pause.waiting }
            state.cleanupConfirmed = !state.adopted
            pause.release(); await startup.value
            try check(state.cleanupConfirmed && state.adopted && !state.reaped, "old-late-cleanup-counterexample")
        }
        // Same production ownership helper, for each awaited preparation boundary.
        for stage in ["root", "pt", "arti"] {
            let owner = TorStartupOwnership<Int>(), pause = Pause(), state = PublicState()
            let starter = Task { @MainActor in
                do {
                    _ = try await owner.start(operation: {
                        state.events.append("entered"); await pause.wait()
                        state.adopted = true; state.events.append("late-adopted"); return 1
                    }, cancellationFence: { state.events.append("cancel-fence") })
                    return false
                } catch {
                    // Production start's outer waiter owns this call, not its worker.
                    await owner.stop(fence: {}, reap: {})
                    return true
                }
            }
            try await until { pause.waiting }
            let stopper = Task { @MainActor in
                await owner.stop(fence: { state.events.append("fenced") }, reap: {
                    state.events.append("reap"); state.reaped = state.adopted
                    state.lockHeld = !state.reaped; state.cleanupConfirmed = state.reaped
                })
            }
            try await until { owner.stopping }
            try check(owner.inFlight && !state.cleanupConfirmed && state.lockHeld, stage + "-not-early-confirmed")
            try check(state.events == ["entered", "fenced"], stage + "-sync-fence-before-join")
            pause.release(); await stopper.value
            try check(await starter.value, stage + "-outer-error-without-self-join")
            try check(!owner.inFlight && !owner.stopping && state.cleanupConfirmed && !state.lockHeld, stage + "-settled-then-reaped")
            try check(state.events.firstIndex(of: "late-adopted")! < state.events.firstIndex(of: "reap")!, stage + "-adopt-before-reap")
        }
        do {
            let owner = TorStartupOwnership<Int>(), pause = Pause(), state = PublicState()
            let starter = Task { @MainActor in
                try await owner.start(operation: { await pause.wait(); return 1 }, cancellationFence: {})
            }
            try await until { pause.waiting }
            let stops = (0..<8).map { _ in Task { @MainActor in
                await owner.stop(fence: { state.events.append("fence") }, reap: { state.events.append("reap") })
            } }
            try await until { owner.stopping }
            // Give all waiters a chance to join the SAME pending shutdown.
            for _ in 0..<8 { await Task.yield() }
            pause.release()
            for stop in stops { await stop.value }
            _ = await starter.result
            try check(state.events == ["fence", "reap"], "concurrent-stop-shares-original-join")
            do { _ = try await owner.start(operation: { 2 }, cancellationFence: {}); throw NSError(domain: "replacement", code: 1) }
            catch TorCoordinatorFailure.ownershipConflict { checks += 1 }
        }
        do {
            let owner = TorStartupOwnership<Int>(), state = PublicState()
            _ = try await owner.start(operation: { 1 }, cancellationFence: {})
            await owner.stop(fence: {}, reap: { state.events.append("unknown"); state.cleanupConfirmed = false })
            try check(!state.cleanupConfirmed && state.lockHeld && owner.closed, "unknown-keeps-owner-lock")
            await owner.stop(fence: {}, reap: { state.reaped = true; state.lockHeld = false; state.cleanupConfirmed = true })
            try check(state.cleanupConfirmed && !state.lockHeld, "explicit-stop-retries-original-reap")
        }
        do {
            let owner = TorStartupOwnership<Int>(), state = PublicState()
            let starter = Task { @MainActor in
                do {
                    _ = try await owner.start(operation: {
                        state.events.append("started")
                        try await Task.sleep(for: .seconds(30)); return 1
                    }, cancellationFence: { state.events.append("cancel-fence") })
                    return false
                } catch {
                    state.first = TorCoordinatorFailure.classify(error)
                    await owner.stop(fence: {}, reap: { state.cleanupConfirmed = true })
                    return true
                }
            }
            try await until { state.events.contains("started") }
            starter.cancel()
            try check(await starter.value, "caller-cancel-reaches-original-worker")
            try await until { state.events.contains("cancel-fence") }
            try check(state.first == .cancelled && !owner.inFlight && state.cleanupConfirmed, "caller-cancel-first-cause-and-cleanup")
        }
        do {
            let owner = TorStartupOwnership<Int>(), state = PublicState()
            do { _ = try await owner.start(operation: { throw TorCoordinatorFailure.networkPathChanged }, cancellationFence: {}) }
            catch { state.first = TorCoordinatorFailure.classify(error) }
            await owner.stop(fence: {}, reap: { state.cleanupConfirmed = true })
            try check(state.first == .networkPathChanged && state.cleanupConfirmed, "original-interruption-first-cause")
        }
        return checks
    }
    static func main() async {
        do { let count = try await run(); print("TOR_WORKER_OWNERSHIP_DELTA \(count) checks PASS; PUBLIC memory fixtures; Root/child/NE/WK/network NOT_RUN") }
        catch { FileHandle.standardError.write(Data("TOR_WORKER_OWNERSHIP_DELTA FAIL \(error)\n".utf8)); exit(1) }
    }
}
