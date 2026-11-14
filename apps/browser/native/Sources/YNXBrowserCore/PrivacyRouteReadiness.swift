import Foundation

/// Diagnostic values only. Constructing/copying a snapshot never changes session admission.
public struct PrivacyRouteReadiness: Equatable, Sendable {
    public enum State: String, Sendable { case notRun, checking, ready, failed, blocked }
    public struct Check: Equatable, Sendable {
        public let state: State
        public let reason: String
        public init(state: State, reason: String) { self.state = state; self.reason = reason }
    }
    public enum LeakSurface: String, CaseIterable, Sendable {
        case dns, webRTCIPv4, webRTCIPv6, webSocket, downloads, ipv6, routeLoss, quic, resources
    }
    public struct LeakSafety: Equatable, Sendable {
        /// Installation qualification, not evidence that the current backend/route is still live.
        public let checks: [LeakSurface: Check]
        public let currentRoute: Check
        public init(checks: [LeakSurface: Check], currentRoute: Check = .init(state: .notRun, reason: "Current protected transport has not run")) {
            self.checks = checks; self.currentRoute = currentRoute
        }
        public func check(_ surface: LeakSurface) -> Check {
            checks[surface] ?? .init(state: .notRun, reason: "Required \(surface.rawValue) qualification not supplied")
        }
        var qualificationComplete: Bool { LeakSurface.allCases.allSatisfy { check($0).state == .ready } }
        public var state: State {
            let values = LeakSurface.allCases.map { check($0).state }
            if values.contains(.failed) { return .failed }
            if values.contains(.blocked) { return .blocked }
            guard qualificationComplete else { return values.contains(.checking) ? .checking : .notRun }
            return currentRoute.state
        }
        public var reason: String {
            let missing = LeakSurface.allCases.filter { check($0).state != .ready }
            if !missing.isEmpty { return missing.map { "\($0.rawValue): \(check($0).reason)" }.joined(separator: "; ") }
            return currentRoute.reason
        }
    }
    public let mode: PrivacyRouteMode
    public let transportReady: Check
    public let browserRouteReady: Check
    public let leakSafe: LeakSafety
    public let searchAvailable: Check
    public let releaseApproved: Check

    public init(mode: PrivacyRouteMode, transportReady: Check, browserRouteReady: Check, leakSafe: LeakSafety,
                searchAvailable: Check, releaseApproved: Check) {
        self.mode = mode; self.transportReady = transportReady; self.browserRouteReady = browserRouteReady
        self.leakSafe = leakSafe; self.searchAvailable = searchAvailable; self.releaseApproved = releaseApproved
    }
}
