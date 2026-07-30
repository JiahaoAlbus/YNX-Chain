# Economics and YUSD Operations

## Economics disclosure

Build with an exact commit identity, start Explorer, verify `/api/economics/health`, then fetch `/api/economics/disclosure` with a Request ID and confirm the same ID, source commit, fixed-fee current policy and false deployment/risk flags. On health failure, remove the instance from ingress and retain the build/metrics evidence; do not serve a static success response. Rollback means deploying the previous immutable build while preserving its matching evidence and public disclosure.

The disclosure stores no user profile or request state, so there is no dashboard user-data export/delete dataset and no request retention requirement. Reverse-proxy access logs and monitoring retention belong to the deploying operator and must be documented before public deployment.

## YUSD sandbox backup and restore

YUSD is an isolated test-unit sandbox with no real value, reserve attestation or external redemption rail. Stop mutation ingress, copy the mode-0600 state file, calculate SHA-256, retain the source binary/config version, and restore only to a mode-0600 path. Start against the restored copy; startup must validate integrity, audit chain, reserve/supply/pending-redemption reconciliation, daily limits and idempotency records before ingress resumes.

`make yusd-restore-drill` performs a local stop-equivalent snapshot copy, digest comparison and restore into a fresh path, then compares snapshot, queued redemptions, audit events and file mode. It proves local correctness only. Off-host encryption, backup scheduler, retention period, deletion authority, elapsed RTO/RPO and staging restore remain unimplemented.

On service termination, pause minting, keep the redemption exit queue visible, export the versioned state plus digest and audit, and publish the honest provider/custody boundary. Never delete a state file until its retention and disposal authority are approved. No public user exit is claimed because no public YUSD deployment exists.

## Incident, support, refund and dispute boundary

For disclosure incidents, capture Request/Trace/Error IDs, exact build, health and metric window; post only through the centrally approved status channel. Support must distinguish an explanatory error from a chain, provider or user-asset incident and must not ask for seeds, private keys or complete credentials. No support/status URL is approved in this package, so no live channel is claimed.

The economics dashboard charges no fee and therefore has no refund ledger. Gas, venue/provider, managed-Vault or YUSD disputes belong to the authoritative receipt/fee/custody owner. Preserve the consent snapshot, signed mandate, fee attribution, burn/revenue split, provider receipt, transaction hash and audit ID; freeze only the affected mutation path; never manufacture a refund or reverse an immutable chain event in the UI. Escalation, response-time policy, refund authority and jurisdiction require central legal/support approval before public release.
