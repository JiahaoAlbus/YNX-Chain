# YNX Seller Console Current Plan

Stage: `FREEZE`  
Goal status: `ACTIVE`  
Runtime source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`

## Protected slices

The following Seller-owned capabilities are implemented, tested and pushed:

- Canonical eight-role least-privilege Seller authority.
- Wallet-account-bound invitations with exact-target one-time acceptance.
- Existing-member-only role updates and owner-only revocation.
- Store-scoped Wallet authorization-revocation adapter with receipt binding and regrant blocking.
- Transactional Seller Audit and versioned local Outbox.
- Snapshot v6 migration, future-version refusal and HMAC-aware verified backup restore.
- Explicit non-destructive v3/v4/v5 rollback export with representability and lossy-state refusal.
- Owner-only, store-scoped Seller data portability export with access Audit.
- Preview-first transient retention that protects orders, financial evidence, authority records, Outbox, Audit, idempotency, buyer profiles and carts.

Verified against runtime source commit `a90d1ee59eec38c15ce42b39420f2625ed758dd0`:

- `go test ./internal/commerce/...`
- `go test -race ./internal/commerce`
- `go vet ./internal/commerce/...`
- `npm test` in `apps/seller-console`
- `npm run build` in `apps/seller-console`

The race command passed with a non-failing macOS linker `LC_DYSYMTAB` warning. The preceding repository-wide `go test ./...` attempt remained red only in already recorded non-Seller ownership areas; do not modify those products from this worktree.

## Exact next implementation slice

Implement the bounded provider registry without storing plaintext credentials.

1. Add Shipping, Tax, Address, Storage, Email, Webhook, Pay and Trust provider records with explicit `disabled`, `sandbox`, `testnet` or `production` mode and truthful health state.
2. Restrict provider create/update/test/disable/rotation-metadata operations to Seller Owner authority.
3. Persist only secret references and rotation timestamps; reject inline credentials.
4. Add bounded test-connection attempts, rate-limit state, timeout/outage handling and Audit evidence.
5. Expose provider capability state without claiming unavailable providers are verified.
6. Add API, restart, persistence-failure, authorization, outage and secret-rejection tests.
7. Update provider contract, cross-product vectors, release facts and Agent Memory to the exact implementation source commit.
8. Run Commerce, Race, Vet and Seller web gates; review, commit, push and verify Local SHA = Remote SHA.

## External acceptance still required

- Owner 02: Seller product registration and store-scoped authorization revocation.
- Owner 04: authoritative settlement/refund evidence acceptance and merchant configuration.
- Owner 15: Trust dispute/appeal evidence acceptance.
- Owner 26: canonical ingestion of Seller role, invitation and revocation Outbox events and Billing Ledger facts.
- Owner 28: current-source `/seller-console` public route and metadata.
- Owner 29: shared Testnet contract freeze and end-to-end execution.
- Owner 30: production-class artifact, security, migration and restore review.

These dependencies do not block the provider registry's local fail-closed implementation.
