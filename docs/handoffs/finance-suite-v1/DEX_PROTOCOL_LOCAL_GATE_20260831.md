# DEX protocol local gate — 2026-08-31

All commands below ran on the isolated local `dexTest` Hardhat network. They
do not assert deployed contracts, Testnet liquidity, Wallet approval, or any
chain transaction receipt.

| Area | Command | Result |
| --- | --- | --- |
| CPMM integration | `npm run dex:contracts:test` | pass |
| Strategy Vault | `npm run dex:vault:test` | pass: 32 stateful vectors; max swap gas 263,407 |
| FairFlow | `npm run dex:fairflow:test` | pass: 32 differential vectors; two-intent settlement gas 252,179 |
| Concentrated liquidity | `npm run dex:concentrated:test` | pass: 64 stateful tick/range, 32 exact, 16 fee-rounding vectors |
| StableSwap | `npm run dex:stable:test` | pass: 64 differential and 32 stateful vectors |
| LP protection | `npm run dex:lp-protection:test` | pass: 32 differential and 16 stateful vectors |

## Non-promotion rule

This local contract result cannot enable a DEX Vault engine. Before any
execution, the DEX owner must supply product-owned evidence for the Chain Core
v1.35 boundary: persisted vault owner equals its StrategyMandate owner, a
closed vault contains zero YNXT, and no engine path can withdraw, change owner,
or widen the mandate. Those constraints also require a separate Wallet-reviewed
Testnet deployment and transaction/Explorer reconciliation receipt.
