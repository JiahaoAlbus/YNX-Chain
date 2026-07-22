# Quant Architecture, Asset Boundary, Fees, and Risks

Version: 0.1.0-candidate  
Last reviewed: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`  
Release class: research/simulation disclosure; no accepted production Quant integration

YNX Quant is not evidenced here as a deployed asset manager, broker, exchange, or autonomous trading service. Research, backtests, signals, and simulations are advisory outputs. They do not authorize orders or move assets.

## Layers

Data adapters ingest source-labeled market and chain data; research transforms produce versioned features; strategy code produces proposals; a risk engine checks limits; a simulator estimates outcomes and costs; an approval layer presents the exact action; and an execution adapter may submit only after canonical Wallet authorization under a valid mandate. Research and execution credentials are separated.

Each result identifies data source, as-of time, version, coverage, missing/stale state, assumptions, gross/net treatment, costs, and confidence where meaningful. Backtests record universe, survivorship treatment, corporate/token events, latency, fees, slippage, liquidity constraints, benchmark, drawdown, and out-of-sample period. They must not be presented as live PnL.

## Asset and permission boundary

Assets remain in the user's Wallet, exchange subaccount, approved strategy vault, custody provider, or approved contract. Quant services receive neither seed/private keys nor arbitrary withdrawal, owner-change, approval-expansion, or unrestricted contract-call rights. Mandates are asset-, venue-, action-, amount-, fee-, time-, product-, device-, and nonce-bound; immediately revocable; and audited.

Kill switch stops new proposals/submissions. Emergency exit cancels open orders where possible, revokes mandates, and returns or exposes withdrawal instructions for assets under user/vault control. It must disclose that venue outage, chain halt, lock period, insolvency, or contract failure can delay exit.

## Fees

Any gas, venue, provider, compute/data, subscription, management, or high-water-mark performance fee must be separately quoted and approved. No hidden spread, unrealized-profit fee, duplicated high-water-mark charge, wash trading, or fake volume is permitted. Reports separate gross return, each cost, net return, period, testnet/production status, drawdown, lock, and exit terms. No guarantee applies.

## Risks

Model error, overfitting, regime change, stale/incomplete data, execution latency, slippage, illiquidity, partial fill, leverage/liquidation, oracle/bridge failure, smart-contract defect, venue/custody insolvency, key compromise, regulatory restriction, and correlated strategies can cause total loss. AI explanations may be wrong and cannot alter risk limits or approve execution.

## Activation evidence

Required: accepted source commit and integration diff; provider terms; deterministic backtest vectors; contamination and look-ahead checks; sandbox/testnet execution and reconciliation; mandate replay/tamper/scope tests; kill-switch and emergency-exit drill; performance/capacity evidence; independent security and economic review; legal classification; and public artifact/source proof. Current status remains candidate.

## Change log

- 0.1.0-candidate: established non-custodial, non-autonomous and truthful performance boundaries.
