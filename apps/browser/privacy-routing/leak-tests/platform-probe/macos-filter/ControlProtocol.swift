import Foundation

@objc protocol ScopedFilterControl {
    func enroll(_ reviewedJSON: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func routeState(_ requestJSON: Data, withReply reply: @escaping (Data?, String?) -> Void)
    func status(_ runID: String, epoch: String, withReply reply: @escaping (Data?, String?) -> Void)
}
struct RouteStateRequest: Codable {
    let runID: String
    let epoch: String
    let sequence: UInt64
    let state: String
    let userActionReference: String?
}
enum FilterBuild {
    static var team: String { Bundle.main.object(forInfoDictionaryKey: "YNXReviewedTeamIdentifier") as? String ?? "NOT_CONFIGURED" }
    static let hostIdentifier = "com.ynxweb4.browser.routefilter.host"
    static let providerIdentifier = "com.ynxweb4.browser.routefilter.provider"
    static var service: String { "\(team).\(providerIdentifier)" }
    static var configured: Bool { team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil }
    static func requirement(identifier: String) -> String { "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and identifier \"\(identifier)\"" }
}
