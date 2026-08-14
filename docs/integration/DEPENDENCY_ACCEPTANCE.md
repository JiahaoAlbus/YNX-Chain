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
| Core Auth/Gateway | `774a1f756890043e88626d13b6c9679a2ad6d288` | 173/173 local POSIX/shared-state evidence: revocation, Kill/Action linearization and pre-ack SIGKILL recovery | Distributed DB/multi-region, central/staging/public/public-route, asset tx, native release, production/store |
| Web/PWA/Extensions | `f789c782c325d64234bd077f5c878b1821b2149a` | Prior evidence plus PWA cache-v4 build digest binding, tampered-asset 503/no execution, legacy rollback rejection/purge and recovery accepting only current build bytes | live RPC/recovery in this slice failed; bundled runtime is not installation; provider/account/sign/tx/hosting/production/store remain false |
| Android API 36 | `4739a60e1fa0e3d0b6862e129330f9e9ca202887` | Historical disposable-QA lifecycle plus current canonical callback/replay, audit/journal and exact-account active-generation rename fail-close tests | Current-source device install/interaction, production signing, tx, callback delivery, reconnect and hosted artifact remain false |
| iOS/macOS | `04450cff296511018447e5d4886803081149f596` | Universal ad-hoc package, arm64 lifecycle/two callback rejection paths, plus direct recovery-vault absence before and after biometric-unavailable creation | authorization/return callback, Core native bridge, x86_64 lifecycle, recovery success, Testnet/public, Universal Link, Developer ID/notarization/store false |
| Desktop/CLI/SDK | `905ac1e5479b08e6b2d9e50a91bef01cbe7d58ef` | Prior evidence, Linux arm64 RPM --noscripts native CI, and Windows 11 arm64 CLI upgrade/install/cold/second/0x1917/fail-close/uninstall with temporary P-256 self-test | Win10/Server2016 declared only; temporary P-256 is not production account/tx signing; CI artifacts not installedLocal; unsigned; no public hosting/production/store |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Web `f789c782c325d64234bd077f5c878b1821b2149a` / `7522b8162b2581c7fed216d0e4e9fef44ff4fef7` / `1ac8c4edd2c8f1b794b3aec9b70b1cf262576f3a`, Android `6f096503793218ddfd9b3b1cd6403a07d4fafb97` and the recorded Desktop/SDK successors remain queued.
