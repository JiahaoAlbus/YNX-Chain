# Commit phase measurement and fee-history optimization

2026-10-17, Asia/Shanghai. Continues performance checkpoint `6aa9ce8298e0a5774991a788a39a3070e80fceba` on `codex/chain-performance-20261017`.

The immutable fee journal reduced allocated bytes by **63.2%** and improved the median measured application pipeline rate from **1,418.4 to 1,544.3 transactions/s (+8.9%)** in six interleaved short runs. This is not a sustained network TPS result or a measurement of network inclusion/finality latency.

## Measured bottleneck

Commit now has opt-in timing of the actual validation, JSON encoding, file preparation, write, file sync, close, rename and directory sync. The normal nil recorder performs no clock reads or timing allocations. Every existing validation and durability operation remains in place.

The initial instrumented profile observed 352.9 ms of commit phases across 16 blocks: 112.4 ms file sync and 167.4 ms directory sync, versus 27.6 ms JSON encoding and 19.2 ms state validation. File/directory sync accounted for about 79% of the phase total in that run. The six subsequent comparisons had lower sync latency; the table below reports the medians of three per-run totals, rather than combining those unrelated windows.

Allocation profiling after the previous optimization still attributed 60.4% of allocated space to `cloneNativeTransferState` and 10.8% directly to `Application.cloneExecutionState`. Fee-history slice copies were repeated at admission and per attempted transaction. The immutable journal removes those copies without bypassing signatures, fee accounting or failure rollback.

## Change and safety

Execution state now holds an immutable committed fee slice plus an immutable linked chain of newly appended fee events. Copying transaction execution state shares those immutable values. A successful append allocates a new node; a failed transaction discards its branch. Block sealing materializes one new ordered fee slice into the unchanged committed state format.

All four append paths use the journal: native transfer, application action, Ethereum transfer and the inner UserOperation fee. No historical fee/audit event is removed. The full account/business-state rollback boundary for actions and Ethereum remains unchanged.

Validation:

- Full `internal/consensus` package PASS after the journal change.
- Journal tests cover empty/nil representation, append order, shared prefixes, spare-capacity sentinels, independently mutable materialized slices and cloned execution-state branches.
- A mixed block includes native/action/Ethereum/UserOperation transactions plus an invalid duplicate nonce. It checks proposal isolation, exact ordered fee records, expected balance/nonce changes, the rejected duplicate and byte-identical full state after persistent restart.
- The six performance runs each offered/accepted/executed 1,024 valid native transfers, with zero failures/rejections and 1,024 persisted fee records. All 16 AppHashes and final snapshot bytes match across all six runs and the first checkpoint's final snapshot.
- Existing signature/chain ID/replay, failed commit, fee audit and account-abstraction controls remain passing.

## Same-condition comparison

Apple M4, 10 logical CPUs, 24 GiB RAM; Go 1.25.7 darwin/arm64, `GOMAXPROCS=2`, `-p 1`, nice 10. Both binaries include identical Commit instrumentation and the same probe. The immutable journal is the application change being compared. Run order was **before, after, after, before, before, after**. Each independent invocation starts from the same isolated migration, with 256 accounts, 64 senders, 64 transfers/block and 16 blocks. Offline signing/setup and post-run restart verification are excluded from pipeline timing.

Before durations were 0.772, 0.704, 0.722 seconds; after durations were 0.663, 0.652, 0.669 seconds. This remains a short, bounded probe on a shared host/disk, not sustained throughput qualification.

| Metric (median of three runs) | Before | After |
| --- | ---: | ---: |
| Application pipeline tx/s | 1,418.41 | 1,544.30 |
| Allocated bytes | 916,647,344 | 336,908,856 |
| GC cycles | 192 | 80 |
| CheckTx total ms | 162.38 | 135.11 |
| PrepareProposal total ms | 117.19 | 104.77 |
| ProcessProposal total ms | 118.40 | 104.62 |
| FinalizeBlock total ms | 151.86 | 137.77 |
| Durable Commit total ms | 175.13 | 176.16 |

| Commit phase total ms (median per run) | Before | After |
| --- | ---: | ---: |
| State validation and hash checks | 18.80 | 18.28 |
| JSON encoding | 26.68 | 26.94 |
| Prepare private temp file | 2.24 | 2.22 |
| Write | 1.54 | 1.57 |
| File Sync | 64.51 | 55.74 |
| Close | 0.24 | 0.24 |
| Atomic rename | 3.84 | 4.12 |
| Directory Sync | 62.46 | 63.32 |

Each run writes 7,787,256 snapshot bytes across its 16 commits; the final snapshot remains 812,656 bytes. Phase medians need not sum to the median whole-Commit time because each median may come from a different run.

| Stage | Before P50/P95/P99 ms | After P50/P95/P99 ms |
| --- | --- | --- |
| CheckTx | 0.134 / 0.262 / 0.377 | 0.121 / 0.205 / 0.257 |
| PrepareProposal | 7.265 / 8.126 / 8.126 | 6.566 / 6.713 / 6.713 |
| ProcessProposal | 7.332 / 7.974 / 7.974 | 6.478 / 6.815 / 6.815 |
| FinalizeBlock | 9.343 / 11.121 / 11.121 | 8.612 / 9.709 / 9.709 |
| Durable Commit | 10.782 / 13.073 / 13.073 | 10.796 / 13.011 / 13.011 |

These are medians of per-run percentiles, not pooled percentiles. Each block-stage percentile has only 16 samples per run; P95 and P99 therefore select the maximum. All eight Commit phase percentiles, raw run records, source digests and retained binary digests are in [the evidence JSON](evidence/fee-journal-20261017.json).

## Reproduction

From the performance worktree, the retained `fee-before.test` and `fee-after.test` binaries reproduce the exact application comparison. For each label in `before after after before before after`:

```sh
env GOMAXPROCS=2 YNX_CHAIN_PERF=1 YNX_CHAIN_PERF_LABEL="manual-$label" \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 "./artifacts/chain-performance-20261017/fee-$label.test" \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

Rebuild/run the current candidate with:

```sh
env GOMAXPROCS=2 YNX_CHAIN_PERF=1 YNX_CHAIN_PERF_LABEL=current-source \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 go test -p 1 ./internal/consensus \
  -run '^TestABCITransferPerformance$' -count=1 -v -timeout=45s
env GOMAXPROCS=2 nice -n 10 go test -p 1 ./internal/consensus -count=1 -timeout=90s
```

## Remaining work

RPC reception, CometBFT mempool acceptance, valid network inclusion throughput and BFT finality latency are still separate unmeasured gates for this probe. The first time-limited four-node slot offered by Root was returned because the client/launcher was not yet ready. It was not used and cannot be reused after its deadline.

The next network step is a newly scheduled 32–64-transaction, loopback-only four-validator run using the bounded fixture/client/launcher. It must validate transaction inclusion proofs and the actual weighted commit signatures, retain rejection/timeout evidence, and verify all isolated process groups have exited. Its first run is a latency/correctness smoke, not a sustained 1,000 TPS qualification.

For sustained throughput, whole-state validation/JSON/snapshot rewriting still scales with accumulated history; the journal removes per-transaction history copies but does not solve that storage growth. Measure account-count/history scaling and real network behavior before choosing a transactional incremental storage change. File sync and consensus safety must remain intact.
