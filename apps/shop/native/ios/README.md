# YNX Shop for iOS

Native-first SwiftUI buyer application. Open `YNXShop.xcodeproj` in full Xcode, choose an iOS 17+ Simulator, and run the `YNXShop` scheme. The bundle identifier is `com.ynxweb4.shop`; Wallet callbacks use `ynxshop://wallet-auth/callback`.

The app never persists a plaintext bearer in defaults. Product sessions, the P-256 device key, callback replay records, and offline mutation envelopes live in Keychain. A payment state changes to paid only after the commerce service validates exact Central Pay settlement evidence.

This checkout intentionally does not include signing credentials or generated build products.
