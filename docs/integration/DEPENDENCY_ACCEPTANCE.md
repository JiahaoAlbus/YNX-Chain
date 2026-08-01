# YNX Quant Lab Dependency Acceptance

This file records acceptance gates, not assumptions. `candidate observed` means a
source-addressable owner contract exists on a remote product branch. It does not
mean the contract is bound to that branch HEAD, centrally accepted, deployed, or
verified with Quant in the shared Testnet. Machine-readable source evidence is in
`apps/quant-lab/integration/owner-contract-snapshot.json`.

| Owner | Required dependency | Current state | Acceptance evidence required | Quant behavior before acceptance |
| --- | --- | --- | --- | --- |
| 01 Chain Core | YNX Testnet identity, Faucet, finality, transaction/receipt facts | pending | chain metadata, funded test account, committed transaction and receipt, Explorer correlation | no chain-finality or asset-settlement claim |
| 02 Wallet/Auth | registry, Product Session, StrategyMandate authorization, expiry, revoke, kill and emergency exit | candidate observed; central acceptance pending | freeze Product Session v1, HTTP proof v1, StrategyMandate v2 and StrategyAction v1; enable exact `quant` / `ynx-quant-v1` / `com.ynxweb4.quant` registration; execute positive/negative vectors and retain authoritative receipts | local preview only; registration stays pending-review and disabled; integrated Testnet mutation disabled |
| 07 Exchange | user subaccount, no-withdraw transport, terminal fill/reject/cancel receipt, reconciliation | candidate observed; terminal receipt/snapshot schema and central acceptance pending | freeze `/v1/quant-adapter/`, signed-intent domains, exact terminal receipt and authoritative snapshot; prove aggregate capital, kill, replay, no-withdraw and restart behavior | Exchange adapter boundary available but no owner transport or real execution claim |
| 12 Explorer | public-safe transaction, mandate, execution, risk and release proof | pending | stable public routes linked to exact Testnet facts and release commit | evidence remains local/private |
| 13 Monitor | risk, kill switch, pending-unknown, reconciliation and incident integration | pending | alerts, incident timeline, restart/recovery verification and role audit | local metrics only; delivered alerts not claimed |
| 14 AI | Product AI Registry entry for research assistance | pending | accepted context/tool/approval/retention contract and forbidden-action tests | AI remains documentation boundary; no autonomous tools |
| 15 Trust Center | mandate-overreach, incorrect fee/PnL and appeal evidence | pending | accepted case/evidence references, redaction and appeal path | no Trust case integration claim |
| 19 Oracle & Market Data | historical/live feed, corrections, source/freshness/quality/failure semantics | candidate observed; Quant consumer acceptance pending | freeze `ynx.oracle.v1`, aggregation/derivatives policy, provider registry and correction lineage; execute stale/divergence/circuit-breaker/last-good/correction vectors | local fixtures or injected adapters only; owner-reported public Oracle smoke does not prove Quant integration |
| 24 Finance | read-only user strategy/PnL view | pending | accepted read model and reconciliation against canonical events | no Finance integration claim |
| 26 Data Fabric | canonical events and Billing Ledger | candidate envelope v2 and Quant mapping observed; producer/ledger mapping and central acceptance pending | accept one envelope/schema registry, exact producer fields, idempotent ingestion, ordering/tamper rules and fee/PnL/usage ledger mapping | local audit events are evidence, not central canonical events |
| 27 DEX | Strategy Vault, limited signed intent, terminal Swap/LP/rebalance and emergency-exit receipts | candidate observed; not deployed; terminal receipt/snapshot schema pending | freeze signed-intent fields and Vault methods; prove ownership, allowlists, negative permissions, action/exit receipts and authoritative reconciliation on chain 6423 | DEX adapter boundary available but no owner transport, deployed Vault or real execution claim |
| 28 Website | canonical Quant page, public metadata, downloads and SEO | pending | rendered canonical route, structured data, public status and immutable downloads | public/deployed/download-hosted remain false |
| 29 Integration | protocol freeze, shared Testnet, cross-product vector execution | zero centrally accepted products in observed matrix | accepted exact source commits, environment manifest, retained vector evidence and resolution of owner identifier conflicts | all owner contracts remain candidates; `integratedCentral=false` |
| 30 Security/SRE/Release | deployed backup/restore, scanners, artifact provenance, public deployment and release approval | pending | deployed drills, scan reports, immutable hashes, release manifest and approval | local security evidence only; no external audit or public release claim |

