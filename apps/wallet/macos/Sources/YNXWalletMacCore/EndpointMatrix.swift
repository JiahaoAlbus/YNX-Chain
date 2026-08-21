import Foundation

public enum EndpointMatrixError: Error, Equatable, Sendable {
  case invalidDocument
  case unsupportedIdentity
  case invalidNetwork
  case invalidCanonicalEndpoint
  case endpointUnavailable
  case responseTooLarge
  case invalidRPCResponse
  case invalidHTTPResponse
  case invalidGatewayResponse
  case wrongChain
}

public struct WalletEndpointConfiguration: Equatable, Sendable {
  public static let expectedMatrixID = "ynx-wallet-auth-public-endpoint-service-discovery-v1"
  public static let expectedChainID = 6423
  public static let expectedChainIDHex = "0x1917"

  public let matrixID: String
  public let restURL: URL
  public let rpcURL: URL
  public let rpcAvailable: Bool
  public let appHealthURL: URL
  public let appHealthAvailable: Bool
  public let walletSessionCompleteURL: URL
  public let walletSessionIntrospectURL: URL
  public let productSessionIntrospectURL: URL
  public let faucetAvailable: Bool
  public let walletApprovalAvailable: Bool
  public let walletCallbackAvailable: Bool
  public let allRequiredServicesAvailable: Bool
  public let allRequiredServicesCorsReady: Bool
  public let mobileWalletDiscoveryVerified: Bool
  public let mobileAccountVerified: Bool
  public let mobileSignVerified: Bool
  public let mobileSendVerified: Bool
  public let deployedPublic: Bool
  public let integratedCentral: Bool

  public init(
    matrixID: String,
    restURL: URL,
    rpcURL: URL,
    rpcAvailable: Bool,
    appHealthURL: URL,
    appHealthAvailable: Bool,
    walletSessionCompleteURL: URL,
    walletSessionIntrospectURL: URL,
    productSessionIntrospectURL: URL,
    faucetAvailable: Bool,
    walletApprovalAvailable: Bool,
    walletCallbackAvailable: Bool,
    allRequiredServicesAvailable: Bool,
    allRequiredServicesCorsReady: Bool,
    mobileWalletDiscoveryVerified: Bool,
    mobileAccountVerified: Bool,
    mobileSignVerified: Bool,
    mobileSendVerified: Bool,
    deployedPublic: Bool,
    integratedCentral: Bool
  ) {
    self.matrixID = matrixID
    self.restURL = restURL
    self.rpcURL = rpcURL
    self.rpcAvailable = rpcAvailable
    self.appHealthURL = appHealthURL
    self.appHealthAvailable = appHealthAvailable
    self.walletSessionCompleteURL = walletSessionCompleteURL
    self.walletSessionIntrospectURL = walletSessionIntrospectURL
    self.productSessionIntrospectURL = productSessionIntrospectURL
    self.faucetAvailable = faucetAvailable
    self.walletApprovalAvailable = walletApprovalAvailable
    self.walletCallbackAvailable = walletCallbackAvailable
    self.allRequiredServicesAvailable = allRequiredServicesAvailable
    self.allRequiredServicesCorsReady = allRequiredServicesCorsReady
    self.mobileWalletDiscoveryVerified = mobileWalletDiscoveryVerified
    self.mobileAccountVerified = mobileAccountVerified
    self.mobileSignVerified = mobileSignVerified
    self.mobileSendVerified = mobileSendVerified
    self.deployedPublic = deployedPublic
    self.integratedCentral = integratedCentral
  }

  public var nativeCapabilities: WalletNativeCapabilities {
    let authorizationCompletionAvailable = walletApprovalAvailable
      && walletCallbackAvailable
      && allRequiredServicesAvailable
      && mobileWalletDiscoveryVerified
      && deployedPublic
      && integratedCentral
    let accountAvailable = authorizationCompletionAvailable && mobileAccountVerified
    let signAvailable = accountAvailable && mobileSignVerified
    return WalletNativeCapabilities(
      authorizationCompletionAvailable: authorizationCompletionAvailable,
      accountAvailable: accountAvailable,
      signAvailable: signAvailable,
      sendAvailable: signAvailable && mobileSendVerified
    )
  }
}

public struct WalletNativeCapabilities: Equatable, Sendable {
  public let authorizationCompletionAvailable: Bool
  public let accountAvailable: Bool
  public let signAvailable: Bool
  public let sendAvailable: Bool
}

