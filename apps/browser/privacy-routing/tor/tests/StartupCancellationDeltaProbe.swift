import Foundation
import YNXBrowserCore

/// Only the new cancellation/diagnostic delta. No child, helper, IPC, WK or network.
@main struct StartupCancellationDeltaProbe {
    @MainActor static func main() async throws {
        var checks = 0
        func check(_ condition: Bool, _ label: String) throws {
            guard condition else { throw NSError(domain: "TorStartupDelta." + label, code: 1) }
            checks += 1
        }
        let transportCases: [(TorTransportFailure, TorCoordinatorFailure)] = [
            (.startupTimedOut, .transportStartupTimedOut), (.processExited, .processExited),
            (.protocolRejected, .transportProtocolRejected), (.outputLimit, .transportProtocolRejected),
            (.protectionUnavailable, .protectionLost), (.alreadyRunning, .ownershipConflict),
            (.unsafeState, .unsafeProfile), (.invalidBridgePeer, .invalidEndpoint)
        ]
        for (input, expected) in transportCases {
            try check(TorCoordinatorFailure.classify(input) == expected, input.rawValue)
        }
        for input in [ProtectionLeaseFailure.transportLost, .heartbeatExpired, .staleReply, .closed, .cancelled] {
            try check(TorCoordinatorFailure.classify(input) == .protectionLost, input.rawValue)
        }
        try check(TorCoordinatorFailure.classify(ProtectionLeaseFailure.systemSleep) == .systemSleep, "sleep")
        try check(TorCoordinatorFailure.classify(PrivacyRouteError.stale) == .protectionLost, "stale-authority")
        try check(TorCoordinatorFailure.classify(CancellationError()) == .cancelled, "task-cancel")
        for input in [TorCoordinatorFailure.bootstrapTimedOut, .networkUnavailable, .networkPathChanged, .systemWake] {
            try check(TorCoordinatorFailure.classify(input) == input, input.rawValue)
        }
        // Unknown errors may contain profile/bridge details: expose only a fixed category.
        let sensitive = NSError(domain: "SYNTHETIC-private-path-and-bridge", code: 99)
        try check(TorCoordinatorFailure.classify(sensitive).rawValue == "startupFailed", "redaction")
        try check(TorExternalTransport.protocolStartupTimeout == .seconds(30), "upstream-pt-budget")
        try check(TorProtectedRouteProvider.bridgedBootstrapTimeout == .seconds(600), "bridge-budget")

        let absent = URL(fileURLWithPath: "/private/tmp/ynx-tor-cancelled-before-start-" + UUID().uuidString)
        let provider = TorProtectedRouteProvider(helperSHA256: String(repeating: "a", count: 64),
            explicitUserAction: UUID(), applicationSupport: absent)
        // MainActor cannot run this queued startup until the current task suspends below.
        let startup = Task { @MainActor in try await provider.start() }
        startup.cancel()
        do { _ = try await startup.value; throw NSError(domain: "TorStartupDelta.unexpected-start", code: 1) }
        catch is CancellationError { checks += 1 }
        try check(provider.firstFailure == .cancelled, "cancel-before-preflight")
        try check(!FileManager.default.fileExists(atPath: absent.path) && provider.cleanupConfirmed, "no-created-state")
        let stops = (0..<8).map { _ in Task { @MainActor in await provider.awaitCleanupConfirmation() } }
        var allConfirmed = true
        for stop in stops { if await !stop.value { allConfirmed = false } }
        try check(allConfirmed && provider.cleanupConfirmed, "concurrent-empty-cleanup-join")
        try check(await provider.status() == .blocked("cancelled"), "first-cause-visible")
        print("TOR_STARTUP_DELTA \(checks) checks PASS; original vendor/gate reap evidence reused; live bootstrap cancellation, IPC, WK and network NOT_RUN")
    }
}
