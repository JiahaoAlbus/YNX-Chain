# YNX Browser

YNX Browser is a separate macOS browser shell using Apple's system WebKit
through `WKWebView`; it does not implement a web engine. The native binary uses
WebKit content processes, a non-persistent `WKWebsiteDataStore` for private tabs,
and explicit Wallet/security boundaries. The JavaScript core provides
origin-scoped permission storage, persistent browser state, strict Wallet
callback validation, transaction review, and permissioned AI context selection.

```bash
npm run check
npm start
```

`npm run build:macos` creates an ad-hoc-signed Testnet Preview app and zip under
`dist/macos/`. It is development evidence, not a Developer ID signed, notarized,
or production update. `ANDROID_SDK_ROOT=... scripts/build-android.sh` produces
the Android Testnet Preview APK with the documented public disposable key.
Private mode prevents YNX Browser from persisting
its history, permission decisions and download records, but it cannot prevent
websites, networks, the OS, extensions or downloaded files from retaining data.
The phishing boundary matches only an operator-supplied blocklist and is not a
claim of complete protection.

Configuration is server/operator supplied; do not place secrets in the app:

- `YNX_BROWSER_BLOCKED_ORIGINS`: comma-separated exact origins.
- `YNX_BROWSER_WALLET_POLICY`: allowlisted callbacks and scopes for the
  Chromium host implementation.
- `YNX_AI_GATEWAY_URL` and `YNX_AI_GATEWAY_CLIENT_TOKEN`: permissioned Gateway
  connection. Provider tokens remain at the Gateway.

Android uses the system WebView in a separate `:private` process for private
browsing, iOS uses WKWebView, and Windows uses Chromium-backed WebView2. The
shared Browser/Search contract exposes
12 locale choices and an Arabic RTL path. Exact build, parse, signature, hash,
and unproven distribution boundaries are recorded in
[`PLATFORM_EVIDENCE.md`](PLATFORM_EVIDENCE.md).

The default new-tab/Search URL is the bounded Testnet Preview at
<https://search-staging.43.153.202.237.sslip.io>. It is not a global index.