public enum EndpointMatrixPolicy {
  public static func parse(_ data: Data) throws -> WalletEndpointConfiguration {
    guard data.count <= 256 * 1024,
          let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          root["schemaVersion"] as? Int == 1,
          let matrixID = root["matrixId"] as? String,
          matrixID == WalletEndpointConfiguration.expectedMatrixID else {
      throw EndpointMatrixError.unsupportedIdentity
    }
    guard let network = root["network"] as? [String: Any],
          network["chainIdDecimal"] as? Int == WalletEndpointConfiguration.expectedChainID,
          network["chainIdHex"] as? String == WalletEndpointConfiguration.expectedChainIDHex else {
      throw EndpointMatrixError.invalidNetwork
    }
    guard let canonical = root["canonical"] as? [String: Any],
          let restRaw = canonical["restUrl"] as? String,
          let rpcRaw = canonical["rpcUrl"] as? String,
          let authV1Raw = canonical["authV1Prefix"] as? String,
          let authV2Raw = canonical["authV2Prefix"] as? String,
          let restURL = strictHTTPSURL(restRaw, requireOrigin: true),
          let rpcURL = strictHTTPSURL(rpcRaw, requireOrigin: false),
          let authV1URL = strictHTTPSURL(authV1Raw, requireOrigin: false),
          let authV2URL = strictHTTPSURL(authV2Raw, requireOrigin: false),
          authV1URL.absoluteString == restURL.absoluteString + "/v1/wallet/",
          authV2URL.absoluteString == restURL.absoluteString + "/v2/product-sessions/",
          let endpoints = root["endpoints"] as? [[String: Any]],
          let rpc = endpoint("chain-rpc-canonical", in: endpoints),
          rpc["url"] as? String == rpcRaw,
          let rpcAvailable = rpc["availability"] as? Bool,
          let appHealth = endpoint("app-gateway-v1", in: endpoints),
          let appHealthRaw = appHealth["url"] as? String,
          let appHealthURL = strictHTTPSURL(appHealthRaw, requireOrigin: false),
          appHealthURL.absoluteString == restURL.appendingPathComponent("app/health").absoluteString,
          let appHealthAvailable = appHealth["availability"] as? Bool,
          let faucetAvailable = endpoint("faucet", in: endpoints)?["availability"] as? Bool,
          let walletApprovalAvailable = endpoint("wallet-approval-deep-link", in: endpoints)?["availability"] as? Bool,
          let callbackAvailable = endpoint("wallet-callback", in: endpoints)?["availability"] as? Bool,
          let aggregate = root["aggregate"] as? [String: Any],
          let allRequiredServicesAvailable = aggregate["allRequiredServicesAvailable"] as? Bool,
          let allRequiredServicesCorsReady = aggregate["allRequiredServicesCorsReady"] as? Bool,
          let mobileWalletDiscoveryVerified = aggregate["mobileWalletDiscoveryVerified"] as? Bool,
          let mobileAccountVerified = aggregate["mobileAccountVerified"] as? Bool,
          let mobileSignVerified = aggregate["mobileSignVerified"] as? Bool,
          let mobileSendVerified = aggregate["mobileSendVerified"] as? Bool,
          let deployedPublic = aggregate["deployedPublic"] as? Bool,
          let integratedCentral = aggregate["integratedCentral"] as? Bool else {
      throw EndpointMatrixError.invalidCanonicalEndpoint
    }
    guard rpcAvailable, appHealthAvailable else { throw EndpointMatrixError.endpointUnavailable }
    return WalletEndpointConfiguration(
      matrixID: matrixID,
      restURL: restURL,
      rpcURL: rpcURL,
      rpcAvailable: rpcAvailable,
      appHealthURL: appHealthURL,
      appHealthAvailable: appHealthAvailable,
      walletSessionCompleteURL: authV1URL.appendingPathComponent("sessions/complete"),
      walletSessionIntrospectURL: authV1URL.appendingPathComponent("sessions/introspect"),
      productSessionIntrospectURL: authV2URL.appendingPathComponent("introspect"),
      faucetAvailable: faucetAvailable,
      walletApprovalAvailable: walletApprovalAvailable,
      walletCallbackAvailable: callbackAvailable,
      allRequiredServicesAvailable: allRequiredServicesAvailable,
      allRequiredServicesCorsReady: allRequiredServicesCorsReady,
      mobileWalletDiscoveryVerified: mobileWalletDiscoveryVerified,
      mobileAccountVerified: mobileAccountVerified,
      mobileSignVerified: mobileSignVerified,
      mobileSendVerified: mobileSendVerified,
      deployedPublic: deployedPublic,
      integratedCentral: integratedCentral
    )
  }

  private static func endpoint(_ id: String, in endpoints: [[String: Any]]) -> [String: Any]? {
    let matches = endpoints.filter { $0["id"] as? String == id }
    return matches.count == 1 ? matches[0] : nil
  }

