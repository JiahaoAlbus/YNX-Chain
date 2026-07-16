# YNX Trust Center + Resource Market correction handoff

## Scope and truth status

- Branch: `codex/ecosystem-trust-resource`
- Corrected candidate: the commit containing this handoff
- Final verification date: `2026-07-16` (Asia/Shanghai)
- Parent before this correction: `ae210bffbcd6`
- Products remain separate: `apps/trust-center/**` and `apps/resource-market/**`
- No root Makefile, central acceptance state, long-term objective, or another product directory was changed.
- This is a candidate implementation. It is not claimed merged, installed in a public environment, deployed, production-signed, published in an app store, or integrated into the central Gateway registry.

## Corrected service boundaries

Both products now expose product-local adapters for the central Wallet/App Gateway contract:

- `POST /api/auth/challenges`
- `POST /api/auth/challenges/{id}/verify`
- `POST /api/auth/revoke`

The adapter uses the current central headers `X-YNX-App-Session`, `X-YNX-Device-ID`, and `X-YNX-Client`. A successful session is bound to the exact device and stored as a SHA-256 token hash only. Expiry, revocation, wrong-device access, restart recovery, and constant-time token comparison are tested. Request/response bodies and signed payloads are not stored in authority audit; only hashes, route, actor, status, outcome and time are persisted.

Central Wallet sessions are also accepted by the product-local persisted read and AI workflows after device-bound verification; logging in no longer leaves `/api/state` behind a separate local-only session registry. GET query strings are forwarded intact to the central authority, so Resource quotes contain the exact address and requested Bandwidth/Compute/AI/Trust quantities. Authority responses are bounded to 1 MiB and fail closed when oversized.

Central URLs must be HTTPS except loopback test URLs. When the central Gateway or authoritative API is absent, product endpoints return an explicit retryable `503`; they do not invent an enforcement, label, capacity, transaction or settlement result.

YNX AI calls are now JSON `POST /ai/stream` requests containing prompt, bounded context and independently selected output language. There is no query-string prompt fallback. Provider failure remains a failure. Trust AI cannot mutate evidence, labels, decisions, appeals or assets. Resource AI cannot rent, stake, sponsor, revoke, settle or transfer.

## Trust Center authoritative workflow

Implemented central adapters:

- evidence submit and query;
- governance request submit/query, independent review and rejection;
- appeal submit/query/resolve;
- request-validity rules;
- public transparency reports.

The Web and native clients present evidence, query, appeal, review, transparency, Wallet sign-in and AI explanation as distinct steps. Local development records are explicitly identified as drafts. Authoritative calls require a central Wallet session. Native YNXT cannot be frozen, seized, blacklisted, confiscated or transferred by any Trust product route. Evidence and independent human review are required; appeal remains available.

The existing durable local workflow still covers request validity, illegal/overbroad rejection, evidence notices, role separation, sourced labels, finite label expiry, false-positive correction and audit. It is not described as authoritative central enforcement.

Final hardening prevents a reviewer from overriding an illegal native-asset-control request or an overbroad request to `valid`. Evidence used by the local conclusion workflow is bounded and must be visible to the subject; request fields and evidence counts/sizes are bounded. Review reasons are mandatory. These checks protect the native YNXT and due-process boundary even when a reviewer supplies a conflicting decision.

## Resource Market authoritative workflow

Implemented central adapters:

- policy, quote, analytics, balances and income;
- delegation, rental, sponsored pool and sponsorship APIs;
- owner/beneficiary/resource/limit/source/expiry/fee/audit records;
- signed purchase-intent creation, exact retry, status query and persisted recovery.

Intent replay is keyed by owner plus idempotency key and exact signed-payload hash. Changed payload retry is rejected. Statuses distinguish `submitting`, `failed`, `authority_rejected`, `pending_authority_confirmation`, and `authority_confirmed_capacity`. Confirmation requires both an authoritative object ID and transaction hash. Even then, the fee field states that asset settlement is not proven without separate authoritative settlement evidence. Resource sponsorship moves bounded capacity only and never YNXT or a user asset.

Resource dispute recovery now restores the exact disputed capacity to its source pool only when an independent reviewer upholds the dispute, caps recovery at the pool limit, and never changes an asset balance. Rejected disputes return to `active` only before expiry; otherwise they become `expired`.

## Changed paths

- `apps/trust-center/**`: standalone Web, Android and iOS clients; product smoke; Playwright and semantic i18n contracts.
- `apps/resource-market/**`: standalone Web, Android and iOS clients; product smoke; Playwright and semantic i18n contracts.
- `internal/trustproduct/**`: persistent cases, evidence, validity, review, labels, appeal/correction, transparency, AI records, central Wallet/Gateway adapter and authority audit.
- `internal/resourceproduct/**`: persistent capacity pools/records, pricing and income boundaries, delegation/rental/sponsorship, revoke/dispute recovery, AI records, signed authority intents and audit.
- `docs/handoffs/evidence/**`: fresh desktop/mobile screenshots generated by the real Playwright runs.
- `docs/handoffs/trust-resource.md`: this handoff only; no central acceptance state or root integration policy was changed.

## Native products

### Android

- Trust package: `com.ynxweb4.trust`, deep link `ynxtrust://auth/callback`
- Resource package: `com.ynxweb4.resource`, deep link `ynxresource://auth/callback`
- Independent launcher icons, manifests, Gradle projects and APKs.
- Native Java UI; no WebView.
- Automatic locale selection, manual locale and independent AI-language persistence, Arabic RTL, localized legal/payment boundary, native accessibility descriptions.
- Central Wallet challenge and proof verification, product-specific authoritative workflows, offline/unavailable states, exact intent retry and explicit no-substitution wording.
- Session tokens are encrypted with per-product Android Keystore AES-GCM keys.

