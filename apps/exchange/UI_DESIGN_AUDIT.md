# YNX Exchange UI design audit

## Information architecture

- Mobile is a native-first five-tab product: Markets, Trade, Orders, Assets, Account. It uses bounded sheets, native inputs and list rows rather than a desktop terminal embedded in a phone.
- Exchange Pro is a dense split terminal: chart, actual owned-venue book, order ticket, open orders, balances/activity and an inspector/control surface.
- Both surfaces keep `TESTNET ONLY`, `YUSD_TEST` venue-credit, custody and cross-chain boundaries adjacent to the affected action.

## Visual system

Klein Blue `#002FA7` is limited to brand, focus, links, primary actions and selection. Light canvas uses neutral white/gray; Pro dark mode uses black/graphite without neon or decorative glow. Red and green appear only for actual risk/error/direction semantics. Typography uses platform system fonts. Tables and dividers carry hierarchy; cards are limited to genuinely independent balances or workflow objects.

## Platform and responsive behavior

- React Native uses safe areas, bottom tabs, 44+ point targets, bounded tablet width, semantic roles/labels and native Android/iOS projects.
- Pro uses keyboard skip navigation, toolbar, split view, tables and responsive stacking below 700 px. There is no horizontal terminal dependency on 390 px.
- Reduced motion disables nonessential transitions. Focus-visible styling, live regions and non-color status labels are present.

## Internationalization and RTL

Mobile catalogs cover all audited keys for `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `id`. Arabic reverses row direction and uses RTL text/writing direction. Amount/date/plural helpers use `Intl`; locale and independent AI-output language persist in secure storage. High-risk Wallet, legal, privacy, unavailable, recovery and cross-chain meanings are included in every catalog. Pro currently retains English operator terminology and is therefore not separately marked 12-language complete.

## State coverage

Mobile explicitly renders loading, empty, service failure/retry, offline/stale, unavailable route, expired session, integration pending, destructive review, partial fill and audited activity. Pro renders empty book/order/history without seeded depth, central-auth unavailable, custody/indexer unavailable, AI provider unavailable and exact withdrawal review/broadcast boundary. Replay, tamper and conflict are API error states backed by tests rather than cosmetically successful UI.

## Screenshot evidence

- `tmp/exchange-browser-evidence/desktop.png` — Pro desktop, 1440×900.
- `tmp/exchange-browser-evidence/mobile.png` — Pro responsive, 390×844.
- `tmp/exchange-native-evidence/android-release-five-tabs.png` — installed Android release cold start with Markets, Trade, Orders, Assets and Account visible in both pixels and the native accessibility tree.
- `tmp/exchange-native-evidence/android-release-five-tabs.xml` — UIAutomator roles, labels and selected state for the five-tab build.

Screenshots are local evidence, not public deployment or download proof. The current machine has no full Xcode installation, so iOS Simulator visual evidence is pending. Dark, large-text and Arabic screenshots for the native app remain required before a public/store release.

## Fixed during this delivery

- Removed legacy browser challenge/session UI, pasted bearer entry, query callback login and custom Wallet action URI.
- Replaced compatibility language with explicit central registration unavailable/fail-closed state.
- Split Markets and Trade into distinct native tabs so discovery/order entry are not conflated; the five-tab requirement is now explicit in product tests and the accessibility tree.
- Kept empty market depth honest; no generated candles, price, liquidity, volume or trades were added.

## Remaining limitations

Central browser-session/action routes are not deployed. Until they are, protected Pro actions remain unavailable rather than using a local pseudo session. Independent device accessibility and legal-language review remain release gates.
