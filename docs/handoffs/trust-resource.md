# YNX Trust Center + Resource Market handoff

## Candidate identity and truth boundary

- Branch: `codex/final-resource-market`
- Source candidate: `beca120f3e5e9552f7d9f1bc62aac217f6026b33`
- Baseline retained: `c7e4445598a74e60aa0ed05b9580790527bf71be`
- Verification date: 2026-07-22, Asia/Shanghai

These are two independent products recovered from a combined source branch. Resource Market now has a broader founder-level objective than the recovered candidate and is not yet fully implemented or fully tested locally. Neither product is centrally merged, connected to a deployed authoritative Wallet/Gateway, staged, public, publicly downloadable, production-signed, or store-released. Product release records keep every unproven state false.

## Status matrix

| Product | implemented-local | tested-local | installed-local | integrated-central | staging | public | hosted | production signed | store released |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YNX Trust Center | true | true | false | false | false | false | false | false | false |
| YNX Resource Market | false | false | true | false | false | false | false | false | false |

Resource Market `installed-local` is true only for a fresh debug-signed APK install and measured cold start on the local Android 16 emulator. Trust Center installation and both iOS installations remain unproven because this host has no full Xcode/Simulator environment. No production signing or store installation is claimed.

## Canonical Wallet and central integration

Each product has a distinct product/client/bundle/callback/scopes registry, test vector, and integration manifest under `apps/<product>/integration/`. `internal/canonicalwallet` validates central session claims for chain, requesting product, product client, bundle, callback, P-256 product device key, account, least-privilege scopes, nonce, purpose, request digest, approval digest, issued-at, expiry, and a maximum fifteen-minute lifetime. Tamper, expiry, callback replacement, scope escalation, cross-app reuse, and device mismatch fail closed.

The product does not fork central authorization semantics. It uses the canonical central `@ynx-chain/wallet-auth` result contract and validates session claims locally. Every protected HTTP request carries a fresh SDK-compatible P-256 Product Session proof bound to method, signed product path, exact raw body digest, nonce and a maximum sixty-second lifetime. The product persists proof consumption before routing and rejects replay, tamper, expiry, mixed legacy headers and unknown/revoked sessions. The proxy forwards the proof plus `X-YNX-Product-Request-Path`; central must treat that path as untrusted until `CanonicalWalletGatewayAdapter.introspect` verifies it and a fixed route table maps it to the active `/app/<product>/*` endpoint. Legacy challenge/verify routes return `410`; the supported completion route is `POST /api/auth/session/complete`. Exact central merge inputs are:

- `docs/handoffs/integration/trust-resource-central.patch.json`
- `apps/trust-center/integration/canonical-wallet-registry.json`
- `apps/resource-market/integration/canonical-wallet-registry.json`
- both `canonical-wallet-v1-test-vector.json` and `central-integration-manifest.json` files

`integratedCentral` stays false until the total-control owner merges those entries and a deployed central Gateway returns real authoritative responses.

## Trust Center behavior

Evidence intake stores packet digest, source, digest, source hash, authority, jurisdiction, bounded scope, affected assets, expiry, summary, collection time, and subject visibility. Request Validity distinguishes `valid`, `insufficient_evidence`, `out_of_scope`, `overbroad`, `illegal_or_abusive`, `governance_review`, user notice, and `rejected`.

The classifier rejects private keys/seed phrases, signature bypass, native YNXT freeze/seize/blacklist/confiscation/transfer, deleted audit, hidden records, fake risk, mass tracking, and automatic punishment, including Chinese request text. A reviewer cannot turn illegal native-control or overbroad input into `valid`. Conclusions require evidence and independent human reasons. Labels require source, confidence, severity, finite expiry, and advisory-only state. Appeal, false-positive correction, public transparency counts, and audit remain accessible.

AI can only preview and explain selected evidence/rules/appeal context. The sequence is preview → context selection → permission → provider/model/status/cost → stream/cancel → human review → apply/reject → audit. It cannot mutate a case, label, appeal, punishment, or asset. Provider unavailable, 429, empty, timeout, and cancellation remain failures.

## Resource Market behavior

The provider market domain supports verified provider profiles, physical resource units, offers, matching, quote/intent/reservation/service/meter/settlement separation, sealed reverse and split batch auctions, failure retry, capped bond penalties, independent appeal, maintenance/capacity updates, terminal-work exit with migration, actor-scoped export, erasure and retention controls. These paths are locally tested through `/api/market/*` and integrated into provider/buyer Web workspaces. Full-product implementation remains false because localization quality/runtime coverage, native feature parity, central/public proof and release evidence remain outstanding.

Local supply starts as `pending_capacity_evidence` with zero availability. Delegation, rental, and sponsorship require authoritative `capacity_confirmed` state. Sponsorship transfers bounded capacity only, never YNXT or a user asset, and retains owner, beneficiary, resource type, limit, source, expiry, fee, policy version, and audit.

