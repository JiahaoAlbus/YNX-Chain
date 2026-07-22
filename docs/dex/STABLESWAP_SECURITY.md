# YNX StableSwap security and economic boundary

`YNXStableFactory` and `YNXStablePool` are a clean-room two-asset StableSwap candidate. No Curve source was copied: the prior license review remains authoritative, while this implementation uses the publicly described amplified-sum/product invariant and independent tests.

## Enforced pool boundary

Each pool immutably binds two ordered reviewed tokens, their decimal precision multipliers, amplification `A`, swap fee and protocol-fee share. Factory governance must create a pool, preventing an unreviewed actor from front-running the one-pool-per-pair registry with unsuitable immutable parameters. Token allow-list, fee recipient and governance changes retain a two-day public delay. Pool reserves cannot be seized or upgraded.

Balances are normalized to 18 decimals. Tokens above 18 decimals reject, and normalized balances above `1e36` reject before invariant arithmetic. The supported amplification range is `10..10000`; the disclosed swap fee is `1..100` BPS. These bounds are engineering limits, not evidence that a pair is economically stable.

Swaps solve the two-asset invariant iteratively and fail if convergence or the invariant check fails. Exact-output inversion is rounded upward and checked for minimal executable input. Protocol fees are accrued separately from LP reserves. Successful swaps cannot decrease `D`; failed slippage, taxed-token, reentrant-token or arithmetic paths revert atomically.

LP entry after initialization must remain within 10 BPS of the current reserve ratio. This intentionally excludes single-sided liquidity and avoids granting dilutionary shares for an imbalanced deposit. Exit is always proportional and permissionless; there is no queue, withdrawal administrator, insurance or guaranteed peg price.

## Oracle and depeg boundary

The cumulative observations are time-weighted reserve-balance ratios, not external prices or marginal StableSwap execution prices. They must be labelled as such. This candidate does not include a rate provider, ERC-4626 wrapper, rebasing-token support, external peg Oracle or automatic depeg pause. Reviewed token selection and LP Protection do not prove a peg.

Negative rebases fail closed at `sync`. Fee-on-transfer and rebasing assets are unsupported. Public Testnet deployment must publish token decimals, issuer/rate assumptions, amplification/fee rationale, source verification and depeg/exit runbook before any pool receives labelled test liquidity.

## Local evidence

`npm run dex:stable:test` covers 6/8/18-decimal normalization, direct and multi-hop exact input, minimal exact output, proportional LP entry/exit, immutable parameters, protocol fees, reserve-ratio accumulators, 64 independent BigInt differential vectors, 32 alternating stateful `D` invariants, reentrancy, taxed input, negative rebase, normalized overflow, parameter front-running and delayed governance. It prints local gas without extrapolating capacity.

`go test -race ./internal/dex ./cmd/ynx-dex-indexerd` covers typed Stable Factory discovery, creation-block fee reads, schema/cursor v4-to-v5 exact backups, factory substitution, Stable event projections, fee accounting and shared reorg infrastructure. `npm test --prefix sdk/dex` requires fresh confirmed RPC state and verifies typed decimal-normalized direct/multi-hop exact-input/output quotes. None of this is a public deployment, independent audit or real-asset stability proof.
