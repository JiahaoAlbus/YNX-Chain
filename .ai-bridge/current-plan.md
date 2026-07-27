# YNX Seller Console Current Plan

Stage: `FREEZE`  
Goal status: `ACTIVE`  
Runtime source commit: `937cf10f387bd1d31d86652ab06d74bc6185f35c`

## Protected slice

The Seller team authority lifecycle is implemented and pushed:

- Owner-created invitations are bound to store, target native Wallet account, assignable role and 15-minute-to-7-day expiry.
- Invitation identifiers are not authentication credentials; only the exact authenticated target account may accept once.
- Wrong-account access returns not found, replay fails, cancellation is permanent, and expired invitations cannot grant authority.
- Direct role update applies only to an existing member; first-time authority must use invitation acceptance.
- Invitation, role, Audit and versioned local Outbox changes share one persistence transaction and roll back together.
- Snapshot v6 preserves invitations, roles, revocations and Seller events across restart.

Verified against runtime commit `937cf10f387bd1d31d86652ab06d74bc6185f35c`:

- `go test ./internal/commerce`
- `go test -race ./internal/commerce`
- `go vet ./internal/commerce`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`

Repository-wide `go test ./...` was attempted and remains red only in the previously recorded non-Seller ownership areas. Do not modify those products from this worktree.

## Exact next implementation slice

Close the highest-priority independent data-safety gap for Snapshot v6.

1. Reject persisted snapshots newer than the runtime's supported schema instead of normalizing them downward.
2. Add an explicit, bounded Snapshot v6 export/downgrade path for operator-controlled rollback that preserves legacy-compatible roles and rejects any state that cannot be represented safely.
3. Ensure the normal runtime never silently drops invitations, revocations, Audit or Outbox data during rollback.
4. Add migration, downgrade refusal, representability, tamper, restart and backup/restore tests.
5. Update `MIGRATION_COMPATIBILITY.md`, Integration Contract, vectors, coverage and release facts to the exact implementation commit.
6. Run Commerce, Race, Vet and relevant restore gates; review, commit, push and verify Local SHA = Remote SHA.

## External acceptance still required

- Owner 02: Seller product registration and store-scoped authorization revocation.
- Owner 26: canonical acceptance of Seller role, invitation and revocation Outbox events.
- Owner 29: shared Testnet contract freeze and end-to-end execution.

These dependencies do not block Snapshot v6 downgrade safety or other independent Seller work.
