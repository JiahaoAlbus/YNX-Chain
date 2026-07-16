# YNX Finance handoff

## Scope and identity

- Branch: `codex/ecosystem-finance`; rework starts from `06868310ed4f03abe2e84d4f3a69c0a65101cb10`.
- Native rework implementation commit: `9a18de44545236f00698542138ba61408c5fc6cd`; final handoff commit is the branch SHA reported after push.
- Owned paths only: `apps/finance/**`, `internal/finance/**`, this handoff.
- Native product: `com.ynxweb4.finance`, scheme `ynxfinance`, callback `ynxfinance://wallet-auth/callback`, client `ynx-finance-v1`.
- No central state, root Makefile, long-term objective, acceptance state, or another product directory was edited.

## Delivered rework

- Android/iOS Expo React Native app plus generated native Gradle and Xcode projects. Web/PWA remains as an additional surface and was not substituted for mobile.
- Native overview, categorized activity, categories, monthly budgets, recurring reminders, source-bounded statements, JSON export/versioned import, privacy, alerts, support/dispute evidence, offline cache/retry/recovery, and AI draft approval/rejection.
- Native activity classification is now wired to the server's owned-Explorer-evidence route; Pay receipts retain transaction/dispute evidence; privacy toggles, audit loading, support links, JSON and CSV report export are operable rather than display-only.
- SecureStore persistence for locale, independent AI locale, Gateway URL, session, offline evidence cache, pending Wallet request and P-256 product-device secret. Language and offline state survive process restart.
- Exact Wallet v1 request fields, sorted Finance scopes, five-minute lifetime, native bundle/callback binding, request digest validation, P-256 device proof, exact callback route and central-session-only behavior. No local session or Wallet secret fallback exists.
- New server activity-classification route verifies that the record came from the authorized account's currently available Explorer evidence and that the category exists before persisting an audited user classification.
- AI adapter now calls the actual central `/health` and authenticated `/ai/stream` SSE interface. It no longer invents `/v1/finance/*` routes or a fake price estimate. Output language is allow-listed; output stays a reviewable draft and can never execute, transfer, trade, borrow, lend, stake, freeze, or change account control.
- Explorer and Pay records retain explicit source, coverage/error, timestamps, tx hashes and dispute links. Offline cache is visibly marked non-live. Empty/unavailable states replace invented balances or receipts.
- 12 audited locales: English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. System detection, manual persistence, `Intl` money/date formatting, Arabic RTL root direction, independent AI output locale, and localized core error/offline/legal/accessibility copy are implemented. Tests reject blank keys and English legal fallback.
- Product boundary is shown in the signed-out and overview/settings flows: not a bank, custodian, broker, adviser, insurer, lender or yield product; no asset movement or promised return. No fiat, APY, card, credit, insurance, custody, leverage or unsupported cross-chain balance is generated.

## Source traceability

| User object | Authoritative source | Persisted provenance / limitation |
|---|---|---|
| YNXT balance/activity | `ynx-explorerd` account response | account match, `source`, block, timestamp, latest-100 coverage, source status/as-of |
| Pay receipt | central `/pay/events` | owned-party match, event ID/status/amount/tx hash/time/dispute URL, Pay source status |
| Category/classification | explicit user or approved AI draft | category ID, record ID, `source=user` or approved draft, update time, audit event |
| Budget/reminder | explicit user, import, or approved AI draft | category/source reference, period/due time, idempotency key, audit event |
| Statement/export | current Explorer/Pay evidence plus persisted plan | source statuses and bounded-opening-balance warning; never called a bank statement |
| Offline view | encrypted platform cache of last accepted overview | `savedAt` envelope and visible “offline snapshot — not live” banner |

## Security and recovery

- Existing atomic `0600` JSON persistence, temp-write/rename, strict JSON/body bounds, origin controls, scoped bearer sessions, rate limit, audit log, idempotency and Wallet replay/tamper rejection remain intact.
- Native Wallet request and product-device key survive restart; exact callback and digest bindings reject substitution. Central completion is mandatory.
- AI context accepts only explicitly selected account-owned Explorer record IDs after privacy permission and per-request consent. Provider failure has no canned/fake fallback.
- Import requires `ynx-finance-export-v1`, imports only validated planning records, and does not overwrite server evidence. Export warning identifies sensitive planning content.
- Optional protocol module remains disabled. A future module must expose counterparty, custody, contract, principal-loss risk, fee, liquidity risk, jurisdiction risk and signature boundary before review; Wallet is the only possible signer.

