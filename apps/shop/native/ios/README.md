# YNX Shop for iOS

Native-first SwiftUI buyer application. Open `YNXShop.xcodeproj` in full Xcode, choose an iOS 17+ Simulator, and run the `YNXShop` scheme. The bundle identifier is `com.ynxweb4.shop`; Wallet callbacks use `ynxshop://wallet-auth/callback`.

The app never persists a plaintext bearer in defaults. Product sessions, the P-256 device key, callback replay records, and offline mutation envelopes live in Keychain. A payment state changes to paid only after the commerce service validates exact Central Pay settlement evidence.

This checkout intentionally does not include signing credentials or generated build products.

2026-10-03 Apple source continuation: the shared Swift core now uses account/token/expiry metadata, fences late requests, keeps the original unbound token and offline queue quarantined, and journals account-bound requests before dispatch. Original unknown mutation bodies/keys survive logout and retries; changed inputs cannot replace them. Logout is local negative authority and cancellation of the original pending approval; it does not claim server revocation. The AppKit opening path and portable view modifiers prepare the same core for macOS. They do not create a macOS release target or installed app.

The inherited Wallet/Auth exchange remains a legacy compatibility implementation. It is not the approved canonical Native SDK consumer. The parent must first adopt the shared Native successor, then wire its actual protected OS ports, callback, fresh proofs and durable server revoke through this product. Bare historical tokens and old pending data cannot silently become new authority. Keep them for recovery.

Current verification: source core module builds on macOS, controlled Foundation request/queue checks and native locale/static verification pass. Full SwiftUI app compilation on the current Command Line Tools fails because its SDK references the absent SwiftUIMacros plugin. Full Xcode, iOS/macOS app builds, hardware protection, real Wallet approval, current business readback and final installed user flows remain unverified.
