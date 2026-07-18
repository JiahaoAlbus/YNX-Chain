# YNX Exchange / Pro / Quant Lab handoff

## Scope and preservation

- Worktree: `/Users/huangjiahao/Desktop/YNX Chain Exchange`
- Branch: `codex/ecosystem-exchange`
- Required minimum baseline preserved: `5d95046a92e01c7c5d00306cf8e78a1b9002a08a`
- Central Wallet/Auth source: `/Users/huangjiahao/Desktop/YNX Chain Wallet Auth`, commit `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`

No reset, old-SHA checkout, force push, or removal of inherited work was used. The final pushed SHA is reported by the completion message and remote verification; release records identify the immutable implementation commit used for artifacts.

This handoff covers three independent surfaces:

1. YNX Exchange Mobile (`ynx-exchange-mobile`, Android/iOS, bundle/package `com.ynxweb4.exchange`)
2. YNX Exchange Pro (`ynx-exchange-pro`, desktop/responsive web terminal)
3. YNX Quant Lab (`ynx-quant-lab`, research, Paper and bounded Testnet Preview)

## Truth and safety boundary

YNX Exchange is a repository-owned deterministic testnet venue, not an exchange listing or production custody venue. `YUSD_TEST` is internal venue credit, not a stablecoin or transferable token. The public order book is persisted open order state; the public trade tape contains persisted price-time matches only. An empty venue returns empty arrays. No third-party price, depth, volume, liquidity, counterparty, trade, cross-chain route or custody proof is generated.

Native YNXT deposit requires both a configured custody address and committed authoritative Indexer evidence. Withdrawal ends at `reviewed_pending_operator_broadcast`; no transaction is broadcast without an operator adapter and proof. Cross-chain remains unavailable without an approved bridge, relayer custody, asset route and external proof. Production custody and real-money automated trading are false.

Quant historical/Paper output is simulated and does not predict returns. Product UI flows consume only the Exchange actual-match tape with exact source metadata and `externalPrice=false`. Empty, insufficient, malformed, external-price, or unconfigured feeds fail closed. The direct backtest endpoint exists for owned engine tests and adapters; the user-facing workflow uses `/v1/backtests/from-market`.

## Canonical Wallet and central integration

The vendored Wallet Auth `src` and `testdata` are byte-for-byte synchronized with central commit `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`. Registry schema v3 and protocol schema v2 requests are committed under each product's `integration/` directory with exact product/client/bundle/callback/scopes and `pending-review`, `enabled=false`, `integratedCentral=false`.

Exchange Mobile uses callback `ynxexchange://wallet-auth/callback`, client `ynx-exchange-v1`, chain `ynx_6423-1`, bundle `com.ynxweb4.exchange`, five-minute request lifetime, canonical request digest and least-privilege Exchange scopes. The central session token is kept in platform secure storage. The product never asks for or stores recovery keys.

Exchange server account access accepts only a configured central Gateway `/v1/sessions/introspect` response with verifier `wallet-auth-v1`, exact client/bundle, scope, expiry, compressed secp256k1 key and account derivation. Legacy `/v1/auth/challenges` and `/v1/auth/sessions` routes are absent (404). Pro has no pasted token, query token, browser storage token, local challenge, or custom pseudo-Wallet action path. Protected actions open an explicit central-unavailable dialog and fail closed.

Central Wallet sessions currently do not contain a product-action proof. Order/cancel/withdrawal submission therefore requires a canonical Gateway action-verification route in addition to session introspection; no local substitute is claimed. Registry/Gateway acceptance is external, so `integratedCentral=false` for all products.

## Exchange engine and lifecycle

- Fixed six-decimal integer accounting, atomic available/reserved balance mutation and provenance-bearing ledger entries.
- Deterministic synchronized price-time matching, partial/full fills, cancel, reject, self-trade prevention and maker/taker fees.
- Exact order authorization payload, low-S secp256k1 signature, nonce, idempotency key and replay rejection.
- Two-account tests cover open, partial, filled, cancel and fee outcomes; concurrency tests prove reservation atomicity.
- `DepositIntent` binds account/network/custody/indexer source, expires, prevents duplicate transaction credit and credits only after the configured committed confirmation threshold.
- Withdrawal review validates destination, amount, exact fee/net amount, lock, maximum, balance and Wallet proof, then reserves funds without broadcasting.
- Append-only object-digested/previous-hash-chained audit; whole-state integrity hash; fsync plus atomic rename; startup rejects tampering and restores valid state.
- Public `/v1/market-data/trades` reports only actual persisted matches. `/health` and `/version` report product, version and build commit.

