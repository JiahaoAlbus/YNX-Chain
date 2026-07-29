# YNX Seller Console Feature Completion Evidence

Version: `0.3.0-testnet-preview`  
Source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`  
Stage: `FREEZE`  
Goal: `Active`

## Canonical least-privilege Seller authority

Implemented and locally tested:

- Roles: Owner, Admin, Catalog, Inventory, Fulfillment, Finance, Support and Viewer.
- Only Owner can create invitations, update an existing member or revoke a non-owner member.
- Owner and legacy `manager` cannot be assigned through current APIs.
- Snapshot v2 `manager` records migrate to canonical `admin`.
- Unknown roles and permissions fail closed.
- First membership requires one-time acceptance by the exact Wallet account named in the invitation.
- Direct role update cannot create first-time authority.
- Local revocation removes access before central Wallet invalidation and blocks regrant until a fully bound receipt is confirmed.
- Role, invitation, revocation, Audit and local Outbox writes share the persistence transaction.

## Snapshot v6 migration and rollback safety

Implemented and locally tested:

- Runtime startup rejects snapshots newer than v6 before normalization or mutation.
- The operator may export a new rollback file targeting v3, v4 or v5.
- Rollback export never overwrites active state or an existing destination.
- HMAC integrity is preserved when configured.
- Export refuses any target that cannot represent Seller invitations, revocations, events or v6-only event fields.
- Tampered state and tampered backups fail closed.

Direct source:

- `internal/commerce/store.go`
- `internal/commerce/snapshot_rollback_test.go`
- `internal/commerce/cmd/shopd/main.go`
- `docs/operations/MIGRATION_COMPATIBILITY.md`

## Data portability and bounded retention

Implemented and locally tested:

- `POST /api/seller/stores/{id}/exports` requires the exact canonical Seller Wallet session and store Owner authority.
- The export is limited to one store and includes catalog/inventory, orders and financial evidence, roles, invitations, revocations, Seller Outbox and store-scoped Audit.
- Unrelated stores, transient AI jobs, rate-limit windows, provider credentials and unrelated buyer state are excluded.
- Export access is persisted as an Audit event.
- Returned export data is deep copied and cannot mutate authoritative state.
- Retention is preview-only by default, requires explicit confirmation and an integrity key, and rejects cutoffs newer than 30 days.
- Only terminal AI drafts and expired rate-limit samples are prunable.
- Orders, settlement/refund evidence, roles, invitations, revocations, Seller Outbox, Audit, idempotency records, buyer profiles and carts are protected.

Direct source:

- `internal/commerce/data_lifecycle.go`
- `internal/commerce/data_lifecycle_test.go`
- `internal/commerce/server.go`
- `internal/commerce/cmd/shopd/main.go`

## Verified commands

Against source commit `a90d1ee59eec38c15ce42b39420f2625ed758dd0`:

- `go test ./internal/commerce/...`
- `go test -race ./internal/commerce`
- `go vet ./internal/commerce/...`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`

The race command passed with a non-failing macOS linker `LC_DYSYMTAB` warning.

## Current truth boundaries

- Local tests and build do not establish central integration or public deployment.
- The existing HTTP smoke probes only an existing local service and does not prove this source commit is running.
- Historical staging and artifact records belong to commit `38e2f68`, not this source revision.
- Current-source staging, public deployment and hosted artifact statuses remain false.
- Wallet registry deployment, authoritative Pay/Trust integration, Data Fabric ingestion, provider credentials, shared Testnet proof, SLO/capacity, complete accessibility, security and supply-chain evidence remain incomplete.
- An authenticated staging-copy migration/restore drill remains required before production-class schema or rollback use.

## Evidence binding

`product-release.json`, the full-goal coverage matrix, machine-readable integration contract, cross-product vectors, migration runbook and integration handoff are bound to source checkpoint `a90d1ee59eec38c15ce42b39420f2625ed758dd0`. Evidence updates are committed separately so the referenced implementation checkpoint remains immutable.
