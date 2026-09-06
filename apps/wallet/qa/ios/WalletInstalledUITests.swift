import XCTest

// This separate runner operates the installed Release bundle through public UI.
// It never creates/imports a key, authenticates a real account, injects application
// state, weakens capture protection, or treats an empty-wallet lock as key access.
@MainActor
final class WalletInstalledUITests: XCTestCase {
  private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.buttons.matching(identifier: label).firstMatch
  }
  private func tap(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 15) {
    let item = button(app, label)
    XCTAssertTrue(item.waitForExistence(timeout: timeout), "Missing public button: \(label)")
    XCTAssertTrue(item.isHittable, "Public button is outside the usable viewport: \(label)")
    item.tap()
  }
  private func evidence(_ app: XCUIApplication, _ name: String) {
    // These checkpoints contain no account, recovery material or entered secrets.
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = name
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testPublicOnboardingSettingsLanguagesCancelAndLockControl() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.ynxweb4.wallet")
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60))
    XCTAssertTrue(button(app, "Create a new Wallet").waitForExistence(timeout: 45))
    XCTAssertTrue(button(app, "Import recovery key").isHittable)
    evidence(app, "01-installed-onboarding")

    tap(app, "Import recovery key")
    XCTAssertTrue(app.secureTextFields["Recovery key"].waitForExistence(timeout: 10))
    XCTAssertFalse(button(app, "Import into secure storage").isEnabled)
    tap(app, "Close Import account")
    XCTAssertTrue(button(app, "Create a new Wallet").waitForExistence(timeout: 10))
    XCTAssertFalse(app.secureTextFields["Recovery key"].exists)

    tap(app, "Recover on a replacement device")
    XCTAssertTrue(app.secureTextFields["Recovery key"].waitForExistence(timeout: 10))
    tap(app, "Close Recover Wallet")
    XCTAssertTrue(button(app, "Create a new Wallet").waitForExistence(timeout: 10))
    evidence(app, "02-cancelled-empty-import-and-recovery")

    tap(app, "Language and accessibility")
    let chinese = app.descendants(matching: .any).matching(identifier: "简体中文").firstMatch
    XCTAssertTrue(chinese.waitForExistence(timeout: 10)); XCTAssertTrue(chinese.isHittable); chinese.tap()
    tap(app, "关闭 语言与辅助功能")
    XCTAssertTrue(button(app, "创建新钱包").waitForExistence(timeout: 10))
    evidence(app, "03-simplified-chinese")

    tap(app, "语言与辅助功能")
    let arabic = app.descendants(matching: .any).matching(identifier: "العربية").firstMatch
    for _ in 0..<6 where !arabic.isHittable { app.swipeUp() }
    XCTAssertTrue(arabic.exists); XCTAssertTrue(arabic.isHittable); arabic.tap()
    tap(app, "إغلاق اللغة وإمكانية الوصول")
    XCTAssertTrue(button(app, "إنشاء محفظة جديدة").waitForExistence(timeout: 10))
    evidence(app, "04-arabic")

    tap(app, "اللغة وإمكانية الوصول")
    let english = app.descendants(matching: .any).matching(identifier: "English").firstMatch
    for _ in 0..<6 where !english.isHittable { app.swipeDown() }
    XCTAssertTrue(english.exists); XCTAssertTrue(english.isHittable); english.tap()
    tap(app, "Close Language and accessibility")
    tap(app, "Lock Wallet")
    XCTAssertTrue(button(app, "Create a new Wallet").waitForExistence(timeout: 10))
    evidence(app, "05-empty-wallet-lock-control")

    app.open(URL(string: "ynxwallet://authorize?request=invalid")!)
    let dismiss = app.descendants(matching: .any).matching(identifier: "Dismiss invalid authorization").firstMatch
    XCTAssertTrue(dismiss.waitForExistence(timeout: 15)); XCTAssertTrue(dismiss.isHittable); dismiss.tap()
    XCTAssertFalse(dismiss.exists)
    XCTAssertTrue(button(app, "Create a new Wallet").exists)
    evidence(app, "06-invalid-request-dismissed")

    app.terminate()
    app.launch()
    XCTAssertTrue(button(app, "Create a new Wallet").waitForExistence(timeout: 45))
    evidence(app, "07-second-launch-english-retained")
  }
}