## Verification evidence (2026-07-16 final rerun)

- `go test ./...` — passed across the repository after the Finance Go changes.
- `go test ./internal/finance ./apps/finance/cmd/server` — passed.
- `npm test` and `npm run smoke` in `apps/finance` — passed.
- Native `npm run typecheck` — passed.
- Native `npm test` — locale/format/RTL, canonical signing, complete workflow, AI approval and truthful-claim contracts passed.
- Native `npm run bundle-check` — Android and iOS Hermes bundles generated (631/633 modules); `dist` is ignored and not committed.
- `npx expo prebuild --no-install` — complete Android and iOS native projects generated.
- Android `assembleDebug` and `assembleRelease` passed with Android Studio JBR and an explicit local SDK path. The release variant embeds the Hermes bundle and is locally debug-signed only; no production-signing claim is made.
- Release APK SHA-256: `006d5ffc592f14abed9b81c8afe3efdd884a4e3adccbada9adae98a4a7886221`. The ignored APK installed successfully on `emulator-5562`; `pm path` resolved `com.ynxweb4.finance`; the package registered the exact `ynxfinance://wallet-auth/callback` route.
- Independent release cold start passed without Metro: `am start -W` returned `Status: ok`, `LaunchState: COLD`, `Activity: com.ynxweb4.finance/.MainActivity`, `TotalTime: 6590`, `WaitTime: 6768`. A screenshot was visually inspected after dismissing a shared-emulator System UI ANR; the native signed-out legal boundary and Wallet entry rendered, with no `Unable to load script` or fatal app log.
- The emulator's installed Wallet resolves `ynxwallet://authorize` to `com.ynxweb4.wallet.MainActivity`, proving the Finance handoff intent is routable. That Wallet build rendered blank after handoff and the central Finance registry is absent, so end-to-end Wallet approval/session completion is truthfully not claimed.
- Web feasibility ran the real `apps/finance/cmd/server` on loopback with temporary non-production configuration. `/health` returned `custody:none`, `portfolio:read-only`, `nativeSymbol:YNXT`; `/` returned 200 with CSP, Permissions-Policy and the visible non-bank/non-custodial boundary.
- `git diff --check` — passed.
- Full Xcode and `simctl` are not installed (`xcode-select` resolves to CommandLineTools), so iOS Simulator execution and production signing remain truthfully pending. The Xcode project and iOS bundle export exist; there is no TestFlight/App Store claim.

## Central/external blockers and exact requests

1. Wallet central registry must add `ynx-finance-v1`, product `finance`, bundle `com.ynxweb4.finance`, callback `ynxfinance://wallet-auth/callback`, algorithm `p256-sha256`, and sorted scopes `finance.ai.draft`, `finance.pay.read`, `finance.portfolio.read`, `finance.profile.write`. The Wallet branch's current local registry contains only Social, so Finance sign-in must presently show unavailable.
2. Central Gateway must expose the shared Wallet protocol challenge/completion routes `/wallet-auth/sessions` and `/wallet-auth/sessions/complete`, call the shared exact verifier, return a Finance-scoped token, persist replay/revocation state, and route that token to Finance. No HMAC or provider secret belongs in the mobile app.
3. Deploy-time Finance needs real Explorer, Pay and AI Gateway URLs/credentials via secret manager, reviewed support/privacy/dispute URLs, TLS ingress and a backed-up state volume. No secret or real `.env` is committed.
4. Explorer must add cursor-paginated account history before a complete historical statement can be claimed. Current coverage stays latest 100 and opening balance stays unavailable.
5. Full Xcode plus an Apple signing team/certificates are external requirements for Simulator/device evidence and signed IPA. Google Play, TestFlight, store publication, production deployment and central merge are not claimed.
6. The Android release proof uses the generated debug keystore solely for local installability. Owner-controlled release signing, Play Console upload and store review remain external and are not claimed.
