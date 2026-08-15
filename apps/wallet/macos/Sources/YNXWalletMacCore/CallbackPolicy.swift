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
  public static func evaluate(_ rawValue: String) -> CallbackDecision {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet",
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
    switch NativeAuthorizationPolicy.evaluate(rawValue) {
    case .rejected(let code): return .rejected(code: code)
    }
  }
}