The signed-intent lifecycle separates:

1. quote with expiry and fee breakdown;
2. Wallet-reviewed signed intent;
3. authoritative acceptance/rejection;
4. capacity confirmation with object and transaction evidence;
5. asset settlement proven with separate authoritative settlement evidence.

Only `settled_with_authoritative_evidence` contributes to income. No transaction/object/proof means never settled. Actor-scoped idempotency permits an exact replay and rejects changed input. Dispute recovery returns only disputed capacity to its source pool after independent approval, respects the original cap/expiry, and never changes an asset balance.

AI may explain quote, usage, delegation, and income context after permission. It cannot rent, stake, sponsor, revoke, settle, pay, or transfer.

## Persistence, HTTP, recovery, and audit

`internal/productstore` writes an exact-schema integrity envelope with SHA-256 payload digest, atomic temporary file/fsync/rename, and `.bak` recovery. Unknown envelope fields, malformed payloads, digest mismatch, and unsupported versions fail closed. This is corruption/tamper detection, not a claim of secret-key HMAC authenticity. Recovery CLIs are under each product's `cmd/recover` directory.

Every mutation uses a strict JSON POST body, maximum-body-plus-one checks, unknown-field/trailing-object rejection, role/owner rules, actor-scoped idempotency, deep snapshot rollback on action/save failure, and redacted audit. Browser clients never receive Wallet secrets, AI keys, database secrets, or signing material.

## UI/UX correction

The rejected left-heavy/card-wall version was replaced. Both products now default to a stable LTR structure suitable for English and Chinese. Arabic changes localized prose/input direction without reversing the application shell. Desktop uses compact horizontal navigation and centered workspaces; mobile uses a compact header and bottom navigation. The 12-language selector is folded into a popover.

Trust is a request-list/evidence-inspector product. Resource is a quote/signed-intent execution console with position rows and a settlement proof rail. They do not share a generic dashboard IA. Light/dark, large text, keyboard focus, skip navigation, reduced motion, live status, touch targets, 12 locale persistence, and semantic error/warning/success states are covered. See both `UI_DESIGN_AUDIT.md` files and `docs/handoffs/evidence/ui-audit-current/`.

## Verification evidence

Passed in the current run:

```text
GOMAXPROCS=2 go test -count=1 ./...
go test -race -count=1 ./internal/productstore ./internal/canonicalwallet ./internal/trustproduct ./internal/resourceproduct
./apps/trust-center/check.sh
./apps/resource-market/check.sh
node scripts/verify-trust-resource-wallet-vectors.mjs
swiftc -parse apps/trust-center/mobile/ios/YNXTrust/YNXTrustApp.swift
swiftc -parse apps/resource-market/mobile/ios/YNXResource/YNXResourceApp.swift
plutil -lint both Info.plist files
cd apps/trust-center && npm run test:ui      # 4/4
cd apps/resource-market && npm run test:ui   # 5/5
```

The full Go suite needed the base worktree's existing generated contract artifacts as a temporary read-only symlink; it was removed immediately after the pass and is not committed. Product race, HTTP smoke, UI, protocol-vector, and native source checks do not depend on that link.

Both Android apps built cleanly with Java 17/Android SDK 35:

```text
Trust APK:    3303230854efd5f30f7f813352f28a30ffdd54088232e3a336be70bc98b9f6d2, 20544 bytes, debug, minSdk 26
Resource APK: e278a89a632ef8c73be4159c4547c6c28ac00d9b2bf28b1525cbfe7782a2d07e, 25468 bytes, Android Debug certificate, minSdk 26
```

Generated APKs remain ignored local artifacts. `docs/handoffs/trust-resource-artifact-manifest.json` records their exact path/hash/size/signing class. A macOS GitHub Actions workflow builds both unsigned iOS Simulator candidates when CI is available.

## External blockers and integration requests

1. Merge and deploy the supplied least-privilege central Wallet/App Gateway registry entries and authority routes. Until then, canonical completion and authority calls correctly fail closed.
2. Provide deployed HTTPS Trust/Resource/AI origins and non-browser service credentials for real staging health/version and remote smoke. No static host can substitute for these Go APIs.
3. Merge and deploy the supplied canonical Wallet V1 challenge/completion route contract. Android now follows the SDK-defined `response` callback and signs the Gateway challenge with an Android Keystore P-256 key, but no live Wallet/Gateway success can be claimed before central deployment.
4. Run the supplied iOS CI or use a host with full Xcode/Simulator; production signing still requires owner-controlled identities.
5. Public artifact hosting, production certificates, store accounts, public deployment, and cross-region verification were not available and are not claimed.

Release records: `apps/trust-center/product-release.json` and `apps/resource-market/product-release.json`. Release notes, artifact manifest, evidence index, and UI audits accompany this handoff.
