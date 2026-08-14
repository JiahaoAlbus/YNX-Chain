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
| Web/PWA/Extensions | `46d030c85c2b1a3d12a10c6b5dd0e521ca303f1c` | Website main `92a8b90…`, PR #34, 3 public pages, 9 exact downloads, registry binding and 3 visible official buttons; prior Firefox temporary first/second launch retained | temporary add-ons are not installed; popup DOM/background, provider/account/sign/tx, production signing and store remain false |
| Android API 36 | `f1edbec46ad4300beec406873b03db2da7c72e4b` | Canonical authorization recovery remains the last consumed evidence | pending `9f91b1f5…` defers deep links until foreground but has no new device evidence; new/old APK certificates are discontinuous, deviceValidated/callback/biometric/relock/public/production/store remain false |
| iOS/macOS | `369578f20b0802bcfef5cfc8bcdd7f53fec0f801` | Run 31793565880 passed Simulator install/cold/second, Keychain 0/0/0, malformed callback reject and native-unavailable recovery fail-close with empty second launch | simulated-biometric `705a7636…` run pending; biometric/recovery/auth success, physical device, public/downloadHosted/Developer ID/notarization/production/store false |
| Desktop/CLI/SDK | `2802876f8470264c4a8819f1426e28f957a09289` | macOS arm64 CLI official YNX URL HTTP 200, 4,904,463-byte/SHA-256 readback, three alias registry/page bindings, production health recheck | ad-hoc/non-production; rollback attempt failed and is not verified; account/tx/production signing/store remain false |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Android `9f91b1f55d3da786198609e8c55cf26d2034b92d` remains queued pending a new disposable API 36 AVD and direct lifecycle evidence; its QA-only signing identity cannot become production truth.

## Chain Core contract binding

Central Integration accepts Chain Core contract version `1.21.0` as the immutable dependency identity for subsequent Wallet/Auth compatibility work. The implementation is `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`; contract commit `cefb37144517e8f44fd9d0b41119bb5754bdb55d` has parent `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`, tree `cb64ea796b9ffa2db5acb7639efff623d587f332`, and contract blob `2ab1e66e72cb17c7d0b234d77a0ed020f77da102` at `release/integration/chain-core-contract.json` (content SHA-256 `94f0fc819ceb1d84e02a3bb93b65e933e8bb4aaa964e7939b9866faa8ab1833c`).

This acceptance freezes identity and ownership, not deployment. Product Session remains Wallet/Auth authority; Chain Core declares `authBoundary.state=dependency-not-accepted`, `failClosed=true`, and `parallelAuthProtocolAllowed=false`. The Owner objects were read directly from the protected Chain Core object store, while the shared origin did not expose the contract commit. Therefore Chain Core source integration, central acceptance of the Auth dependency, staging/public deployment, hosted downloads, production signing and store release all remain false.

## Product Session Router v2 public boundary

Remote Owner commit `e5932a2eb0e5c01ca31a1ba6e03f9872ccf0ef7f` supersedes `739fca33…` and is accepted for its direct negative public evidence and bounded mount gate only. At `2026-08-14T10:29:16Z`, the public App Gateway health endpoint returned HTTP 200 and the legacy `/v1/wallet/sessions/complete` route returned the canonical v1 HTTP 400 schema for an empty request. The empty `/v2/product-sessions/challenge` probe instead returned HTTP 200 with Chain JSON-RPC `-32601`, proving that `ProductSessionGatewayHttpHandler` was not reached and the request fell through to the Chain RPC catch-all. No valid approval/device proof was sent and no challenge, session or revocation was created.

The executable probe uses one stable request ID, an invalid canonical empty body, at most three bounded transport attempts and a 64 KiB response cap. Its six tests pass; the official public command exits 1 with `UNEXPECTED_HTTP_STATUS`, correctly blocking the deployment claim. Central deployment must mount all five exact `/v2/product-sessions/*` routes ahead of the Chain RPC fallback, persist schema-v2 sessions/revocations/proof replay/idempotency/audit state atomically, and pass candidate-preflight, atomic switch/rollback and the full public lifecycle. The probe proves route mount only and cannot replace lifecycle acceptance. The public `d8863f6b…` source package predates this gate and is distinct from a deployed v2 runtime; `integratedCentral` and Product Session v2 `deployedPublic` remain false.
