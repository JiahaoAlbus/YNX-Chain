# YNX Finance handoff

## Scope

- Branch: `codex/integrate-finance-suite`
- Version: `1.2.0`
- Native identity: `com.ynxweb4.finance`
- Scheme/callback: `ynxfinance`, `ynxfinance://wallet-auth/callback`
- Product client: `ynx-finance-v1`
- Network/asset: public YNX Testnet `ynx_6423-1`, YNXT
- Boundary: read-only portfolio and private planning; no banking, custody, brokerage, lending, insurance, card, fiat, yield or asset-signing claim.

## Delivered

The branch contains Android/iOS React Native and Web products, the Go Finance API and a bounded Finance edge Gateway. It covers Wallet entry, real-source YNXT overview/activity, authorized Pay receipts and dispute links, account-bound Exchange balances/trading evidence, account-bound DEX LP/swap/liquidity/fee evidence, categories, private notes, user/approved-AI classification, monthly budgets and progress, recurring reminders, reports, CSV/JSON export, versioned planning import, privacy, account deletion, support, recovery and account audit.

AI accepts only explicitly selected owned evidence after privacy permission and per-request consent. Categorization, fee explanation and budget output remain review drafts until Apply; Reject, Cancel and Delete are visible. No provider failure fallback invents advice or money.

Twelve locale packs are present: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. System/manual locale and theme persist; Arabic applies RTL; dates and YNXT amounts use locale formatters; AI language is independent. Public release still requires professional legal/privacy translation review.

## Canonical Wallet integration

Legacy Finance HMAC/local identity sessions were removed. Native and Web code delegate request/deep-link/callback verification, digest and device proof to `@ynx-chain/wallet-auth`. Each private API call carries a fresh method/path/body/scope-bound P-256 Product Session proof, which the Go API introspects at the central Gateway. No Bearer session, address login or caller-provided identity is accepted. Exact registry input and deterministic vectors live in `apps/finance/integration/wallet-auth/`; the central registry and public Gateway are live, while final installed approval/callback remains unverified because the Android emulator had no enrolled strong biometric and correctly failed closed.

## Source truth

| Object | Source | Provenance and limitation |
|---|---|---|
| YNXT balance/activity | real Explorer account endpoint | account match, source/as-of/block/tx; latest 100 indexed records; complete history/opening balance not claimed |
| Pay receipt | authenticated real `/pay/events` | owned-party filter, event/status/amount/tx/time/dispute; unavailable without key; no placeholders |
| Exchange account | `exchange-finance-read-v1` owner endpoint | Wallet-account/path/time/nonce-bound HMAC; sanitized persisted balances, spot/perpetual orders and fills, fees, margin, positions, funding and risk status; current public runtime is not configured with the candidate |
| DEX account | `dex-finance-read-v1` owner endpoint | deployed account/path/time/nonce-bound HMAC; raw indexed LP positions, swaps, liquidity actions, fees and referenced pools only; public owner adapter is configured, while a fresh installed-Wallet `/api/sources` end-to-end probe remains pending |
| Category/note/budget/reminder | explicit user, import or applied AI draft | `source` plus account-scoped audit; planning only |
| Statement/monthly review/export | current Explorer/Pay evidence plus planning state | YNXT/Testnet/coverage markers; not a bank, tax or legal statement |
| Offline view | last accepted encrypted-platform cache | visible saved-at and not-live labeling |

Remote smoke on 2026-07-18 proved Explorer health and public transaction access, and Pay health. Explorer reported height 306,446, indexed height 285,750 and 20,696-block lag. Pay receipt endpoints returned the expected 401 without an operator credential. This proves failure closure, not authorized receipt success; see `artifacts/finance/remote-source-smoke.json`.

## Verification

- `go test ./internal/finance ./apps/finance/cmd/server` — passed.
- Shared Wallet package — 21/21 passed.
- Finance edge Gateway — 2/2 passed, including canonical completion, revoke, tamper and replay.
- Finance Web/product contract suite — 13/13 passed; smoke and the 146-file security gate passed.
- Native TypeScript — typecheck passed; 6/6 tests passed for workflows, AI approval, exact Wallet delegation, 12 locales, formats and Arabic RTL.
- Android/iOS Hermes bundle export — passed (current Exchange-evidence native candidate included).
- Android `assembleRelease` — passed (352 tasks). Final APK size 77,371,822 bytes; SHA-256 `37208e56e96357371b19afc290d82d68adf1f0596213dbcd777341a949915f4e`.
- Final Android APK install — `com.ynxweb4.finance`, version 1.2.0/code 3, exact callback registered. Independent launch without Metro on `emulator-5580` returned `Status: ok`, `LaunchState: COLD`, `Activity: com.ynxweb4.finance/.MainActivity`, `TotalTime: 16313`, `WaitTime: 17320`.
- Android light/dark screenshots were visually inspected. A shared System UI ANR dialog was excluded from accepted evidence and is not attributed to Finance.
- Web signed-out companion was inspected in the in-app Browser at 1440×900 and 390×844. The product boundary, no-fallback Wallet state and responsive layout passed.
- Local `/health` returned version 1.2.0, `custody:none`, `portfolio:read-only`; CSP, Permissions Policy, no-referrer and nosniff headers were present.
- `npm audit --omit=dev --prefix apps/finance/mobile` now reports 11 advisories: 1 high `brace-expansion` denial-of-service advisory and 10 moderate Expo/tooling advisories. Non-force repair was attempted but not completed because of a local rename conflict followed by bounded MCP 502 failures; `--force` was not used because it proposes an incompatible Expo 46 downgrade. See the security audit.
- `git diff --check` and workflow YAML parsing passed.

