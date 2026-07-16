# YNX Exchange handoff

## Scope and branch

- Branch: `codex/ecosystem-exchange`
- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Exchange`
- Continuation baseline preserved: `ff2b6b4ea877a0f708aff5fedc24b3fc7f40762d`
- Owned paths only: `apps/exchange/**`, `internal/exchangeproduct/**`, this handoff.
- No root Makefile, long-term goal, central acceptance state, Gateway policy or other product directory was changed.

The final immutable commit is supplied in the completion message. This candidate is not evidence of central merge, installation outside the local emulator, deployment, production signing, TestFlight, App Store, Google Play, public availability, third-party cooperation or regulatory/custody approval.

## Truth boundary

YNX Exchange is a YNX-owned deterministic testnet venue. It is not an exchange listing or production custody venue. It does not represent public users, external counterparties, Binance or other exchange liquidity, public volume, third-party prices, or invented market depth. The order book contains only persisted open user orders and trades contain only deterministic price-time matches from this engine.

`YUSD_TEST` is venue-only deterministic test credit, not a token or stablecoin. It cannot be deposited or withdrawn. Cross-chain deposit and withdrawal are always unavailable until an approved bridge, relayer custody, exact asset route and external proof exist. Native YNXT deposit is unavailable unless custody and an authoritative indexer are both configured; withdrawal is review-only and cannot be broadcast without an operator adapter and proof.

## Delivered product

### Native-first mobile

- Expo/React Native app at `apps/exchange/mobile`, with generated Android and iOS native projects.
- Independent Android/iOS identity `com.ynxweb4.exchange`, deep-link scheme `ynxexchange`, Wallet callback `ynxexchange://wallet-auth/callback`, own icon and native launch entry.
- Mobile-native tabs for market, assets, own orders/history and account/security/AI/integration status. Web remains a denser desktop companion, not a substitute for mobile.
- Loading, truthful empty market/order state, service failure, retry, offline/stale warning, unsupported route and integration-unavailable states.
- All controls expose semantic roles/labels, touch targets, selected/disabled state; wide/tablet layout is bounded and phone layout has no horizontal terminal dependency.

### Wallet and central Gateway contract

- The accepted Task 1 `@ynx-chain/wallet-auth` v1 implementation is vendored unchanged under the owned mobile path and used directly.
- Request binding: chain `ynx_6423-1`, product `exchange`, client `ynx-exchange-v1`, bundle `com.ynxweb4.exchange`, callback above, five-minute nonce, canonical JSON and sorted least-privilege scopes.
- Scopes: `exchange:ai`, `exchange:deposit`, `exchange:read`, `exchange:trade`, `exchange:withdrawal-review`.
- Wallet callback verification binds request digest, account/public key, compact lower-S secp256k1 approval, purpose, scope and expiry. Product device uses a securely persisted P-256 secret and signs the canonical Gateway challenge in DER form.
- `EXPO_PUBLIC_YNX_EXCHANGE_GATEWAY_URL` defines the central challenge/completion interface. No URL or acceptance is fabricated. With no registered Wallet client/Gateway route, the native app reports unavailable and issues no session.
- The Go product accepts central session tokens only through a configured `/v1/sessions/introspect` adapter. It verifies `wallet-auth-v1`, exact client/bundle, expiry, requested scope, compressed secp256k1 public key and the derived YNX account before returning any account state. Gateway failures never fall back to a guessed principal.
- The older Web companion adapter remains compatibility-only. It is not labeled central or used as evidence of Task 1 integration. It now uses the same address-bound compressed secp256k1 identity and low-S compact signatures as Wallet Auth v1; an arbitrary key can no longer claim another `ynx1...` account, and central-introspected sessions can authorize the exact order/cancel/withdrawal payload format.

Central integration request: register the exact client/bundle/callback/scopes and route `/v1/wallet/session-challenges`, `/v1/wallet/sessions`, and Exchange account/action authorization to this product. This branch intentionally does not edit central policy.

### Assets, orders and traceability

- Deposit now begins with an idempotent, expiring `DepositIntent`. It exists only when custody and indexer are configured, binds the account/network/address and records the exact indexer source.
- Observation accepts only a committed YNX transfer to the configured custody address, tracks confirmations, prevents duplicate transaction credit, and credits once after the threshold.
- Withdrawal review validates native destination, exact fee/receive amount, balance, security lock, maximum amount and Wallet signature. It reserves balance but truthfully stays `reviewed_pending_operator_broadcast`.
- Fixed six-decimal integer ledger; atomic balance reservation; deterministic synchronized price-time matching; partial/full fills; cancel; reject/self-trade prevention; maker/taker fees; restart and idempotent replay.
- Balance mutations produce `LedgerEntry` records with available/reserved delta, source type, source object and source digest. Deposits, withdrawals, orders and trades expose authorization/evidence provenance.
- Audit events are append-only, object-digested and previous-hash chained. Whole state remains SHA-256 integrity protected, fsynced and atomically renamed; startup rejects tampering.
- Risk limits are operator-configurable and fail closed: maximum order notional and maximum withdrawal review amount. Cross-chain and withdrawal broadcast remain disabled.

### AI-native workflow

The product accepts only market explanation, own-trade summary, risk explanation and order draft intents with explicit context classes/permission. Provider/model/cost/status are audited. Without an approved provider it reports `provider_unavailable`; no canned answer, price or volume is substituted. An order draft can be approved only from an exact `result_ready` state; approval is one-use, binds a digest of the exact result and selected context, and only advances to `approved_for_wallet_review`. It never creates an order: order submission still requires a fresh Wallet signature over the canonical order payload. AI cannot invoke order, cancel, withdrawal or security mutation methods. AI output language is selected independently and persisted.

## Internationalization audit

Implemented locales: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia.

- Initial locale is detected from the system; manual UI locale and independent AI-output locale are persisted in platform secure storage across restart.
- Locale-aware number/amount, date/time and plural helpers use `Intl`.
- Arabic uses explicit RTL row ordering, writing direction and text alignment.
- Catalog audit covers all 57 keys in every locale, nonblank fallback, strict presence of legal/privacy/sign-in/unavailable/cross-chain semantics and Arabic RTL.
- Security, recovery-key warning, privacy, Wallet permission, failure, unavailable and accessibility navigation text are present in the catalog. Legal/payment/signing English source semantics are preserved; central registration should obtain independent legal-language review before public release.

## Configuration

Server-only/operator values (never committed as `.env`):

- `YNX_EXCHANGE_ADMIN_API_KEY`
- `YNX_EXCHANGE_STATE_PATH`
- `YNX_EXCHANGE_INDEXER_URL`
- `YNX_EXCHANGE_CUSTODY_ADDRESS`
- `YNX_EXCHANGE_GATEWAY_URL`, `YNX_EXCHANGE_GATEWAY_CLIENT_ID`
- fee, confirmation, maximum-notional and maximum-withdrawal limits

Mobile public routing values:

- `EXPO_PUBLIC_YNX_EXCHANGE_API_URL`
- `EXPO_PUBLIC_YNX_EXCHANGE_GATEWAY_URL`

`/v1/config` reports Gateway, Wallet registry, custody, indexer and cross-chain states separately. `configured_not_attested` explicitly means configuration is not proof of central acceptance.

## Verification evidence

Passing source checks:

- `go test -race ./internal/exchangeproduct`
- `go test ./internal/exchangeproduct ./apps/exchange/server`
- `npm --prefix apps/exchange test`
- `npm --prefix apps/exchange run test:browser` — desktop 1440x900 and mobile 390x844
- `npm --prefix apps/exchange run smoke`
- `npm --prefix apps/exchange/mobile run typecheck`
- `npm --prefix apps/exchange/mobile test`
- `npm --prefix apps/exchange/mobile run i18n-check` — 12 locales, 57 keys, Arabic RTL
- `npm --prefix apps/exchange/mobile run bundle-check` — Android and iOS production JS/Hermes bundles
- `JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/huangjiahao/Library/Android/sdk NODE_ENV=production ./gradlew :app:assembleRelease --no-daemon --offline --max-workers=2` — 328 tasks, all four configured ABIs, lint vital, embedded Hermes bundle and release APK

Browser screenshots (uncommitted):

- `tmp/exchange-browser-evidence/desktop.png`
- `tmp/exchange-browser-evidence/mobile.png`

Android install/cold-start evidence (uncommitted):

- Local release variant APK: `apps/exchange/mobile/android/app/build/outputs/apk/release/app-release.apk` (74 MB, intentionally local debug signing rather than production/store signing).
- Installed on API 36 arm64 emulator `emulator-5562`; `am start -W` reported `LaunchState: COLD`, `TotalTime: 1623`, Activity `com.ynxweb4.exchange/.MainActivity`.
- Process remained alive after the post-start wait; filtered logs contained no fatal exception or missing-bundle error.
- Final screenshot: `tmp/exchange-native-evidence/android-release.png`; accessibility hierarchy: `tmp/exchange-native-evidence/android-release-ui.xml`.
- The first debug-APK diagnostic correctly failed without Metro and is not counted as release evidence. The release rerun embeds the bundle and succeeds offline.

The complete iOS `.xcodeproj`, native source, Info.plist scheme and bundle ID are committed, and the iOS production JS/Hermes export passes. This machine has Command Line Tools only, so `xcodebuild`, Simulator and signing evidence remain honestly pending.

Repository-wide `GOMAXPROCS=2 go test ./...` was also run. All Exchange tests passed, but the existing unrelated `internal/bftgateway` and `internal/consensus` IDE tests fail because `artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json` is absent from this baseline worktree. This branch does not own or alter that artifact path.

## Remaining external blockers

1. Central Wallet registry and Gateway route acceptance for the exact binding/scopes; until then native sign-in and action authorization fail closed.
2. Operator-approved custody address, authoritative Indexer endpoint, withdrawal broadcast adapter and proof. Review does not imply broadcast.
3. Product-scoped YNX AI Gateway provider/model/quota/stream/cancel/retention approval. Current provider state is unavailable.
4. Full Xcode installation, signing identities and iOS Simulator/App Store tooling. No production signing/store claim.
5. Independent security, legal-language, accessibility-device and custody/regulatory review before any public venue.