AI supports market explanation, own-trade summary, risk explanation and order drafting only. Provider/model/status/cost/context are audited. Without an approved provider it returns unavailable. Approval is one-use and binds the exact output/context digest, advancing only to Wallet review; it never creates/cancels an order, withdraws or changes security settings.

## Product surfaces and internationalization

Exchange Mobile is a native React Native app with generated Android and iOS projects and five separate tabs: Markets, Trade, Orders, Assets and Account. Android/iOS production Hermes exports pass. The Android Release Testnet Preview is embedded-bundle, API 24+/target 36, installed and cold-launched on API 36. The current host lacks full Xcode; `.github/workflows/exchange-ios-simulator.yml` is a runnable macOS-15 job that installs Pods, builds the unsigned Release Simulator app, installs, cold launches, delivers the Wallet callback and uploads the `.app`, hash, log and screenshot.

Exchange Pro uses a dense split terminal (chart, actual book, ticket, orders, balances/activity and inspector) with responsive stacking, keyboard skip navigation, restrained dark mode, no neon/casino treatment and honest empty/integration states.

Exchange Mobile has 12 complete catalogs and 59 audited keys: en, zh-Hans/zh-CN, zh-Hant/zh-TW, ja, ko, es, fr, de, pt, ru, ar and id. System locale, persisted manual UI locale, independent persisted AI locale, Intl amounts/date/time/plurals and Arabic row/text RTL are tested. Pro remains English operator terminology and is not falsely marked 12-language complete.

Quant Lab is a separate workbench with Research, Strategies, Experiments, Paper, Testnet, Risk and Audit. Desktop uses sidebar/table/inspector; mobile uses a compact tab strip and stacked inspector. It supports 12 complete catalogs, Arabic document/table RTL, light/dark, reduced motion, semantic headings/navigation/tables/status and a verified no-overflow 390 px layout.

See `apps/exchange/UI_DESIGN_AUDIT.md` and `apps/quant-lab/UI_DESIGN_AUDIT.md` for visual evidence, fixed issues and remaining device-review limits.

## Quant engine, broker and risk design

The selected preview core is the repository-owned deterministic Go event engine. `ENGINE_EVALUATION.md` records official repositories, exact evaluated commits, licenses, adapter difficulty and risk for NautilusTrader (`3c099f…`, LGPL-3.0), Freqtrade/FreqAI (`02f6ca…` / stable `b604e2…`, GPL-3.0) and LEAN (`026911…`, Apache-2.0). No third-party engine source or binary is bundled. Copyleft candidates remain attributed isolated-sidecar evaluations pending legal review; notices and SBOM are retained.

The owned engine records strategy source/commit/license, strategy/model/data/feature hashes, split, seed, parameters, assumptions and limitations. Out-of-sample/walk-forward runs model fees, slippage, latency, participation/liquidity, partial fills, gaps, regimes, parameter sensitivity and no-trade/buy-hold baselines, with leakage/look-ahead guards.

Tournament stages are Baseline, Candidate, Champion, Challenger, Rejected and Retired. Paper Broker state is persistent, fixed point, reconciled and kill-switch protected. Reconciliation mismatch activates a persistent audited kill switch; restart does not clear it. The Testnet Broker requires a canonical Wallet-signed bounded mandate binding strategy hash, market, expiry, notional, position and daily-loss limits; replay/idempotency and broker proof are tested. Verifier and broker default unavailable. Third-party strategies cannot directly call execution, and live funds stay structurally disabled.

## Release state

| Product | Implemented | Tested | Installed | Central | Staging | Public/download | Production signed/store |
|---|---:|---:|---:|---:|---:|---:|---:|
| Exchange Mobile | true | true | Android true; overall false until iOS CI run | false | false | false | false |
| Exchange Pro | true | true | local service/browser only; no desktop package claim | false | false | false | false |
| Quant Lab | true | true | local service/browser only; no desktop package claim | false | false | false | false |

Static hosting was deliberately not labeled staging: both web products require a persistent Go service, authenticated/write boundaries and exact health/version. No suitable authorized stateful staging target was available. Product release booleans, empty URL arrays and known limitations are authoritative.