  private static func strictHTTPSURL(_ rawValue: String, requireOrigin: Bool) -> URL? {
    guard let components = URLComponents(string: rawValue),
          components.scheme == "https",
          components.user == nil,
          components.password == nil,
          components.host != nil,
          components.query == nil,
          components.fragment == nil,
          components.port == nil else { return nil }
    if requireOrigin && !(components.path.isEmpty || components.path == "/") { return nil }
    return components.url
  }
}

public struct HTTPReachabilityObservation: Equatable, Sendable {
  public let statusCode: Int
  public let responseBytes: Int

  public init(statusCode: Int, responseBytes: Int) {
    self.statusCode = statusCode
    self.responseBytes = responseBytes
  }
}

public enum HTTPReachabilityResponsePolicy {
  public static let maximumBytes = 256 * 1024

  public static func verify(statusCode: Int, data: Data) throws -> HTTPReachabilityObservation {
    guard data.count <= maximumBytes else { throw EndpointMatrixError.responseTooLarge }
    guard statusCode == 200 else { throw EndpointMatrixError.invalidHTTPResponse }
    return HTTPReachabilityObservation(statusCode: statusCode, responseBytes: data.count)
  }
}

public struct AppGatewayReachabilityProbe: Sendable {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func run(configuration: WalletEndpointConfiguration) async throws -> HTTPReachabilityObservation {
    guard configuration.appHealthAvailable else { throw EndpointMatrixError.endpointUnavailable }
    var request = URLRequest(url: configuration.appHealthURL)
    request.httpMethod = "GET"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw EndpointMatrixError.invalidHTTPResponse
    }
    if let declared = http.value(forHTTPHeaderField: "Content-Length"),
       let bytes = Int(declared), bytes > HTTPReachabilityResponsePolicy.maximumBytes {
      throw EndpointMatrixError.responseTooLarge
    }
    return try HTTPReachabilityResponsePolicy.verify(statusCode: http.statusCode, data: data)
  }
}

public struct ChainRPCObservation: Equatable, Sendable {
  public let chainIDHex: String
  public let responseBytes: Int

  public init(chainIDHex: String, responseBytes: Int) {
    self.chainIDHex = chainIDHex
    self.responseBytes = responseBytes
  }
}

public enum ChainRPCResponsePolicy {
  public static let maximumBytes = 256 * 1024

  public static func verify(statusCode: Int, data: Data, requestID: Int) throws -> ChainRPCObservation {
    guard data.count <= maximumBytes else { throw EndpointMatrixError.responseTooLarge }
    guard statusCode == 200,
          let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(root.keys) == Set(["jsonrpc", "id", "result"]),
          root["jsonrpc"] as? String == "2.0",
          root["id"] as? Int == requestID,
          let result = root["result"] as? String else {
      throw EndpointMatrixError.invalidRPCResponse
    }
    guard result == WalletEndpointConfiguration.expectedChainIDHex else {
      throw EndpointMatrixError.wrongChain
    }
    return ChainRPCObservation(chainIDHex: result, responseBytes: data.count)
  }
}

public struct ChainRPCProbe: Sendable {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func run(configuration: WalletEndpointConfiguration) async throws -> ChainRPCObservation {
    guard configuration.rpcAvailable else { throw EndpointMatrixError.endpointUnavailable }
    let requestID = 1
    var request = URLRequest(url: configuration.rpcURL)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "jsonrpc": "2.0",
      "id": requestID,
      "method": "eth_chainId",
      "params": [],
    ])
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw EndpointMatrixError.invalidRPCResponse
    }
    if let declared = http.value(forHTTPHeaderField: "Content-Length"),
       let bytes = Int(declared), bytes > ChainRPCResponsePolicy.maximumBytes {
      throw EndpointMatrixError.responseTooLarge
    }
    return try ChainRPCResponsePolicy.verify(statusCode: http.statusCode, data: data, requestID: requestID)
  }
}

public struct WalletGatewayFailClosedObservation: Equatable, Sendable {
  public let walletCompletionError: String
  public let walletIntrospectionError: String
  public let productSessionIntrospectionError: String
  public let walletStateDigest: String
  public let stateUnchanged: Bool
  public let responseBytes: Int

  public init(
    walletCompletionError: String,
    walletIntrospectionError: String,
    productSessionIntrospectionError: String,
    walletStateDigest: String,
    stateUnchanged: Bool,
    responseBytes: Int
  ) {
    self.walletCompletionError = walletCompletionError
    self.walletIntrospectionError = walletIntrospectionError
    self.productSessionIntrospectionError = productSessionIntrospectionError
    self.walletStateDigest = walletStateDigest
    self.stateUnchanged = stateUnchanged
    self.responseBytes = responseBytes
  }
}

