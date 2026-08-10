# YNXT Macro Stress Model v1

Status: seeded Monte Carlo and multi-agent accounting model implemented and tested locally. Results are sensitivity outputs from supplied assumptions, not forecasts, reserve attestations, live telemetry, prices, APY, governance approval, or mainnet readiness.

## Coverage

The model runs exactly Low, Medium, and High usage scenarios over a bounded number of years and iterations. A fixed seed makes every run reproducible. It keeps separate ledgers for validators, providers, Treasury, stable reserve/supply, liquidity incentives, Sybil leakage, governance attacks, Bridge failures, and Oracle failures.

Each scenario reports minimum, p10, p50, p90, and maximum for:

- issuance, fee burn, explicit service burn, closing and net supply;
- annualized network revenue, validator net economics, and provider revenue;
- Treasury closing balance, shortfall and bounded runway;
- stable reserve ratio and potential undercollateralization;
- liquidity-incentive cost and the portion captured by Sybil abuse;
- governance, Bridge, and Oracle loss;
- mainnet-readiness gate pass rate.

The macro accounting policy assigns gross fees among burn, validator, provider, protocol, and Treasury buckets so they sum to 100%. Issuance is separately assigned to validator security, public goods, and grants. Burn is supply destruction and never revenue. These candidate macro shares are sensitivity assumptions and do not replace the per-lane model or current fixed-fee consensus.

## Failure and readiness semantics

Random events are sampled in basis points from the supplied probabilities. Governance and Bridge losses affect only Treasury; Oracle loss affects only stable reserve. Liquidity incentives are an explicit Treasury expense, while Sybil leakage records ineffective subsidy rather than inventing extra revenue or volume.

A trial passes the candidate gate only when validator net economics are non-negative, Treasury has no shortfall and at least 12 months of simple obligation coverage, stable reserve remains at least 100%, Sybil leakage is within policy, and no modeled governance/Bridge/Oracle loss occurred. The pass rate is diagnostic only. `forecast=false` and `mainnetReady=false` are immutable output boundaries.

The model does not yet prove production scale, correlated-event calibration, market-price effects, legal reserve treatment, custody, external data quality, or deployment. Those require independent datasets and reviews before the assumptions can be calibrated.

## Reproduce

```bash
make macro-stress-check
go run ./cmd/ynx-macro-stress-sim -input economics/examples/macro-stress.json
```

The verification checks deterministic replay, ordered percentile summaries, monotonic usage/revenue sensitivity, issuance/burn/supply accounting, validator and Treasury economics, stable-reserve stress, liquidity/Sybil cost, governance/Bridge/Oracle event coverage, arithmetic bounds, and truthful readiness fields.
