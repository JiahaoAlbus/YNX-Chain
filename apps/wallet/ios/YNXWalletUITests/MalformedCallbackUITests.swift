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
}
