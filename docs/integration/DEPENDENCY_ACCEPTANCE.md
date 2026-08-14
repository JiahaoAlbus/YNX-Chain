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
| Android API 36 | `f1edbec46ad4300beec406873b03db2da7c72e4b` | Canonical authorization recovery remains the last consumed evidence | pending `9f91b1f5…` defers deep links until foreground but has no new device evidence; new/old APK certificates are discontinuous, deviceValidated/callback/biometric/relock/public/production/store remain false |
| iOS/macOS | `7a3a110fb7cd9a33512ce4db87ddd8387cb730d5` | Run 31786857637 directly proves entitlement/signature, Simulator install, cold PID 28338, second PID 29129, Keychain 0/0/0, malformed callback PID 35715 and Universal Link fail-close | step18 recovery failed; `ee1457e8…` run remains in progress; recovery/biometric/auth success/public/downloadHosted/Developer ID/notarization/production/store false |
| Desktop/CLI/SDK | `2802876f8470264c4a8819f1426e28f957a09289` | macOS arm64 CLI official YNX URL HTTP 200, 4,904,463-byte/SHA-256 readback, three alias registry/page bindings, production health recheck | ad-hoc/non-production; rollback attempt failed and is not verified; account/tx/production signing/store remain false |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Android `9f91b1f55d3da786198609e8c55cf26d2034b92d` remains queued pending a new disposable API 36 AVD and direct lifecycle evidence; its QA-only signing identity cannot become production truth.

## Chain Core contract binding

Central Integration accepts Chain Core contract version `1.21.0` as the immutable dependency identity for subsequent Wallet/Auth compatibility work. The implementation is `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`; contract commit `cefb37144517e8f44fd9d0b41119bb5754bdb55d` has parent `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`, tree `cb64ea796b9ffa2db5acb7639efff623d587f332`, and contract blob `2ab1e66e72cb17c7d0b234d77a0ed020f77da102` at `release/integration/chain-core-contract.json` (content SHA-256 `94f0fc819ceb1d84e02a3bb93b65e933e8bb4aaa964e7939b9866faa8ab1833c`).

This acceptance freezes identity and ownership, not deployment. Product Session remains Wallet/Auth authority; Chain Core declares `authBoundary.state=dependency-not-accepted`, `failClosed=true`, and `parallelAuthProtocolAllowed=false`. The Owner objects were read directly from the protected Chain Core object store, while the shared origin did not expose the contract commit. Therefore Chain Core source integration, central acceptance of the Auth dependency, staging/public deployment, hosted downloads, production signing and store release all remain false.
