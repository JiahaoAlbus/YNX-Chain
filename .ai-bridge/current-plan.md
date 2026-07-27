# YNX Seller Console Current Plan

## Current stage

`FREEZE` — canonical Seller RBAC and central integration boundaries are being frozen before shared Testnet integration.

## Protected slice in progress

1. Replace the legacy broad `manager` role with canonical least-privilege roles.
2. Migrate Snapshot v2 `manager` records to Snapshot v3 `admin`.
3. Reject legacy and unknown roles for new assignments.
4. Apply fail-closed permission checks across catalog, inventory, fulfillment, finance, support and read paths.
5. Freeze integration contract, test vectors, dependency acceptance, coverage and truthful release status.
6. Run targeted Go, Web, build and HTTP smoke verification.
7. Commit and push the independent `codex/final-seller-console` branch.

## Exact next engineering slice

Implement owner-only role revocation and a Wallet/Auth session-invalidation adapter:

- add an explicit revoke endpoint and owner-only store operation;
- preserve the owner role and reject self/owner revocation;
- append immutable audit and canonical event records;
- call the central Wallet/Auth revoke contract when configured;
- return a truthful pending/unavailable state when central revoke cannot be confirmed;
- add negative tests for non-owner revoke, unknown account, repeated revoke and provider outage;
- update the coverage matrix and integration vectors.
