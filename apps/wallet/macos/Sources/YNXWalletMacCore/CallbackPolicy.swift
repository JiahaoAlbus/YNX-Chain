import Foundation

public enum CallbackDecision: Equatable, Sendable {
  case home
  case rejected(code: String)
}

public struct PendingCallbackInbox: Equatable, Sendable {
  private var rawValues: [String] = []

  public init() {}

  public var count: Int { rawValues.count }

  public mutating func enqueue(_ rawValue: String) {
    rawValues.append(rawValue)
  }

  public mutating func drain() -> [String] {
    defer { rawValues.removeAll(keepingCapacity: true) }
    return rawValues
  }
}

public enum CallbackPolicy {
  public static func evaluate(
    _ rawValue: String,
    walletConnectProjectID: String? = nil,
    now: Date = Date()
  ) -> CallbackDecision {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet" else {
      return .rejected(code: "INVALID_CALLBACK_ROUTE")
    }

    if components.host == "wc" {
      do {
        _ = try WalletConnectV2Policy.parseDeepLink(
          rawValue,
          projectID: walletConnectProjectID,
          now: now
        )
        // Parsing is not a relay connection. Runtime remains closed until
        // the accepted adapter and a real Reown project ID are supplied.
        return .rejected(code: "WALLETCONNECT_RELAY_UNAVAILABLE")
      } catch let error as WalletConnectV2PolicyError {
        return .rejected(code: error.rawValue)
      } catch {
        return .rejected(code: "INVALID_WALLETCONNECT_DEEP_LINK")
      }
    }

    guard components.host == "authorize",
          components.path.isEmpty,
          components.fragment == nil else {
      return .rejected(code: "INVALID_CALLBACK_ROUTE")
    }
    let items = components.queryItems ?? []
    guard items.count == 1, items[0].name == "request",
          let request = items[0].value, !request.isEmpty else {
      return .rejected(code: "INVALID_AUTHORIZATION_REQUEST")
    }
    switch NativeAuthorizationPolicy.evaluate(rawValue) {
    case .rejected(let code): return .rejected(code: code)
    }
  }
}
