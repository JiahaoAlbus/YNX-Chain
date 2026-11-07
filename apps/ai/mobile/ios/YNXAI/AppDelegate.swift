internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
#if YNX_AI_MATCHED_NATIVE_V6
    precondition(Self.nativeRetainedOwners.isEmpty, "AI_ORIGINAL_HOST_CLOSE_DEBT_RETAINED")
    YNXOriginalAIMobileV6RegisterBeforeReactHost()
#endif
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

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

#if YNX_AI_MATCHED_NATIVE_V6
  // A enables both this Swift condition and the matching bridging-header macro
  // only for its one selected image. This never registers a permission provider.
  private final class RetainedNativeHost: @unchecked Sendable {
    let owner: AnyObject
    init(_ owner: AnyObject) { self.owner = owner }
  }
  private static let nativeTeardown = DispatchQueue(label: "ynx.ai.native.teardown")
  private static var nativeRetainedOwners: [RetainedNativeHost] = []

  // Normal explicit host retirement and termination. Never drain on JS/main,
  // nor drop a retained factory because a timeout or failed close looked done.
  func retireOriginalNativeHost() {
    guard let owner = reactNativeFactory else { return }
    if Self.nativeRetainedOwners.contains(where: { $0.owner === owner }) { return }
    let retained = RetainedNativeHost(owner)
    Self.nativeRetainedOwners.append(retained)
    YNXOriginalAIMobileV6RequestRetireBeforeHostInvalidation()
    Self.nativeTeardown.async { [weak self, retained] in
      let physicallyClosed = YNXOriginalAIMobileV6DrainOnNativeTeardownExecutor()
      guard physicallyClosed else { return } // owner and original debt remain retained
      DispatchQueue.main.async { [weak self, retained] in
        if let self, self.reactNativeFactory === retained.owner {
          self.reactNativeFactory = nil
          self.reactNativeDelegate = nil
        }
        AppDelegate.nativeRetainedOwners.removeAll { $0 === retained }
      }
    }
  }
  public override func applicationWillTerminate(_ application: UIApplication) {
    retireOriginalNativeHost()
    // OS termination may preempt this asynchronous drain. It is never recorded
    // as physicalDone; persisted UNKNOWN belongs to original cold recovery.
    super.applicationWillTerminate(application)
  }
#endif

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
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
