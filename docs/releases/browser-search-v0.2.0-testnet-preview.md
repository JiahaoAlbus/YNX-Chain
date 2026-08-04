# YNX Browser & Search 0.2.0 Testnet Preview

Release date: 2026-07-18

## Browser

- Ships native mature-engine hosts: WKWebView on macOS/iOS, Android System
  WebView, and Chromium-backed WebView2 on Windows.
- Adds operational tabs/groups, history, bookmarks, downloads, exact-origin
  permissions, security details, configured-list phishing warning, signed-update
  boundary, crash recovery, Search-first new tab, Wallet signing review, and
  explicitly permissioned selected-page AI.
- Private mode is nonpersistent and excluded from history/recovery/AI. It does
  not claim perfect privacy; external sites, networks, OS software and downloaded
  files can retain activity.
- Browser never signs or holds Wallet secrets. Central Wallet registry entries
  are delivered as reviewed integration artifacts but remain unmerged centrally.

## Search

- Delivers an operator-authorized HTTPS index with authorization evidence,
  robots and fetch bounds, source/freshness/snippet/score receipts, filters,
  pagination, removal/correction/appeal and audit.
- Empty approved-source inventories return an empty index. No global coverage,
  neutrality, completeness, or production corpus claim is made.
- Citation AI can only cite the current retrieval set, separates retrieval from
  inference, and requires preview/permission/review. Staging has no AI provider
  credentials and reports unavailable.
- Adds 12 locales, Arabic RTL, light/dark, responsive/150% text behavior and
  Playwright evidence for success/empty/failure/retry states.

## Staging and release classification

Search staging is <https://search-staging.43.153.202.237.sslip.io>. It is a
Testnet Preview with an intentionally empty source inventory. Browser artifacts
are preview/development signed only: Android uses a published disposable RSA
key, macOS uses an ad-hoc signature, and iOS Simulator/Windows packages are not
production signed or store releases.

Central Wallet/Gateway/Trust integration, production signing/notarization,
store release, production/public Search deployment and an approved source
inventory remain outside this release.
