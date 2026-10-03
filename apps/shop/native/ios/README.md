# YNX Shop for iOS

Native-first SwiftUI buyer application. Open `YNXShop.xcodeproj` in full Xcode, choose an iOS 17+ Simulator, and run the `YNXShop` scheme. The bundle identifier is `com.ynxweb4.shop`; Wallet callbacks use `ynxshop://wallet-auth/callback`.

The canonical macOS Native consumer uses a protected Secure Enclave key and DeviceOnly Keychain context/namespaces. Private API requests use original SDK proof headers, and historical tokens/keys/pending data remain retired in their original records. A payment state changes to paid only after the commerce service validates exact Central Pay settlement evidence.

This checkout intentionally does not include signing credentials or generated build products.

2026-10-03 Apple source continuation: the shared Swift core now uses account/token/expiry metadata, fences late requests, keeps the original unbound token and offline queue quarantined, and journals account-bound requests before dispatch. Original unknown mutation bodies/keys survive logout and retries; changed inputs cannot replace them. Logout is local negative authority and cancellation of the original pending approval; it does not claim server revocation. The AppKit opening path and portable view modifiers prepare the same core for macOS. They do not create a macOS release target or installed app.

2026-10-03 canonical macOS continuation: WalletAuth, APIClient and ShopModel now use the exact adopted Native SDK through a private pinned WebKit engine and protected ports. The owned project includes YNXShopMac and a shared macOS scheme. Actual engine checks, controlled API/invoice checks, model/core compile and locale/static checks pass. iOS is not a registered Native tuple and does not inherit macOS authority.

Full SwiftUI app compilation with current Command Line Tools still fails due to absent SwiftUIMacros; xcodebuild requires full Xcode. The macOS target, asset/metadata packaging, signing, installed Secure Enclave behavior, real Wallet approval/return, cold recovery/server ACK and private business readback must be verified through A's sole final release. See NATIVE_PRODUCT_SESSION_PORTS.md and the apple-native-sdk-bridge-20261003 evidence.
