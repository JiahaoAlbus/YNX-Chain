import Foundation
import Darwin

private enum StopDeltaFailure: Error { case failed(String) }
private func check(_ value: Bool, _ label: String) throws { if !value { throw StopDeltaFailure.failed(label) } }

@MainActor private final class SyntheticStopOwner {
    let scheduler = OwnedBackendStopTask() // Actual production scheduling primitive, not a copy.
    let process = Process()
    let output = Pipe()
    private(set) var pid: Int32 = 0
    private(set) var attempts = 0, activeWorkers = 0, maximumWorkers = 0
    private(set) var inheritedCancellation = false, closed = false, closureCount = 0
    private(set) var firstCause: String?
    init(seconds: String) throws {
        // Exact owned synthetic process only. No vendor, socket, user data,
        // RoutedRootPreparation, fake signed ACK, or privacy qualification.
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = [seconds]; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run(); pid = process.processIdentifier
    }
    func stop(observationNanoseconds: UInt64) async {
        await scheduler.join { [self] in
            attempts += 1; activeWorkers += 1; maximumWorkers = max(maximumWorkers, activeWorkers)
            defer { activeWorkers -= 1 }
            inheritedCancellation = inheritedCancellation || Task.isCancelled
            let deadline = DispatchTime.now().uptimeNanoseconds + observationNanoseconds
            while process.isRunning && DispatchTime.now().uptimeNanoseconds < deadline {
                do { try await Task.sleep(nanoseconds: 5_000_000) }
                catch { if firstCause == nil { firstCause = "unexpected-owned-worker-cancellation" }; return }
            }
            if process.isRunning {
                if firstCause == nil { firstCause = "synthetic-observation-unknown" }
                return // Preserve SAME process/FD/stop scheduler, no release or replacement.
            }
            process.waitUntilExit() // Actual Foundation-owned child reap/termination observation.
            guard process.terminationReason == .exit && process.terminationStatus == 0 else {
                if firstCause == nil { firstCause = "synthetic-process-failed" }; return
            }
            if !closed {
                do { try output.fileHandleForReading.close(); try output.fileHandleForWriting.close(); closed = true; closureCount += 1 }
                catch { if firstCause == nil { firstCause = "synthetic-fd-close-unknown" } }
            }
        }
    }
}

