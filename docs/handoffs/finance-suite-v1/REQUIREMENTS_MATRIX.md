# YNX finance suite requirements matrix

Authority: Fable5 Coordinated Final Testnet Prompt Pack v2. This file records the finance-suite interpretation only; it does not redefine Wallet, Oracle, Data Fabric, Explorer, Bridge, Website, Security/SRE or Governance ownership.

Status vocabulary: `proven-public`, `tested-local`, `partial`, `missing`, `external-blocked`. Testnet, paper, unsigned artifacts and production are deliberately separate.

| Product | Requirement group | Current status | Direct evidence / next closure |
| --- | --- | --- | --- |
| DEX | Chain-native swap, add/remove liquidity, LP shares, exact-in/out, fees, slippage, minimum received, approval, explicit Wallet confirmation and reconnect | public reads only; execution disabled | Chain Core v1.35 requires product-owned custody acceptance. Existing older evidence does not satisfy it; see `CHAIN_CORE_STRATEGY_VAULT_V135_CONSUMPTION.md`. |
| DEX | Token list, balances/allowance, pools, positions, history, TVL/volume/fees, candles and depth/liquidity | partial | Current chain-native indexer and web tests pass; candles exist, but concentrated/stable/weighted liquidity is not integrated into the public chain-native path |
| DEX | Multi-hop routing, Strategy Vault, FairFlow, StableSwap, concentrated liquidity, LP protection, kill/revoke/emergency exit | Strategy Vault, FairFlow, StableSwap, concentrated accounting and LP protection tested-local; advanced capabilities missing-public | Local evidence: `docs/evidence/dex/strategy-vault-local-2026-08-13.json`, `docs/evidence/dex/advanced-liquidity-local-2026-08-13.json`; public Wallet mandate, advanced-pool and transaction evidence remains absent |
| Exchange | Deterministic Spot CLOB, market/limit/advanced orders, order book, trades, candles, account/orders/fills, client-consumed resumable WebSocket stream | public reads only; routing/execution disabled | Market data and WebSocket evidence remains traceable, but v1.35 product-owned custody evidence is absent; no public order route is claimed executable. |
| Exchange | Margin/perpetual/risk/solvency and UltraLiquidity | tested-local / partial-public | Local schema-v10 evidence exists; production custody, portfolio margin and committed DEX execution remain absent |
| Finance | Read-only portfolio/activity/budget/report/risk views from Wallet, Pay, Exchange, DEX, Quant and economics | partial-public | Current public health returned HTTP 200 with Exchange/DEX/Quant configured: `docs/evidence/finance/current-financial-suite-public-health-2026-08-15.json`. Source-specific authenticated evidence and outage handling still require fresh end-to-end verification. |
| Finance | Lending, staking and yield execution | out of product boundary | Fable5 defines Finance as non-custodial and read-only. It may display verified staking/yield facts but must not originate loans, trades or promised returns |
| Quant | Research, deterministic backtest, costs/slippage, benchmarks, PnL, drawdown, risk, lifecycle, paper/shadow | tested-local | `apps/quant-lab/FEATURE_COMPLETION_EVIDENCE.md` |
| Quant | Bounded Exchange Testnet execution, tenant isolation, restart and kill/revoke | research/paper public; Testnet execution disabled | Prior owner-read proof does not satisfy v1.35 Strategy Vault custody acceptance. Tenant isolation and research remain available; Testnet submit is fail-closed. |
| Quant | DEX Vault execution and emergency exit | missing-public | Requires accepted DEX owner transport, Vault receipt and Wallet mandate evidence |
| Shared | Asset, Market, Quote, Candle, Order, Trade, Position, Portfolio, LiquidityPool, Strategy, RiskLimit | tested-local / central integration pending | `ynx-finance-domain-v1` validates provenance plus model-specific IDs, amount strings, timestamps, intervals, order/strategy states, pool reserve cardinality and risk bounds; invalid records fail closed. Website/Integration handoff: `docs/handoffs/finance-suite-v1/DOMAIN_PORTFOLIO_WEBSITE_HANDOFF.md`. Central contract acceptance and public-release probe remain required. |
| Shared | Stable API/events/errors, idempotency, optimistic concurrency, request tracing | partial | Candidate error and write-header protocol is implemented locally; product adapters and central event-envelope mapping remain to be completed |
| Shared | Multi-user durable storage, rate limits, health/readiness/metrics/logs, retry/reconnect/RPC failover | partial | Exchange PostgreSQL CAS repository, migration and two-instance conflict/reload are tested locally (`docs/evidence/exchange/postgres-multi-instance-local-2026-08-14.json`) but public `/ready` remains `file-cas-single-host`. DEX public failed 7/1000 and Exchange public passed 294/400, so public zero-error and database cutover gates remain open |
| Shared | Wallet/Auth consumption without private-key custody | partial / accepted per product at older sources | No finance-suite code may redefine central Wallet registry or signer behavior; only versioned handoff/test vectors are permitted |

## Mandatory user-action boundary

Every financial write must follow `authoritative quote or order preview → source/fee/risk/slippage disclosure → exact Wallet-bound intent → explicit confirmation → idempotent submission → terminal or unknown-state reconciliation`. A timeout is never reported as success. Private keys and seed phrases never enter finance-suite services or logs.

## Language and accessibility baseline

Default locale is English. Required runtime locales are English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic with real RTL, and Bahasa Indonesia. Keyboard, screen reader, focus, contrast, dynamic type, reduced motion, light/dark and 390 px layouts are release gates.
