import XCTest

final class MalformedCallbackUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func testMalformedCallbackIsDeliveredAndRejected() throws {
    let wallet = XCUIApplication()
    wallet.launch()

    try XCUIDevice.shared.system.open(
      XCTUnwrap(URL(string: "ynxwallet://authorize?request=invalid"))
    )

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let openButton = springboard.buttons["Open"]
    XCTAssertTrue(
      openButton.waitForExistence(timeout: 60),
      "iOS did not expose a semantic Open action for the ynxwallet callback confirmation sheet"
    )
    openButton.tap()

    XCTAssertTrue(
      wallet.staticTexts["Invalid Wallet authorization rejected"].waitForExistence(timeout: 45),
      "YNX Wallet did not expose its fail-closed rejection after callback delivery"
    )

    let screenshot = XCTAttachment(screenshot: wallet.screenshot())
    screenshot.name = "malformed-callback-fail-closed"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
