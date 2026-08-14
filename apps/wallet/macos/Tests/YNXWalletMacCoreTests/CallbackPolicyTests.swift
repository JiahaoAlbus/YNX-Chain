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
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet://authorize?request=invalid"), .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE"))
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
      .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE"),
    ])
    XCTAssertEqual(inbox.count, 0)
  }
}
