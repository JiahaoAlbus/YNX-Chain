# YNX Resource Market dependency acceptance

No dependency is accepted from file existence, HTTP 200, local mocks or documentation alone. Each row requires direct Testnet or deployment evidence bound to an immutable source commit.

| Owner | Required contract | Current status | Acceptance evidence required | Failure behavior |
| --- | --- | --- | --- | --- |
| 01 Chain Core | Authoritative transaction finality, unique transaction identity and settlement receipt evidence | External blocked | Deployed Testnet endpoint; final transaction hash; asset, amount and finality proof; negative replay and mismatch vectors | Keep order `settlement_pending`; never create receipt or release capacity |
| 02 Wallet/Auth | Exact Resource Market registry, challenge, completion, introspection, expiry and revocation | External blocked | Registry merge commit; deployed Gateway; wrong-product, wrong-device, scope-widening, expiry, revoke and replay results | Reject product session and perform no mutation |
| 12 Explorer | Public transaction, receipt and source-commit proof | External blocked | Public HTTPS transaction/receipt URL linked to authoritative settlement | Do not claim public settlement evidence |
| 13 Monitor | Provider health, stale capacity, meter failure, settlement mismatch/replay and incident alerts | External blocked | Deployed alert rules, triggered negative vectors, incident and recovery evidence | Product remains locally observable only |
| 15 Trust Center | Provider failure, dispute, notice, appeal and correction linkage | Locally implemented, central acceptance pending | Cross-product case IDs and final decision evidence without asset authority | Keep dispute local and do not infer refund |
| 26 Data Fabric | Canonical usage, billing, fee and settlement events with idempotent lineage | External blocked | Event schema freeze, replay-safe ingestion, meter/receipt reconciliation and ledger query evidence | Do not emit or claim authoritative billing ledger state |
| 28 Website | `/resource-market` public entry, support/privacy/security/status routes, metadata and downloads | External blocked | Deployed canonical route, remote smoke, indexability and immutable artifact URLs | Keep all public and hosted release booleans false |
| 29 Integration | Freeze contract version, owner, events, errors, vectors and shared Testnet order | External blocked | Signed acceptance record for `resource-market-integration-v1`; all cross-product vectors pass | Do not maintain a second compatibility protocol |
| 30 Security/SRE/Release | Secrets, artifact provenance, backup/restore, deployment and release acceptance | External blocked | Source-bound SBOM, scans, immutable hashes, restore drill, deployment record and external review status | Keep production signing and release booleans false |

## Resource Market autonomous acceptance

The product-owned portion is accepted locally only when all of the following pass against the same source commit:

- Resource engine and HTTP product tests, including race detection.
- Stable error-code contract tests.
- Settlement transaction replay rejection and signed-meter reconciliation.
- Product HTTP smoke, health/version truth boundaries and scoped state/export.
- Contract and cross-product vector schema validation.
- Backup/restore and migration compatibility checks.

Local acceptance is not central integration, public Testnet proof or production release.

## Wallet/Auth platform evidence acceptance

| Owner delivery | Frozen source | Accepted boundary | Remaining false/pending boundary |
| --- | --- | --- | --- |
| Core Auth/Gateway | `404f818719b920008f88f076949a4387c5130855` | Source 37f exact cross-restart response/state plus public 0644, hardlink, symlink, same-byte inode and digest tamper rejection with zero mutation | 6437/6439 absorption, runtime migration, visible approval, aggregate/central remain false |
| Web/PWA/Extensions | `46d030c85c2b1a3d12a10c6b5dd0e521ca303f1c` | Website main `92a8b90…`, PR #34, 3 public pages, 9 exact downloads, registry binding and 3 visible official buttons; prior Firefox temporary first/second launch retained | temporary add-ons are not installed; popup DOM/background, provider/account/sign/tx, production signing and store remain false |
| Android API 36 | `66d321e423baedb0e030650729f1000d25a351cf` | Exact `9f91b1f5…` APK on disposable API 36 arm64 AVD: fresh install, two cold PIDs, strong-biometric wrong/registered fingerprint behavior, background relock, Social review and bounded duplicate/callback fail-close | disposable QA certificate only; terminal replay, process reconstruction, authoritative balance/nonce, callback delivery, sign/broadcast/receipt, website hosting, production signing/store remain false |
| iOS/macOS | `3b27b83f18799ff74252469075ec460b6665dd44` | Prior successful Simulator fail-closed lifecycle plus 3/3 AASA contract tests and direct public SPA-fallback rejection | public path is 1,018-byte text/html, real Team ID/Core components/signed app binding absent; AASA/associated domain/Universal Link/auth/public/production/store false |
| Desktop/CLI/SDK | `2802876f8470264c4a8819f1426e28f957a09289` | macOS arm64 CLI official YNX URL HTTP 200, 4,904,463-byte/SHA-256 readback, three alias registry/page bindings, production health recheck | ad-hoc/non-production; rollback attempt failed and is not verified; account/tx/production signing/store remain false |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Android evidence `66d321e423baedb0e030650729f1000d25a351cf` consumes the bounded current-source AVD lifecycle. The branch has advanced to unreviewed `19d86a33…`, which remains pending and cannot change release truth. The QA-only signing identity cannot become production truth.

