# YNX Card Decisions

## 2026-07-27

1. Product routing is based on the exact current Worktree and Branch, identifying 06 Card.
2. Recovery source `c20beda` contained Card, Pay and Merchant work; only Card-owned paths and Card handoff/evidence were restored.
3. The historical committed Android `debug.keystore` was not retained. Signing material is ignored and release signing is environment-only with complete-variable validation.
4. A missing `rg` caused the repository-wide legacy secret scan to print a false pass. Card now uses a zero-dependency product-local security gate and does not claim the legacy scan as evidence.
5. Full PAN-like literals were removed from source; sensitive-field tests construct bounded test data only at runtime.
6. Issuer-unavailable mode is an intentional fail-closed state: `/health` reports degraded dependency status, `/ready` returns 503, and `/version` reports source/schema identity.
7. Sandbox issuance remains explicitly Testnet-only. No BIN, real processor, fiat balance, spendability, reward, Apple Pay or Google Pay claim is permitted.
8. `bdd5ca02ad42b712db66a5173ecfad09340aa42c` remains the protected recovery provenance commit; subsequent runtime and evidence commits must retain that provenance rather than rewriting it.
9. Issuer adapters must satisfy `ynx.card.provider.capabilities.v1` before service startup. Missing, malformed or unsafe secure-display/sensitive-data capabilities fail closed. Implemented at `8cd6a721b0ffe007ddaa5855337aa2dfc26c0d9b`.
10. Provider webhook verification supports a bounded overlap of at most four explicit Key IDs. Unknown or retired Key IDs, tampered bodies and expired timestamps fail closed; no secret material is logged or persisted.
11. Clearing and reversal must reference a prior authorization on the same provider Card, and refund must reference a prior clearing. Out-of-order delivery returns a retryable conflict without consuming the provider event ID.
12. `13f90c5f6dae6fb002560574b4c481b5e1477f9d` is the latest protected Card runtime source. Card tests, Race and Vet pass at this commit.
13. Repository-wide Go failures in Chain/Trust/Faucet and missing Solidity artifacts are recorded as central-repository blockers. This thread will not modify those other owners merely to manufacture a green Card result.
