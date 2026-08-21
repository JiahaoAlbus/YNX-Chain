import AppKit
import OSLog
import SwiftUI
import YNXWalletMacCore

private let lifecycleLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "lifecycle")
private let callbackLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "callback")
private let networkLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "network")
private let recoveryLogger = Logger(subsystem: "com.ynxweb4.wallet.macos", category: "recovery")

@MainActor
final class WalletState: ObservableObject {
  @Published var headline = "Wallet locked"
  @Published var detail = "No account, balance, transaction, session, or provider state is inferred."
  @Published var errorCode: String?
  @Published var securityBoundary = "Checking Keychain and biometric availability…"
  @Published var networkBoundary = "Loading verified YNX Testnet endpoint matrix…"
  @Published var recoveryBoundary = "Checking device recovery material…"
  @Published var recoveryMaterialPresent = false
  @Published var recoveryOperationInProgress = false
  @Published var recoveryActionAvailable = false
  private let recoveryVault = KeychainRecoveryVault()

  func refreshSecurityBoundary() {
    let capability = DeviceSecurityProbe.run()
    if capability.keychainRoundTripVerified && capability.biometricPolicyAvailable {
      securityBoundary = "Device-only Keychain round-trip verified. System biometric policy is available."
      recoveryActionAvailable = true
    } else if capability.keychainRoundTripVerified {
      securityBoundary = "Device-only Keychain round-trip verified. System biometric policy is unavailable; recovery and signing remain locked."
      recoveryActionAvailable = false
    } else {
      securityBoundary = "Keychain verification failed. Recovery and signing remain locked."
      recoveryActionAvailable = false
    }
    refreshRecoveryBoundary()
  }

  func prepareDeviceRecovery() async {
    guard recoveryActionAvailable, !recoveryOperationInProgress else { return }
    recoveryOperationInProgress = true
    defer { recoveryOperationInProgress = false }
    recoveryLogger.notice("YNX_WALLET_MAC_DEVICE_RECOVERY_ATTEMPTED pid=\(getpid(), privacy: .public) productRecovery=false")
    do {
      try await recoveryVault.create(
        reason: recoveryMaterialPresent
          ? "Rotate YNX Wallet device recovery material"
          : "Create YNX Wallet device recovery material"
      )
      let absent = try recoveryVault.isAbsentWithoutAuthentication()
      guard !absent else {
        recoveryBoundary = "Device recovery creation was not persisted. Product recovery remains unavailable."
        recoveryLogger.error("YNX_WALLET_MAC_DEVICE_RECOVERY_REJECTED pid=\(getpid(), privacy: .public) code=RECOVERY_NOT_PERSISTED productRecovery=false")
        return
      }
      recoveryMaterialPresent = true
      recoveryBoundary = "Biometric-bound device recovery material is stored in this Mac's Keychain. Product account recovery remains unavailable."
      recoveryLogger.notice("YNX_WALLET_MAC_DEVICE_RECOVERY_PERSISTED pid=\(getpid(), privacy: .public) bytes=32 productRecovery=false")
    } catch DeviceSecurityError.biometricUnavailable(let code) {
      recoveryBoundary = "Biometric authorization was unavailable or cancelled. No recovery success is recorded."
      recoveryLogger.error("YNX_WALLET_MAC_DEVICE_RECOVERY_REJECTED pid=\(getpid(), privacy: .public) code=BIOMETRIC_UNAVAILABLE errorCode=\(code, privacy: .public) productRecovery=false")
      recoveryMaterialPresent = ((try? recoveryVault.isAbsentWithoutAuthentication()) == false)
    } catch DeviceSecurityError.keychain(let code) {
      recoveryBoundary = "Keychain rejected the device recovery operation. Existing material was not deleted."
      recoveryLogger.error("YNX_WALLET_MAC_DEVICE_RECOVERY_REJECTED pid=\(getpid(), privacy: .public) code=KEYCHAIN_REJECTED errorCode=\(code, privacy: .public) productRecovery=false")
      recoveryMaterialPresent = ((try? recoveryVault.isAbsentWithoutAuthentication()) == false)
    } catch {
      recoveryBoundary = "Device recovery failed closed. No product recovery success is recorded."
      recoveryLogger.error("YNX_WALLET_MAC_DEVICE_RECOVERY_REJECTED pid=\(getpid(), privacy: .public) code=UNEXPECTED_ERROR productRecovery=false")
      recoveryMaterialPresent = ((try? recoveryVault.isAbsentWithoutAuthentication()) == false)
    }
  }

  private func refreshRecoveryBoundary() {
    defer {
      recoveryLogger.notice(
        "YNX_WALLET_MAC_DEVICE_RECOVERY_STATUS pid=\(getpid(), privacy: .public) present=\(self.recoveryMaterialPresent, privacy: .public) actionAvailable=\(self.recoveryActionAvailable, privacy: .public) productRecovery=false"
      )
    }
    do {
      recoveryMaterialPresent = !(try recoveryVault.isAbsentWithoutAuthentication())
      recoveryBoundary = recoveryMaterialPresent
        ? "Biometric-bound device recovery material is present. Product account recovery remains unavailable."
        : "No device recovery material is stored. Product account recovery remains unavailable."
    } catch DeviceSecurityError.keychain(let code) {
      recoveryMaterialPresent = false
      recoveryBoundary = "Device recovery status is unavailable because Keychain returned \(code)."
    } catch {
      recoveryMaterialPresent = false
      recoveryBoundary = "Device recovery status is unavailable."
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
      let gatewayObservation = try await WalletGatewayFailClosedProbe().run(configuration: configuration)
      networkLogger.notice(
        "YNX_WALLET_MAC_GATEWAY_FAIL_CLOSED pid=\(getpid(), privacy: .public) walletComplete=\(gatewayObservation.walletCompletionError, privacy: .public) walletIntrospect=\(gatewayObservation.walletIntrospectionError, privacy: .public) productIntrospect=\(gatewayObservation.productSessionIntrospectionError, privacy: .public) stateUnchanged=\(gatewayObservation.stateUnchanged, privacy: .public)"
      )
      let capabilities = configuration.nativeCapabilities
      networkLogger.notice(
        "YNX_WALLET_MAC_NATIVE_PRODUCT_GATES pid=\(getpid(), privacy: .public) authorizationCompletion=\(capabilities.authorizationCompletionAvailable, privacy: .public) account=\(capabilities.accountAvailable, privacy: .public) sign=\(capabilities.signAvailable, privacy: .public) send=\(capabilities.sendAvailable, privacy: .public)"
      )
      networkBoundary = "YNX Testnet transport reachable · chain \(chainObservation.chainIDHex) · REST HTTP \(restObservation.statusCode). Invalid Wallet completion and introspection requests were rejected with an unchanged observed Gateway state digest. Account, sign, send, and callback gates remain unavailable."
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
      Text(state.recoveryBoundary).font(.callout.weight(.medium))
      Button(state.recoveryMaterialPresent ? "Rotate device recovery material" : "Prepare device recovery") {
        Task { await state.prepareDeviceRecovery() }
      }
      .disabled(!state.recoveryActionAvailable || state.recoveryOperationInProgress)
      .accessibilityIdentifier("YNX device recovery action")
      Text("Device recovery material is not an account, seed phrase, balance, transaction, authorization, or product recovery success. Account derivation, signing and asset actions remain unavailable until the frozen native bridge is integrated and verified.")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer()
    }
    .padding(28)
    .frame(minWidth: 620, minHeight: 500)
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
    .defaultSize(width: 680, height: 540)
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