Build commands and results:

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home \
ANDROID_HOME=/Users/huangjiahao/Library/Android/sdk \
./gradlew --no-daemon assembleDebug

Trust: BUILD SUCCESSFUL, 32 tasks
Resource: BUILD SUCCESSFUL, 32 tasks
```

Generated APKs are verification artifacts under ignored `app/build/` directories and are not committed.

Debug APK SHA-256 values from the final build:

```text
Trust:    30ad7b06ed2cfb4c92325d216b5142db0656a357e4de4c5d52ae331875f2df6a
Resource: e834b50f811ed0c0f820efb36aa0369a2d36cb44267619ed2d64ba87aec62c00
```

### iOS

- Trust bundle: `com.ynxweb4.trust`, scheme `ynxtrust`
- Resource bundle: `com.ynxweb4.resource`, scheme `ynxresource`
- Independent `.xcodeproj`, SwiftUI app entry, Info.plist, product workflow, locale persistence, Arabic RTL and strict boundary translations.
- `plutil -lint` and `swiftc -parse` pass for both projects.

The host has Apple Command Line Tools but no full Xcode installation or Simulator runtime. Therefore no Xcode build, code-signing, Simulator install or cold-launch claim is made.

## Internationalization contract

Web, Android and iOS cover English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية and Bahasa Indonesia. Web tests exercise every locale, reload persistence, no blank critical boundary and Arabic RTL. Locale-aware `Intl` date, number and plural formatters are provided. AI output language persists independently.

Critical Trust asset/due-process and Resource payment/settlement translations are explicitly checked by Go semantic-contract tests. These tests require the native-YNXT prohibition, human-review/appeal concepts, capacity-only transfer and quote-not-settlement meaning across all locale dictionaries.

## Verification completed

```text
go test ./internal/trustproduct ./internal/resourceproduct ./apps/trust-center ./apps/resource-market
PASS

go test -race ./internal/trustproduct ./internal/resourceproduct
PASS

go test ./...
PASS with a temporary read-only symlink to the base workspace's existing generated `artifacts/` directory; the symlink was removed and is not committed

node --check apps/trust-center/web/{i18n,app}.js
node --check apps/resource-market/web/{i18n,app}.js
PASS

swiftc -parse apps/trust-center/mobile/ios/YNXTrust/YNXTrustApp.swift
swiftc -parse apps/resource-market/mobile/ios/YNXResource/YNXResourceApp.swift
PASS

cd apps/trust-center && npm run test:ui
4 passed: desktop, mobile, lifecycle/failure, all-locales/RTL/persistence

cd apps/resource-market && npm run test:ui
4 passed: desktop, mobile, lifecycle/failure, all-locales/RTL/persistence
```

Authority tests use a real HTTP mock central service and verify challenge/verify, session binding, evidence/governance/appeal or quote/intent forwarding, POST bodies, token secrecy, signed-payload secrecy, persisted hashes, unavailable behavior, exact retry, tamper rejection and restart recovery.

Additional final verification:

```text
./apps/trust-center/check.sh
./apps/resource-market/check.sh
PASS against real locally started HTTP servers and persisted temporary stores

npm run test:ui (both products)
4/4 PASS for Trust and 4/4 PASS for Resource in real Chromium

make test
make no-placeholder-check
make secret-scan
make env-check
make objective-state-check
PASS

All remaining preflight targets were run through `ops-check` and passed, including
anti-illegal-request, request-validity, transparency-report, trust-appeal,
anti-unreasonable-tracking, native-ynxt-no-hidden-freeze, resource-market,
resource-sponsor, App Gateway, AI Gateway, BFT Trust/Resource actions and ops.
```

The monolithic `GOMAXPROCS=2 make preflight` was attempted three times. It advanced through the product-relevant and repository checks but encountered three host-local transient failures at different later stages: one AI fixed-port run returned `401`, one Explorer fixed-port run returned `502`, and the default `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` was killed with exit `137`. The AI and Explorer checks passed immediately when rerun alone. `sdk-check` passed completely with `/usr/bin/python3` (JavaScript 12/12, Python 6/6 and release integrity). Every target after `sdk-check` through `ops-check` was then run serially with the generated artifact link present and passed. No failing product test was waived.

## Outstanding integration blockers

1. The central App Gateway registry in the integration branch does not yet register Trust/Resource client routes and scopes. Product adapters therefore correctly remain unavailable until the total-control thread adds and reviews those bindings.
2. No live authoritative Trust/Resource deployment endpoint or production credential was provided. No live enforcement, transaction or settlement proof is claimed.
3. Android APK installation/cold launch was attempted against three existing API 36 emulators and a newly started API 34 emulator. ADB detected them, but Android's `package` service never became available and `sys.boot_completed` stayed unset; installation returned `Can't find service: package`. APK build is proven, but installed cold-launch evidence remains blocked by the host emulator state.
4. Full Xcode/Simulator and signing identities are unavailable, so iOS Simulator/device execution and signed archive remain pending.
5. No TestFlight, App Store, Google Play, public deployment, third-party audit or central merge is claimed.

## Integration requests

1. Register `ynx-trust-center-v1` and `ynx-resource-market-v1` in the central Gateway with the least-privilege scopes documented by each product's `/api/meta` response.
2. Map `/app/trust/**`, `/app/governance/**`, and `/app/resource-market/**` to the authoritative services with replay, nonce, committed-response and role policies intact.
3. Repeat Android install/cold-launch on a healthy emulator/device and iOS build/Simulator tests on a host with full Xcode before distribution acceptance.
4. Provision production HTTPS origins, product AI scopes and audited persistence/backup before any deployment statement.

There are no secrets, real `.env` files, recovery materials, debug APKs, Xcode derived data or signing artifacts in the commit.
