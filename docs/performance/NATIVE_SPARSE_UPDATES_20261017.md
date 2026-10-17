# Native execution: sparse immutable account and lot updates

The preceding scale probes showed that each transfer copied the entire account
slice and both hot receiver/fee lot maps. The candidate instead retains immutable
base accounts and records only changed account/lot paths in private AVL indexes.
Both indexes are transient execution data, not a new database or state format.

## Semantics and boundaries

Native lookup first reads the current sparse account version, then the sorted
base table. Lot lookup similarly overlays the immutable base map. Transfers update
at most three distinct local account records and publish their immutable paths
only after both amount and fee movement succeed. Sender/receiver fee aliases use
the same local record, preserving original pointer-alias semantics.

Lot spending still enumerates the sender's effective lot IDs in the original
dictionary order. Zero-valued lot keys remain present: the old mover retains
them, and dropping them would change canonical state/AppHash. Recipient/fee maps
do not need full copies merely to credit one lot. Older roots and sibling
transaction branches never acquire newer writes.

Before an application action or Ethereum transaction, the existing full clone
materializes all native updates into independent canonical account/lot maps.
Block sealing does the same. Private update roots are then absent from the new
full execution state or committed DTO. Committed-state version, hash document,
JSON bytes, signatures, nonce/balance/fee/resource checks, full validation and
durable write/Sync/rename/Sync are unchanged. CheckTx still checks the committed
next nonce, without speculative reservation.

## Verification

- 3,000 randomized index updates check ordering, heights and AVL balance. Saved
  historical roots must retain their original values.
- 400 native sequence steps compare canonical accounts/fees, results and exact
  rejection reasons with the frozen `8a57bca88` native implementation. Cases
  include newly created accounts becoming senders, fee aliases, invalid nonces,
  insufficient balance, sibling branches and intermittent full-clone boundaries.
- 64 actual signing keys transfer twice into shared recipient/fee records. The
  second round fully spends every sender and checks zero-lot retention, growing
  lot indexes, retained old roots and materialized map ownership.
- A late fee-lot failure from an already nonempty sparse version must leave the
  prior root unchanged. Existing partial amount/fee failure, fee-alias,
  CheckTx spare-capacity/concurrency, mixed native/Ethereum/action/AA and durable
  restart/replay/abrupt-exit tests remain active.

The complete final candidate consensus suite passed. No race-detector run is
claimed. One existing isolation test now inspects the fully materialized
execution state rather than the new private base-array representation; its
balance, lot, nonce, supply, fee and sibling-isolation assertions remain.

Six actual 1,024-transfer application probes produced **identical per-block
AppHashes and final snapshot bytes** before/after. Every candidate still reports
1,024 successful actual static signature verifications and 3,072 reuse hits;
all transactions execute, persist and survive full-state restart comparison,
with committed replay rejected.

## Same-condition structural comparison

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10; build `-p 1`.
Retained baseline: `account-hot-lots-before.test`, runtime core `2f446351f`,
captured with the `8a57bca88` benchmarks. Candidate: `native-delta-after.test`.
Both run the unchanged account/hot-lot benchmarks. Each is a synthetic table
execution cost with primed static verification, not business TPS or persistence.
Order: before, after, after, before, before, after; 100 ms per sub-benchmark.

| Accounts, small lot maps | Before ns/op / bytes/op | After ns/op / bytes/op |
| ---: | ---: | ---: |
| 256 | 8,046 / 26,400 | 3,717 / 2,016 |
| 2,048 | 32,923 / 182,052 | 3,755 / 2,016 |
| 8,192 | 120,137 / 722,730 | 3,751 / 2,016 |

| Receiver/fee lot count, 2,048 accounts | Before ns/op / bytes/op | After ns/op / bytes/op |
| ---: | ---: | ---: |
| 1 | 32,010 / 182,052 | 3,738 / 2,016 |
| 64 | 36,807 / 188,628 | 3,731 / 2,016 |
| 256 | 45,972 / 208,852 | 3,765 / 2,016 |
| 2,048 | 166,366 / 400,071 | 3,767 / 2,016 |

These benchmark branches start from the same base for each invocation. They do
not measure an indefinitely growing update tree or a whole large-population
network run. The sequence/fan-in tests exercise growing roots separately. Index
paths still cost logarithmic work; general multi-lot sender spending still sorts
the effective sender keys. Canonical materialization, hashing and persistence
still cost work proportional to state/history.

## Real application pipeline comparison

The unchanged actual fixture uses 256 seeded accounts, 64 senders,
64 transactions/block and 16 blocks, with the same migration and offline signing
excluded. Before/after invocation order is the same interleaved six-run order.
Medians of three independent runs:

| Metric | Before | After |
| --- | ---: | ---: |
| allocated bytes | 187,087,840 | 83,597,432 |
| CheckTx total ms | 119.468 | 112.727 |
| PrepareProposal total ms | 12.990 | 5.947 |
| ProcessProposal total ms | 13.525 | 6.819 |
| FinalizeBlock total ms | 46.235 | 37.623 |
| durable Commit total ms | 312.222 | 367.692 |
| whole pipeline tx/s | 2,028.02 | 1,924.35 |

Allocation decreases 55.32%. Whole-pipeline TPS median decreases in this sample;
baseline range is 1,797.50–2,067.51, candidate 1,570.55–2,116.60. File Sync total
medians are 131.326/178.569 ms, directory Sync 130.882/134.915 ms. Those write
paths are unchanged, but their observed timing varies on the shared disk. Do
not claim a stable whole-pipeline or network TPS increase from these runs.

All original outputs, timing phases, counters, source/binary digests and hash
equality checks are in
[the evidence JSON](evidence/native-delta-20261017.json).

## Reproduction and remaining qualification

From the performance worktree:

```sh
env GOMAXPROCS=1 nice -n 10 \
  ./artifacts/chain-performance-20261017/native-delta-after.test \
  -test.run '^$' -test.bench '^BenchmarkNative(AccountScale|HotLots)$' \
  -test.benchtime=100ms -test.count=1
env GOMAXPROCS=1 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/native-delta-after.test \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

Use `account-hot-lots-before.test` for the application/structural baseline. Run the
candidate's complete ordinary suite from `internal/consensus` so fixtures resolve.

No nodes started for this change and no frozen network binary was overwritten.
The candidate still needs a new Root-scheduled network regression/load window.
The 256-count/short-duration driver, history input limits and full-snapshot
growth also remain barriers to the original ten-minute 1,000 business TPS gate.
This removes measured per-transaction copy amplification without redefining that
uncompleted goal.
