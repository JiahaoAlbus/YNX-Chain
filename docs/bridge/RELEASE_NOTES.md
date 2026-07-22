# Bridge Release Notes

- Added persistence schema v5 with explicit exposure resolution. Destination-confirmed or refund-recovered transfers remain settled if a later dispute becomes current, preventing false outstanding-supply and limit inflation.
- Added persistence schema v4 with an ordered, source-qualified lifecycle timeline. Retry is retained as an explicit event, while migrated v2/v3 transfers receive only an honestly labeled current-phase snapshot.
- Added a public, read-only `/bridge/routes` catalog and SDK method with exact route classification, contract/token/fee/slippage/time/risk/finality/refund disclosures. All current candidates fail closed with null quote fields and no external execution.
- Added persistence schema v3 with source-qualified account export, durable deletion requests, active-transfer safety holds, configurable retention, separately authorized execution, identity pseudonymization, v2 migration, and service-cessation guidance. Financial and security evidence remains intact.
- Added an independent dependency-free Bridge JavaScript SDK for credential-free health/transparency reads and fail-closed destination-availability classification. The package is locally tested, private, and not registry-published.
- Added W3C trace-context propagation, bounded per-route safety/reconciliation metrics, loadable Prometheus alerts, and an importable Bridge safety/SLO dashboard. These are local definitions; no remote monitoring or public status service is claimed.

## Local engineering candidate — 2026-07-22

- Added explicit source, proof, destination, failure, retry, recovery, and dispute phases.
- Added persistent pause/resume safety state.
- Added per-transfer and route-outstanding exposure limits.
- Added strict v1-to-v2 state migration and tamper rejection.
- Added source-qualified public transparency and operator-evidence reconciliation.
- Added semantic startup rejection for invalid phases, over-limit exposure, inconsistent accounting, and changed truth-source labels.
- Added eight-product consumer integration contracts and destination-confirmed availability vectors.
- Recorded the official stablecoin transfer candidate as unavailable because YNX was not listed in the inspected official CCTP testnet contract reference.
- Added Bridge-specific threat, security-boundary, third-party, reproducible-build, SPDX SBOM, public metadata, and machine release-state gates.
- Added source-bound local p50/p95/p99/throughput/storage evidence and a corruption-rejection plus backup-restore drill.
- Added explicit provider identity, UTC daily volume, user outstanding exposure, and enforced large-transfer delay controls.
- Added per-key/IP rate limits, Request ID/Error ID responses, structured access logs, and denial metrics.

External submission remains disabled. This candidate is not installed, staged, public, production-signed, issuer-supported, funded, or independently audited.
