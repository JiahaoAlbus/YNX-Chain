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
| Core Auth/Gateway | `75b0a68a03eb75cb8afb84d71abce591e544dc92` | Prior bounded auth/durability plus process-local request-body timeout/abort, admission release and zero mutation/lock acquisition | Public proxy/load-balancer protection, automatic recovery, power loss/network filesystem, multi-region, asset tx, reconnect, native release, production/store |
| Web/PWA/Extensions | `0b3ffa8faabad2caa49b1c00db493261e2d98bca` | Edge-local PWA; unpacked popup RPC; isolated Edge MV3 provider injection, fixture accounts/lifecycle and wrong-chain rejection | isolated/unpacked is not installedLocal; Chrome injection, live provider RPC, connect/add/switch/sign/tx/release gates, hosting/production/store remain false |
| Android API 36 | `4739a60e1fa0e3d0b6862e129330f9e9ca202887` | Historical disposable-QA lifecycle plus current canonical callback/replay, audit/journal and exact-account active-generation rename fail-close tests | Current-source device install/interaction, production signing, tx, callback delivery, reconnect and hosted artifact remain false |
| iOS/macOS | `8ccb7bf9c4bf9453ed72395d1f024de9fa75fb4d` | iOS Simulator boundary; Universal x86_64+arm64 ad-hoc package plus arm64 install/cold/second, Keychain canary and malformed callback rejection | x86_64 lifecycle, physical iOS, Testnet/authorization/recovery success, asset tx, Universal Link, Developer ID/notarization, production/store remain false |
| Desktop/CLI/SDK | `931b70fc0dd4e7ff01542065099aeaa0b3f25a51` | Linux/Windows x64 native CI; Windows arm64 native lifecycle/readback; x64/arm64 AppImage portable lifecycle; Linux arm64 deb native CI; macOS x64 native lifecycle; CLI proof signing; SDK clean-consumer Testnet read | Portable/CI artifacts are not installedLocal; Windows is NotSigned; macOS packages unsigned/unnotarized; asset tx, reconnect, immutable public downloads, production/store |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Core `8e91c58e3f997b35da1b3d0298f174a2e8533fa2`, Android `2299a90e12a46dd030425c6a5bf2edf4257c9c59`, iOS/macOS `8b6dee8f746456874d7a7b2913d38b3aa5591fc7` and Desktop `b11faa864304ac3e260c261c732d30d018fe0eb8` remain queued descendants.
