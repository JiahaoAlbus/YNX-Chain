import XCTest
@testable import YNXWalletMacCore

final class CallbackPolicyTests: XCTestCase {
  func testFreshRecoveryVaultIsAbsentWithoutAuthentication() throws {
    let vault = KeychainRecoveryVault(
      service: "com.ynxweb4.wallet.macos.tests",
      account: UUID().uuidString
    )
    XCTAssertTrue(try vault.isAbsentWithoutAuthentication())
  }

  func testRecoveryMaterialRequiresExactly256Bits() throws {
    let material = Data(repeating: 0x5a, count: RecoveryMaterial.byteCount)
    XCTAssertEqual(try RecoveryMaterial.validate(material), material)
    XCTAssertThrowsError(try RecoveryMaterial.validate(Data()))
    XCTAssertThrowsError(try RecoveryMaterial.validate(Data(repeating: 0, count: 31)))
    XCTAssertThrowsError(try RecoveryMaterial.validate(Data(repeating: 0, count: 33)))
  }

  func testRecoveryMaterialUsesSystemRandomness() throws {
    let first = try RecoveryMaterial.generate()
    let second = try RecoveryMaterial.generate()
    XCTAssertEqual(first.count, 32)
    XCTAssertEqual(second.count, 32)
    XCTAssertNotEqual(first, second)
  }

  func testMalformedAndWidenedCallbacksFailClosed() {
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://authorize?request=invalid"), .rejected(code: "INVALID_DEEP_LINK"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://authorize?request=invalid&scope=wallet"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://callback?request=invalid"), .rejected(code: "INVALID_CALLBACK_ROUTE"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://authorize?request=invalid"), .rejected(code: "INVALID_CALLBACK_ROUTE"))
    XCTAssertEqual(CallbackPolicy.evaluate("https://ynxweb4.com/authorize?request=invalid"), .rejected(code: "INVALID_CALLBACK_ROUTE"))
  }

  func testEmptyAndUnknownInputsFailClosed() {
    XCTAssertEqual(CallbackPolicy.evaluate(""), .rejected(code: "INVALID_CALLBACK_ROUTE"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://authorize"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://authorize?unknown=value"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
  }

  func testColdStartInboxPreservesTwoCallbacksInOrder() {
    var inbox = PendingCallbackInbox()
    inbox.enqueue("ynxwallet://authorize?request=invalid&scope=wallet")
    inbox.enqueue("ynxwallet://authorize?request=invalid")

    XCTAssertEqual(inbox.count, 2)
    let decisions = inbox.drain().map(CallbackPolicy.evaluate)
    XCTAssertEqual(decisions, [
      .rejected(code: "INVALID_AUTHORIZATION_REQUEST"),
      .rejected(code: "INVALID_DEEP_LINK"),
    ])
    XCTAssertEqual(inbox.count, 0)
  }

  func testFrozenAuthorizationRequestAndRegistryStillFailClosedBeforeApproval() throws {
    let registry = try registryData()
    let now = try XCTUnwrap(ISO8601DateFormatter.ynx.date(from: "2026-08-15T12:00:00.000Z"))
    let valid = deepLink(request(product: "social", client: "ynx-social-v1", bundle: "com.ynx.social", callback: "ynx-social://com.ynx.social", scopes: ["account:read", "profile:link"]))
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(valid, registryData: registry, now: now),
      .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE")
    )
  }

  func testRegistryValidationDoesNotDependOnAProductCountSnapshot() throws {
    let registry = try registryObject()
    let products = try XCTUnwrap(registry["products"] as? [[String: Any]])
    let social = try XCTUnwrap(products.first { $0["productClientId"] as? String == "ynx-social-v1" })
    var reducedRegistry = registry
    reducedRegistry["products"] = [social]
    let reducedData = try JSONSerialization.data(withJSONObject: reducedRegistry, options: [.sortedKeys])
    let now = try XCTUnwrap(ISO8601DateFormatter.ynx.date(from: "2026-08-15T12:00:00.000Z"))

    let valid = deepLink(request(product: "social", client: "ynx-social-v1", bundle: "com.ynx.social", callback: "ynx-social://com.ynx.social", scopes: ["account:read", "profile:link"]))
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(valid, registryData: reducedData, now: now),
      .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE")
    )
  }

