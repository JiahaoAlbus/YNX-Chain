# YNX LP Protection security and economic boundary

`YNXProtectedDexFactory` creates constant-product pools that immutably bind one `YNXLPProtection` contract. The recovered v1 Factory remains a separate legacy deployment type; governance cannot attach a hook to an existing legacy pool or silently change its fee arithmetic.

## Enforced swap protection

Every protected swap calls `assessSwap` atomically before output. The policy verifies a nonzero, source-hashed, owner-reviewed on-chain Oracle observation and rejects future, stale or out-of-tolerance depeg data. Its bounded fee is the disclosed sum of base, volatility, input-depth, spot/Oracle divergence, directional-flow imbalance and recent-liquidity JIT components, capped by the public pool configuration. `ProtectionAssessed` emits base and every surcharge component in BPS, Oracle time and source hash. A source hash identifies the reviewed upstream configuration; it is not itself proof that an external market price is correct.

Directional toxic flow is a deterministic windowed imbalance measure, not an AI classifier. It tracks each side's cumulative input depth in BPS, caps both sides, charges same-side concentration and lets opposite flow reduce the imbalance. The JIT guard is an explicitly bounded fee for swaps shortly after mint/burn, not a claim that all JIT liquidity is malicious. Neither signal guarantees LVR or MEV elimination.

The pool computes output with the assessed fee, accounts the disclosed protocol share from that realized input fee and leaves the remainder in reserves for LPs. The strategy holds no assets and has no transfer or approval method. Failed slippage, malicious-token or invariant checks revert the Oracle assessment and flow update in the same transaction.

## Governance and exit

Per-pool configurations require the Factory's current governance and a two-day public delay. Fee bounds are base `<= 1%`, total `<= 20%`, with bounded multipliers, Oracle age, flow window and JIT interval. Pool/token identity and the Oracle address are immutable. Changing Oracle trust requires deploying a new versioned Factory rather than substituting a dependency under existing pools.

Oracle/depeg protection applies only to swaps. Proportional LP burn remains permissionless during stale Oracle or depeg conditions, so the protection layer cannot trap users. There is no exit queue, withdrawal administrator, guaranteed execution price, insurance fund or loss reimbursement in this candidate.

## Explicit limitations

- The Oracle adapter is an owner-reviewed dependency. Public Testnet deployment must publish its address, source verification, upstream providers, heartbeat, authorization, failure behavior and `sourceHash` derivation.
- Volatility and depeg values are supplied by that adapter; this contract verifies bounds, identity and freshness but does not reconstruct them from external venues.
- The toxic-flow and JIT measures are transparent heuristics. Sybil flow, cross-venue LVR, private order flow and builder behavior remain outside their proof boundary.
- There is no LVR-aware auction, inventory manager, range recommendation engine, incentive program, StableSwap, concentrated-liquidity or weighted-pool implementation yet.
- There is no independent audit, formal verification, public deployment or real-liquidity evidence.

## Local evidence

`npm run dex:lp-protection:test` covers component-level fee arithmetic, 32 differential/property vectors, 16 stateful invariant vectors, exact-input/output routing, fee caps, Oracle source binding, stale/invalid/depeg fail-closed behavior, flow-window reset, same-side versus offsetting flow, JIT expiry, delayed governance, taxed-token atomic rollback, protocol-fee accounting and permissionless LP exit during a depeg. It prints local Factory deployment, pool creation and protected-swap gas without extrapolating capacity.

`go test -race ./internal/dex ./cmd/ynx-dex-indexerd` covers all four LP Protection ABI shapes, fixed-schema persistence/API reads, exact v3-to-v4 backup migration, address substitution, fee-cap substitution, restart and shared confirmed-reorg removal. `npm test --prefix sdk/dex` covers strict source/freshness/schema parsing, exact pool/token/amount quote binding and post-confirmation component/realized-fee reconciliation. These are local deterministic tests, not live Oracle or public-chain evidence.