## 2026-07-27 source-truth and cursor checkpoint

- Finance now validates Explorer `/health` and the `YNXT` native identity before accepting account evidence.
- Portfolio source status now includes source version, `asOf`, timestamp semantics, coverage, sync state, RPC/indexed heights, lag and explicit errors.
- Activity pagination now uses HMAC-SHA-256 cursors bound to the Wallet account, offset and current activity snapshot; tamper, wrong-account reuse and stale snapshots fail closed.
- `YNX_FINANCE_CURSOR_SIGNING_KEY` is required at startup and rejects values shorter than 32 characters. It is an operator secret, not a Wallet or provider credential.
- `go test -count=1 ./internal/finance ./apps/finance/cmd/server` passed, and `npm run smoke --prefix apps/finance` passed all Finance Go, security, product-contract and build checks.
- Full `go test ./...` was also attempted and failed only outside Finance ownership: consensus/Faucet/Trust key-permission tests and missing IDE contract artifacts. `internal/finance` passed in that run; these failures are recorded for their owners rather than modified here.
- The authoritative Finance integration contract, handoff, dependency acceptance and cross-product negative vectors now live under `release/integration/` and `docs/integration/`.

## 2026-07-29 observability checkpoint

- Every Finance HTTP response now carries a validated or generated `X-Request-ID`; errors also carry a stable `YNX-FIN-*` identifier in `X-Error-ID` and the JSON body.
- JSON access/error logs record matched route patterns and status/latency correlation only. Tests reject leakage of bearer tokens, Wallet accounts, query strings and authorization header names.
- `GET /metrics` is protected by a distinct `YNX_FINANCE_OPERATIONS_KEY` and returns the versioned `finance-metrics-v1` process snapshot: route/status/latency counters, source outcomes, start time, process instance and explicit restart semantics.
- Metrics are in-memory and reset on restart. Central Monitor ingestion, persistence and deployed alerting remain false.
- `go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`, the equivalent race run and `npm run smoke --prefix apps/finance` passed for this slice.

## Exact release state

The Web/API and DEX owner-read adapter at source commit `4f6546e0823c5063a99c7d84e2ed13ba3c014866` are publicly deployed on Testnet. Exact `/version` bindings, binary/Web hashes and a server-side account-bound owner probe are recorded in `docs/evidence/finance/dex-read-public-runtime-2026-08-11.json`. This does not prove the installed-Wallet approval → Finance `/api/sources` path, production signing, or a store release. Android remains test-signed; iOS install, production signing and store release are false.

## Remaining external gates

1. Pass installed Finance → Wallet approval → device proof → introspection → scoped Finance API → revoke on both Android and iOS using devices with strong biometrics.
2. Provide a secret-managed Finance Pay read key and pass an owned receipt/dispute smoke. Never place the key in the client or repository.
3. Configure and deploy the Exchange and Quant owner-read pairs, then prove Exchange/DEX/Quant through one fresh installed-Wallet Product Session and Finance `/api/sources`; retain same-account and exact-source evidence and run backup/restore evidence.
4. Run the macOS CI Simulator build/install/cold launch, then obtain owner-controlled iOS and Android production signing. No TestFlight, App Store or Play claim until actual console evidence exists.
5. Resolve or accept with owner sign-off the current moderate Expo tooling advisories, and professionally review legal/privacy translations.
6. Add Explorer cursor history before changing the latest-100 coverage or claiming complete statements.

## Acceptance recommendation

Accept the DEX owner-read adapter as publicly deployed and server-side account-bound on Testnet. Keep `integratedCentral=false` until a fresh installed-Wallet Product Session proves the complete Wallet → Finance `/api/sources` path. Exchange and Quant remain locally accepted but publicly unconfigured. Native download and store-release claims remain separate from the Web/API release.
