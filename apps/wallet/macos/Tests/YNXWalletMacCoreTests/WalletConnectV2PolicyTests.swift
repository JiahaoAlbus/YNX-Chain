import Foundation
import XCTest
@testable import YNXWalletMacCore

final class WalletConnectV2PolicyTests: XCTestCase {
  private let projectID = "0123456789abcdef0123456789abcdef"
  private let topic = String(repeating: "a", count: 64)
  private let symKey = String(repeating: "b", count: 64)
  private let account = "0x1111111111111111111111111111111111111111"

  func testParsesExactV2DeepLinkOnlyWithExplicitProjectID() throws {
    let uri = "wc:\(topic)@2?symKey=\(symKey)&relay-protocol=irn&expiryTimestamp=2000000000"
    let encoded = uri.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    let result = try WalletConnectV2Policy.parseDeepLink(
      "ynxwallet://wc?uri=\(encoded)",
      projectID: projectID,
      now: Date(timeIntervalSince1970: 1_900_000_000)
    )
    XCTAssertEqual(result.topic, topic)
    XCTAssertEqual(result.projectID, projectID)
    XCTAssertEqual(result.uri, uri)
  }

  func testMissingOrPlaceholderProjectIDFailsClosed() {
    let link = "ynxwallet://wc?uri=wc%3Ainvalid"
    XCTAssertThrowsError(try WalletConnectV2Policy.parseDeepLink(link, projectID: nil)) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .invalidProjectID)
    }
    XCTAssertThrowsError(try WalletConnectV2Policy.parseDeepLink(link, projectID: "FAKEPROJECTID")) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .invalidProjectID)
    }
  }

  func testRejectsRouteWideningDuplicateParametersAndExpiredURI() {
    let validURI = "wc:\(topic)@2?symKey=\(symKey)&relay-protocol=irn"
    XCTAssertThrowsError(
      try WalletConnectV2Policy.parseDeepLink(
        "ynxwallet://authorize?uri=\(validURI)",
        projectID: projectID
      )
    )
    XCTAssertThrowsError(
      try WalletConnectV2Policy.parseDeepLink(
        "ynxwallet://wc?uri=\(validURI)&uri=\(validURI)",
        projectID: projectID
      )
    )
    let expired = "wc:\(topic)@2?symKey=\(symKey)&relay-protocol=irn&expiryTimestamp=100"
    XCTAssertThrowsError(
      try WalletConnectV2Policy.parseDeepLink(
        "ynxwallet://wc?uri=\(expired.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)",
        projectID: projectID,
        now: Date(timeIntervalSince1970: 101)
      )
    ) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .expiredPairingURI)
    }
  }

  func testApprovesOnlyYNXChainSupportedSurfaceAndApprovedEVMAccount() throws {
    let result = try WalletConnectV2Policy.approve(
      requiredChains: ["eip155:6423"],
      requiredMethods: ["personal_sign", "eth_sendTransaction"],
      requiredEvents: ["accountsChanged", "chainChanged"],
      optionalMethods: ["eth_signTypedData_v4", "eth_sign"],
      optionalEvents: ["disconnect", "message"],
      approvedAccount: account
    )
    XCTAssertEqual(result.chain, "eip155:6423")
    XCTAssertEqual(result.account, "eip155:6423:\(account)")
    XCTAssertEqual(result.methods, ["personal_sign", "eth_sendTransaction", "eth_signTypedData_v4"])
    XCTAssertEqual(result.events, ["accountsChanged", "chainChanged", "disconnect"])
  }

  func testRejectsUnapprovedAccountAndRequiredSurfaceWidening() {
    XCTAssertThrowsError(
      try WalletConnectV2Policy.approve(
        requiredChains: ["eip155:6423"],
        requiredMethods: ["personal_sign"],
        requiredEvents: [],
        approvedAccount: nil
      )
    ) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .accountNotApproved)
    }
    XCTAssertThrowsError(
      try WalletConnectV2Policy.approve(
        requiredChains: ["eip155:1"],
        requiredMethods: ["eth_sign"],
        requiredEvents: ["message"],
        approvedAccount: account
      )
    ) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .unsupportedNamespace)
    }
  }
}
