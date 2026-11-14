import Foundation

/// Request boundary shared by the existing production session and a separately compiled,
/// authenticated synthetic trial. This interface itself grants no route or platform authority.
@MainActor public protocol PrivacyRouteRequestAuthorizing: AnyObject {
    var endpoint: PrivacyRouteEndpoint? { get }
    var readiness: PrivacyRouteReadiness { get }
    func authorize(_ url: URL) throws
    func confirmBrowserRouteBinding() throws
    func block(_ reason: String) async
}

// Conformance changes no production start, qualification, release or target-admission guard.
extension PrivacyRouteSession: PrivacyRouteRequestAuthorizing {}
