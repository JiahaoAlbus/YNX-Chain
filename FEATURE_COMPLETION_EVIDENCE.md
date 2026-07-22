# YNX DEX feature completion evidence

Updated 2026-07-22 for `codex/final-dex`. A checked local subset is not evidence that the final DEX objective is complete.

## Current release truth

| Scope | Status | Direct evidence | Missing final evidence |
| --- | --- | --- | --- |
| Recovery | complete | Source branch and remote both resolved to `1614ffb7fa4983a182405fe3fa118fa448f87b4b`; the source worktree was clean; the final worktree was created from that SHA. | None for recovery itself. |
| Constant-product contracts/router/quoter | recovered and locally tested | `npm run hardhat:build`; `npm run dex:contracts:test`. | Independent audit, verified Testnet bytecode, invariant framework beyond the recovered deterministic campaign, gas report, public transactions. |
| Indexer | recovered and locally tested | `go test -race ./internal/dex ./cmd/ynx-dex-indexerd`; confirmed polling/restart/reorg cases pass. | Real deployed factory scan, remote restart/reorg drill, SLO and capacity evidence. |
| JavaScript SDK | recovered, extended and locally tested | `npm test --prefix sdk/dex` passes 10 deterministic, property, Vault approval and receipt-reconciliation tests. | Final multi-pool/FairFlow API surface, live central integration and compatibility evidence. |
| Web/PWA | recovered and locally tested | Build and 16 Vitest tests pass; Playwright reports 10 passed and 2 project-inapplicable skipped; offline cold reload passes. | Final feature UI, central Wallet acceptance, installed/public evidence. |
| Release integrity | recovered and repaired | `npm run dex:release:test`, manifest check and artifact verification pass. Source binding rejects committed or uncommitted drift after the declared release source SHA. | Hosted immutable artifact, signing, remote install/cold-start evidence. |
| Concentrated liquidity / StableSwap / weighted candidate | not implemented | No authoritative source or tests found. | Contracts, SDK/indexer/UI integration, invariant/fuzz/differential/chaos evidence. |
| FairFlow / solver competition / batch auction | not implemented | No authoritative source or tests found. | Intent lifecycle, bonds/reputation/slashing, best-execution proof, fallback and adversarial evidence. |
| Strategy Vault | implemented and locally tested; not deployed or audited | `YNXStrategyVault.sol` at source commit `8a793b4562790834a67c3e4ee491ce089341d549`; `npm run dex:vault:test` passes integration/adversarial/property coverage with 32 stateful vectors and a local maximum observed swap gas of 265341. | Independent audit, formal invariant campaign, verified Testnet bytecode, Wallet-reviewed mandate, real Quant session and Explorer/indexer reconciliation. |
| Quant execution adapter | partially implemented and locally tested | `sdk/dex` parses authoritative Vault state; builds typed swap/add/remove/pause/emergency requests; requires an exact canonical Wallet approval digest before invoking an injected engine transport; and reconciles direct or indexed confirmed `ActionExecuted` evidence. Indexer schema/cursor v2 binds the Vault address, migrates authenticated v1 state and rewinds/reorgs Vault actions with pool events. SDK tests pass 11 cases; Go race tests pass. | Live canonical Wallet introspection, gas/oracle/risk endpoint integration, collect/compound/rebalance orchestration and end-to-end DCA/TWAP/LP evidence. |
| LP protection / launch auction / protocol-owned liquidity | not implemented | No authoritative source or tests found. | On-chain mechanisms, public accounting schemas, risk and adversarial evidence. |
| Real YNX Testnet | not deployed | The retained RPC probe proves chain identity only and records `dexDeploymentObserved=false`. | Deploy/verify, reviewed tokens, pools, liquidity, swaps/LP/Vault receipts, Explorer/indexer/UI consistency, public micro-site. |

## Boolean status

The authoritative machine-readable status is `product-release.json`. The final objective currently has `implementedLocal=false`, `testedLocal=false`, and every integration/deployment/distribution boolean false. The recovered 0.1 constant-product candidate is recorded separately under `recoveredCandidate` so its passing tests cannot be mistaken for completion of the expanded final objective.

## Revalidation performed

- Solidity 0.8.24 compilation: pass.
- Contract integration and arithmetic differential vectors: pass.
- SDK deterministic/property/security tests: 11 pass.
- Indexer race/restart/tamper/reorg tests: pass.
- Web build and component/integration tests: 16 pass.
- Chromium desktop/mobile E2E: 10 pass, 2 skipped because the cases are project-inapplicable.
- Production dependency audit: zero vulnerabilities at the configured threshold.
- Release source-binding regression, manifest validation and artifact digest validation: pass.

No item above proves deployment, public availability, production signing, audit completion, real liquidity, TVL, APY, volume or revenue.