## Chain Core contract binding

Central Integration accepts Chain Core contract version `1.30.0` as the immutable dependency identity for subsequent Wallet/Auth compatibility work. The implementation is `aab0b6b9fc28b40ef8715214cd95360734db4c48`; contract commit `3bcae14f9d42fd2fbcce2211a7c51a737f8ed464` has parent `aab0b6b9…`, tree `aa84d7b1ff15285d479fc784c28928021fcc8497`, and contract blob `6df6d0e7bf7ac77bdaf0f9349d24c924b021c4a0` at `release/integration/chain-core-contract.json` (content SHA-256 `ad0c6fbdc6851fab2547f94e3ae89f5393d9aa245f9e219f70a13ba2449c6acd`). Package commit `3de79e37aba04c22d2cc90809a6bcef83c48356c` and readiness head `1adbcd664b040f17644cea4140eb6e50aba111aa` are linear descendants. The local delivery bundle is 141,977,791 bytes with SHA-256 `496032529043ea2f589dff6ad36ab8fb813399562291baca32ccca8358ce8162` and fixed base `66ea9ba9704dbb0e4863bb9e28ad12eae59ba5a7`.

This acceptance freezes identity and ownership, not deployment. v30 retains the durable safety state, exclusive OS process lease and ValidatorVoteSigner, and authenticates SafetyStore v2 with separate checksum/seal domains and an Ed25519 seal bound to Chain ID, exact state, checksum and configured validator key. Wrong key, legacy unsealed state, recomputed checksum without a valid seal, invalid signer output and seal failure fail closed. Replay of an older validly signed snapshot is not independently rejected without a trusted external monotonic rollback anchor; that anchor and external signer custody are not provided. State v14, application version 20, finality, Bulk Data Commitment and public truth do not change. Product Session remains Wallet/Auth authority, and all integration/deployment/release promotions remain false.

## Product Session Router v2 public boundary

Remote Owner commit `e5932a2eb0e5c01ca31a1ba6e03f9872ccf0ef7f` supersedes `739fca33…` and is accepted for its direct negative public evidence and bounded mount gate only. At `2026-08-14T10:29:16Z`, the public App Gateway health endpoint returned HTTP 200 and the legacy `/v1/wallet/sessions/complete` route returned the canonical v1 HTTP 400 schema for an empty request. The empty `/v2/product-sessions/challenge` probe instead returned HTTP 200 with Chain JSON-RPC `-32601`, proving that `ProductSessionGatewayHttpHandler` was not reached and the request fell through to the Chain RPC catch-all. No valid approval/device proof was sent and no challenge, session or revocation was created.

The negative checkpoint and initial cc6c deployment are superseded by hardened evidence `2bcdf4f646177fe2419f1af3ac9e66bb3c218194` for deployed source `d26ed915516c97d07cb4d58e5fc4646486afc851`. It directly proves isolated service 6441 mounted ahead of legacy and Chain fallback, protected rollback, the challenge→crypto approval/device completion→introspection→replay rejection→revoke→post-revoke lifecycle, and runtime state-permission enforcement. A real public-host chmod 0644 tamper returned HTTP 503 `INSECURE_STATE_FILE`, preserved identical state SHA `f3d9c5e1…e6c6f`, performed no silent repair, and stayed fail-closed until explicit chmod 0600 plus restart; the post-recovery lifecycle passed.

This is accepted only as a hardened isolated interim public route. Existing services 6437/6439 remain active and unchanged, no runtime product has migrated, installed/visible Wallet approval is unproved, and the dedicated 6441 service is not dual-side atomic absorption into the active App Gateway pair. Therefore route-level public deployment and permission-tamper fail-close are true, while `integratedCentral` and aggregate Product Session v2 `deployedPublic` remain false.

Final evidence `404f818719b920008f88f076949a4387c5130855` binds production source `37f2485ed604d88ed1457bc497d50f3f7a037469` and directly exercises five public zero-mutation attacks. Mode `0644`, hardlink and symlink return HTTP 503 `INSECURE_STATE_FILE`; same-byte inode replacement returns `STATE_FILE_CHANGED`; digest tamper returns `STATE_TAMPERED`. Explicit repair restores `0600 ynx:ynx nlink=1` and the public lifecycle, but does not migrate any product runtime or absorb ports 6437/6439.

Separate evidence `f1c43b77b054da2d918e2b10ec5cad8afe6e3645` proves the canonical public user-rejection route is still absent. A canonical request to `/v1/wallet/authorizations/reject` returns HTTP 404 `ROUTE_NOT_FOUND`, not HTTP 403 `AUTHORIZATION_REJECTED`; the state digest remains unchanged and mutation is zero. This is negative deployment evidence only.

Website evidence `24c0589e729a2a1ae59400600c346e6f18dd7864` binds production merge `3ac32e039ba6d3a96f56fba3544304afcea2586c`, successful build run 31803464187, two Ready Vercel production deployments and exact runtime JSON backreads from the www, apex and wallet aliases. The published JSON identifies source `37f2485…` and evidence `404f8187…`; website and route-level publication are true. The immutable deployment URL itself timed out under direct HTTP, and product migration, visible Wallet approval, central absorption and aggregate ecosystem deployment remain false.
