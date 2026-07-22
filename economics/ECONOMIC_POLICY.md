# YNXT Economic Policy Candidate v1

Status: implemented and tested locally as a simulation candidate. It is not integrated into consensus, deployed, governance-approved, or a mainnet policy.

## Authority and units

The policy is versioned in `internal/economics`. Simulation inputs are user-supplied estimates with an explicit `asOf`; outputs identify that source and never claim live chain authority. All ratios use basis points and all YNXT values use the current integer testnet accounting unit. Migration to 18-decimal base units is required before consensus adoption.

## Dynamic issuance

Annual issuance begins at the public floor and can rise when the staked ratio is below target, the validator count is below the minimum, or operator concentration exceeds its bound. Network fees reduce the security subsidy according to the revenue-offset parameter. The result is clamped to the public annual floor and ceiling.

The candidate has no hard supply cap, but it does have an annual issuance ceiling, an annual parameter-change limit, a seven-day governance timelock, and deterministic integer calculations. An emergency action may pause future policy activation; it may not mint outside the formula or rewrite prior accounting.

## Fee and burn separation

Base-fee burn destroys supply and is never revenue. Explicit service burn is separately identified. Only the non-burn remainder may be allocated among validators, providers, protocol service revenue, and Treasury; the four shares must sum to exactly 100%.

The current chain runtime still charges a fixed 1 YNXT transfer fee and credits the proposer. The separately versioned model in `FEE_MARKET_CANDIDATE.md` covers per-lane base fees, priority fees, sponsored-fee attribution, explicit service metering, burn and allocation conservation, but remains simulation-only until a governed consensus migration and Explorer-verifiable activation.

## Public candidate defaults

| Parameter | Value |
| --- | ---: |
| Annual issuance floor / ceiling | 1% / 8% |
| Target staked ratio | 67% |
| Minimum validator count | 32 |
| Maximum largest-operator concentration | 20% |
| Base-fee burn | 100% |
| Non-burn validator/provider/protocol/Treasury split | 70% / 10% / 10% / 10% |
| Governance timelock | 7 days |
| Maximum annual parameter delta | 1 percentage point |

These are review parameters, not promises. No APY, token price, fee volume, liquidity, peg, reserve, or Treasury return is guaranteed.

## Reproduce

```bash
go run ./cmd/ynx-economics-sim -input economics/examples/medium-usage.json
go test ./internal/economics ./cmd/ynx-economics-sim
```

The separately bounded liquid-staking stress model is documented in `LIQUID_STAKING_CANDIDATE.md`; it is not part of the issuance policy or active consensus.
