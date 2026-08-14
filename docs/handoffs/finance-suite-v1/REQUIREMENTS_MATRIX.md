# YNX finance suite requirements matrix

Authority: Fable5 Coordinated Final Testnet Prompt Pack v2. This file records the finance-suite interpretation only; it does not redefine Wallet, Oracle, Data Fabric, Explorer, Bridge, Website, Security/SRE or Governance ownership.

Status vocabulary: `proven-public`, `tested-local`, `partial`, `missing`, `external-blocked`. Testnet, paper, unsigned artifacts and production are deliberately separate.

| Product | Requirement group | Current status | Direct evidence / next closure |
| --- | --- | --- | --- |
| DEX | Chain-native swap, add/remove liquidity, LP shares, exact-in/out, fees, slippage, minimum received, approval, explicit Wallet confirmation and reconnect | proven-public Testnet | Current source-bound deployment health/version/UI: `docs/evidence/dex/public-reconnect-deployment-2026-08-13.json`; historical transaction lifecycle: `docs/evidence/dex/native-public-lifecycle-2026-08-11.json` |
| DEX | Token list, balances/allowance, pools, positions, history, TVL/volume/fees, candles and depth/liquidity | partial | Current chain-native indexer and web tests pass; candles exist, but concentrated/stable/weighted liquidity is not integrated into the public chain-native path |
| DEX | Multi-hop routing, Strategy Vault, FairFlow, StableSwap, concentrated liquidity, LP protection, kill/revoke/emergency exit | Strategy Vault, FairFlow, StableSwap, concentrated accounting and LP protection tested-local; advanced capabilities missing-public | Local evidence: `docs/evidence/dex/strategy-vault-local-2026-08-13.json`, `docs/evidence/dex/advanced-liquidity-local-2026-08-13.json`; public Wallet mandate, advanced-pool and transaction evidence remains absent |
| Exchange | Deterministic Spot CLOB, market/limit/advanced orders, order book, trades, candles, account/orders/fills, client-consumed resumable WebSocket stream | proven-public Testnet | Source-bound health/version, persisted-fill market data and public WebSocket evidence: `docs/evidence/exchange/public-live-stream-deployment-2026-08-14.json` |
| Exchange | Margin/perpetual/risk/solvency and UltraLiquidity | tested-local / partial-public | Local schema-v10 evidence exists; production custody, portfolio margin and committed DEX execution remain absent |
| Finance | Read-only portfolio/activity/budget/report/risk views from Wallet, Pay, Exchange, DEX, Quant and economics | partial-public | Current health returned HTTP 200 with Exchange/DEX/Quant configured; source-specific authenticated evidence and outage handling still require fresh end-to-end verification |
| Finance | Lending, staking and yield execution | out of product boundary | Fable5 defines Finance as non-custodial and read-only. It may display verified staking/yield facts but must not originate loans, trades or promised returns |
| Quant | Research, deterministic backtest, costs/slippage, benchmarks, PnL, drawdown, risk, lifecycle, paper/shadow | tested-local | `apps/quant-lab/FEATURE_COMPLETION_EVIDENCE.md` |
| Quant | Bounded Exchange Testnet execution, tenant isolation, restart and kill/revoke | proven-public at older source / partial-current | Public health returned simulated-testnet-only on 2026-08-13; current source candidate has not been redeployed |
| Quant | DEX Vault execution and emergency exit | missing-public | Requires accepted DEX owner transport, Vault receipt and Wallet mandate evidence |
| Shared | Asset, Market, Quote, Candle, Order, Trade, Position, Portfolio, LiquidityPool, Strategy, RiskLimit | candidate implemented-local | `packages/finance-domain` v1 candidate; acceptance belongs to central Integration |
| Shared | Stable API/events/errors, idempotency, optimistic concurrency, request tracing | partial | Candidate error and write-header protocol is implemented locally; product adapters and central event-envelope mapping remain to be completed |
| Shared | Multi-user durable storage, rate limits, health/readiness/metrics/logs, retry/reconnect/RPC failover | partial | DEX loopback passed 1000/1000 but its public path failed 7/1000; Exchange public client probe passed 294/400 and hit admission/network failures. Exchange remains single-active JSON persistence, so transactional multi-instance storage and cross-product concurrent/restart drills remain required |
| Shared | Wallet/Auth consumption without private-key custody | partial / accepted per product at older sources | No finance-suite code may redefine central Wallet registry or signer behavior; only versioned handoff/test vectors are permitted |

## Mandatory user-action boundary

Every financial write must follow `authoritative quote or order preview → source/fee/risk/slippage disclosure → exact Wallet-bound intent → explicit confirmation → idempotent submission → terminal or unknown-state reconciliation`. A timeout is never reported as success. Private keys and seed phrases never enter finance-suite services or logs.

## Language and accessibility baseline

Default locale is English. Required runtime locales are English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic with real RTL, and Bahasa Indonesia. Keyboard, screen reader, focus, contrast, dynamic type, reduced motion, light/dark and 390 px layouts are release gates.
