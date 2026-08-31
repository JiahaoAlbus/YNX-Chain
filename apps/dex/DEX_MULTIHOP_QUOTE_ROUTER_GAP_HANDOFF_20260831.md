# DEX multi-hop quote checkpoint — 2026-08-31

## Implemented source behavior

The DEX quote engine now discovers deterministic routes of up to three committed chain-native CPMM pools. It rejects repeated pools and repeated assets, calculates each hop from the exact committed reserves and fee, derives exact-input/exact-output bounds with integer arithmetic, exposes the complete route and per-hop fee breakdown, and retains a route only when each hop produces a positive valid amount.

Every returned hop now carries its exact committed pool-state anchor: block height, update time, transaction hash and audit hash. The quote exposes the ordered audit-hash set plus the earliest and latest committed block across the route, and the review UI shows the complete anchor list. This remains evidence for a read-only quote only; a future atomic routed action must bind these same ordered values before Wallet signing can be enabled.

## Execution boundary

The currently accepted Wallet action contract binds one `poolId` per DEX swap action. Therefore:

- a one-hop quote remains eligible for the existing separately confirmed Wallet action; and
- a two- or three-hop quote is visibly marked **quote only** and its signing button is disabled.

No browser-side route is split into multiple swaps, no intermediate asset is fabricated, and no Wallet signature is requested for a route that the current chain-native action contract cannot bind atomically.

## Required Central/Chain Core integration

To promote multi-hop quotes to executable Testnet swaps, Chain Core must publish and attestate one atomic routed action contract with all of: ordered pool IDs, ordered asset path, input/output mode, minimum output or maximum input, pool state/version binding for every hop, account nonce, deadline, route digest, and a single receipt that proves all hop events and the final transaction hash. The DEX Wallet adapter can then consume that shared contract; this checkpoint does not create a second router protocol.

## Local verification and truth

- `npm --prefix apps/dex test` — 30 tests passed, including multi-hop exact-input, exact-output, state-anchor propagation, cycle rejection, and UI signing-disable coverage.
- `npm --prefix apps/dex run verify:canonical-authorize` — passed; source scan uses YNX Testnet `6423` / `0x1917` and rejects legacy chain identifiers.
- `npm --prefix apps/dex run build` — passed.

No public deployment, Wallet approval, signature, swap, liquidity operation, or transaction occurred. The existing public DEX is not source-bound to this checkpoint.
