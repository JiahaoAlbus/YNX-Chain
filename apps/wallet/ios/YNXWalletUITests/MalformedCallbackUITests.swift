import Foundation
import XCTest

final class MalformedCallbackUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testMalformedCallbackIsDeliveredAndRejected() throws {
    let wallet = XCUIApplication()
    wallet.launch()
    FileHandle.standardError.write(Data("YNX_WALLET_CALLBACK_TEST_COLD_LAUNCH_COMPLETE\n".utf8))

    wallet.terminate()
    wallet.launch()

    FileHandle.standardError.write(Data("YNX_WALLET_UI_READY_FOR_SIMCTL_OPENURL secondLaunch=true\n".utf8))

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.buttons["Open"]
    XCTAssertTrue(
      openButton.waitForExistence(timeout: 60),
      "simctl openurl did not expose a semantic Open action"
    )
    openButton.tap()

    XCTAssertTrue(wallet.alerts["Request rejected"].waitForExistence(timeout: 45))
    XCTAssertTrue(wallet.staticTexts["INVALID_DEEP_LINK"].exists)
    XCTAssertTrue(wallet.buttons["Dismiss"].exists)

    let screenshot = XCTAttachment(screenshot: wallet.screenshot())
    screenshot.name = "malformed-callback-fail-closed"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    FileHandle.standardError.write(Data("YNX_WALLET_SECOND_LAUNCH_CALLBACK_VISIBLE code=INVALID_DEEP_LINK authorizationSuccess=false signing=false callbackEmitted=false\n".utf8))
  }

  func testCanonicalRegistryRequestStopsAtNativeBridge() throws {
    let wallet = XCUIApplication()
    wallet.launch()
    FileHandle.standardError.write(Data("YNX_WALLET_CANONICAL_UI_READY_FOR_SIMCTL_OPENURL\n".utf8))

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.buttons["Open"]
    let rejection = wallet.alerts["Request rejected"]
    let deadline = Date().addingTimeInterval(60)
    var deliveryMode: String?
    while Date() < deadline {
      if rejection.exists {
        deliveryMode = "direct-after-prior-scheme-confirmation"
        break
      }
      if openButton.exists {
        openButton.tap()
        deliveryMode = "system-confirmed"
        break
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    XCTAssertNotNil(
      deliveryMode,
      "Canonical simctl openurl produced neither a semantic system confirmation nor Wallet rejection UI"
    )
    FileHandle.standardError.write(
      Data("YNX_WALLET_CANONICAL_OPENURL_DELIVERY mode=\(deliveryMode ?? "unavailable")\n".utf8)
    )

    XCTAssertTrue(rejection.waitForExistence(timeout: 45))
    XCTAssertTrue(wallet.staticTexts["CANONICAL_AUTH_BRIDGE_UNAVAILABLE"].exists)
    XCTAssertTrue(wallet.buttons["Dismiss"].exists)
    let screenshot = XCTAttachment(screenshot: wallet.screenshot())
    screenshot.name = "canonical-registry-native-bridge-fail-closed"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testRecoveryRemainsEmptyWhenBiometricAuthorizationIsNotCompleted() throws {
    let wallet = XCUIApplication()
    wallet.launch()

    let recover = wallet.buttons["Recover on a replacement device"]
    XCTAssertTrue(recover.waitForExistence(timeout: 45), "Fresh Wallet recovery action is unavailable")
    recover.tap()

    let textView = wallet.textViews["Recovery key"]
    let secureField = wallet.secureTextFields["Recovery key"]
    let recoveryField = textView.waitForExistence(timeout: 15) ? textView : secureField
    XCTAssertTrue(recoveryField.waitForExistence(timeout: 15), "Recovery key field is unavailable")
    recoveryField.tap()
    recoveryField.typeText(String(repeating: "0", count: 64))

    let semanticSubmit = wallet.keyboards.buttons["Done"]
    XCTAssertTrue(
      semanticSubmit.waitForExistence(timeout: 15),
      "Recovery input did not expose its semantic authorization submit action"
    )

    let persist = wallet.buttons["Recover into secure storage"]
    let enabled = NSPredicate(format: "enabled == true")
    let enabledExpectation = expectation(for: enabled, evaluatedWith: persist)
    XCTAssertEqual(
      XCTWaiter.wait(for: [enabledExpectation], timeout: 15),
      .completed,
      "Recovery action did not accept the isolated 32-byte test vector"
    )
    semanticSubmit.tap()
    XCTAssertTrue(
      persist.waitForExistence(timeout: 5),
      "Recovery sheet disappeared before authorization produced a result"
    )

    let failure = wallet.staticTexts["Recovery authorization failed"]
    if !failure.waitForExistence(timeout: 5) {
      let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      let cancel = springboard.buttons["Cancel"]
      XCTAssertTrue(
        cancel.waitForExistence(timeout: 15),
        "Recovery neither failed closed nor exposed a semantic biometric cancellation action"
      )
      cancel.tap()
      FileHandle.standardError.write(
        Data("YNX_WALLET_RECOVERY_AUTHORIZATION_NOT_COMPLETED mode=system-prompt-cancelled\n".utf8)
      )
    } else {
      FileHandle.standardError.write(
        Data("YNX_WALLET_RECOVERY_AUTHORIZATION_NOT_COMPLETED mode=native-unavailable\n".utf8)
      )
    }
    XCTAssertTrue(
      failure.waitForExistence(timeout: 30),
      "Recovery did not expose its fail-closed authorization error"
    )
    XCTAssertTrue(wallet.buttons["Recover into secure storage"].exists)

    let rejected = XCTAttachment(screenshot: wallet.screenshot())
    rejected.name = "recovery-biometric-fail-closed"
    rejected.lifetime = .keepAlways
    add(rejected)

    wallet.terminate()
    wallet.launch()
    XCTAssertTrue(
      wallet.buttons["Create a new Wallet"].waitForExistence(timeout: 45),
      "Failed recovery unexpectedly persisted an account across process restart"
    )

    let restart = XCTAttachment(screenshot: wallet.screenshot())
    restart.name = "recovery-second-launch-empty"
    restart.lifetime = .keepAlways
    add(restart)
  }

  func testRecoveryAndUnlockWithSimulatedBiometricMatches() throws {
    let wallet = XCUIApplication()
    wallet.launch()

    let recover = wallet.buttons["Recover on a replacement device"]
    XCTAssertTrue(recover.waitForExistence(timeout: 45), "Fresh Wallet recovery action is unavailable")
    recover.tap()

    let textView = wallet.textViews["Recovery key"]
    let secureField = wallet.secureTextFields["Recovery key"]
    let recoveryField = textView.waitForExistence(timeout: 15) ? textView : secureField
    XCTAssertTrue(recoveryField.waitForExistence(timeout: 15), "Recovery key field is unavailable")
    recoveryField.tap()
    recoveryField.typeText(String(repeating: "1", count: 64))

    let semanticSubmit = wallet.keyboards.buttons["Done"]
    XCTAssertTrue(semanticSubmit.waitForExistence(timeout: 15), "Recovery input has no semantic submit action")
    semanticSubmit.tap()

    let unlock = wallet.buttons["Unlock with biometrics"]
    XCTAssertTrue(
      unlock.waitForExistence(timeout: 45),
      "Matched Simulator biometric did not persist and lock the recovered account"
    )
    let recovered = XCTAttachment(screenshot: wallet.screenshot())
    recovered.name = "simulated-biometric-recovery-persisted-locked"
    recovered.lifetime = .keepAlways
    add(recovered)

    unlock.tap()
    XCTAssertTrue(
      wallet.staticTexts["NATIVE ACCOUNT"].waitForExistence(timeout: 45),
      "Second matched Simulator biometric did not unlock the recovered account"
    )

    let unlocked = XCTAttachment(screenshot: wallet.screenshot())
    unlocked.name = "simulated-biometric-recovery-unlocked"
    unlocked.lifetime = .keepAlways
    add(unlocked)
    FileHandle.standardError.write(
      Data("YNX_WALLET_SIMULATED_BIOMETRIC_MATCHED recovery=true unlock=true\n".utf8)
    )
  }

  func testWalletConnectPendingDecisionsRestoreAndFailClosedWithoutRelay() throws {
    let now = Date(timeIntervalSince1970: 2_000_000_000)
    let approvedAccount = "0x1111111111111111111111111111111111111111"
    let digest = "0x" + String(repeating: "b", count: 64)
    let signature = "0x" + String(repeating: "1", count: 130)
    let typedSignature = "0x" + String(repeating: "2", count: 130)
    let transactionHash = "0x" + String(repeating: "3", count: 64)

    XCTAssertThrowsError(
      try WalletConnectV2Policy.parseDeepLink("ynxwallet://wc?uri=wc%3Ainvalid", projectID: nil)
    ) {
      XCTAssertEqual($0 as? WalletConnectV2PolicyError, .invalidProjectID)
    }

    for (index, dappClass) in [WalletConnectV2DAppClass.firstParty, .external].enumerated() {
      let topic = String(repeating: index == 0 ? "a" : "c", count: 64)
      let file = FileManager.default.temporaryDirectory
        .appendingPathComponent("ynx-ios-walletconnect-\(UUID().uuidString)")
        .appendingPathComponent("state.json")
      let proposal = WalletConnectV2PendingRequest(
        id: "proposal-\(index)", topic: topic, kind: .sessionProposal,
        dappClass: dappClass,
        dappName: dappClass == .firstParty ? "YNX First Party" : "External EVM DApp",
        method: "wc_sessionPropose", paramsDigest: digest,
        receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
      )
      let initial = try WalletConnectV2StateStore(fileURL: file)
      try initial.enqueue(proposal, now: now)
      let restarted = try WalletConnectV2StateStore(fileURL: file)
      XCTAssertEqual(try restarted.restoredPending(now: now), [proposal])

      let approval = try WalletConnectV2Policy.approve(
        requiredChains: [WalletConnectV2Policy.chain],
        requiredMethods: [
          "eth_requestAccounts", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
        ],
        requiredEvents: ["accountsChanged", "disconnect"],
        approvedAccount: approvedAccount
      )
      XCTAssertEqual(
        try restarted.approveProposal(requestID: proposal.id, approval: approval, now: now).result,
        .success("eip155:6423:\(approvedAccount)")
      )

      func request(_ id: String, _ method: String) -> WalletConnectV2PendingRequest {
        WalletConnectV2PendingRequest(
          id: "\(id)-\(index)", topic: topic, kind: .sessionRequest,
          dappClass: dappClass,
          dappName: dappClass == .firstParty ? "YNX First Party" : "External EVM DApp",
          method: method, paramsDigest: digest,
          receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
        )
      }

      let accounts = request("accounts", "eth_requestAccounts")
      try restarted.enqueue(accounts, now: now)
      XCTAssertThrowsError(
        try restarted.resolveRequest(
          requestID: accounts.id,
          executionResult: "[\"0x2222222222222222222222222222222222222222\"]",
          now: now
        )
      )
      XCTAssertEqual(
        try restarted.resolveRequest(
          requestID: accounts.id,
          executionResult: "[\"\(approvedAccount)\"]",
          now: now
        ).result,
        .success("[\"\(approvedAccount)\"]")
      )

      for (id, method, result) in [
        ("sign", "personal_sign", signature),
        ("typed", "eth_signTypedData_v4", typedSignature),
        ("send", "eth_sendTransaction", transactionHash),
      ] {
        let pending = request(id, method)
        try restarted.enqueue(pending, now: now)
        XCTAssertThrowsError(
          try restarted.resolveRequest(requestID: pending.id, executionResult: "0xfake", now: now)
        )
        XCTAssertEqual(
          try restarted.resolveRequest(requestID: pending.id, executionResult: result, now: now).result,
          .success(result)
        )
      }

      let rejected = request("reject", "personal_sign")
      try restarted.enqueue(rejected, now: now)
      XCTAssertEqual(
        try restarted.reject(requestID: rejected.id, now: now).result,
        .rejected(code: 4001, message: "User rejected the request")
      )
      XCTAssertTrue(try restarted.disconnect(topic: topic))
      let disconnected = try WalletConnectV2StateStore(fileURL: file)
      XCTAssertTrue(disconnected.restoredSessions().isEmpty)
      XCTAssertTrue(try disconnected.restoredPending(now: now).isEmpty)
      XCTAssertFalse(try disconnected.revoke(topic: topic))
    }

    FileHandle.standardError.write(Data(
      "YNX_WALLETCONNECT_NATIVE_STATE_CONTRACT firstParty=true external=true restart=true approve=true reject=true personalSign=true eip712=true send=true disconnect=true revoke=true relay=false\n".utf8
    ))
  }

  func testWalletConnectCallbackFailsClosedWithoutProjectID() throws {
    let now = Date(timeIntervalSince1970: 1_900_000_000)
    let topic = String(repeating: "a", count: 64)
    let symKey = String(repeating: "b", count: 64)
    let uri = "wc:\(topic)@2?symKey=\(symKey)&relay-protocol=irn&expiryTimestamp=2000000000"
    let encoded = uri.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
    let callback = "ynxwallet://wc?uri=\(encoded)"
    XCTAssertEqual(
      NativeWalletConnectInboundPolicy.evaluate(callback, projectID: nil, now: now),
      .rejected(code: "WALLETCONNECT_PROJECT_ID_UNAVAILABLE")
    )
    XCTAssertEqual(
      NativeWalletConnectInboundPolicy.evaluate(
        callback,
        projectID: "0123456789abcdef0123456789abcdef",
        now: now
      ),
      .rejected(code: "WALLETCONNECT_RELAY_UNAVAILABLE")
    )
    XCTAssertEqual(
      NativeWalletConnectInboundPolicy.evaluate("ynxwallet://authorize?request=invalid", projectID: nil),
      .notWalletConnect
    )

    let wallet = XCUIApplication()
    wallet.launch()
    FileHandle.standardError.write(Data("YNX_WALLET_WALLETCONNECT_UI_READY_FOR_SIMCTL_OPENURL\n".utf8))

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.buttons["Open"]
    let rejection = wallet.alerts["WalletConnect unavailable"]
    let deadline = Date().addingTimeInterval(60)
    var deliveryMode: String?
    while Date() < deadline {
      if rejection.exists {
        deliveryMode = "direct-after-prior-scheme-confirmation"
        break
      }
      if openButton.exists {
        openButton.tap()
        deliveryMode = "system-confirmed"
        break
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
    XCTAssertNotNil(deliveryMode, "WalletConnect callback was not delivered through a semantic system action")
    XCTAssertTrue(rejection.waitForExistence(timeout: 45))
    XCTAssertTrue(wallet.staticTexts["WALLETCONNECT_PROJECT_ID_UNAVAILABLE"].exists)
    XCTAssertTrue(wallet.buttons["Dismiss"].exists)
    let screenshot = XCTAttachment(screenshot: wallet.screenshot())
    screenshot.name = "walletconnect-project-id-relay-fail-closed"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    FileHandle.standardError.write(Data(
      "YNX_WALLET_WALLETCONNECT_CALLBACK_VISIBLE projectID=false relay=false pairing=false approval=false delivery=\(deliveryMode ?? "unavailable")\n".utf8
    ))
  }

  func testUniversalLinkRemainsFailClosedWithoutFrozenAssociatedDomain() throws {
    XCTAssertFalse(InboundLinkPolicy.associatedDomainFrozen)
    XCTAssertEqual(
      InboundLinkPolicy.evaluateUniversalLink(URL(string: "https://ynxweb4.com/authorize?request=invalid")),
      .rejected(code: "ASSOCIATED_DOMAIN_UNAVAILABLE")
    )
    XCTAssertEqual(
      InboundLinkPolicy.evaluateUniversalLink(URL(string: "http://ynxweb4.com/authorize?request=invalid")),
      .rejected(code: "INVALID_UNIVERSAL_LINK")
    )
    XCTAssertEqual(
      InboundLinkPolicy.evaluateUniversalLink(nil),
      .rejected(code: "INVALID_UNIVERSAL_LINK")
    )
  }
}
