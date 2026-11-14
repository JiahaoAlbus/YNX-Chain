import Darwin
import Foundation

@MainActor private func checkPathFence() async {
    var calls: [NymPublicRuntimeFailure] = []
    let fence = NymPublicRouteFence { failure in
        calls.append(failure)
    }
    precondition(!fence.hasUsablePath)
    fence.observePath(available: true)
    precondition(fence.hasUsablePath && calls.isEmpty)
    // A callback waiting for the MainActor must not make a stale lease live.
    DispatchQueue.global().sync { fence.observePath(available: true) }
    precondition(!fence.hasUsablePath && fence.failure == .networkChanged && calls.isEmpty)
    fence.deliverIfNeeded()
    fence.revoke(.systemWake)
    fence.deliverIfNeeded()
    precondition(calls == [.networkChanged])

    let offline = NymPublicRouteFence { calls.append($0) }
    offline.observePath(available: false)
    offline.observePath(available: true)
    offline.deliverIfNeeded()
    precondition(!offline.hasUsablePath && calls == [.networkChanged, .networkUnavailable])

    let closed = NymPublicRouteFence { _ in preconditionFailure("late callback after explicit stop") }
    closed.observePath(available: true)
    closed.close()
    closed.revoke(.childExited)
    closed.observePath(available: false)
    closed.deliverIfNeeded()
    precondition(!closed.hasUsablePath && closed.failure == nil)
}

@MainActor private func checkOwnedChild(fixture: URL) async throws {
    let child = NymPublicOwnedProcess(limit: 4096)
    var calls: [NymPublicRuntimeFailure] = []
    let fence = NymPublicRouteFence { calls.append($0) }
    fence.observePath(available: true)
    try child.launch(executable: fixture, arguments: [], environment: [:],
                     onTermination: { fence.revoke(.childExited) })
    guard let pid = child.originalPID else { preconditionFailure("missing original fixture PID") }
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while calls.isEmpty, ContinuousClock.now < deadline {
        try await Task.sleep(for: .milliseconds(20))
    }
    let closed = await child.stop()
    let receipt = child.receipt
    precondition(closed && child.descriptorsClosed && !child.forcedStop)
    precondition(calls == [.childExited] && fence.failure == .childExited && !fence.hasUsablePath)
    precondition(receipt?.pid == pid && receipt?.code == 7 && receipt?.signal == nil && receipt?.childReaped == true)
    let bytes = try child.output.completedDirectoryCapture(expectedPID: pid)
    precondition(bytes.0.isEmpty && bytes.1.isEmpty, "non-zero fixture must be rejected")
}

@main struct NymPublicRouteLossChecks {
    @MainActor static func main() async throws {
        await checkPathFence()
        do {
            try await checkOwnedChild(fixture: URL(fileURLWithPath: CommandLine.arguments[1]))
            preconditionFailure("expected non-zero original child to reject capture")
        } catch NymPublicRuntimeFailure.childExited {}
        print("PASS Nym PUBLIC path loss, child exit, first failure, stale callback and original reap")
    }
}
