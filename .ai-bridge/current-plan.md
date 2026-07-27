# YNX Seller Console Current Plan

Stage: `FREEZE`  
Goal status: `ACTIVE`  
Runtime source commit: `9e6aea94087d02c76ee9002df8b92b3f7d55df9b`

## Protected slice

Owner-only Seller role revocation is implemented and pushed. Local authority is removed immediately, central Wallet invalidation is store-scoped and receipt-bound, regrant is blocked until confirmed, and Snapshot v5 persists revocation, Audit, and append-only Seller Outbox evidence transactionally.

Local verification passed:

- `go test ./internal/commerce`
- `go test -race ./internal/commerce`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`

Repository-wide `go test ./...` remains red only in non-Seller ownership areas recorded in the Integration Handoff. Do not modify those products from this worktree.

## Exact next implementation slice

Complete the remaining local portion of `SC-RBAC-003`: persisted Seller team invitations.

1. Add an owner-created invitation record bound to store, target native account, canonical assignable role, creator, created time, expiry, status, and one-time acceptance identifier.
2. Reject owner/self invitations, unknown roles, duplicate active invitations, expired invitations, wrong-account acceptance, replayed acceptance, and acceptance after cancel/revoke.
3. Acceptance must use the authenticated canonical Wallet account already provided by Seller product sessions; do not add a parallel bearer, password, seed, or browser-held signing secret.
4. Persist invitation create/cancel/accept Audit and versioned local Outbox events in the same transaction as role assignment.
5. Bump and test Snapshot migration only if the persisted schema changes; include restart, tamper, rollback-on-persist-failure, Race, API, and UI failure-state tests.
6. Update the frozen contract, cross-product vectors, coverage matrix, release facts, and handoff to the exact implementation commit.
7. Commit, push, and verify Local SHA = Remote SHA before selecting the next uncovered requirement.

## External acceptance still required

- Owner 02: Seller registry plus store-scoped authorization-revocation contract.
- Owner 26: canonical ingestion of the two Seller revocation Outbox events.
- Owner 29: shared Testnet contract freeze and end-to-end execution.

These dependencies do not block the invitation implementation or other independent Seller work.
