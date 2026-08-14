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
| Core Auth/Gateway | `0c747c6030b5a475a1f12dc7e57345555c23055d` | Prior evidence plus fail-closed deployment verifier: 3/3 focused, 187/187 full, exact receipt/address/runtime/EntryPoint/Bundler bindings required | verifier ran only against isolated mocked JSON-RPC; public execution, contracts, Bundler, Testnet deployment, central/staging/public remain false |
| Web/PWA/Extensions | `deca6f4fe29dafdccb3736f237e6e8829e094eec` | Prior negative branded runtime plus publication verifier that retries only bounded transport failures; self-test 9/9 and simulated Firefox retry on attempt 2 | semantic HTTP/content/hash/registry failures do not retry; current production hosting/public/install/provider/account/sign/tx/production/store remain false |
| Android API 36 | `f1edbec46ad4300beec406873b03db2da7c72e4b` | Canonical authorization pending→delivered recovery, exact binding, no re-sign/secret read; focused 24/24, Wallet 124/124, Hermes 2750 | source/local only; device/install/sign/tx/callback delivery/public/production/store false |
| iOS/macOS | `a1ba611635289e22f883e49c4e7b25417f94778d` | Prior direct evidence plus reachable Universal ad-hoc engineering prerelease and run 31785220186 terminal failure: install succeeded, first launch rejected by SpringBoard | source fix `7a3a110f…` has run 31786857637 in progress but no terminal evidence; new launch/Keychain/second launch/callback/recovery, official hosting, AASA/Universal Link, production signing/store remain false |
| Desktop/CLI/SDK | `2802876f8470264c4a8819f1426e28f957a09289` | macOS arm64 CLI official YNX URL HTTP 200, 4,904,463-byte/SHA-256 readback, three alias registry/page bindings, production health recheck | ad-hoc/non-production; rollback attempt failed and is not verified; account/tx/production signing/store remain false |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Android `d14d19a022b82ed1006b4e4c3786e4505cf347a4` remains queued; unknown descendants are not consumed.
