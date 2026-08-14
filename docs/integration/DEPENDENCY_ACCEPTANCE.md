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
| Core Auth/Gateway | `b8467853060db04c2981abb7fcfa22d4cfdcf65b` | Prior evidence plus local Hardhat batch boundary: owner/WebAuthn success, Session Key AA24 rejection without nonce/target mutation, failed-subcall rollback; 184/184 | local in-process only; production contracts/deployment, external Bundler, Testnet/public/central/staging, asset tx/release false |
| Web/PWA/Extensions | `7d569d1babb85e6d28bb6bfc3b3c0c5fd828255d` | Prior built-PWA readiness plus strict JSON-RPC envelope validation for jsonrpc/id/error/result before Wallet calls | exact module tests are not live RPC/browser runtime; install/action injection/provider/account/sign/tx/hosting/production/store remain false |
| Android API 36 | `8666c0bb0535270e595f3db54e7d2e35b18afe66` | Prior evidence plus 8 signing domains' temporary 32-byte Uint8Array success/exception finally zeroing; 115/115, 104/104, Hermes 2749 | immutable SecureStore JS strings are not erased; current-source device/install/sign/tx/callback/public/production/store remain false |
| iOS/macOS | `50d3b2e2c5bd77456b84f348c48fa4a9ed76b5b3` | Prior direct evidence plus terminal failed Simulator boundary: malformed callback reached the app and was rejected; workflow source blob verified | step15 deep-link, recovery/biometric, auth success, Universal Link/public, x86_64, Developer ID/notarization/store false |
| Desktop/CLI/SDK | `c738443079fe2519d334d7104f30dc9675673c9a` | Prior Fedora 42 x64 RPM lifecycle plus bounded Owner handoff | handoff adds no gate; native CI only, unsigned, no account/tx, public hosting, production signing or store release |

Acceptance is enforced by `scripts/verify/wallet-auth-release-evidence-matrix.mjs`. GitHub Actions artifacts are temporary retention evidence, not `downloadHosted` product delivery.

Android `6f096503793218ddfd9b3b1cd6403a07d4fafb97` remains queued; rollback descendants are not consumed.
