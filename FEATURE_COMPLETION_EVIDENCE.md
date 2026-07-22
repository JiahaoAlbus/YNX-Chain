# YNX DEX feature completion evidence

Updated 2026-07-23 for `codex/final-dex`. A checked local subset is not evidence that the final DEX objective is complete.

## Current release truth

| Scope | Status | Direct evidence | Missing final evidence |
| --- | --- | --- | --- |
| Recovery | complete | Source branch and remote both resolved to `1614ffb7fa4983a182405fe3fa118fa448f87b4b`; the source worktree was clean; the final worktree was created from that SHA. | None for recovery itself. |
| Constant-product contracts/router/quoter | recovered, extended and locally tested | Legacy immutable CPMM regression: `npm run dex:contracts:test`. Separate protected CPMM integration: `npm run dex:lp-protection:test`. | Independent audit, verified Testnet bytecode, real-node chaos and public transactions. |
| Indexer | recovered, extended and locally tested | `go test -race ./internal/dex ./cmd/ynx-dex-indexerd`; confirmed pool/Vault/FairFlow/LP Protection polling, all ten FairFlow and four LP Protection ABI shapes, schema v1/v2/v3 migration, restart and shared reorg cases pass. | Real deployed factory/Vault/FairFlow/LP Protection scan, remote restart/reorg drill, SLO and capacity evidence. |
| JavaScript SDK | recovered, extended and locally tested | `npm test --prefix sdk/dex` passes 17 deterministic, property, Vault/FairFlow approval, LP Protection quote/reconciliation, preflight risk, fee-semantics and receipt/event-reconciliation tests. | Final multi-pool surface, live central integration and compatibility evidence. |
| Web/PWA | recovered and locally tested | Build and 16 Vitest tests pass; Playwright reports 10 passed and 2 project-inapplicable skipped; offline cold reload passes. | Final feature UI, central Wallet acceptance, installed/public evidence. |
| Release integrity | recovered and repaired | `npm run dex:release:test`, manifest check and artifact verification pass. Source binding rejects committed or uncommitted drift after the declared release source SHA. | Hosted immutable artifact, signing, remote install/cold-start evidence. |
| Concentrated liquidity / StableSwap / weighted candidate | not implemented | No authoritative source or tests found. | Contracts, SDK/indexer/UI integration, invariant/fuzz/differential/chaos evidence. |
| FairFlow / solver competition / batch auction | local contract, Indexer and SDK candidate implemented and tested; not integrated, deployed or audited | `YNXFairFlow.sol` contract source remains bound in `contracts/dex/SOURCE_REV`; release source commit `6acd42669c8982625a706bfd3bd6b5b7ea991dda` adds ten-stage confirmed indexing plus fresh-state, nonce-domain and exact canonical Wallet-approved submit/cancel SDK requests. `npm run dex:fairflow:test` passes 32 score differential vectors plus uniform-price settlement, verified surplus competition, CoW netting, exact external inventory, atomic rollback, cancellation, bond/reputation and objective slashing cases. Local observed deployment gas is 3825894 and two-Intent settlement gas is 252191. | UI, Sybil/collusion controls, partial fills, attributable MEV evidence, external-route proof, cross-chain settlement, independent Solver, audit, verified Testnet bytecode and public batch receipts. |
| Strategy Vault | implemented and locally tested; not deployed or audited | `YNXStrategyVault.sol` at source commit `8a793b4562790834a67c3e4ee491ce089341d549`; `npm run dex:vault:test` passes integration/adversarial/property coverage with 32 stateful vectors and a local maximum observed swap gas of 265341. | Independent audit, formal invariant campaign, verified Testnet bytecode, Wallet-reviewed mandate, real Quant session and Explorer/indexer reconciliation. |
| Quant execution adapter | partially implemented and locally tested | `sdk/dex` parses authoritative Vault state; builds typed swap/add/remove/pause/emergency requests; requires an exact canonical Wallet approval digest before invoking an injected engine transport; reconciles direct or indexed confirmed `ActionExecuted` evidence; validates source-labelled gas/fee/oracle/risk snapshots against the mandate; reports CPMM collect as unsupported rather than fabricating a transaction; and constrains compound/rebalance to caller-sized, sequentially approved actions. Indexer schema/cursor v3 binds Vault and FairFlow addresses, migrates authenticated v1/v2 state and rewinds/reorgs all sources together. SDK tests pass 15 cases; Go race tests pass. | Live canonical Wallet introspection and RPC/oracle endpoint wiring, non-CPMM collect implementation, and end-to-end DCA/TWAP/LP evidence. |
| LP protection | local protected-CPMM contract, Indexer and SDK candidate implemented and tested; not integrated, deployed or audited | `YNXProtectedDexFactory` creates pools with immutable `YNXLPProtection`. `npm run dex:lp-protection:test` passes 32 fee differential/property vectors, 16 stateful invariant vectors, Oracle/depeg chaos, taxed-token rollback, delayed config, fee accounting and depeg-time LP exit. Indexer schema/cursor v4 persists all four fixed event shapes and binds the protection address; the SDK binds fresh authoritative component quotes and reconciles realized fee separately from incentive. Latest local observed gas: Factory deployment 5303678, pool creation 2279845, protected swap 223568. | UI, reviewed live Oracle adapter, LVR-aware auction, inventory/range guidance, independent audit, verified Testnet bytecode and public receipts. |
| Launch auction / protocol-owned liquidity | not implemented | No authoritative source or tests found. | Uniform allocation/anti-sniping/anti-Sybil contracts, public treasury accounting, migration, risk and adversarial evidence. |
| Real YNX Testnet | not deployed | The retained RPC probe proves chain identity only and records `dexDeploymentObserved=false`. | Deploy/verify, reviewed tokens, pools, liquidity, swaps/LP/Vault receipts, Explorer/indexer/UI consistency, public micro-site. |

## Boolean status

The authoritative machine-readable status is `product-release.json`. The final objective currently has `implementedLocal=false`, `testedLocal=false`, and every integration/deployment/distribution boolean false. The recovered 0.1 constant-product candidate is recorded separately under `recoveredCandidate` so its passing tests cannot be mistaken for completion of the expanded final objective.

## Revalidation performed

- Solidity 0.8.24 compilation: pass.
- Contract integration and arithmetic differential vectors: pass.
- FairFlow uniform-batch integration/adversarial test and 32 score differential vectors: pass.
- LP Protection integration, 32 fee differential vectors and 16 stateful invariant vectors: pass.
- SDK deterministic/property/security tests: 17 pass.
- Indexer race/restart/tamper/reorg tests: pass.
- Web build and component/integration tests: 16 pass.
- Chromium desktop/mobile E2E: 10 pass, 2 skipped because the cases are project-inapplicable.
- Production dependency audit: zero vulnerabilities at the configured threshold.
- Release source-binding regression, manifest validation and artifact digest validation: pass.

No item above proves deployment, public availability, production signing, audit completion, real liquidity, TVL, APY, volume or revenue.
