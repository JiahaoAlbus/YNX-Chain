# YNX Card Decisions

## 2026-07-27

1. Product routing is based on the exact current Worktree and Branch, identifying 06 Card.
2. Recovery source `c20beda` contained Card, Pay and Merchant work; only Card-owned paths and Card handoff/evidence were restored.
3. The historical committed Android `debug.keystore` was not retained. Signing material is ignored and release signing is environment-only with complete-variable validation.
4. A missing `rg` caused the repository-wide legacy secret scan to print a false pass. Card now uses a zero-dependency product-local security gate and does not claim the legacy scan as evidence.
5. Full PAN-like literals were removed from source; sensitive-field tests construct bounded test data only at runtime.
6. Issuer-unavailable mode is an intentional fail-closed state: `/health` reports degraded dependency status, `/ready` returns 503, and `/version` reports source/schema identity.
7. Sandbox issuance remains explicitly Testnet-only. No BIN, real processor, fiat balance, spendability, reward, Apple Pay or Google Pay claim is permitted.
8. `bdd5ca02ad42b712db66a5173ecfad09340aa42c` is the protected recovery/runtime source commit. Coverage and integration documents reference this exact commit.
