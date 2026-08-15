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
  public let faucetAvailable: Bool
  public let walletCallbackAvailable: Bool
  public let integratedCentral: Bool

  public init(
    matrixID: String,
    restURL: URL,
    rpcURL: URL,
    rpcAvailable: Bool,
    appHealthURL: URL,
    appHealthAvailable: Bool,
    faucetAvailable: Bool,
    walletCallbackAvailable: Bool,
    integratedCentral: Bool
  ) {
    self.matrixID = matrixID
    self.restURL = restURL
    self.rpcURL = rpcURL
    self.rpcAvailable = rpcAvailable
    self.appHealthURL = appHealthURL
    self.appHealthAvailable = appHealthAvailable
    self.faucetAvailable = faucetAvailable
    self.walletCallbackAvailable = walletCallbackAvailable
    self.integratedCentral = integratedCentral
  }
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
          let restURL = strictHTTPSURL(restRaw, requireOrigin: true),
          let rpcURL = strictHTTPSURL(rpcRaw, requireOrigin: false),
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
          let callbackAvailable = endpoint("wallet-callback", in: endpoints)?["availability"] as? Bool,
          let aggregate = root["aggregate"] as? [String: Any],
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
      faucetAvailable: faucetAvailable,
      walletCallbackAvailable: callbackAvailable,
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
