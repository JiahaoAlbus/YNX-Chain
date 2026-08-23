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

  func testRestoredSessionAndRequestRemainBoundToApprovedSurface() throws {
    let approved = WalletConnectV2SessionSurface(
      chains: [WalletConnectV2Policy.chain],
      accounts: ["eip155:6423:\(account)"],
      methods: ["eth_requestAccounts", "personal_sign"],
      events: ["accountsChanged", "disconnect"]
    )
    XCTAssertNoThrow(try WalletConnectV2Policy.validateRestoredSession(
      surfaces: [approved], approvedAccount: account
    ))
    XCTAssertNoThrow(try WalletConnectV2Policy.authorizeSessionRequest(
      method: "personal_sign", chainID: WalletConnectV2Policy.chain,
      surfaces: [approved], approvedAccount: account
    ))
    XCTAssertThrowsError(try WalletConnectV2Policy.authorizeSessionRequest(
      method: "eth_sendTransaction", chainID: WalletConnectV2Policy.chain,
      surfaces: [approved], approvedAccount: account
    )) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .methodNotApproved)
    }

    let widened = WalletConnectV2SessionSurface(
      chains: [WalletConnectV2Policy.chain, "eip155:1"],
      accounts: ["eip155:6423:\(account)"],
      methods: ["personal_sign"], events: []
    )
    XCTAssertThrowsError(try WalletConnectV2Policy.validateRestoredSession(
      surfaces: [widened], approvedAccount: account
    )) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .invalidSession)
    }
  }

  func testChainManagementRequestRequiresStructuralYNXParameters() throws {
    XCTAssertNoThrow(try WalletConnectV2Policy.validateChainManagementRequest(
      method: "wallet_switchEthereumChain",
      paramsJSON: #"[{"chainId":"0x1917"}]"#
    ))
    XCTAssertNoThrow(try WalletConnectV2Policy.validateChainManagementRequest(
      method: "wallet_addEthereumChain",
      paramsJSON: #"[{"chainId":"0x1917","chainName":"YNX Testnet","nativeCurrency":{"decimals":18,"name":"YNX Testnet","symbol":"YNXT"},"rpcUrls":["https://rpc.ynxweb4.com/evm"]}]"#
    ))
    XCTAssertThrowsError(try WalletConnectV2Policy.validateChainManagementRequest(
      method: "wallet_switchEthereumChain",
      paramsJSON: #"[{"chainId":"0x1","note":"contains 0x1917"}]"#
    )) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .unsupportedNamespace)
    }
    XCTAssertThrowsError(try WalletConnectV2Policy.validateChainManagementRequest(
      method: "wallet_addEthereumChain",
      paramsJSON: #"[{"chainId":"0x1917","rpcUrls":["https://evil.example/rpc"]}]"#
    )) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .invalidChainRequest)
    }
  }
}
