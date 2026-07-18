# YNX Browser UI design audit

Audited 2026-07-18 against the Task 13 Browser UI gates.

## Information architecture and platform behavior

The desktop Browser uses a minimal tab strip, native toolbar, exact security
status, a lightly grouped library sidebar, and a WebKit/WebView2 content split.
It does not copy Safari, Chrome, or Edge branding and does not use colored tab
blocks, a card wall, or a dashboard template. macOS uses AppKit controls and SF
Symbols; iOS uses SwiftUI controls and SF Symbols; Android and Windows retain
their native control and dialog behavior. Search is the new-tab default.

Tabs/groups, history, bookmarks, downloads, site permissions, certificate and
origin details, known-list phishing boundaries, update status, crash recovery,
Wallet review, and selected-page AI are reachable. Permission prompts show the
exact origin and allow-once/deny decisions. Private mode explicitly says it is
not perfect privacy.

## Privacy and security presentation

- macOS/iOS private tabs use nonpersistent WebKit stores.
- Android launches a non-exported `:private` process and calls
  `WebView.setDataDirectorySuffix("private")` before creating its WebView; the
  process clears cookies, WebStorage and cache on exit.
- Windows private windows use a unique temporary WebView2 profile.
- Private pages never enter history, recovery, bookmarks, permission storage,
  or AI selection. Downloaded files are disclosed as an external trace.
- Browser only parses/reviews Wallet requests and hands them to YNX Wallet. It
  never signs or receives private keys.

## Accessibility, locale, and state coverage

Controls have accessible names and platform focus behavior. Mobile actions
scroll rather than shrink to unreadable glyphs; visible fake-symbol buttons were
replaced with text or platform symbol assets. The shared contract tests all 12
required locales and Arabic RTL. Android changes layout direction, iOS uses the
SwiftUI RTL environment, and the Search surface loaded in every Browser carries
the fully verified responsive/RTL/150% text behavior.

Contract/UI tests cover normal/private tabs, recovery, permissions, phishing,
updates, Wallet expiry/replay/tamper rejection and AI unavailable boundaries.
Platform CI captures real cold/restart evidence; the definitive job links and
artifacts are recorded in `evidence/EVIDENCE_INDEX.md`.

## Issues found and fixed

- Replaced the minimal macOS shell with a real WKWebView browser window.
- Removed window restoration/autosave behavior that produced a narrow window.
- Replaced fake navigation glyphs with SF Symbols on Apple platforms and text
  controls on Android.
- Moved Android private browsing from a shared CookieManager into a separate
  WebView data-directory process.
- Expanded Windows from a static feasibility view to operational WebView2 tabs,
  history/download records, private profile, recovery, Wallet/AI boundaries.

## Remaining boundaries

The local Mac was able to build, package, ad-hoc sign, and install the app, but a
separate OS network-extension prompt caused AppKit launches to block before a
window appeared. No interaction with that unrelated prompt was attempted.
macOS CI supplies independent cold/restart evidence. This preview is not Apple
Developer signed/notarized; Android uses a published disposable preview key;
iOS Simulator and Windows CI artifacts are not production/store packages.
