# YNX Browser platform feasibility evidence

Evidence captured on 2026-07-16. These are engineering artifacts, not store,
notarization, production-signing, or distribution claims.

## Android

- Native application ID: `com.ynxweb4.browser`.
- Engine: Android system `WebView`; the app does not implement a web engine.
- Toolchain proof: API 36 `aapt2`, `javac`, `d8`, `zipalign`, and `apksigner`
  built `android/.manual-build/ynx-browser-debug.apk` from source.
- `aapt2 dump badging` verified version `0.2.0-candidate`, min SDK 28,
  target/compile SDK 36, launchable `MainActivity`, and the declared network,
  camera, microphone, and coarse-location boundaries.
- `apksigner verify --verbose --print-certs` passed with APK Signature Scheme
  v3. The short-lived development certificate SHA-256 was
  `5a6ecce882f85613d3c44a5b6a23f29fe7c8855866752b5b89f0e84097eb971f`.
- APK SHA-256:
  `2e0e5d468776a454f16e150dcfe8c79c9285227073862b6e225044f7d9195f98`.
- The APK is ignored and is not a release package. An available emulator was
  visible to `adb`, but its Android package/activity services had not completed
  booting, so installation/launch evidence is not claimed.

Build command:

```bash
ANDROID_SDK_ROOT=/Users/huangjiahao/Library/Android/sdk \
  ./apps/browser/scripts/build-android.sh
```

## iOS and iPadOS

- Native project: `ios/YNXBrowser.xcodeproj` with the separate bundle ID
  `com.ynxweb4.browser.ios`.
- Engine: `WKWebView`; private tabs use
  `WKWebsiteDataStore.nonPersistent()`.
- `swiftc -parse apps/browser/ios/YNXBrowser/*.swift` passed for all Swift
  sources. `plutil -lint` passed for both `Info.plist` and `project.pbxproj`.
- The project includes a Keychain-backed P-256 product device identity,
  exact Wallet callback binding, five-minute nonce expiry, replay rejection,
  WebKit process recovery, downloads, permission review, 12 locale choices,
  and Arabic right-to-left layout.
- Full `xcodebuild` was not run because this machine currently selects
  `/Library/Developer/CommandLineTools` and has no full Xcode installation.
  No iOS binary, signing, simulator run, TestFlight, or App Store status is
  claimed.

## macOS

- Engine: Apple system WebKit through `WKWebView`.
- `swift build -c release --package-path apps/browser/native` passed.
- Unsigned local binary SHA-256:
  `81d0f008b35b97e8b3b494835d579b56255743381b7eeeca01b6250d54ecccda`.
- The build is local feasibility evidence only. It is not code-signed,
  notarized, packaged, or distributed. The update action therefore fails
  honestly until a signed operator feed exists.

## Windows

- Native WPF project: `windows/YNXBrowser.Windows`, targeting
  `net8.0-windows10.0.19041.0`.
- Engine: Microsoft WebView2, backed by Chromium.
- `xmllint --noout` passed for the XAML, project, and application manifest.
- The host specifies normal-session restart recovery, a separate temporary
  WebView2 profile for private windows, exact-origin permission prompts,
  download review, renderer recovery, bookmarks, data clearing, and keyboard
  navigation.
- This macOS machine has no `dotnet` executable and cannot build WPF. No Windows
  executable, MSIX, runtime installation, signing, or launch proof is claimed;
  `dotnet build YNXBrowser.Windows/YNXBrowser.Windows.csproj` remains a required
  Windows integration gate.

## Internationalization and truthful boundaries

- Shared contracts test 12 locales: English, Simplified Chinese, Traditional
  Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian,
  Arabic, and Indonesian.
- Arabic resolves to RTL; the web UI writes both `lang` and `dir`, Android sets
  locale and layout direction, and SwiftUI selects right-to-left layout.
- Localized security strings preserve the same meaning: private mode does not
  promise perfect privacy, blocklist matches do not promise phishing
  protection, and Browser approval never signs a Wallet transaction.
