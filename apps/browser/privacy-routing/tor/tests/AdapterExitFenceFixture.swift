// Appended to the actual copied adapter file by the offline SDK driver only.
// No application target includes this fixture or gains a private-adapter API.
private final class ExitFenceNotificationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func increment() { lock.lock(); value += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
}

extension ArtiProcessAdapter {
    func exerciseActualExitFence(executable: URL) async throws -> [String: Any] {
        var owned: [Process] = []
        var receipts: [[String: Any]] = []
        @MainActor func launch(_ command: String) throws -> Process {
            let child = Process(); child.executableURL = executable; child.arguments = [command]
            child.standardInput = FileHandle.nullDevice; child.standardOutput = FileHandle.nullDevice
            child.standardError = FileHandle.nullDevice
            try child.run(); owned.append(child)
            return child
        }
        @MainActor func adopt(_ child: Process) {
            process = child; state = .processRunningOnly; generation = UUID()
            lastStopReason = nil; hasInitialPath = false
        }
        @MainActor func deliver(_ available: Bool, _ expected: UUID) {
            #if P05_LEGACY_EXIT_FENCE_RED
            fixtureOriginalQueuedPath(available: available, expected: expected)
            #else
            receivePathUpdate(available: available, generation: expected)
            #endif
        }
        @MainActor func joined(_ child: Process) async throws {
            let end = ContinuousClock.now.advanced(by: .seconds(4))
            while child.isRunning, ContinuousClock.now < end { try await Task.sleep(for: .milliseconds(10)) }
            guard !child.isRunning else { throw TorPlatformError.alreadyRunning }
            child.waitUntilExit(); _ = pollProcess()
            if let shutdownTask { await shutdownTask.value }
            receipts.append(["pid": child.processIdentifier, "originalWait": true,
                             "status": child.terminationStatus,
                             "reason": child.terminationReason == .exit ? "exit" : "signal"])
        }
        do {
            let natural = try launch("--owned-natural-exit")
            natural.waitUntilExit(); adopt(natural)
            let oldGeneration = generation
            hasInitialPath = true
            pathMonitor = NWPathMonitor() // deliberately never started: no NW callbacks or sockets
            let name = Notification.Name("P05-own-exit-fence-" + UUID().uuidString)
            let counter = ExitFenceNotificationCounter()
            powerObservers = [NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: nil) { _ in counter.increment() }]
            guard pollProcess() == .exited(7) else { throw TorPlatformError.invalidPin }
            NSWorkspace.shared.notificationCenter.post(name: name, object: nil)
            let monitorRetainedAfterPoll = pathMonitor != nil
            let sameGenerationAfterPoll = generation == oldGeneration
            deliver(true, oldGeneration)
            #if P05_LEGACY_EXIT_FENCE_RED
            guard monitorRetainedAfterPoll, sameGenerationAfterPoll, counter.count == 1,
                  state == .stopped, !natural.isRunning else { throw TorPlatformError.invalidPin }
            try await joined(natural)
            return ["status": "EXPECTED_RED", "actualCounterexample": "natural_exit_monitor_retained_and_late_callback_erases_exit",
                    "children": receipts, "NWPathMonitorStarts": 0, "notRealNetworkChange": true]
            #else
            guard !monitorRetainedAfterPoll, !sameGenerationAfterPoll, counter.count == 0,
                  powerObservers.isEmpty, state == .exited(7), lastStopReason == nil else { throw TorPlatformError.invalidPin }
            stop(reason: "network-path-changed")
            guard state == .exited(7), lastStopReason == nil else { throw TorPlatformError.invalidPin }
            try await joined(natural)
            let live = try launch("--owned-wait")
            adopt(live)
            let liveGeneration = generation
            deliver(true, oldGeneration)
            guard live.isRunning, state == .processRunningOnly, !hasInitialPath, lastStopReason == nil else { throw TorPlatformError.invalidPin }
            deliver(true, liveGeneration)
            guard live.isRunning, hasInitialPath, state == .processRunningOnly else { throw TorPlatformError.invalidPin }
            deliver(true, liveGeneration) // same DATA again: live later updates still stop
            guard lastStopReason == "network-path-changed" else { throw TorPlatformError.invalidPin }
            try await joined(live)
            let unavailable = try launch("--owned-wait")
            adopt(unavailable)
            deliver(false, generation)
            guard lastStopReason == "network-unavailable" else { throw TorPlatformError.invalidPin }
            try await joined(unavailable)
            return ["status": "PASS", "newActualLifecycleCases": 3,
                    "children": receipts, "NWPathMonitorStarts": 0, "notRealNetworkChange": true,
                    "exitedCodeRetained": true, "oldCallbackDidNotAffectNewChild": true,
                    "sameGenerationLaterSatisfiedStillStops": true, "unavailableStillStops": true]
            #endif
        } catch {
            // Exact owned fixture handles only; no product/backend replacement.
            for child in owned where child.isRunning { child.terminate() }
            let end = ContinuousClock.now.advanced(by: .seconds(2))
            while owned.contains(where: { $0.isRunning }), ContinuousClock.now < end { try? await Task.sleep(for: .milliseconds(10)) }
            for child in owned where child.isRunning { _ = Darwin.kill(child.processIdentifier, SIGKILL) }
            for child in owned { child.waitUntilExit() }
            let actualCleanup = owned.map { ["pid": $0.processIdentifier, "status": $0.terminationStatus, "originalWait": true] as [String: Any] }
            if let bytes = try? JSONSerialization.data(withJSONObject: ["ownedFixtureCleanup": actualCleanup], options: [.sortedKeys]) {
                FileHandle.standardError.write(bytes + Data("\n".utf8))
            }
            stop(reason: "explicit-stop")
            throw error
        }
    }
}
