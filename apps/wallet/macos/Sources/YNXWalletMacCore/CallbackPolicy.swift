import Foundation

public enum CallbackDecision: Equatable, Sendable {
  case home
  case rejected(code: String)
}

public enum CallbackPolicy {
  public static func evaluate(_ rawValue: String) -> CallbackDecision {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet-macos",
          components.host == "authorize",
          components.path.isEmpty,
          components.fragment == nil else {
      return .rejected(code: "INVALID_CALLBACK_ROUTE")
    }
    let items = components.queryItems ?? []
    guard items.count == 1, items[0].name == "request",
          let request = items[0].value, !request.isEmpty else {
      return .rejected(code: "INVALID_AUTHORIZATION_REQUEST")
    }
    // This companion must consume the frozen Wallet/Auth request through the
    // canonical native bridge before approval. Until that bridge is present,
    // every request fails closed and no signature or callback is emitted.
    return .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE")
  }
}
