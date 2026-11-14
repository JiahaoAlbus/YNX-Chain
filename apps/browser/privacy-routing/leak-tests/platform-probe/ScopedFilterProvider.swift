import Foundation
import Network
import NetworkExtension

// Compile-ready public-API integration core. NOT installed, entitled, activated or an admission proof.
// A containing signed system extension and separately authorized user activation are required.
final class ScopedFilterProvider: NEFilterDataProvider {
    private let fenceLock = NSLock()
    private var fence: AuditFlowFence?
    private var ownedFlows: [UUID: NEFilterSocketFlow] = [:]

    // The containing app must authenticate its control channel and validate exact launch tokens,
    // executable hashes, lifecycle generation and profile before calling this method.
    func installReviewedRun(_ candidate: AuditFlowFence) {
        fenceLock.lock(); fence = candidate; ownedFlows.removeAll(); fenceLock.unlock()
    }
    func blockReviewedRun() {
        fenceLock.lock(); fence?.setConnected(false); let flows = Array(ownedFlows.values); fenceLock.unlock()
        for flow in flows { update(flow, using: .drop(), for: .any) }
    }
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        fenceLock.lock(); defer { fenceLock.unlock() }
        guard let fence else { return .allow() } // No run enrolled; do not inspect other applications.
        guard flow.sourceAppAuditToken == fence.appAuditToken else { return .allow() }
        guard let socket = flow as? NEFilterSocketFlow else { return .drop() }
        var endpoint: AuditFlowFence.Endpoint?
        if let remote = socket.remoteFlowEndpoint, case let .hostPort(host, port) = remote {
            endpoint = .init(host: String(describing: host), port: port.rawValue, transport: socket.socketProtocol)
        }
        let decision = fence.decide(sourceApp: socket.sourceAppAuditToken, sourceProcess: socket.sourceProcessAuditToken, endpoint: endpoint)
        switch decision {
        case .dropOwned: return .drop()
        case .unownedAllowWithoutReading: return .allow()
        case .allowRouteEntry, .allowApprovedRouteTransport:
            guard ownedFlows.count < 4096 else { return .drop() }
            ownedFlows[socket.identifier] = socket
            return .allow()
        }
    }
    // No data-peek verdicts or inbound/outbound payload callbacks are used.
    // A flow whose sourceAppAuditToken is missing is not attributable; deployment acceptance must
    // reject missing audit-token coverage instead of claiming this core alone enforces every path.
}
