import Foundation
import XCTest

final class MalformedCallbackUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testMalformedCallbackIsDeliveredAndRejected() throws {
    let wallet = XCUIApplication()
    wallet.launch()

    let rejection = wallet.staticTexts["Invalid Wallet authorization rejected"]
    FileHandle.standardError.write(Data("YNX_WALLET_UI_READY_FOR_SIMCTL_OPENURL\n".utf8))

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.buttons["Open"]
    XCTAssertTrue(
      openButton.waitForExistence(timeout: 60),
      "simctl openurl did not expose a semantic Open action"
    )
    openButton.tap()

    XCTAssertTrue(
      rejection.waitForExistence(timeout: 45),
      "YNX Wallet did not expose its fail-closed rejection after callback delivery"
    )

    let screenshot = XCTAttachment(screenshot: wallet.screenshot())
    screenshot.name = "malformed-callback-fail-closed"
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

    let persist = wallet.buttons["Recover into secure storage"]
    let enabled = NSPredicate(format: "enabled == true")
    let enabledExpectation = expectation(for: enabled, evaluatedWith: persist)
    XCTAssertEqual(
      XCTWaiter.wait(for: [enabledExpectation], timeout: 15),
      .completed,
      "Recovery action did not accept the isolated 32-byte test vector"
    )
    persist.tap()

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

    wallet.buttons["Close Recover Wallet"].tap()
    XCTAssertTrue(wallet.buttons["Create new Wallet"].waitForExistence(timeout: 15))
    wallet.terminate()
    wallet.launch()
    XCTAssertTrue(
      wallet.buttons["Create new Wallet"].waitForExistence(timeout: 45),
      "Failed recovery unexpectedly persisted an account across process restart"
    )

    let restart = XCTAttachment(screenshot: wallet.screenshot())
    restart.name = "recovery-second-launch-empty"
    restart.lifetime = .keepAlways
    add(restart)
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
