internal import Expo
import Combine
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
    let capabilities = configuration.nativeCapabilities
    walletNetworkLogger.notice(
      "YNX_WALLET_ENDPOINT_MATRIX_LOADED pid=\(getpid(), privacy: .public) matrixId=\(configuration.matrixID, privacy: .public) rpcHost=\(rpcHost, privacy: .public) rpcPath=\(configuration.rpcURL.path, privacy: .public) integratedCentral=\(configuration.integratedCentral, privacy: .public)"
    )
    walletNetworkLogger.notice(
      "YNX_WALLET_NATIVE_PRODUCT_GATES pid=\(getpid(), privacy: .public) authorizationCompletion=\(capabilities.authorizationCompletionAvailable, privacy: .public) account=\(capabilities.accountAvailable, privacy: .public) sign=\(capabilities.signAvailable, privacy: .public) send=\(capabilities.sendAvailable, privacy: .public)"
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

  do {
    let observation = try await WalletGatewayFailClosedProbe().run(configuration: configuration)
    walletNetworkLogger.notice(
      "YNX_WALLET_GATEWAY_FAIL_CLOSED pid=\(getpid(), privacy: .public) walletComplete=\(observation.walletCompletionError, privacy: .public) walletIntrospect=\(observation.walletIntrospectionError, privacy: .public) productIntrospect=\(observation.productSessionIntrospectionError, privacy: .public) stateUnchanged=\(observation.stateUnchanged, privacy: .public) authorizationSuccess=false account=false signing=false send=false transaction=false"
    )
  } catch {
    walletNetworkLogger.error(
      "YNX_WALLET_GATEWAY_FAIL_CLOSED_UNAVAILABLE pid=\(getpid(), privacy: .public) code=ENDPOINT_OR_RESPONSE_REJECTED authorizationSuccess=false account=false signing=false send=false transaction=false"
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
  private var walletConnectRuntime: WalletConnectRelayRuntime?
  private var walletConnectSubscriptions = Set<AnyCancellable>()
  private var presentedWalletConnectProposalIDs = Set<String>()
  private var presentedWalletConnectRequestIDs = Set<String>()

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

    configureWalletConnectRuntime()
    if let launchURL = launchOptions?[.url] as? URL,
       launchURL.scheme == "ynxwallet",
       launchURL.host == "wc" {
      handleWalletConnectURL(launchURL)
    }

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
    if url.scheme == "ynxwallet", url.host == "wc", walletConnectRuntime != nil {
      handleWalletConnectURL(url)
      return true
    }
    let configuredProjectID = Bundle.main.object(forInfoDictionaryKey: "YNXWalletConnectProjectID") as? String
    let projectID = configuredProjectID?.isEmpty == false ? configuredProjectID : nil
    switch NativeWalletConnectInboundPolicy.evaluate(url.absoluteString, projectID: projectID) {
    case .rejected(let code):
      walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_REJECTED pid=\(getpid(), privacy: .public) code=\(code, privacy: .public) relay=false pairing=false approval=false callbackEmitted=false")
      presentNativeRejection(title: "WalletConnect unavailable", code: code, walletConnect: true)
      return true
    case .notWalletConnect:
      break
    }
    switch NativeAuthorizationPolicy.evaluate(url.absoluteString) {
    case .rejected(let code):
      walletCallbackLogger.notice("YNX_WALLET_NATIVE_AUTHORIZATION_REJECTED pid=\(getpid(), privacy: .public) code=\(code, privacy: .public) authorizationSuccess=false signing=false callbackEmitted=false")
      presentNativeRejection(title: "Request rejected", code: code, walletConnect: false)
      return true
    }
  }

  private func configureWalletConnectRuntime() {
    let projectID = (Bundle.main.object(forInfoDictionaryKey: "YNXWalletConnectProjectID") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let appGroup = (Bundle.main.object(forInfoDictionaryKey: "YNXWalletConnectAppGroup") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let projectID, !projectID.isEmpty else {
      walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_RUNTIME_BLOCKED pid=\(getpid(), privacy: .public) code=WALLETCONNECT_PROJECT_ID_UNAVAILABLE")
      return
    }
    guard let appGroup, !appGroup.isEmpty else {
      walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_RUNTIME_BLOCKED pid=\(getpid(), privacy: .public) code=WALLETCONNECT_APP_GROUP_UNAVAILABLE")
      return
    }
    guard let signer = WalletConnectNativeSignerRegistry.current else {
      walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_RUNTIME_BLOCKED pid=\(getpid(), privacy: .public) code=WALLETCONNECT_SIGNER_UNAVAILABLE")
      return
    }
    do {
      let runtime = try WalletConnectRelayRuntime(
        configuration: WalletConnectRelayConfiguration(
          projectID: projectID,
          appGroup: appGroup
        ),
        signer: signer
      )
      walletConnectRuntime = runtime
      subscribeToWalletConnectRuntime(runtime)
      walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_SDK_CONFIGURED pid=\(getpid(), privacy: .public) relay=false pairing=false approval=false")
    } catch let error as WalletConnectRelayRuntimeError {
      walletCallbackLogger.error("YNX_WALLET_WALLETCONNECT_RUNTIME_BLOCKED pid=\(getpid(), privacy: .public) code=\(error.rawValue, privacy: .public)")
    } catch {
      walletCallbackLogger.error("YNX_WALLET_WALLETCONNECT_RUNTIME_BLOCKED pid=\(getpid(), privacy: .public) code=WALLETCONNECT_CONFIGURATION_REJECTED")
    }
  }

  @discardableResult
  private func handleWalletConnectURL(_ url: URL) -> Bool {
    guard let runtime = walletConnectRuntime else { return false }
    Task { @MainActor [weak self] in
      do {
        try await runtime.pair(deepLink: url.absoluteString)
        walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_PAIRING_SUBMITTED pid=\(getpid(), privacy: .public) relayConnected=\(runtime.relayConnected, privacy: .public) approval=false callbackEmitted=false")
      } catch let error as WalletConnectV2PolicyError {
        self?.presentNativeRejection(title: "WalletConnect rejected", code: error.rawValue, walletConnect: true)
      } catch let error as WalletConnectRelayRuntimeError {
        self?.presentNativeRejection(title: "WalletConnect rejected", code: error.rawValue, walletConnect: true)
      } catch {
        self?.presentNativeRejection(title: "WalletConnect rejected", code: "WALLETCONNECT_PAIRING_REJECTED", walletConnect: true)
      }
    }
    return true
  }

  private func subscribeToWalletConnectRuntime(_ runtime: WalletConnectRelayRuntime) {
    runtime.$proposals
      .receive(on: DispatchQueue.main)
      .sink { [weak self, weak runtime] proposals in
        guard let self, let runtime, let proposal = proposals.first,
              presentedWalletConnectProposalIDs.insert(proposal.id).inserted else { return }
        presentWalletConnectProposal(proposal, runtime: runtime)
      }
      .store(in: &walletConnectSubscriptions)

    runtime.$requests
      .receive(on: DispatchQueue.main)
      .sink { [weak self, weak runtime] requests in
        guard let self, let runtime, let request = requests.first,
              presentedWalletConnectRequestIDs.insert(request.id).inserted else { return }
        presentWalletConnectRequest(request, runtime: runtime)
      }
      .store(in: &walletConnectSubscriptions)
  }

  private func presentWalletConnectProposal(
    _ proposal: WalletConnectProposalViewState,
    runtime: WalletConnectRelayRuntime
  ) {
    presentWalletConnectDecision(
      title: "Connect to \(proposal.dappName)?",
      message: "\(proposal.dappURL)\n\nChain: \(proposal.chains.joined(separator: ", "))\nMethods: \(proposal.methods.joined(separator: ", "))",
      approveTitle: "Approve",
      approve: { try await runtime.approveProposal(id: proposal.id) },
      reject: { try await runtime.rejectProposal(id: proposal.id) }
    )
  }

  private func presentWalletConnectRequest(
    _ request: WalletConnectRequestViewState,
    runtime: WalletConnectRelayRuntime
  ) {
    presentWalletConnectDecision(
      title: "Approve \(request.method)?",
      message: "\(request.dappName)\n\(request.chainID)\n\n\(request.paramsJSON)",
      approveTitle: request.method == "eth_sendTransaction" ? "Send on Testnet" : "Approve request",
      approve: { try await runtime.approveRequest(id: request.id) },
      reject: { try await runtime.rejectRequest(id: request.id) }
    )
  }

  private func presentWalletConnectDecision(
    title: String,
    message: String,
    approveTitle: String,
    approve: @escaping () async throws -> Void,
    reject: @escaping () async throws -> Void
  ) {
    guard let root = window?.rootViewController else {
      walletCallbackLogger.error("YNX_WALLET_WALLETCONNECT_UI_UNAVAILABLE pid=\(getpid(), privacy: .public)")
      return
    }
    var presenter = root
    while let presented = presenter.presentedViewController { presenter = presented }
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.view.accessibilityIdentifier = "YNX WalletConnect decision"
    alert.addAction(UIAlertAction(title: "Reject", style: .destructive) { [weak self] _ in
      Task { @MainActor in
        do { try await reject() }
        catch { self?.presentNativeRejection(title: "WalletConnect rejected", code: "WALLETCONNECT_REJECTION_FAILED", walletConnect: true) }
      }
    })
    alert.addAction(UIAlertAction(title: approveTitle, style: .default) { [weak self] _ in
      Task { @MainActor in
        do { try await approve() }
        catch let error as WalletConnectRelayRuntimeError {
          self?.presentNativeRejection(title: "WalletConnect rejected", code: error.rawValue, walletConnect: true)
        } catch {
          self?.presentNativeRejection(title: "WalletConnect rejected", code: "WALLETCONNECT_ACTION_REJECTED", walletConnect: true)
        }
      }
    })
    presenter.present(alert, animated: true)
  }

  private func presentNativeRejection(title: String, code: String, walletConnect: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let root = self?.window?.rootViewController else {
        walletCallbackLogger.error("YNX_WALLET_NATIVE_AUTHORIZATION_UI_UNAVAILABLE pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
        return
      }
      var presenter = root
      while let presented = presenter.presentedViewController { presenter = presented }
      let alert = UIAlertController(
        title: title,
        message: code,
        preferredStyle: .alert
      )
      alert.view.accessibilityIdentifier = "YNX native authorization rejection"
      alert.addAction(UIAlertAction(title: "Dismiss", style: .default))
      presenter.present(alert, animated: false) {
        if walletConnect {
          walletCallbackLogger.notice("YNX_WALLET_WALLETCONNECT_UI_VISIBLE pid=\(getpid(), privacy: .public) code=\(code, privacy: .public) relay=false pairing=false approval=false")
        } else {
          walletCallbackLogger.notice("YNX_WALLET_NATIVE_AUTHORIZATION_UI_VISIBLE pid=\(getpid(), privacy: .public) code=\(code, privacy: .public)")
        }
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
