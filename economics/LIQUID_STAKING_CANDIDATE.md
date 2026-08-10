# Liquid Staking Candidate v1

Status: deterministic model implemented and tested locally. It is not a token, contract, chain feature, audited protocol, governance activation, installed artifact, or deployment.

## Accounting and lifecycle

The candidate represents staked YNXT backing with fungible shares. The exchange rate is derived from active backing divided by outstanding shares; it is not fixed at 1:1. Deposits mint shares at the current rate and allocate backing to an explicitly named validator subject to a 25% candidate allocation cap. Validator rewards increase backing and the exchange rate. Slashing reduces backing and the exchange rate.

A withdrawal request burns shares at the current rate and creates a fixed YNXT liability with a 21-epoch maturity. The queue remains available while deposits are paused. Early fulfillment fails without changing state. Mature fulfillment removes backing and clears exactly the matching liability. Every simulation step reports validator allocations, backing, share supply, queued liabilities, active backing, exchange rate, and solvency.

The model deliberately does not guarantee that queued claims survive severe slashing. A loss that makes backing smaller than pending liabilities is reported as insolvency; no hidden mint, reserve, insurance, rehypothecation, or administrator override repairs it.

## Secondary liquidity and controls

Secondary-market price and available shares are user-supplied observations only. They never alter protocol accounting or prove live liquidity. Candidate v1 flags a market discount above 15% of net asset value. It does not guarantee a peg, redemption price, APY, market maker, depth, or exit time.

The local policy limits each deposit and withdrawal request to 1,000,000 integer YNXT/share units. Pause blocks deposits but preserves queue creation and mature fulfillment. These values are review inputs, not active governance parameters.

## Activation gates

No contract or consensus implementation should activate until all of the following have direct evidence:

1. independent contract audit and remediation;
2. governance authority, parameter bounds, timelock, pause roles, and upgrade/rollback design;
3. economic stress coverage for queue saturation, correlated validator slashing, concentration, reward variance, rounding, liquidity disappearance, and market discount;
4. invariant/property tests and a testnet deployment with Explorer-visible share mint/burn, allocation, slash, queue, and redemption events;
5. custody, legal, tax, and user-risk review;
6. backup, migration, incident, emergency-exit, and public-solvency runbooks.

The input fields `contractAuditCompleted`, `governanceActivated`, and `secondaryLiquidityLive` are source-labelled scenario assertions. They cannot make output `mainnetReady` or `contractExecution` true.

## Reproduce

```bash
make liquid-staking-candidate-check
go run ./cmd/ynx-liquid-staking-sim -input economics/examples/liquid-staking-stress.json
```

The checked scenario covers deposit/share issuance, validator allocation, reward, share burn, queued redemption, pause rejection, slash loss, a 20% secondary-market discount, rejected early fulfillment, mature fulfillment, and step-by-step solvency.
