import XCTest
@testable import YNXWalletMacCore

final class EndpointMatrixTests: XCTestCase {
  func testConsumesExactCentralEndpointMatrix() throws {
    let data = try Data(contentsOf: centralMatrixURL())
    let configuration = try EndpointMatrixPolicy.parse(data)

    XCTAssertEqual(configuration.matrixID, WalletEndpointConfiguration.expectedMatrixID)
    XCTAssertEqual(configuration.restURL.absoluteString, "https://rest.ynxweb4.com")
    XCTAssertEqual(configuration.rpcURL.absoluteString, "https://rpc.ynxweb4.com/evm")
    XCTAssertEqual(configuration.appHealthURL.absoluteString, "https://rest.ynxweb4.com/app/health")
    XCTAssertTrue(configuration.rpcAvailable)
    XCTAssertTrue(configuration.appHealthAvailable)
    XCTAssertFalse(configuration.faucetAvailable)
    XCTAssertFalse(configuration.walletApprovalAvailable)
    XCTAssertFalse(configuration.walletCallbackAvailable)
    XCTAssertFalse(configuration.allRequiredServicesAvailable)
    XCTAssertFalse(configuration.allRequiredServicesCorsReady)
    XCTAssertFalse(configuration.mobileWalletDiscoveryVerified)
    XCTAssertFalse(configuration.mobileAccountVerified)
    XCTAssertFalse(configuration.mobileSignVerified)
    XCTAssertFalse(configuration.mobileSendVerified)
    XCTAssertFalse(configuration.deployedPublic)
    XCTAssertFalse(configuration.integratedCentral)
    XCTAssertEqual(
      configuration.nativeCapabilities,
      WalletNativeCapabilities(
        authorizationCompletionAvailable: false,
        accountAvailable: false,
        signAvailable: false,
        sendAvailable: false
      )
    )
  }

  func testNativeProductCapabilitiesRequireEveryFrozenPositiveGate() throws {
    let original = try JSONSerialization.jsonObject(with: Data(contentsOf: centralMatrixURL())) as! [String: Any]
    let enabled = try EndpointMatrixPolicy.parse(try mutated(original) {
      var endpoints = $0["endpoints"] as! [[String: Any]]
      for id in ["wallet-approval-deep-link", "wallet-callback"] {
        let index = endpoints.firstIndex { $0["id"] as? String == id }!
        endpoints[index]["availability"] = true
      }
      $0["endpoints"] = endpoints
      var aggregate = $0["aggregate"] as! [String: Any]
      for key in [
        "allRequiredServicesAvailable", "mobileWalletDiscoveryVerified", "mobileAccountVerified",
        "mobileSignVerified", "mobileSendVerified", "deployedPublic", "integratedCentral",
      ] {
        aggregate[key] = true
      }
      $0["aggregate"] = aggregate
    })
    XCTAssertEqual(
      enabled.nativeCapabilities,
      WalletNativeCapabilities(
        authorizationCompletionAvailable: true,
        accountAvailable: true,
        signAvailable: true,
        sendAvailable: true
      )
    )

    let missingCallback = try EndpointMatrixPolicy.parse(try mutated(original) {
      var endpoints = $0["endpoints"] as! [[String: Any]]
      let approval = endpoints.firstIndex { $0["id"] as? String == "wallet-approval-deep-link" }!
      endpoints[approval]["availability"] = true
      $0["endpoints"] = endpoints
      var aggregate = $0["aggregate"] as! [String: Any]
      for key in [
        "allRequiredServicesAvailable", "mobileWalletDiscoveryVerified", "mobileAccountVerified",
        "mobileSignVerified", "mobileSendVerified", "deployedPublic", "integratedCentral",
      ] {
        aggregate[key] = true
      }
      $0["aggregate"] = aggregate
    })
    XCTAssertFalse(missingCallback.nativeCapabilities.authorizationCompletionAvailable)
    XCTAssertFalse(missingCallback.nativeCapabilities.accountAvailable)
    XCTAssertFalse(missingCallback.nativeCapabilities.signAvailable)
    XCTAssertFalse(missingCallback.nativeCapabilities.sendAvailable)
  }

