# YNX Card Testnet Preview Release Notes

Release line: `1.0.0-testnet-preview`  
Source baseline: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Status: local tested candidate; not publicly deployed, production-signed or store-released

## Added

- Account-scoped export at `GET /v1/account/export` using `ynx.card.account-export.v1`.
- Provider-sensitive export redaction for eligibility, application, Card and event references.
- Correlation-ID removal and audit-chain reconstruction in exported projections.
- Bounded account retention at `POST /v1/account/retention` using `ynx.card.data-lifecycle.v1`.
- Fail-closed account deletion at `DELETE /v1/account/data`.
- Dedicated `card:data:delete` Gateway scope; ordinary Card assertions cannot authorize deletion.
- Provider Card closure before local deletion, with zero local erasure on provider failure.
- Pseudonymized, bounded and idempotent deletion receipts.
- Audit subject/object/correlation pseudonymization and full hash-chain rebuilding after deletion.
- Compatibility normalization for older state-v1 documents without deletion receipts.
- Deterministic CycloneDX 1.5 npm SBOM generated from package-lock v3, plus SHA-256 provenance.
- Local Card state/export benchmarks and an initial Testnet SLO/capacity plan.
- Threat model, observability contract and unit-economics truth model.

## Changed

- `Store.Update` skips durable rewrites for no-op mutations. This reduced the local no-expiry account-export benchmark from roughly 33.1 ms/op to roughly 0.146 ms/op on the same Apple M2 benchmark class while preserving integrity tests.
- `/version` now reports the data-lifecycle schema and human-readable retention disclosures.
- Product metadata and integration handoff describe privacy operations without changing public/deployment flags.
- `origin/main` was merged into `codex/final-card`; Card package and race tests remained green.

## Security

- Deletion requires explicit confirmation, valid idempotency and exact route-specific authorization.
- Export responses omit provider-sensitive identifiers.
- HTTP deletion receipts omit the internal idempotency digest.
- Existing provider webhook signature, key rotation, replay, event-order, Gateway binding, state HMAC and backup integrity controls remain in force.
- Product security scanning rejects signing material, private-key/token patterns, hard-coded Gradle passwords and PAN-like literals.

## Verification

- `go test ./internal/cardproduct/...` — passed.
- `go test -race ./internal/cardproduct/...` — passed.
- `go vet ./internal/cardproduct/...` — passed.
- `npm run security-check` — passed.
- `npm run generate-sbom` — generated 533 components deterministically.
- `go test -run ^$ -bench Benchmark -benchtime=1s -benchmem ./internal/cardproduct` — passed.

Repository-wide `go test ./...` remains non-green only because unrelated BFT/consensus tests require a missing generated Solidity artifact. This release note does not present those packages as fixed by Card.

## Unfinished release gates

- Pull request review and exact-head GitHub Actions.
- Central Wallet/Auth scope acceptance and shared Testnet integration.
- Official issuer sandbox and provider-specific signature/closure mapping.
- Encrypted off-host backup scheduling and timed RPO/RTO evidence.
- Scheduled retention and central privacy-workflow acceptance.
- Go package-specific SBOM, dependency alert triage, DAST and independent review.
- Native Android/iOS install, cold start and callback evidence.
- Staging/public deployment, hosted artifacts, SHA-256 download manifest, production signing and store release.
- `/card` publication on `https://ynxweb4.com` by website owner 28 after integration owner 29 acceptance.

## Explicit non-claims

This candidate is not a real-world spendable Card, has no BIN or production issuer relationship, holds no fiat balance, and is not deployed to mainnet or production. A source branch, local test pass, SBOM, handoff or HTTP route is not evidence of public release.
