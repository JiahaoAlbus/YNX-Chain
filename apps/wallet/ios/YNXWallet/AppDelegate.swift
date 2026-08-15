internal import Expo
import Darwin
import os
import React
import ReactAppDependencyProvider
import Security

private let walletLifecycleLogger = Logger(subsystem: "com.ynxweb4.wallet", category: "lifecycle")
private let walletCallbackLogger = Logger(subsystem: "com.ynxweb4.wallet", category: "callback")
private let walletSecurityLogger = Logger(subsystem: "com.ynxweb4.wallet", category: "security")
private let walletNetworkLogger = Logger(subsystem: "com.ynxweb4.wallet", category: "network")

private func verifyFrozenEndpointMatrixAndChain() async {
  guard let matrixURL = Bundle.main.url(
    forResource: "wallet-auth-public-endpoint-service-discovery-matrix",
    withExtension: "json"
  ) else {
    walletNetworkLogger.error("YNX_WALLET_ENDPOINT_MATRIX_UNAVAILABLE pid=\(getpid(), privacy: .public) code=MISSING_BUNDLED_MATRIX")
    return
  }

  let configuration: WalletEndpointConfiguration
  do {
    configuration = try EndpointMatrixPolicy.parse(Data(contentsOf: matrixURL))
    let rpcHost = configuration.rpcURL.host ?? "unknown"
    walletNetworkLogger.notice(
      "YNX_WALLET_ENDPOINT_MATRIX_LOADED pid=\(getpid(), privacy: .public) matrixId=\(configuration.matrixID, privacy: .public) rpcHost=\(rpcHost, privacy: .public) rpcPath=\(configuration.rpcURL.path, privacy: .public) integratedCentral=\(configuration.integratedCentral, privacy: .public)"
    )
  } catch {
    walletNetworkLogger.error(
      "YNX_WALLET_ENDPOINT_MATRIX_UNAVAILABLE pid=\(getpid(), privacy: .public) code=MATRIX_REJECTED"
    )
    return
  }

  do {
    let observation = try await ChainRPCProbe().run(configuration: configuration)
    walletNetworkLogger.notice(
      "YNX_WALLET_RPC_CHAIN_ID_VERIFIED pid=\(getpid(), privacy: .public) chainId=\(observation.chainIDHex, privacy: .public) bytes=\(observation.responseBytes, privacy: .public)"
    )
  } catch {
    walletNetworkLogger.error(
      "YNX_WALLET_RPC_CHAIN_ID_UNAVAILABLE pid=\(getpid(), privacy: .public) code=ENDPOINT_OR_RESPONSE_REJECTED"
    )
  }

  do {
    let observation = try await AppGatewayReachabilityProbe().run(configuration: configuration)
    walletNetworkLogger.notice(
      "YNX_WALLET_REST_APP_GATEWAY_REACHABLE pid=\(getpid(), privacy: .public) status=\(observation.statusCode, privacy: .public) bytes=\(observation.responseBytes, privacy: .public)"
    )
  } catch {
    walletNetworkLogger.error(
      "YNX_WALLET_REST_APP_GATEWAY_UNAVAILABLE pid=\(getpid(), privacy: .public) code=ENDPOINT_OR_RESPONSE_REJECTED"
    )
  }
}

private func runEphemeralKeychainProbeIfRequested() {
  guard ProcessInfo.processInfo.environment["YNX_WALLET_KEYCHAIN_PROBE"] == "1" else { return }

  let account = "ci.\(UUID().uuidString)"
  let identity: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.ynxweb4.wallet.keychain-probe",
    kSecAttrAccount as String: account,
  ]
  var addQuery = identity
  let expected = Data("YNX Wallet ephemeral Keychain probe".utf8)
  addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  addQuery[kSecValueData as String] = expected
  let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

  var readQuery = identity
  readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
  readQuery[kSecReturnData as String] = true
  var result: CFTypeRef?
  let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &result)
  let valueMatches = (result as? Data) == expected
  let deleteStatus = SecItemDelete(identity as CFDictionary)
  let available = addStatus == errSecSuccess
    && readStatus == errSecSuccess
    && valueMatches
    && deleteStatus == errSecSuccess

  walletSecurityLogger.notice(
    "YNX_WALLET_KEYCHAIN_PROBE pid=\(getpid(), privacy: .public) available=\(available, privacy: .public) add=\(addStatus, privacy: .public) read=\(readStatus, privacy: .public) delete=\(deleteStatus, privacy: .public)"
  )
}

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    walletLifecycleLogger.notice("YNX_WALLET_LAUNCHED pid=\(getpid(), privacy: .public)")
    runEphemeralKeychainProbeIfRequested()
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    Task { await verifyFrozenEndpointMatrixAndChain() }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    walletCallbackLogger.notice("YNX_WALLET_CALLBACK_RECEIVED pid=\(getpid(), privacy: .public) scheme=\(url.scheme ?? "unknown", privacy: .public)")
    switch NativeAuthorizationPolicy.evaluate(url.absoluteString) {
    case .rejected(let code):
      walletCallbackLogger.notice("YNX_WALLET_NATIVE_AUTHORIZATION_REJECTED pid=\(getpid(), privacy: .public) code=\(code, privacy: .public) authorizationSuccess=false signing=false callbackEmitted=false")
      presentNativeAuthorizationRejection(code: code)
      return true
    }
  }

  private func presentNativeAuthorizationRejection(code: String) {
    DispatchQueue.main.async { [weak self] in
      guard let root = self?.window?.rootViewController else {
        walletCallbackLogger.error("YNX_WALLET_NATIVE_AUTHORIZATION_UI_UNAVAILABLE pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
        return
      }
      var presenter = root
      while let presented = presenter.presentedViewController { presenter = presented }
      let alert = UIAlertController(
        title: "Request rejected",
        message: code,
        preferredStyle: .alert
      )
      alert.view.accessibilityIdentifier = "YNX native authorization rejection"
      alert.addAction(UIAlertAction(title: "Dismiss", style: .default))
      presenter.present(alert, animated: false) {
        walletCallbackLogger.notice("YNX_WALLET_NATIVE_AUTHORIZATION_UI_VISIBLE pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
      }
    }
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let url = userActivity.webpageURL
    walletCallbackLogger.notice("YNX_WALLET_UNIVERSAL_LINK_RECEIVED pid=\(getpid(), privacy: .public) scheme=\(url?.scheme ?? "unknown", privacy: .public)")
    switch InboundLinkPolicy.evaluateUniversalLink(url) {
    case .rejected(let code):
      walletCallbackLogger.notice("YNX_WALLET_UNIVERSAL_LINK_REJECTED pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
      return false
    }
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
