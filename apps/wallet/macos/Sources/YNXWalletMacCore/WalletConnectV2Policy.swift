import Foundation

public enum WalletConnectV2PolicyError: String, Error, Equatable, Sendable {
  case invalidProjectID = "WALLETCONNECT_PROJECT_ID_UNAVAILABLE"
  case invalidDeepLink = "INVALID_WALLETCONNECT_DEEP_LINK"
  case invalidPairingURI = "INVALID_WALLETCONNECT_PAIRING_URI"
  case expiredPairingURI = "WALLETCONNECT_PAIRING_EXPIRED"
  case unsupportedNamespace = "WALLETCONNECT_NAMESPACE_UNSUPPORTED"
  case accountNotApproved = "WALLETCONNECT_ACCOUNT_NOT_APPROVED"
}

public struct WalletConnectV2Pairing: Equatable, Sendable {
  public let uri: String
  public let topic: String
  public let projectID: String
}

public struct WalletConnectV2SessionApproval: Equatable, Sendable {
  public let chain: String
  public let account: String
  public let methods: Set<String>
  public let events: Set<String>
}

public enum WalletConnectV2Policy {
  public static let chain = "eip155:6423"
  public static let chainHex = "0x1917"
  public static let nativeAsset = "YNXT"
  public static let defaultLanguage = "en"

  public static let supportedMethods: Set<String> = [
    "eth_chainId",
    "eth_requestAccounts",
    "personal_sign",
    "eth_signTypedData_v4",
    "eth_sendTransaction",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]

  public static let supportedEvents: Set<String> = [
    "accountsChanged",
    "chainChanged",
    "disconnect",
  ]

  public static func parseDeepLink(
    _ rawValue: String,
    projectID: String?,
    now: Date = Date()
  ) throws -> WalletConnectV2Pairing {
    let validatedProjectID = try validateProjectID(projectID)
    guard let components = URLComponents(string: rawValue),
          components.scheme == "ynxwallet",
          components.host == "wc",
          components.path.isEmpty,
          components.fragment == nil,
          components.user == nil,
          components.password == nil,
          components.port == nil else {
      throw WalletConnectV2PolicyError.invalidDeepLink
    }
    let queryItems = components.queryItems ?? []
    guard queryItems.count == 1,
          queryItems[0].name == "uri",
          let pairingURI = queryItems[0].value else {
      throw WalletConnectV2PolicyError.invalidDeepLink
    }
    let topic = try validatePairingURI(pairingURI, now: now)
    return WalletConnectV2Pairing(uri: pairingURI, topic: topic, projectID: validatedProjectID)
  }

  public static func approve(
    requiredChains: Set<String>,
    requiredMethods: Set<String>,
    requiredEvents: Set<String>,
    optionalMethods: Set<String> = [],
    optionalEvents: Set<String> = [],
    approvedAccount: String?
  ) throws -> WalletConnectV2SessionApproval {
    guard requiredChains.isEmpty || requiredChains == [chain],
          requiredMethods.isSubset(of: supportedMethods),
          requiredEvents.isSubset(of: supportedEvents) else {
      throw WalletConnectV2PolicyError.unsupportedNamespace
    }
    guard let approvedAccount, isEVMAccount(approvedAccount) else {
      throw WalletConnectV2PolicyError.accountNotApproved
    }
    return WalletConnectV2SessionApproval(
      chain: chain,
      account: "\(chain):\(approvedAccount)",
      methods: requiredMethods.union(optionalMethods.intersection(supportedMethods)),
      events: requiredEvents.union(optionalEvents.intersection(supportedEvents))
    )
  }

  private static func validateProjectID(_ value: String?) throws -> String {
    guard let value,
          value.range(of: "^[0-9a-fA-F]{32}$", options: .regularExpression) != nil else {
      throw WalletConnectV2PolicyError.invalidProjectID
    }
    return value.lowercased()
  }

  private static func validatePairingURI(_ rawValue: String, now: Date) throws -> String {
    guard rawValue.range(
      of: "^wc:[0-9a-fA-F]{64}@2\\?",
      options: .regularExpression
    ) != nil else {
      throw WalletConnectV2PolicyError.invalidPairingURI
    }
    let split = rawValue.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    guard split.count == 2 else { throw WalletConnectV2PolicyError.invalidPairingURI }
    let identity = split[0].dropFirst(3).split(separator: "@", maxSplits: 1)
    guard identity.count == 2 else { throw WalletConnectV2PolicyError.invalidPairingURI }
    let topic = String(identity[0]).lowercased()
    guard let query = URLComponents(string: "https://walletconnect.invalid/?\(split[1])")?.queryItems else {
      throw WalletConnectV2PolicyError.invalidPairingURI
    }
    let allowedNames = Set(["symKey", "relay-protocol", "relay-data", "methods", "expiryTimestamp"])
    guard query.count == Set(query.map(\.name)).count,
          Set(query.map(\.name)).isSubset(of: allowedNames),
          let symKey = query.first(where: { $0.name == "symKey" })?.value,
          symKey.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil,
          query.first(where: { $0.name == "relay-protocol" })?.value == "irn" else {
      throw WalletConnectV2PolicyError.invalidPairingURI
    }
    if let expiryValue = query.first(where: { $0.name == "expiryTimestamp" })?.value {
      guard let expiry = TimeInterval(expiryValue) else {
        throw WalletConnectV2PolicyError.invalidPairingURI
      }
      guard expiry > now.timeIntervalSince1970 else {
        throw WalletConnectV2PolicyError.expiredPairingURI
      }
    }
    return topic
  }

  private static func isEVMAccount(_ value: String) -> Bool {
    value.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil
  }
}
