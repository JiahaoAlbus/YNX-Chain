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
| Core Auth/Gateway | `674d07c3157ce33a4ee6419fd599aac5b2703255` | Bounded public Testnet auth lifecycle and device-proof signing; 15-case completion plus 16-case introspection/revoke matrices are local-only | New matrices are absent from the deployed public source; asset tx, reconnect, native release, production/store |
| Web/PWA/Extensions | `85af602dc96ae476c723f8646de55a081b89ed46` | Edge-local PWA install, visible first/second windows, exact live `0x1917` RPC and fail-closed provider identity invalidation | Real-provider reconnect was not retested; callback, hosting, production/store remain false; unpacked extension is not installed |
| Android API 36 | `52825ac7fce0d962271a920397eb838862130301` | Historical disposable-QA build/install/two cold launches/Testnet identity plus current-source strong-biometric, callback/replay and account-relock tests | Current-source device install/interaction, production signing, tx, callback delivery, reconnect and hosted artifact remain false |
| iOS/macOS | `3150165e14f38031b9a089b029b623f67cd6df85` | macOS local ad-hoc lifecycle only | iOS current HEAD lacks an exact successful run record; callback, Testnet, production/store remain false |
| Desktop/CLI/SDK | `1bdb7fb4991937eba4f74341bd123214f9776e92` | Linux/Windows x64 native CI lifecycle; Ubuntu AppImage portable lifecycle and post-upload hash verification; CLI proof signing; SDK clean-consumer Testnet read | AppImage install, asset tx, reconnect, immutable public downloads, production/store |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Core `806f342723bdc7911367b9db9a72c4f33cd0a3db` and Web `40cbf6f2` are pending later Owner evidence-freeze checkpoints. Core branch descendant `979b791a87320718e66832cf690755792e998ab5` is readable but lacks explicit terminal authority in this integration thread. None is consumed for release truth.
