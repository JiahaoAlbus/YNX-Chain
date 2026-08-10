# Per-lane Fee Market Candidate v1

Status: deterministic model implemented and tested locally. Current consensus remains the authoritative fixed-fee policy; this candidate is not activated, integrated with Explorer, governance-approved, deployed, or a source of real fee/burn events.

## Independent lanes and base fee

Candidate v1 models `ai`, `contract`, `pay`, `resource`, `transfer`, and `trust` lanes independently. Each lane starts with a base fee of 10 integer YNXT units, targets 1,000 metered units per block, caps a block at 2,000 units, and changes by at most the EIP-1559-style `baseFee × utilizationDelta / target / 8` step. An over-target change has a minimum increment of one; every lane is clamped to its public minimum and maximum.

Congestion in one lane cannot raise another lane's fee. Transactions above capacity or below `base fee + service fee` are rejected and produce zero accounting values. The maximum priority fee is bounded by policy.

## Burn, revenue and sponsorship

For each accepted transaction:

```text
gross fee = base fee + effective priority fee + explicit service fee
gross fee = base-fee burn + service burn + validator + provider + protocol + Treasury
```

The candidate burns 100% of the base fee. AI, Pay, Resource, and Trust lanes apply an explicit service fee and burn 10% of that service component. Burn is supply destruction and is never revenue. The remaining priority fee and non-burn service fee use versioned lane-specific validator/provider/protocol/Treasury shares that sum to exactly 10,000 basis points; integer remainder goes to Treasury so every event reconciles exactly.

A sponsored transaction preserves the initiating `user` and separately records the `sponsor` as `payer`. Sponsorship changes only fee attribution; it cannot change the gross charge, create volume, conceal a spread, or convert burn into revenue. Every accepted or rejected candidate event has a deterministic ID and SHA-256 audit hash.

## Governance and activation boundary

The policy contains a seven-epoch candidate timelock and a 10% maximum parameter-change bound. Scenario fields describing governance or activation are user-supplied inputs and cannot set `consensusActive`, `governanceActivated`, or `explorerIntegrated` to true.

Consensus activation requires a versioned state migration, governance authority and timelock execution, wallet fee preview/approval, sponsor mandates and limits, per-lane metering consensus, proposer/provider settlement, supply invariant tests, rollback, Explorer/Billing event integration, load and abuse tests, an independent security review, and a public testnet drill. Until then the fixed-fee event ledger remains canonical.

## Reproduce

```bash
make fee-market-candidate-check
go run ./cmd/ynx-fee-market-sim -input economics/examples/fee-market-stress.json
```

The checked scenario covers lane-local congestion adjustment, an empty-block decrease, fee-cap rejection, capacity rejection, priority fee, service metering, separate burns, exact revenue splits, sponsored payer attribution, deterministic audit hashes, and whole-block reconciliation.
