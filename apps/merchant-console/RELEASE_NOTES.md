# Release notes

## Unreleased — Merchant operational recovery

- Restored canonical Wallet/Gateway Merchant Console authentication, five-role RBAC, invoices, webhooks, reconciliation, settlements, refunds/disputes and bounded AI workflows.
- Added RBAC/Webhook/Settlement fuzz, fault, soak and benchmark coverage.
- Added a versioned nine-category Provider Hub with server-side probe evidence and fail-closed health.
- Added snapshot v1-to-v2 migration and future-version rejection tests.
- Added read-only capital capability and transparent settlement waterfall APIs/UI without invented cost or merchant-net values.
- Replaced fixed health success with direct liveness/store evidence and unverified dependency readiness.
- Added frontend CycloneDX SBOM and backend module inventory.
- Added an independent backup/verify/restore CLI with exact source commit, nested integrity checks, non-overwrite behavior, running-service exclusion, exact-current-SHA confirmation, automatic rollback preservation and verified local drill evidence.
- Added correlated request/trace/error IDs, redacted structured request logs, outbound trace propagation and a fail-closed process-local metrics snapshot.
- Fixed skip targets across render states, localized critical authentication navigation, retained focus after language changes, exposed active navigation semantics, and added RTL/focus regression tests.
- Added the complete current API authority/route contract and a versioned golden reconciliation CSV compatibility test.

No staging/public deployment, official provider success, stablecoin settlement, hosted download or production signature is claimed by this release.