@main private struct StopCancellationSelfTest {
    @MainActor static func main() async {
        do {
            if CommandLine.arguments.contains("--legacy-cancelled-sleep") {
                var ticks = 0, spins = 0
                let cancelled = Task { @MainActor in
                    let heartbeat = Task { @MainActor in ticks += 1 }
                    // Exact old cancellation-swallowing wait pattern, shortened to
                    // 150ms. This is a semantic first-cause reproduction only,
                    // not a pretend full Gate/NE/vendor run.
                    let end = DispatchTime.now().uptimeNanoseconds + 150_000_000
                    while DispatchTime.now().uptimeNanoseconds < end {
                        try? await Task.sleep(nanoseconds: 20_000_000); spins += 1
                    }
                    let during = ticks
                    await heartbeat.value
                    return during
                }
                // Create cancellation before the old pattern's first sleep.
                cancelled.cancel()
                let baselineTicks = await cancelled.value
                print("{\"legacyPattern\":true,\"cancelledSleepSpins\":\(spins),\"heartbeatBeforeOrAfterLoop\":\(baselineTicks),\"expectedFailure\":true,\"fullGateOrNE\":false}")
                // Actual Swift scheduling may run a heartbeat even while this
                // cancellation-swallowing loop spins. Prove the observed busy
                // loop, not an unobserved claim of complete actor starvation.
                exit(spins > 100 ? 1 : 2)
            }
            var rows: [[String: Any]] = []
            let path = "/PUBLIC/synthetic-backend", sha = String(repeating: "a", count: 64), requirement = "PUBLIC-code-rule"
            let run = "PUBLIC-stop-run", epoch = UUID().uuidString
            let pin: [String: Any] = ["pid": Int32(4242), "path": path, "sha256": sha, "requirement": requirement, "auditTokenHex": String(repeating: "b", count: 64)]
            let frame: [String: Any] = ["kind": "prepared", "state": "post-exec-suspended", "pid": Int32(4242), "runID": run, "epoch": epoch, "processPin": pin]
            func cleanupIdentity(_ event: [String: Any]) -> OwnedBackendCleanupChild? {
                OwnedBackendCleanupChild(event: event, runID: run, epoch: epoch, path: path, sha256: sha, requirement: requirement)
            }
            try check(cleanupIdentity(frame)?.pid == 4242, "late-prepared-frame-has-cleanup-only-identity")
            var rejected = 0
            for key in ["pid", "runID", "epoch", "state"] {
                var changed = frame; changed[key] = key == "pid" ? Int32(4243) : "wrong"
                try check(cleanupIdentity(changed) == nil, "cleanup-frame-reject-" + key); rejected += 1
            }
            for key in ["pid", "path", "sha256", "requirement", "auditTokenHex"] {
                var changedPin = pin; changedPin[key] = key == "pid" ? Int32(4243) : "wrong"
                var changed = frame; changed["processPin"] = changedPin
                try check(cleanupIdentity(changed) == nil, "cleanup-pin-reject-" + key); rejected += 1
            }
            do {
                let owner = try SyntheticStopOwner(seconds: "0.20")
                var ticks = 0
                let heartbeat = Task { @MainActor in
                    while !owner.closed { ticks += 1; try await Task.sleep(nanoseconds: 5_000_000) }
                }
                let cancelled = Task { @MainActor in await owner.stop(observationNanoseconds: 1_000_000_000) }
                cancelled.cancel(); await cancelled.value; _ = try await heartbeat.value
                try check(owner.closed && !owner.process.isRunning && !owner.inheritedCancellation && ticks > 5 && owner.attempts == 1, "cancelled-caller-independent-yielding-worker")
                rows.append(["case": "cancelled-caller", "pid": owner.pid, "ticks": ticks, "attempts": owner.attempts, "ownedReaped": true, "fdsClosed": owner.closed, "workerInheritedCancellation": owner.inheritedCancellation])
            }
            do {
                let owner = try SyntheticStopOwner(seconds: "0.25")
                var firstReturned = false, secondReturned = false
                let first = Task { @MainActor in await owner.stop(observationNanoseconds: 1_000_000_000); firstReturned = true }
                while owner.attempts == 0 { await Task.yield() }
                let second = Task { @MainActor in await owner.stop(observationNanoseconds: 1_000_000_000); secondReturned = true }
                second.cancel()
                try await Task.sleep(nanoseconds: 30_000_000)
                try check(!firstReturned && !secondReturned && owner.attempts == 1 && owner.process.isRunning, "concurrent-stop-does-not-return-early")
                await first.value; await second.value
                try check(firstReturned && secondReturned && owner.closed && owner.maximumWorkers == 1 && owner.attempts == 1 && owner.closureCount == 1, "concurrent-stop-exact-join-and-close-once")
                rows.append(["case": "concurrent-stop", "pid": owner.pid, "attempts": owner.attempts, "maximumWorkers": owner.maximumWorkers, "closureCount": owner.closureCount, "bothJoined": true, "ownedReaped": true])
            }
            do {
                let owner = try SyntheticStopOwner(seconds: "0.25")
                let originalPID = owner.pid
                await owner.stop(observationNanoseconds: 20_000_000)
                try check(!owner.closed && owner.process.isRunning && owner.firstCause == "synthetic-observation-unknown", "unknown-retains-same-owned-process-and-fds")
                await owner.stop(observationNanoseconds: 1_000_000_000)
                try check(owner.closed && owner.pid == originalPID && owner.attempts == 2 && owner.maximumWorkers == 1 && owner.firstCause == "synthetic-observation-unknown", "explicit-same-owner-observation-retains-first-cause")
                rows.append(["case": "same-owner-after-unknown", "pid": owner.pid, "attempts": owner.attempts, "maximumWorkers": owner.maximumWorkers, "firstCause": owner.firstCause!, "replacementProcess": false, "ownedReaped": true])
            }
            let report: [String: Any] = ["schema": "P05_OWNED_STOP_TASK_DELTA_V1", "cases": rows,
                "cleanupOnlyBindingAccepted": 1, "cleanupOnlyBindingRejected": rejected,
                "cleanupBindingIsAuthority": false,
                "actualGateStopScheduler": true, "fixtureOnlyOwnedSleepProcesses": true,
                "actualSignedGateOrBackend": "NOT_RUN", "actualNE": "NOT_RUN", "productionRouteAdmission": false,
                "GUIOrNetworkUsed": false]
            print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
        } catch { print("STOP_DELTA_FAIL: \(error)"); exit(1) }
    }
}
