# YNX Quant Lab Dependency Acceptance

This file records acceptance gates, not assumptions. `pending` means Quant has
identified and tested its local boundary but has not received or verified the
owner's accepted contract in the shared environment.

| Owner | Required dependency | Current state | Acceptance evidence required | Quant behavior before acceptance |
| --- | --- | --- | --- | --- |
| 01 Chain Core | YNX Testnet identity, Faucet, finality, transaction/receipt facts | pending | chain metadata, funded test account, committed transaction and receipt, Explorer correlation | no chain-finality or asset-settlement claim |
| 02 Wallet/Auth | registry, Product Session, StrategyMandate verification, expiry and revoke | pending | accepted registry/version, positive and negative session vectors, mandate attestation and revoke propagation | local preview only; integrated Testnet mutation disabled |
| 07 Exchange | user subaccount, no-withdraw transport, terminal fill/reject/cancel receipt, reconciliation | pending | capability proof, order/fill and rejected receipts, no-withdraw negative tests, authoritative snapshot | Exchange adapter boundary available but no owner transport or real execution claim |
| 12 Explorer | public-safe transaction, mandate, execution, risk and release proof | pending | stable public routes linked to exact Testnet facts and release commit | evidence remains local/private |
| 13 Monitor | risk, kill switch, pending-unknown, reconciliation and incident integration | pending | alerts, incident timeline, restart/recovery verification and role audit | local metrics only; delivered alerts not claimed |
| 14 AI | Product AI Registry entry for research assistance | pending | accepted context/tool/approval/retention contract and forbidden-action tests | AI remains documentation boundary; no autonomous tools |
| 15 Trust Center | mandate-overreach, incorrect fee/PnL and appeal evidence | pending | accepted case/evidence references, redaction and appeal path | no Trust case integration claim |
| 19 Oracle & Market Data | historical/live feed, corrections, source/freshness/quality/failure semantics | pending | accepted provider registry/schema, licensed data proof, stale/divergence/correction vectors | local fixtures or injected adapters only; no authoritative deployed feed claim |
| 24 Finance | read-only user strategy/PnL view | pending | accepted read model and reconciliation against canonical events | no Finance integration claim |
| 26 Data Fabric | canonical events and Billing Ledger | pending | one accepted schema/version, idempotent ingestion, fee/PnL/usage reconciliation | local audit events are not called central canonical events |
| 27 DEX | Strategy Vault, limited session key, terminal Swap/LP/rebalance and emergency-exit receipts | pending | Vault ownership, method allowlist, negative permission tests, action and exit receipts, reconciliation | DEX adapter boundary available but no owner transport or real Vault execution claim |
| 28 Website | canonical Quant page, public metadata, downloads and SEO | pending | rendered canonical route, structured data, public status and immutable downloads | public/deployed/download-hosted remain false |
| 29 Integration | protocol freeze, shared Testnet, cross-product vector execution | pending | accepted contract versions, environment manifest, retained vector evidence | contract remains owner proposal |
| 30 Security/SRE/Release | deployed backup/restore, scanners, artifact provenance, public deployment and release approval | pending | deployed drills, scan reports, immutable hashes, release manifest and approval | local security evidence only; no external audit or public release claim |

## Acceptance rules

1. Acceptance must identify owner, schema/version, source commit and environment.
2. A reachable endpoint alone is insufficient; positive and negative vectors
   must establish business and security semantics.
3. Test fixtures, injected transports, Paper fills and local health responses do
   not satisfy an owner dependency.
4. Unknown, stale, malformed, revoked or conflicting dependencies fail closed.
5. Secrets must be referenced through an authorized secret manager or signer
   path and never copied into this repository, evidence bundle or chat.
6. When an owner contract conflicts with this proposal, record the exact field,
   version and impact, prepare one migration, and submit it to 29 Integration.
   Do not preserve two long-lived canonical protocols.
7. Only 29 Integration may mark a cross-product protocol frozen; only direct
   shared-environment evidence may mark a vector integrated or Testnet verified.

## Current autonomous next actions

- validate this integration package in the Quant release gate;
- keep Exchange/DEX transports capability-narrow and receipt-bound;
- add accepted owner schemas when they become available without widening Quant
  authority;
- continue local capacity, container, accessibility and recovery evidence that
  does not require another owner;
- retain `integratedCentral=false` and all public/release booleans false until
  direct evidence exists.
