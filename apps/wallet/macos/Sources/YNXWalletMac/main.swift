import AppKit
import OSLog
import SwiftUI
import YNXWalletMacCore

private let lifecycleLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "lifecycle")
private let callbackLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "callback")
private let networkLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "network")

@MainActor
final class WalletState: ObservableObject {
  @Published var headline = "Wallet locked"
  @Published var detail = "No account, balance, transaction, session, or provider state is inferred."
  @Published var errorCode: String?
  @Published var securityBoundary = "Checking Keychain and biometric availability…"
  @Published var networkBoundary = "Loading verified YNX Testnet endpoint matrix…"

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

  func refreshNetworkBoundary() async {
    guard let matrixURL = Bundle.main.url(
      forResource: "wallet-auth-public-endpoint-service-discovery-matrix",
      withExtension: "json"
    ) else {
      networkBoundary = "Testnet endpoint unavailable: the frozen matrix is not bundled."
      networkLogger.error("YNX_WALLET_MAC_ENDPOINT_MATRIX_UNAVAILABLE pid=\(getpid(), privacy: .public) code=MISSING_BUNDLED_MATRIX")
      return
    }

    do {
      let configuration = try EndpointMatrixPolicy.parse(Data(contentsOf: matrixURL))
      let rpcHost = configuration.rpcURL.host ?? "unknown"
      networkLogger.notice(
        "YNX_WALLET_MAC_ENDPOINT_MATRIX_LOADED pid=\(getpid(), privacy: .public) matrixId=\(configuration.matrixID, privacy: .public) rpcHost=\(rpcHost, privacy: .public) rpcPath=\(configuration.rpcURL.path, privacy: .public) integratedCentral=\(configuration.integratedCentral, privacy: .public)"
      )
      let chainObservation = try await ChainRPCProbe().run(configuration: configuration)
      networkLogger.notice(
        "YNX_WALLET_MAC_RPC_CHAIN_ID_VERIFIED pid=\(getpid(), privacy: .public) chainId=\(chainObservation.chainIDHex, privacy: .public) bytes=\(chainObservation.responseBytes, privacy: .public)"
      )
      let restObservation = try await AppGatewayReachabilityProbe().run(configuration: configuration)
      networkLogger.notice(
        "YNX_WALLET_MAC_REST_APP_GATEWAY_REACHABLE pid=\(getpid(), privacy: .public) status=\(restObservation.statusCode, privacy: .public) bytes=\(restObservation.responseBytes, privacy: .public)"
      )
      networkBoundary = "YNX Testnet endpoints verified · chain \(chainObservation.chainIDHex) · REST HTTP \(restObservation.statusCode)"
    } catch {
      networkBoundary = "Testnet endpoint unavailable: matrix, RPC, or REST response rejected."
      networkLogger.error("YNX_WALLET_MAC_ENDPOINTS_UNAVAILABLE pid=\(getpid(), privacy: .public) code=ENDPOINT_OR_RESPONSE_REJECTED")
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
      Text(state.networkBoundary).font(.callout.weight(.medium))
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
    WindowGroup("YNX Wallet") {
      WalletView(state: state).onAppear {
        appDelegate.state = state
        state.refreshSecurityBoundary()
        Task { await state.refreshNetworkBoundary() }
      }
    }
    .defaultSize(width: 620, height: 420)
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  weak var state: WalletState? {
    didSet {
      guard let state else { return }
      for rawValue in pendingCallbacks.drain() {
        state.receive(rawValue)
      }
    }
  }
  private var pendingCallbacks = PendingCallbackInbox()

  func applicationDidFinishLaunching(_ notification: Notification) {
    lifecycleLogger.notice("YNX_WALLET_MAC_LAUNCHED pid=\(getpid(), privacy: .public)")
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

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls {
      deliver(url.absoluteString)
    }
  }

  @objc private func handleGetURL(event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
    guard let rawValue = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue else {
      deliver("")
      return
    }
    deliver(rawValue)
  }

  private func deliver(_ rawValue: String) {
    let scheme = URLComponents(string: rawValue)?.scheme ?? "unknown"
    callbackLogger.notice("YNX_WALLET_MAC_CALLBACK_RECEIVED pid=\(getpid(), privacy: .public) scheme=\(scheme, privacy: .public)")
    let decision = CallbackPolicy.evaluate(rawValue)
    if let state { state.receive(rawValue) } else { pendingCallbacks.enqueue(rawValue) }
    if case .rejected(let code) = decision {
      NSApp.mainWindow?.title = "Request rejected · \(code)"
      callbackLogger.notice("YNX_WALLET_MAC_CALLBACK_REJECTED pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
    }
  }
}
