import AppKit
import SwiftUI
import YNXWalletMacCore

@MainActor
final class WalletState: ObservableObject {
  @Published var headline = "Wallet locked"
  @Published var detail = "No account, balance, transaction, session, or provider state is inferred."
  @Published var errorCode: String?
  @Published var securityBoundary = "Checking Keychain and biometric availability…"

  func refreshSecurityBoundary() {
    let capability = DeviceSecurityProbe.run()
    if capability.keychainRoundTripVerified && capability.biometricPolicyAvailable {
      securityBoundary = "Device-only Keychain round-trip verified. System biometric policy is available."
    } else if capability.keychainRoundTripVerified {
      securityBoundary = "Device-only Keychain round-trip verified. System biometric policy is unavailable; recovery and signing remain locked."
    } else {
      securityBoundary = "Keychain verification failed. Recovery and signing remain locked."
    }
  }

  func receive(_ rawValue: String) {
    switch CallbackPolicy.evaluate(rawValue) {
    case .home:
      headline = "Wallet locked"
      detail = "No authorization request is active."
      errorCode = nil
    case .rejected(let code):
      headline = "Request rejected"
      detail = "The request failed closed before key access, signing, network submission, or callback."
      errorCode = code
    }
  }
}

struct WalletView: View {
  @ObservedObject var state: WalletState

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("YNX WALLET · macOS TESTNET COMPANION")
        .font(.caption.weight(.semibold))
        .foregroundStyle(Color(red: 0, green: 47 / 255, blue: 167 / 255))
      Text(state.headline).font(.largeTitle.weight(.semibold))
      Text(state.detail).foregroundStyle(.secondary)
      if let errorCode = state.errorCode {
        Text(errorCode).font(.system(.body, design: .monospaced)).textSelection(.enabled)
      }
      Divider()
      Text(state.securityBoundary).font(.callout.weight(.medium))
      Text("Recovery material can be bound to the current biometric set in the device-only Keychain. Account derivation, signing and asset actions remain unavailable until the frozen native bridge is integrated and verified.")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer()
    }
    .padding(28)
    .frame(minWidth: 560, minHeight: 360)
  }
}

@main
struct YNXWalletMacApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var state = WalletState()

  var body: some Scene {
    WindowGroup("YNX Wallet") { WalletView(state: state).onAppear { appDelegate.state = state; state.refreshSecurityBoundary() } }
    .defaultSize(width: 620, height: 420)
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  weak var state: WalletState? {
    didSet {
      if let pendingURL {
        state?.receive(pendingURL)
        self.pendingURL = nil
      }
    }
  }
  private var pendingURL: String?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSAppleEventManager.shared().setEventHandler(
      self,
      andSelector: #selector(handleGetURL(event:reply:)),
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

  func applicationWillTerminate(_ notification: Notification) {
    NSAppleEventManager.shared().removeEventHandler(
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

  @objc private func handleGetURL(event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
    guard let rawValue = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue else {
      deliver("")
      return
    }
    deliver(rawValue)
  }

  private func deliver(_ rawValue: String) {
    let decision = CallbackPolicy.evaluate(rawValue)
    if let state { state.receive(rawValue) } else { pendingURL = rawValue }
    if case .rejected(let code) = decision {
      NSApp.mainWindow?.title = "Request rejected · \(code)"
    }
  }
}