  func testMissingFrozenProductGateRejectsTheMatrix() throws {
    let original = try JSONSerialization.jsonObject(with: Data(contentsOf: centralMatrixURL())) as! [String: Any]
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var aggregate = $0["aggregate"] as! [String: Any]
      aggregate.removeValue(forKey: "mobileSignVerified")
      $0["aggregate"] = aggregate
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidCanonicalEndpoint)
    }
  }

  func testMatrixIdentityNetworkAndAvailabilityFailClosed() throws {
    let original = try JSONSerialization.jsonObject(with: Data(contentsOf: centralMatrixURL())) as! [String: Any]

    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) { $0["matrixId"] = "other" })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .unsupportedIdentity)
    }
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var network = $0["network"] as! [String: Any]
      network["chainIdHex"] = "0x1"
      $0["network"] = network
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidNetwork)
    }
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var endpoints = $0["endpoints"] as! [[String: Any]]
      let index = endpoints.firstIndex { $0["id"] as? String == "chain-rpc-canonical" }!
      endpoints[index]["availability"] = false
      $0["endpoints"] = endpoints
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .endpointUnavailable)
    }
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var endpoints = $0["endpoints"] as! [[String: Any]]
      let index = endpoints.firstIndex { $0["id"] as? String == "app-gateway-v1" }!
      endpoints[index]["availability"] = false
      $0["endpoints"] = endpoints
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .endpointUnavailable)
    }
  }

  func testHTTPReachabilityRequires200AndBoundedResponse() throws {
    let body = Data(#"{"status":"ok"}"#.utf8)
    XCTAssertEqual(
      try HTTPReachabilityResponsePolicy.verify(statusCode: 200, data: body),
      HTTPReachabilityObservation(statusCode: 200, responseBytes: body.count)
    )
    XCTAssertThrowsError(try HTTPReachabilityResponsePolicy.verify(statusCode: 503, data: body)) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidHTTPResponse)
    }
    XCTAssertThrowsError(try HTTPReachabilityResponsePolicy.verify(
      statusCode: 200,
      data: Data(repeating: 0, count: HTTPReachabilityResponsePolicy.maximumBytes + 1)
    )) {
      XCTAssertEqual($0 as? EndpointMatrixError, .responseTooLarge)
    }
  }

  func testMatrixRejectsHTTPAndRPCURLDrift() throws {
    let original = try JSONSerialization.jsonObject(with: Data(contentsOf: centralMatrixURL())) as! [String: Any]
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var canonical = $0["canonical"] as! [String: Any]
      canonical["restUrl"] = "http://rest.ynxweb4.com"
      $0["canonical"] = canonical
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidCanonicalEndpoint)
    }
    XCTAssertThrowsError(try EndpointMatrixPolicy.parse(try mutated(original) {
      var canonical = $0["canonical"] as! [String: Any]
      canonical["rpcUrl"] = "https://rpc.ynxweb4.com/other"
      $0["canonical"] = canonical
    })) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidCanonicalEndpoint)
    }
  }

  func testRPCResponseRequiresExactChainAndBinding() throws {
    let valid = Data(#"{"jsonrpc":"2.0","id":1,"result":"0x1917"}"#.utf8)
    XCTAssertEqual(
      try ChainRPCResponsePolicy.verify(statusCode: 200, data: valid, requestID: 1),
      ChainRPCObservation(chainIDHex: "0x1917", responseBytes: valid.count)
    )
    XCTAssertThrowsError(try ChainRPCResponsePolicy.verify(
      statusCode: 200,
      data: Data(#"{"jsonrpc":"2.0","id":1,"result":"0x1"}"#.utf8),
      requestID: 1
    )) {
      XCTAssertEqual($0 as? EndpointMatrixError, .wrongChain)
    }
    XCTAssertThrowsError(try ChainRPCResponsePolicy.verify(
      statusCode: 200,
      data: Data(#"{"jsonrpc":"2.0","id":2,"result":"0x1917"}"#.utf8),
      requestID: 1
    )) {
      XCTAssertEqual($0 as? EndpointMatrixError, .invalidRPCResponse)
    }
  }

  private func mutated(_ source: [String: Any], change: (inout [String: Any]) -> Void) throws -> Data {
    var value = source
    change(&value)
    return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  }

  private func centralMatrixURL() -> URL {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { root.deleteLastPathComponent() }
    return root.appendingPathComponent("release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json")
  }
}
