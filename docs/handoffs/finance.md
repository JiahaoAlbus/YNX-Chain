# YNX Finance handoff

## Scope

- Branch: `codex/ecosystem-finance`
- Version: `1.2.0`
- Native identity: `com.ynxweb4.finance`
- Scheme/callback: `ynxfinance`, `ynxfinance://wallet-auth/callback`
- Product client: `ynx-finance-v1`
- Network/asset: public YNX Testnet `ynx_6423-1`, YNXT
- Boundary: read-only portfolio and private planning; no banking, custody, brokerage, lending, insurance, card, fiat, yield or asset-signing claim.

## Delivered

The branch now contains an Android/iOS React Native product, Go Finance API, Web feasibility companion and a canonical Finance edge Gateway. The native app covers Wallet entry, real-source YNXT overview/activity, authorized Pay receipts and dispute links, categories, private notes, user/approved-AI classification, monthly budgets and progress, recurring reminders, reports, CSV/JSON export, versioned planning import, privacy, account deletion, support, recovery and account audit.

AI accepts only explicitly selected owned evidence after privacy permission and per-request consent. Categorization, fee explanation and budget output remain review drafts until Apply; Reject, Cancel and Delete are visible. No provider failure fallback invents advice or money.

Twelve locale packs are present: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. System/manual locale and theme persist; Arabic applies RTL; dates and YNXT amounts use locale formatters; AI language is independent. Public release still requires professional legal/privacy translation review.

## Canonical Wallet integration

Legacy Finance HMAC/local session routes were removed. Native code delegates request/deep-link/callback verification/digest/device proof to `@ynx-chain/wallet-auth`. The edge Gateway invokes the exact central verifier, binds product/bundle/account/device/scopes/expiry, prevents replay and exposes introspection/revocation behind an internal key. The Go API introspects every bearer token and accepts no caller-provided address identity.

Exact merge input and deterministic vector live in `apps/finance/integration/wallet-auth/`. Their manifest deliberately says:

- `registryMerged=false`
- `gatewayDeployed=false`
- `walletApprovalTestedOnInstalledBuild=false`

Therefore `integratedCentral=false`. The current central Wallet branch registers Social only; Finance correctly fails closed. Local Gateway replay/revocation state is memory-backed and must become persistent/shared before deployment.

## Source truth

| Object | Source | Provenance and limitation |
|---|---|---|
| YNXT balance/activity | real Explorer account endpoint | account match, source/as-of/block/tx; latest 100 indexed records; complete history/opening balance not claimed |
| Pay receipt | authenticated real `/pay/events` | owned-party filter, event/status/amount/tx/time/dispute; unavailable without key; no placeholders |
| Category/note/budget/reminder | explicit user, import or applied AI draft | `source` plus account-scoped audit; planning only |
| Statement/monthly review/export | current Explorer/Pay evidence plus planning state | YNXT/Testnet/coverage markers; not a bank, tax or legal statement |
| Offline view | last accepted encrypted-platform cache | visible saved-at and not-live labeling |

Remote smoke on 2026-07-18 proved Explorer health and public transaction access, and Pay health. Explorer reported height 306,446, indexed height 285,750 and 20,696-block lag. Pay receipt endpoints returned the expected 401 without an operator credential. This proves failure closure, not authorized receipt success; see `artifacts/finance/remote-source-smoke.json`.

## Verification

- `go test ./internal/finance ./apps/finance/cmd/server` — passed.
- Shared Wallet package — 21/21 passed.
- Finance edge Gateway — 2/2 passed, including canonical completion, revoke, tamper and replay.
- Finance contract suite — 6/6 passed; smoke passed.
- Native TypeScript — typecheck passed; 6/6 tests passed for workflows, AI approval, exact Wallet delegation, 12 locales, formats and Arabic RTL.
- Android/iOS Hermes bundle export — passed (2,523/2,521 modules in the current native build).
- Android `assembleRelease` — passed (352 tasks). Final APK size 77,371,822 bytes; SHA-256 `37208e56e96357371b19afc290d82d68adf1f0596213dbcd777341a949915f4e`.
- Final Android APK install — `com.ynxweb4.finance`, version 1.2.0/code 3, exact callback registered. Independent launch without Metro on `emulator-5580` returned `Status: ok`, `LaunchState: COLD`, `Activity: com.ynxweb4.finance/.MainActivity`, `TotalTime: 16313`, `WaitTime: 17320`.
- Android light/dark screenshots were visually inspected. A shared System UI ANR dialog was excluded from accepted evidence and is not attributed to Finance.
- Web signed-out companion was inspected in the in-app Browser at 1440×900 and 390×844. The product boundary, no-fallback Wallet state and responsive layout passed.
- Local `/health` returned version 1.2.0, `custody:none`, `portfolio:read-only`; CSP, Permissions Policy, no-referrer and nosniff headers were present.
- `npm audit --omit=dev` reports 10 moderate Expo/tooling advisories, no high/critical. The incompatible automated Expo downgrade was not applied; see the security audit.
- `git diff --check` and workflow YAML parsing passed.

## Exact release state

`implementedLocal=true`, `testedLocal=true`, Android `installedLocal=true`. iOS local install, central integration, functional staging API, public deployment, production signing and store release are false. The APK is local-test-signed only. A Web preview attempt was not counted as deployment unless a reachable URL and `/api/health` evidence are later recorded. See `apps/finance/product-release.json` for machine-readable status.

## Remaining external gates

1. Merge the exact Finance registry v2 entry into the canonical central Wallet branch; deploy the persistent Gateway; pass installed Finance → Wallet approval → device proof → introspection → scoped Finance API → revoke on both Android and iOS.
2. Provide a secret-managed Finance Pay read key and pass an owned receipt/dispute smoke. Never place the key in the client or repository.
3. Deploy the Go API behind TLS with persistent backed-up storage, source credentials, rate monitoring and reviewed support/privacy/dispute destinations; run backup/restore evidence.
4. Run the macOS CI Simulator build/install/cold launch, then obtain owner-controlled iOS and Android production signing. No TestFlight, App Store or Play claim until actual console evidence exists.
5. Resolve or accept with owner sign-off the current moderate Expo tooling advisories, and professionally review legal/privacy translations.
6. Add Explorer cursor history before changing the latest-100 coverage or claiming complete statements.

## Acceptance recommendation

Accept as a locally implemented and Android-installed Testnet candidate. Do not describe it as centrally integrated, production deployed, production signed, publicly downloadable or store released until the corresponding evidence changes the status manifest.
