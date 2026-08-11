# YNX concentrated-liquidity v1 — accounting-core freeze

Status: first bounded local candidate; not a pool deployment, swap engine, Router surface, audited protocol or public Release.

## Purpose

`YNXConcentratedLiquidityBook` freezes the first clean-room concentrated-liquidity state model before token custody or price movement is introduced. The slice proves deterministic tick/range accounting and fee-growth attribution at one immutable current tick while failing closed on every unsupported execution path.

## Immutable identity

- Pool kind: `ynx-concentrated-liquidity-book-v1`.
- Tokens must be non-zero and strictly ordered as `token0 < token1`.
- Fee tier is immutable, non-zero and at most 10,000 pips in this candidate namespace.
- Tick spacing is immutable and positive.
- The initial/current tick is immutable in this slice, must be spacing-aligned and remain within `[-887272, 887272]`.
- The deployer is the immutable accounting controller.

## Supported state transitions

- An owner may mint liquidity only to its own spacing-aligned `[tickLower, tickUpper)` range.
- An owner may burn no more than its own range liquidity.
- Lower ticks add positive liquidity net; upper ticks add negative liquidity net.
- `activeLiquidity` equals the sum of all position liquidity whose range contains the immutable current tick.
- The controller may record externally settled fee-accounting amounts only while active liquidity is non-zero.
- Owners may realize and clear their accounting units. `collectAccounting` performs no asset transfer and is not a withdrawal receipt.

## Fee-growth semantics

- Global fee growth uses Q128 fixed-point accounting.
- Tick initialization records outside-growth snapshots for future reviewed tick-crossing work, but those snapshots do not drive accounting while crossing is unsupported.
- With an immutable current tick, an active lower-inclusive/upper-exclusive range sees global growth and an inactive range sees zero growth.
- A newly created position snapshots current active-range growth and cannot claim historical fees.
- Existing positions accrue before any liquidity mutation.
- Global division rounds down. The immediately measurable global remainder is recorded as `globalRoundingDust0/1`.
- Per-position multiplication also rounds down. Therefore collected accounting may never exceed recorded fees; residual fractional units are not promoted into a public revenue claim.
- Cumulative recorded fees are capped at `uint128.max` per asset for this slice. Exceeding the cap fails closed.

## Security boundary

This candidate deliberately has:

- no swaps;
- no price movement or tick crossing;
- no token transfers or approvals;
- no callback entrypoint;
- no arbitrary recipient;
- no Oracle or rate-provider dependency;
- no Router, Quoter, Vault or Wallet integration;
- no fee-on-transfer, rebasing or ERC-777 compatibility claim;
- no public deployment or production-liquidity claim.

The contract exposes `supportsSwaps=false`, `supportsCallbacks=false` and `custodiesTokens=false`. Because it makes no token calls, malicious token callbacks cannot enter this slice. A later custody-enabled pool must add exact balance-delta checks, callback payment verification, reentrancy protection, taxed-token rejection and negative-rebase failure behavior before any deployment claim.

## Required invariants

1. `activeLiquidity` equals the model sum of all active positions after every mint and burn.
2. Tick gross liquidity equals the sum of all positions touching that boundary.
3. Tick net liquidity equals lower additions minus upper removals.
4. Position liquidity never underflows and active/tick liquidity never overflows.
5. Inactive ranges accrue zero fees while the current tick remains immutable.
6. New positions cannot claim fees recorded before their creation.
7. For exact-divisibility vectors, the sum collected by active positions equals the recorded fee amount.
8. For arbitrary vectors, collected accounting plus explicit rounding loss never exceeds recorded fees.
9. Unauthorized fee recording, zero active liquidity, invalid ranges, invalid fee tiers and invalid token ordering revert atomically.
10. Token balances of the accounting book remain zero throughout the test suite.

## Deferred slices

Before this can become a full concentrated-liquidity pool, separate reviewed slices must implement and test:

1. square-root price representation and bounded tick math;
2. exact-input and exact-output swap steps with explicit rounding direction;
3. initialized-tick traversal and liquidity-net crossing;
4. price-limit and zero-liquidity failure behavior;
5. callback payment verification and reentrancy rejection;
6. real token custody with exact balance deltas and malicious-token boundaries;
7. Factory governance for reviewed fee tiers and spacing;
8. Router/Quoter/SDK/Indexer/PWA integration;
9. differential, stateful invariant, fuzz, gas, migration, restore and Testnet evidence;
10. independent audit and immutable Release evidence.

No deferred item is implied by this accounting-core candidate.