## Verification and evidence

Core checks:

- `go test -race ./internal/exchangeproduct ./internal/quantlab`
- Exchange lifecycle tests: two accounts, price-time, reservation, partial/full fill, cancel, self-trade prevention, fees, risk, replay/idempotency, tamper/restart, deposit and withdrawal boundary, AI approval.
- Quant tests: deterministic OOS persistence, walk-forward/sensitivity/regime/gaps, tamper/restart, actual-tape adapter strictness, Paper partial fill/reconciliation/kill switch, mandate expiry/limits/replay/broker proof, local write boundary and strict JSON.
- `npm --prefix apps/exchange test` and `npm --prefix apps/exchange run test:browser`
- `npm --prefix apps/quant-lab test` and `npm --prefix apps/quant-lab run test:browser`
- `npm --prefix apps/exchange/mobile run typecheck`, `test`, `i18n-check` and `bundle-check`
- Android `assembleRelease`, APK v2 signature verification, install, cold launch, deep link and UIAutomator tree.
- Local Exchange/Quant `/health`, `/version`, web headers, empty actual trade tape and Quant remote-write 403 smoke.
- CycloneDX SBOMs, dependency/license reviews, notices, secret/placeholder scans and `git diff --check`.

Android artifact evidence:

- APK: `apps/exchange/mobile/android/app/build/outputs/apk/release/app-release.apk`
- SHA-256: `986cf0ce775cb92ba60429445b354c38141c723af4c62d7cb6e8294fe57a3ca2`
- Bytes: `77,369,630`; version `1.0.0`; min API 24; target API 36.
- Signing: APK Signature Scheme v2, Android Debug certificate; testnet preview only, not production.
- API 36 emulator: install success; cold `com.ynxweb4.exchange/.MainActivity`; 751 ms; callback intent delivered to live PID.
- Screenshot/tree: `tmp/exchange-native-evidence/android-release-five-tabs.png` and `.xml`.

Current Playwright screenshots:

- Exchange Pro: `tmp/exchange-browser-evidence/desktop.png`, `mobile.png`.
- Quant: `tmp/quant-lab-evidence/desktop-light.png`, `desktop-dark.png`, `mobile-arabic-rtl.png`, `paper-kill-switch.png`.

The Quant desktop evidence intentionally shows `unavailable` plus an empty experiment table when no actual matched history exists. Paper submission also fails closed without the feed; reconciliation-zero and persistent kill-switch transitions still run and are captured. This replaces older browser-generated price evidence.

## Operations

Exchange required secret/operator values: `YNX_EXCHANGE_ADMIN_API_KEY`, `YNX_EXCHANGE_STATE_PATH`; optional integration values: `YNX_EXCHANGE_GATEWAY_URL`, `YNX_EXCHANGE_GATEWAY_CLIENT_ID`, `YNX_EXCHANGE_INDEXER_URL`, `YNX_EXCHANGE_CUSTODY_ADDRESS`, fee/confirmation/max-notional/max-withdrawal values. Mobile routing uses `EXPO_PUBLIC_YNX_EXCHANGE_API_URL` and `EXPO_PUBLIC_YNX_EXCHANGE_GATEWAY_URL`.

Quant uses `YNX_QUANT_STATE_PATH`, optional `YNX_QUANT_HTTP_ADDR`, and `YNX_QUANT_EXCHANGE_URL` pointing to the Exchange API root. Mutating HTTP calls are accepted only from loopback with exact `X-YNX-Preview-Mode: local-paper` and same origin. Do not expose that local preview server as production.

Release artifacts and hashes are indexed by `apps/exchange/ARTIFACT_MANIFEST.json`; product truth records are `apps/exchange/mobile/product-release.json`, `apps/exchange/product-release.json` and `apps/quant-lab/product-release.json`.

## External blockers

1. Central Wallet registry acceptance and canonical Gateway session/action-verification routes for the exact product bindings/scopes.
2. Operator-approved custody address, authoritative Indexer, withdrawal broadcast adapter/proof, and any bridge/relayer route.
3. Product-approved AI Gateway provider/model/quota/privacy/retention policy.
4. A successful iOS Simulator CI run, then production certificates/profiles and store accounts.
5. Authorized persistent staging infrastructure for both Go services, then public/download hosting if desired.
6. Independent security, legal-language, accessibility-device and custody/regulatory review before public operation.
