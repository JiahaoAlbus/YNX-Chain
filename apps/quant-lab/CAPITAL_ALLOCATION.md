# Testnet capital allocation

No strategy receives capital solely because it has the highest backtest return.
Candidate scoring must use held-out and walk-forward return, drawdown, tail loss,
turnover, fee/funding/gas/slippage/MEV, liquidity capacity, parameter stability,
correlation/concentration, regime/depeg/delisting performance, recovery time,
reconciliation quality, provider reliability, and operational incidents.

Hard disqualifiers are leakage, missing provenance/license, unstable parameters,
capacity breach, stale oracle/data, unresolved reconciliation, failed revoke or
kill, missing Wallet mandate, hidden fees, unavailable emergency exit, and any
request for Wallet keys or withdrawals.

Allocation is bounded by Wallet-approved notional/position/loss/expiry limits and
independent Risk. Quant and AI can propose an allocation with evidence; neither
can choose a champion, change risk, sign a mandate, or deploy it. A human-approved
decision record must include rejected alternatives and uncertainty.

The current runtime can enforce bounded VaR and expected-shortfall observations
supplied at the pre-trade boundary, but it does not calculate or independently
source them. Portfolio allocation, VaR/ES modelling, Monte Carlo and automated
candidate ranking remain candidates and must not be inferred from backtest
metrics.
