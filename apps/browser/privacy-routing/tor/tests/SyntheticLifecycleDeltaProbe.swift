import Foundation

private enum FixtureFailure: Error { case originalStartup }
@main struct SyntheticLifecycleDeltaProbe {
    @MainActor static func main() async throws {
        var checks = 0
        func check(_ value: Bool, _ label: String) throws {
            guard value else { throw NSError(domain: "SyntheticLifecycleDelta." + label, code: 1) }
            checks += 1
        }
        func wait(_ condition: () -> Bool) async throws {
            let end = ContinuousClock.now.advanced(by: .seconds(3))
            while !condition() {
                guard ContinuousClock.now < end else { throw NSError(domain: "SyntheticLifecycleDelta.timeout", code: 1) }
                try await Task.sleep(for: .milliseconds(1))
            }
        }

        // Simulate a real asynchronous factory that returns a partial AFTER cancel.
        // No Root/authority/backend is made: only its ownership timing is controlled.
        let late = ProtectedSyntheticLifecycle<Int>()
        var pause: CheckedContinuation<Void, Never>?
        var waiting = false, adopted = false, pageMade = false, stopReturned = false
        var fences = 0, cleanups = 0
        let startup = Task { @MainActor in
            try await late.start(operation: {
                waiting = true
                await withCheckedContinuation { pause = $0 }
                adopted = true
                try late.requireStarting()
                pageMade = true
                return 1
            }, fence: { fences += 1 }, cleanup: {
                cleanups += 1
                return adopted
            })
        }
        try await wait { waiting }
        try check(!late.cleanupConfirmed, "pending-startup-is-not-clean")
        let stopping = Task { @MainActor in
            let result = await late.shutdown(fence: { fences += 1 }, cleanup: { cleanups += 1; return adopted })
            stopReturned = true
            return result
        }
        try await wait { late.closing }
        try check(fences == 1 && cleanups == 0 && !stopReturned, "fence-before-join-not-early-confirm")
        pause!.resume(); pause = nil
        try check(await stopping.value, "late-owner-cleanup-confirmed")
        switch await startup.result {
        case .success: throw NSError(domain: "SyntheticLifecycleDelta.late-page", code: 1)
        case .failure(let error): try check(error is CancellationError, "cancel-remains-first-failure")
        }
        try check(adopted && !pageMade && cleanups == 1 && late.cleanupConfirmed, "adopt-join-clean-exact-original")
        try check(late.firstFailure is CancellationError, "first-cause-retained")
        do { _ = try await late.start(operation: { 2 }, fence: {}, cleanup: { true }); throw NSError(domain: "replayed", code: 1) }
        catch ProtectedSyntheticWindowFailure.alreadyStarted { checks += 1 }

        // Immediate startup failure must not deadlock by joining its own work Task.
        let failed = ProtectedSyntheticLifecycle<Int>()
        var failedCleanupCalls = 0
        do {
            _ = try await failed.start(operation: { throw FixtureFailure.originalStartup }, fence: {}, cleanup: { failedCleanupCalls += 1; return false })
            throw NSError(domain: "SyntheticLifecycleDelta.failed-start-returned", code: 1)
        } catch FixtureFailure.originalStartup { checks += 1 }
        try check(!failed.cleanupConfirmed && failedCleanupCalls == 1, "partial-cleanup-unknown")
        try check(failed.firstFailure as? FixtureFailure == .originalStartup, "cleanup-unknown-does-not-mask-original")
        try check(await failed.shutdown(fence: {}, cleanup: { failedCleanupCalls += 1; return true }), "explicit-same-owner-cleanup-retry")
        try check(failedCleanupCalls == 2 && failed.firstFailure as? FixtureFailure == .originalStartup, "retry-keeps-first-cause")

        // Every concurrent close waiter must join the same real cleanup operation.
        let running = ProtectedSyntheticLifecycle<Int>()
        _ = try await running.start(operation: { 7 }, fence: {}, cleanup: { true })
        var releaseCleanup: CheckedContinuation<Void, Never>?
        var joinedCleanups = 0, returnedWaiters = 0
        let stops = (0..<6).map { _ in Task { @MainActor in
            let result = await running.shutdown(fence: {}, cleanup: {
                joinedCleanups += 1
                await withCheckedContinuation { releaseCleanup = $0 }
                return true
            })
            returnedWaiters += 1
            return result
        } }
        try await wait { releaseCleanup != nil }
        try check(joinedCleanups == 1 && returnedWaiters == 0 && !running.cleanupConfirmed, "all-quit-waiters-wait")
        releaseCleanup!.resume(); releaseCleanup = nil
        for stop in stops { try check(await stop.value, "joined-close-result") }
        try check(joinedCleanups == 1 && returnedWaiters == 6 && running.cleanupConfirmed, "one-cleanup-all-confirmed")

        // The dispatcher owes host cleanup even before it receives an attachment.
        let host = ProtectedAcceptanceHostCustody()
        var hostCalls = 0
        try check(await host.close(using: { hostCalls += 1; return true }) && hostCalls == 0, "no-fabricated-owner")
        try host.beginOpening()
        try check(host.hasPartialOwner, "partial-before-await-open")
        try check(!(await host.close(using: { hostCalls += 1; return false })) && host.hasPartialOwner, "open-failure-keeps-unknown-owner")
        var releaseHost: CheckedContinuation<Void, Never>?
        let closes = (0..<4).map { _ in Task { @MainActor in
            await host.close(using: { hostCalls += 1; await withCheckedContinuation { releaseHost = $0 }; return true })
        } }
        try await wait { releaseHost != nil }
        try check(hostCalls == 2 && host.hasPartialOwner, "host-close-coalesced")
        releaseHost!.resume(); releaseHost = nil
        for close in closes { try check(await close.value, "host-close-joined") }
        try check(!host.hasPartialOwner && hostCalls == 2, "partial-cleared-only-after-confirmation")
        print("SYNTHETIC_LIFECYCLE_DELTA \(checks) checks PASS; actual ownership helpers; no AppKit/Core authority, GUI, IPC, vendor or network")
    }
}
