# YNX Explorer Dependency Acceptance

## Acceptance rule

YNX Explorer consumes public, read-only evidence. It does not become the authority for chain identity, market prices, solvency, economics, product state, user identity or operational health. A dependency is accepted only when its contract is versioned, source-bound, failure-aware and testable without privileged credentials.

## Current dependency status

| Owner | Required facts | Acceptance | Current state |
|---|---|---|---|
| 01 Chain Core | Network identity, blocks, receipts, validators, finality, governance, upgrade and rollback evidence | Exact chain/release identity; source and as-of; explicit unavailable/reorg state | Partial |
| 02 Wallet/Auth | Public address equivalence and approved public identity facts | No private session, device, mandate or credential disclosure | Partial |
| 07 Exchange | Public markets, fills, funding, liquidation, insurance and solvency evidence | Versioned public read model; no private subaccount or API-key data | Not accepted |
| 08 Quant Lab | Public strategy hash/version, mandate boundary, execution and fee/PnL evidence | No private source, parameters or sensitive user configuration | Not accepted |
| 17 Economics | Supply, issuance, burn, staking, stablecoin, treasury and solvency facts | Source, period, gross/net, risk and Testnet status | Not accepted |
| 19 Oracle | Price, source, version, as-of, confidence, coverage and stale state | Consumers must fail closed on stale/unsupported data | Not accepted |
| 26 Data Fabric | Canonical public product evidence and billing event envelope | Stable event ID, source commit/release, integrity and correction semantics | Not accepted |
| 28 Website | Canonical public route, metadata, sitemap and download/public entry | Must use canonical deep links, not legacy query routes | Pending |
| 29 Integration | Protocol freeze, shared Testnet and public proof | Freeze one summary/cursor/error/evidence version | Pending |
| 30 Security/SRE | Secret reference, artifact, backup, release and incident controls | No secret in Git/chat/log; provenance and rollback evidence | Pending |

## Accepted local contracts

The following local contracts are internally consistent but are not yet centrally frozen:

- `explorer.summary.v1`
- `explorer.block-page.v1`
- `explorer.transaction-page.v1`
- cursor envelope version 1, including locally verified configured-key restart continuity
- `explorer.stream-recovery.v1` with retained `Last-Event-ID` replay and explicit snapshot reset
- canonical `/block`, `/tx` and `/address` routes
- HTTP 400 cursor rejection versus HTTP 502 dependency failure

## Rejected assumptions

Explorer must not:

- calculate or display price, TVL, market cap, APY, revenue, PnL, TPS or solvency without an authoritative source;
- treat an HTTP 200, webhook, cached page, AI explanation or UI success state as chain finality;
- expose private Quant source, exchange credentials, Wallet sessions, provider secrets or sensitive support evidence;
- maintain long-term compatibility with two conflicting owner schemas;
- silently replace corrected historical evidence.

## Current blockers

1. Central owner contracts for market, Quant, economics, solvency and product evidence are not accepted.
2. Public ingress, DNS, hosted immutable artifact and cross-region verification are not available in this workspace.
3. Repository-wide release preflight remains red in other-owner key-permission and Hardhat selector-metadata tests; Explorer/Indexer targeted verification is green.
4. Root Hardhat development tooling carries three High npm advisories through `adm-zip` with no current npm fix; the Explorer package audit is clean.

## Next acceptance action

After the verified checkpoint is pushed and source-bound, submit `explorer.integration.v1` and the cross-product vectors to 29 Integration. Continue independently with source/as-of/coverage envelopes and negative privacy tests while other owners finalize their contracts.