## Observed candidate sources

| Owner | Observed branch HEAD | Contract source commit | Exact HEAD bound | Central acceptance |
| --- | --- | --- | --- | --- |
| 02 Wallet/Auth | `a5c99e4e26e150aa6cf4138f4ecf8ac6d1ea8b2f` | `61df5559c647d880cc1d435bece9d89ff66a07e1` | no; source is a reachable ancestor | no |
| 07 Exchange | `03dc31d6120df2a72ced1de4042d3102ebb48060` | `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d` | no; source is a reachable ancestor | no |
| 19 Oracle & Market Data | `c4ee5246b69423cd319ab9af8b275b01e3e14370` | `f71d5ca5c2ede28477fbadff36701a9f040e311f` | no; source is a reachable ancestor | no |
| 26 Data Fabric | `b76bf9be88275a1310ba88f5f9d8a8a6a4ba4056` | `3a1bcceddc9e680761ce9563bb3d6cd823037222` | no; source is a reachable ancestor | no |
| 27 DEX | `f933440d5cb791044476eb69c58c522d5c91d8a1` | `7d61369e02ab4d50a9fc36c927dc487e47ce9814` | no; source is a reachable ancestor | no |

The observed Integration branch was
`20191a3e7f561882b7393686fc0ea39d7a08a5ed`. Its acceptance matrix generated at
`2026-07-29T02:29:14.029Z` reported zero centrally accepted products and no
accepted Quant source commit.

## Acceptance rules

1. Acceptance must identify owner, schema/version, exact source commit and environment.
2. Branch reachability is not acceptance. A candidate whose internal source commit differs from the observed branch HEAD remains unfrozen until 29 Integration selects the exact commit.
3. A reachable endpoint alone is insufficient; positive and negative vectors must establish business and security semantics.
4. Test fixtures, injected transports, Paper fills, owner-reported smoke tests and local health responses do not satisfy a Quant dependency.
5. Unknown, stale, malformed, revoked, conflicting or unaccepted dependencies fail closed.
6. Secrets must be referenced through an authorized secret manager or signer path and never copied into this repository, evidence bundle or chat.
7. When an owner contract conflicts with this proposal, record the exact field, version and impact, prepare one migration, and submit it to 29 Integration. Do not preserve two long-lived canonical protocols.
8. Only 29 Integration may mark a cross-product protocol frozen; only direct shared-environment evidence may mark a vector integrated or Testnet verified.

## Current conflicts

- The earlier Quant Wallet proposal used `ynx-quant-lab-v1`,
  `com.ynxweb4.quantlab` and research/Paper scopes. The reachable Wallet owner
  candidate uses `ynx-quant-v1`, `com.ynxweb4.quant` and mandate lifecycle
  scopes. Quant-owned proposal files are migrated, but the registration remains
  pending-review, disabled and not centrally accepted.
- The Oracle owner contract names product 09 as its DEX dependency, while the
  current ownership map assigns DEX to product 27. This identifier must be
  corrected by Owner 19 and frozen by Owner 29.
- Exchange and DEX owner candidates expose bounded Quant/Vault capabilities but
  do not yet publish the exact terminal receipt and authoritative reconciliation
  schemas required by the Quant adapter contract.

## Current autonomous next actions

- validate candidate source and acceptance semantics in the Quant release gate;
- keep Exchange/DEX transports capability-narrow and receipt-bound;
- prepare adapters and negative vectors against explicit candidates without
  enabling shared Testnet mutation;
- re-snapshot owner branches when their contract source or Integration acceptance
  changes;
- retain `integratedCentral=false` and all public/release booleans false until
  direct evidence exists.
