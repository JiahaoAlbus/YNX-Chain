# YNX Seller Console Current Plan

## Current stage

`FREEZE` — canonical Seller RBAC and central integration boundaries are being frozen before shared Testnet integration.

## Protected source checkpoint

Source commit `62d5a1833b9a901a339dc267ef78779ba793a095` contains:

1. Replacement of the legacy broad `manager` role with canonical least-privilege roles.
2. Snapshot v2 `manager` to Snapshot v3 `admin` migration.
3. Rejection of legacy and unknown roles for new assignments.
4. Fail-closed permission checks across catalog, inventory, fulfillment, finance, support and read paths.
5. Frozen integration contract, test vectors, dependency acceptance, coverage and truthful release status.
6. Passing targeted Go, Web, build and local HTTP smoke verification.

The independent branch must be pushed and local/remote SHA equality verified before the next source slice begins.

## Exact next engineering slice

Implement owner-only role revocation and a Wallet/Auth session-invalidation adapter:

- add an explicit revoke endpoint and owner-only store operation;
- preserve the owner role and reject self/owner revocation;
- append immutable audit and canonical event records;
- call the central Wallet/Auth revoke contract when configured;
- return a truthful pending/unavailable state when central revoke cannot be confirmed;
- add negative tests for non-owner revoke, unknown account, repeated revoke and provider outage;
- update the coverage matrix and integration vectors.
