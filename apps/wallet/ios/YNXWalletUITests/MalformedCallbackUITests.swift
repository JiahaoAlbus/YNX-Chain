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
    // The preceding malformed-link proof intentionally leaves its rejection
    // visible.  xcodebuild runs this proof as a separate invocation against
    // the same simulator, so launch() may only activate that existing process
    // and mistake the stale INVALID_DEEP_LINK alert for canonical delivery.
    // Establish a real process boundary before accepting any delivery signal.
    wallet.terminate()
    wallet.launch()
    XCTAssertFalse(
      wallet.alerts["Request rejected"].exists,
      "A rejection from an earlier authorization request survived the clean launch boundary"
    )
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
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
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
    let recoveryPrompt = springboard.staticTexts["Import a YNX Wallet account"]
    XCTAssertTrue(
      recoveryPrompt.waitForExistence(timeout: 30),
      "LocalAuthentication recovery prompt did not appear after Simulator enrollment"
    )
    let recoveryPromptAttachment = XCTAttachment(screenshot: springboard.screenshot())
    recoveryPromptAttachment.name = "simulated-biometric-recovery-system-prompt"
    recoveryPromptAttachment.lifetime = .keepAlways
    add(recoveryPromptAttachment)
    FileHandle.standardError.write(
      Data("YNX_WALLET_SIMULATED_BIOMETRIC_READY phase=recovery prompt=true\n".utf8)
    )

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
    let unlockPrompt = springboard.staticTexts["Unlock YNX Wallet"]
    XCTAssertTrue(
      unlockPrompt.waitForExistence(timeout: 30),
      "LocalAuthentication unlock prompt did not appear for the persisted account"
    )
    let unlockPromptAttachment = XCTAttachment(screenshot: springboard.screenshot())
    unlockPromptAttachment.name = "simulated-biometric-unlock-system-prompt"
    unlockPromptAttachment.lifetime = .keepAlways
    add(unlockPromptAttachment)
    FileHandle.standardError.write(
      Data("YNX_WALLET_SIMULATED_BIOMETRIC_READY phase=unlock prompt=true\n".utf8)
    )
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