  func testDuplicateOrMissingRegistryClientIDsFailClosed() throws {
    let registry = try registryObject()
    let products = try XCTUnwrap(registry["products"] as? [[String: Any]])
    let social = try XCTUnwrap(products.first { $0["productClientId"] as? String == "ynx-social-v1" })
    let now = try XCTUnwrap(ISO8601DateFormatter.ynx.date(from: "2026-08-15T12:00:00.000Z"))
    let valid = deepLink(request(product: "social", client: "ynx-social-v1", bundle: "com.ynx.social", callback: "ynx-social://com.ynx.social", scopes: ["account:read", "profile:link"]))

    var duplicateRegistry = registry
    duplicateRegistry["products"] = [social, social]
    let duplicateData = try JSONSerialization.data(withJSONObject: duplicateRegistry, options: [.sortedKeys])
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(valid, registryData: duplicateData, now: now),
      .rejected(code: "INVALID_REGISTRY")
    )

    var missingClient = social
    missingClient.removeValue(forKey: "productClientId")
    var missingRegistry = registry
    missingRegistry["products"] = [missingClient]
    let missingData = try JSONSerialization.data(withJSONObject: missingRegistry, options: [.sortedKeys])
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(valid, registryData: missingData, now: now),
      .rejected(code: "INVALID_REGISTRY")
    )
  }

  func testDisabledUnknownAndMismatchedRegistrationsFailClosed() throws {
    let registry = try registryData()
    let now = try XCTUnwrap(ISO8601DateFormatter.ynx.date(from: "2026-08-15T12:00:00.000Z"))
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(
        deepLink(request(product: "ai", client: "ynx-ai-v1", bundle: "com.ynxweb4.ai", callback: "ynxai://wallet-auth/callback", scopes: ["ai:account"])),
        registryData: registry,
        now: now
      ),
      .rejected(code: "REGISTRY_DISABLED")
    )
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(
        deepLink(request(product: "social", client: "ynx-unknown-v1", bundle: "com.ynx.social", callback: "ynx-social://com.ynx.social", scopes: ["account:read"])),
        registryData: registry,
        now: now
      ),
      .rejected(code: "UNKNOWN_PRODUCT")
    )
    XCTAssertEqual(
      NativeAuthorizationPolicy.evaluate(
        deepLink(request(product: "social", client: "ynx-social-v1", bundle: "com.ynx.social", callback: "ynx-social://com.ynx.social", scopes: ["wallet:sign"])),
        registryData: registry,
        now: now
      ),
      .rejected(code: "SCOPE_NOT_ALLOWED")
    )
  }

  private func request(product: String, client: String, bundle: String, callback: String, scopes: [String]) -> [String: Any] {
    [
      "version": "1",
      "nonce": "nonce_abcdefghijklmnopqrstuvwxyz12",
      "chainId": "ynx_6423-1",
      "requestingProduct": product,
      "productClientId": client,
      "bundleId": bundle,
      "productDeviceAlgorithm": "p256-sha256",
      "productDeviceKey": "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",
      "callback": callback,
      "scopes": scopes,
      "purpose": "Review an exact Testnet authorization request.",
      "issuedAt": "2026-08-15T11:59:00.000Z",
      "expiresAt": "2026-08-15T12:04:00.000Z",
    ]
  }

  private func deepLink(_ request: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
    let encoded = data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    return "ynxwallet://authorize?request=\(encoded)"
  }

  private func registryData() throws -> Data {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "central-registry", withExtension: "json"))
    return try Data(contentsOf: url)
  }

  private func registryObject() throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: registryData()) as? [String: Any])
  }
}

private extension ISO8601DateFormatter {
  static let ynx: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
