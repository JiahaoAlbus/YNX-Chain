# Wallet/Auth Dependency Acceptance

Source commit: `853b2e0bf923e3d3535685c38b3e2396c2ea56df`

This file records acceptance conditions only. A dependency is not accepted merely because an adapter, schema or local test exists.

| Owner | Required input | Acceptance evidence | Current state |
| --- | --- | --- | --- |
| 01 Chain Core | Canonical chain identity, EVM chain ID, EntryPoint, transaction/receipt schemas, public RPC and Testnet contract addresses | Tx/UserOperation hash, block, receipt and source commit from the accepted Testnet | Blocked: no direct accepted deployment evidence in this worktree |
| App Gateway | Canonical adapter merge, durable atomic replay/revocation/mandate storage, health/version endpoints | Central merge SHA, migration result, restart test, public or staging endpoint evidence | Adapter ready; not merged/deployed |
| 26 Data Fabric | Canonical Wallet events and billing-ledger mappings | Accepted schema/version plus event ingestion and replay evidence | Contract ready; not accepted centrally |
| 19 Oracle | Capital-product and stablecoin facts with source/as-of/version/failure state | Signed or authoritative reference response and outage behavior | Contract required |
| 12 Explorer | Authorization, Product Session, revocation, transaction, UserOperation and mandate indexing | Explorer URLs or API responses bound to authoritative hashes | Contract required |
| 13 Monitor | Gateway, Session, Sponsor, Bundler, Paymaster and mandate metrics/alerts | Dashboard/alert evidence with request, error and audit IDs | Contract required |
| 15 Trust Center | Appeal, correction and mandate-dispute linkage | Case schema and immutable audit-ID correlation | Contract required |
| 29 Integration | Unique protocol freeze, merge order and shared Testnet execution | Accepted contract SHA plus all required shared vectors passing | Handoff ready; shared Testnet not executed |

## Fail-closed rules while blocked

- A missing central registration stays disabled.
- A missing Product Session, P-256 proof, required scope or active mandate is rejected.
- A missing Chain receipt, Bundler receipt, Paymaster decision, Explorer record or Monitor record cannot be represented as deployed or complete.
- Provider and owner outages return explicit failure states; they do not fall back to mock balances, mock receipts or hard-coded success.
- Wallet/Auth does not reproduce Chain Core, Data Fabric, Oracle, Explorer, Monitor, Trust Center or Integration authority inside this worktree.

## Accepted local evidence

- `packages/wallet-auth/testdata/strategy-mandate-v2.json`
- `packages/wallet-auth/test/strategy-vector.test.mjs`
- `packages/wallet-auth/test/strategy-gateway-adapter.test.mjs`
- `packages/wallet-auth/test/mandate-lifecycle.test.mjs`
- `release/integration/wallet-auth-contract.json`

The local evidence proves implementation and deterministic validation only. It does not satisfy central integration, Testnet deployment or public evidence gates.
