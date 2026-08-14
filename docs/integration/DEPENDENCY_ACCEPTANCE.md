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
| Core Auth/Gateway | `e2aaff33832507b4a5ebf44d522a9b7ffa5d5ba4` | Bounded public Testnet auth lifecycle and device-proof signing; local negative, inventory, single-Node session-linearization and persistence-rollback evidence | New slices are absent from deployed public source; multi-process/multi-region, asset tx, reconnect, native release, production/store |
| Web/PWA/Extensions | `d8f96c0649576cc645b3bc1651148dd0318bc243` | Edge-local PWA install, visible first/second windows, exact live `0x1917` RPC; source/build gates cover offline, sensitive-action and packaged-artifact integrity | Extension popup control failed; extension installed/action gates, registered callback, hosting, production/store remain false |
| Android API 36 | `a0101ac491c2790d5cfdef99c2e11e3807d81aca` | Historical disposable-QA build/install/two cold launches/Testnet identity plus current-source biometric, callback/replay, relock and process-reconstruction tests | Current-source device install/interaction, production signing, tx, callback delivery, reconnect and hosted artifact remain false |
| iOS/macOS | `3150165e14f38031b9a089b029b623f67cd6df85` | macOS local ad-hoc lifecycle only | iOS current HEAD lacks an exact successful run record; callback, Testnet, production/store remain false |
| Desktop/CLI/SDK | `f76a416ebde087e16f1c0c02c80dc392e8c365e8` | Linux/Windows x64 native CI; x64/arm64 AppImage portable lifecycle; macOS x64 native upgrade/install/lifecycle and DMG/ZIP redownload hashes; CLI proof signing; SDK clean-consumer Testnet read | AppImages are not installed; macOS packages unsigned/unnotarized; asset tx, reconnect, immutable public downloads, production/store |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

iOS/macOS `4c8c464dffee289fd9173569915638f873409198` lacks an Owner terminal successful current-source run and remains the only queued Owner checkpoint in this slice.
