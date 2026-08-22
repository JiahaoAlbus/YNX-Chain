import Foundation

enum InboundLinkDecision: Equatable {
  case rejected(code: String)
}

enum InboundLinkPolicy {
  static let associatedDomainFrozen = false

  static func evaluateUniversalLink(_ url: URL?) -> InboundLinkDecision {
    guard let url, url.scheme == "https" else {
      return .rejected(code: "INVALID_UNIVERSAL_LINK")
    }
    // Core freezes only ynxwallet://authorize today. Until an associated
    // domain is frozen and deployed, every web-browsing activity fails closed.
    return .rejected(code: "ASSOCIATED_DOMAIN_UNAVAILABLE")
  }
}
