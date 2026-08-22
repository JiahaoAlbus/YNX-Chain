import Foundation

enum NativeWalletConnectInboundDecision: Equatable {
  case notWalletConnect
  case rejected(code: String)
}

enum NativeWalletConnectInboundPolicy {
  static func evaluate(
    _ rawValue: String,
    projectID: String?,
    now: Date = Date()
  ) -> NativeWalletConnectInboundDecision {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet",
          components.host == "wc" else {
      return .notWalletConnect
    }
    do {
      _ = try WalletConnectV2Policy.parseDeepLink(rawValue, projectID: projectID, now: now)
      // Parsing is not a relay connection. Runtime remains fail closed until
      // the accepted Reown adapter and a real project ID are supplied.
      return .rejected(code: "WALLETCONNECT_RELAY_UNAVAILABLE")
    } catch let error as WalletConnectV2PolicyError {
      return .rejected(code: error.rawValue)
    } catch {
      return .rejected(code: "INVALID_WALLETCONNECT_DEEP_LINK")
    }
  }
}
