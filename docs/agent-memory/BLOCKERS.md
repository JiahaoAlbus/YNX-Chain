# YNX Seller Console Blockers

## External acceptance blockers

### SC-BLOCK-WALLET-001

- Owner: `02-wallet-auth`
- Reason: central Seller product registration, introspection and store-scoped authorization-revocation receipt are not accepted/deployed.
- Evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md`, `release/integration/operator-inputs.request.json`.
- Prepared locally: registry patch, exact session binding, invitation account binding, revocation adapter, receipt validation and negative tests.
- Why local Owner 10 cannot solve it: central Wallet registry and deployed session authority belong to Owner 02.
- Minimum input: accepted registry version, deployed endpoint identity, accepted receipt schema and shared Testnet window.
- Resume action: run Wallet positive/negative vectors and update central acceptance evidence.

### SC-BLOCK-PAY-001

- Owner: `04-pay`
- Reason: authoritative merchant/payout configuration and settlement/refund endpoint acceptance are absent.
- Prepared locally: exact evidence bindings, fail-closed negative paths and order-state boundary.
- Minimum input: accepted merchant/payout identity, Testnet endpoint/evidence version and verification window.
- Resume action: execute settlement/refund vectors with committed Testnet evidence.

### SC-BLOCK-TRUST-001

- Owner: `15-trust-center`
- Reason: dispute/appeal evidence endpoint and schema are not accepted.
- Prepared locally: request/display-only authority boundary and truthful outage behavior.
- Minimum input: accepted endpoint/schema and Testnet window.
- Resume action: run dispute/appeal evidence vectors without granting local adjudication authority.

### SC-BLOCK-DATA-001

- Owner: `26-data-fabric`
- Reason: Seller role, invitation and revocation Outbox events and Billing Ledger facts are not accepted as canonical inputs.
- Prepared locally: versioned persisted Outbox, atomic rollback and idempotent-ingest vectors.
- Minimum input: accepted event versions, acknowledgement/replay semantics and reconciliation query.
- Resume action: ingest shared vectors and record canonical acknowledgements.

### SC-BLOCK-INTEGRATION-001

- Owner: `29-integration`
- Reason: shared Testnet contract freeze and end-to-end environment execution are incomplete.
- Prepared locally: machine-readable contract, dependency requests and cross-product vectors.
- Minimum input: frozen dependency manifest, environment window and evidence location.
- Resume action: execute Wallet → Seller authority → catalog/inventory → order → Pay → fulfillment → refund/dispute → recovery flow.

### SC-BLOCK-WEBSITE-001

- Owner: `28-website`
- Reason: the current-source `/seller-console` route is not deployed or verified on `ynxweb4.com`.
- Prepared locally: public metadata and `release/integration/seller-console-website-handoff.json`.
- Minimum input: consume handoff, deploy exact source metadata/build, record Vercel SHA and route content hash.
- Resume action: verify canonical, Open Graph, JSON-LD, Sitemap, robots, responsive and accessibility behavior.

### SC-BLOCK-SECURITY-001

- Owner: `30-security`
- Reason: immutable artifact, SBOM, provenance, production-class migration/restore review and release gate are absent.
- Prepared locally: local build, migration runbook, rollback tests, release facts and truth boundaries.
- Minimum input: artifact workflow, attestation policy, staging-copy review and hosting location.
- Resume action: build from exact commit, publish hashes/SBOM/provenance and complete restore review.

## Execution infrastructure observation

### SC-INFRA-GITHUB-TLS-001

- Classification: `executionInfrastructureBlocked`, not a product external blocker.
- Evidence: bounded `gh pr list` and `gh release list` attempts returned TLS handshake timeouts.
- Impact: PR and Release state were not verified during this recovery.
- Non-impact: source push succeeded and Local/Remote branch equality was directly verified.
- Resume action: retry GitHub PR/Release inspection before claiming PR, merge or release state.
