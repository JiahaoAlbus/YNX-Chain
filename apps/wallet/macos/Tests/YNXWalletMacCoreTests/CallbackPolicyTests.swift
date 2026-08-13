import XCTest
@testable import YNXWalletMacCore

final class CallbackPolicyTests: XCTestCase {
  func testMalformedAndWidenedCallbacksFailClosed() {
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://authorize?request=invalid"), .rejected(code: "CANONICAL_AUTH_BRIDGE_UNAVAILABLE"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://authorize?request=invalid&scope=wallet"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://callback?request=invalid"), .rejected(code: "INVALID_CALLBACK_ROUTE"))
    XCTAssertEqual(CallbackPolicy.evaluate("https://ynxweb4.com/authorize?request=invalid"), .rejected(code: "INVALID_CALLBACK_ROUTE"))
  }

  func testEmptyAndUnknownInputsFailClosed() {
    XCTAssertEqual(CallbackPolicy.evaluate(""), .rejected(code: "INVALID_CALLBACK_ROUTE"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://authorize"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
    XCTAssertEqual(CallbackPolicy.evaluate("ynxwallet-macos://authorize?unknown=value"), .rejected(code: "INVALID_AUTHORIZATION_REQUEST"))
  }
}