public enum WalletGatewayFailClosedResponsePolicy {
  public static let maximumBytes = 256 * 1024

  public static func verify(
    walletCompletionStatus: Int,
    walletCompletionData: Data,
    walletIntrospectionStatus: Int,
    walletIntrospectionData: Data,
    productSessionIntrospectionStatus: Int,
    productSessionIntrospectionData: Data
  ) throws -> WalletGatewayFailClosedObservation {
    let completion = try v1Rejection(
      statusCode: walletCompletionStatus,
      data: walletCompletionData,
      expectedCode: "UNKNOWN_OR_MISSING_FIELD"
    )
    let introspection = try v1Rejection(
      statusCode: walletIntrospectionStatus,
      data: walletIntrospectionData,
      expectedCode: "PROOF_REQUIRED"
    )
    guard completion.stateDigest == introspection.stateDigest else {
      throw EndpointMatrixError.invalidGatewayResponse
    }
    let productError = try v2Rejection(
      statusCode: productSessionIntrospectionStatus,
      data: productSessionIntrospectionData,
      expectedCode: "UNKNOWN_OR_MISSING_FIELD"
    )
    return WalletGatewayFailClosedObservation(
      walletCompletionError: completion.code,
      walletIntrospectionError: introspection.code,
      productSessionIntrospectionError: productError,
      walletStateDigest: completion.stateDigest,
      stateUnchanged: true,
      responseBytes: walletCompletionData.count + walletIntrospectionData.count + productSessionIntrospectionData.count
    )
  }

  private static func v1Rejection(statusCode: Int, data: Data, expectedCode: String) throws -> (code: String, stateDigest: String) {
    guard data.count <= maximumBytes,
          statusCode == 400,
          let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(root.keys) == Set(["error", "ok", "schemaVersion", "stateDigest"]),
          root["ok"] as? Bool == false,
          root["schemaVersion"] as? Int == 1,
          let stateDigest = root["stateDigest"] as? String,
          stateDigest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
          let error = root["error"] as? [String: Any],
          Set(error.keys) == Set(["code", "message"]),
          error["code"] as? String == expectedCode,
          let message = error["message"] as? String,
          !message.isEmpty else {
      throw data.count > maximumBytes ? EndpointMatrixError.responseTooLarge : EndpointMatrixError.invalidGatewayResponse
    }
    return (expectedCode, stateDigest)
  }

  private static func v2Rejection(statusCode: Int, data: Data, expectedCode: String) throws -> String {
    guard data.count <= maximumBytes,
          statusCode == 400,
          let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(root.keys) == Set(["error", "ok", "requestId", "schemaVersion"]),
          root["ok"] as? Bool == false,
          root["schemaVersion"] as? Int == 2,
          let requestID = root["requestId"] as? String,
          !requestID.isEmpty,
          requestID.utf8.count <= 128,
          let error = root["error"] as? [String: Any],
          Set(error.keys) == Set(["code", "message"]),
          error["code"] as? String == expectedCode,
          let message = error["message"] as? String,
          !message.isEmpty else {
      throw data.count > maximumBytes ? EndpointMatrixError.responseTooLarge : EndpointMatrixError.invalidGatewayResponse
    }
    return expectedCode
  }
}

public struct WalletGatewayFailClosedProbe: Sendable {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func run(configuration: WalletEndpointConfiguration) async throws -> WalletGatewayFailClosedObservation {
    let completion = try await postEmptyJSON(configuration.walletSessionCompleteURL)
    let introspection = try await postEmptyJSON(configuration.walletSessionIntrospectURL)
    let productIntrospection = try await postEmptyJSON(configuration.productSessionIntrospectURL)
    return try WalletGatewayFailClosedResponsePolicy.verify(
      walletCompletionStatus: completion.status,
      walletCompletionData: completion.data,
      walletIntrospectionStatus: introspection.status,
      walletIntrospectionData: introspection.data,
      productSessionIntrospectionStatus: productIntrospection.status,
      productSessionIntrospectionData: productIntrospection.data
    )
  }

  private func postEmptyJSON(_ url: URL) async throws -> (status: Int, data: Data) {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data("{}".utf8)
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse,
          http.url == url,
          http.mimeType == "application/json" else {
      throw EndpointMatrixError.invalidGatewayResponse
    }
    if let declared = http.value(forHTTPHeaderField: "Content-Length"),
       let bytes = Int(declared), bytes > WalletGatewayFailClosedResponsePolicy.maximumBytes {
      throw EndpointMatrixError.responseTooLarge
    }
    return (http.statusCode, data)
  }
}
