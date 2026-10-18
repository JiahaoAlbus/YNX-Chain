# Fee audit encoding optimization

Historical fee validation recomputes every V1 audit hash. Replace variadic
`fmt.Sprintf` with append-based text, decimal integer, boolean and UTC timestamp
encoding into a local buffer before the same SHA-256 operation. Larger fields
grow the buffer normally. The domain, field order, NUL separators, signed-number
format, RFC3339Nano timestamp and hex output remain unchanged. No history is
removed or trusted without recomputation.

The preceding structural CPU sample attributed 70 ms cumulative to
`feeEventAuditHash` and 30 ms cumulative to `fmt.Sprintf` overall, out of 1,670 ms
sampled across the whole structural probe. The formatter figure is not scoped
exclusively to fee validation. That probe includes GC, synthetic-history
construction, legacy copying, JSON, readback and comparisons; this is not a
validation-only profile or a claim that fee formatting is the largest overall
bottleneck. Snapshot JSON remains a substantial remaining cost.

## Compatibility and source checks

The test retains the original formatter as an independent compatibility oracle.
It checks 128 deterministic combinations including empty/long/Unicode/NUL text,
minimum and maximum signed integers, both boolean values, zero time, fractional
seconds and a non-UTC timezone. This covers the hash encoder's byte contract,
including inputs that higher-level validation would reject.

The full consensus suite passed in 1.832 seconds, including existing rollback,
mixed fee records, replay and abrupt-exit recovery tests. Six actual 1,024-transfer
application runs additionally produced identical per-block AppHashes and final
snapshot bytes across both source versions. All runs perform signature checks,
proposals, execution, durable Sync/rename/Sync, restart comparison and replay
rejection. These are application checks, not four-node acceptance.

## Same-condition measurements

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10; build `-p 1`.
Baseline runtime is `6fb54329045d3e9f34197ad116f74efcbf372b88`. Both retained test
binaries include the identical new compatibility test and microbenchmark.
Candidate changes only the runtime fee audit formatter. Source and binary SHA-256
digests and every raw run are in
[the evidence JSON](evidence/fee-audit-encoding-20261017.json).

Microbenchmark order: before, after, after, before, before, after, 200 ms each.
Median of three runs:

| Metric per fee audit hash | Before | After |
| --- | ---: | ---: |
| ns/op | 822.0 | 242.9 |
| allocated bytes/op | 840 | 128 |
| allocations/op | 12 | 2 |

The same order was used for six independent 1,024-transfer application runs,
reusing the original migration and workload (256 accounts, 64 senders,
64 transactions/block, 16 blocks). Offline signing and post-run restart checks
are excluded from pipeline timing. This is a separate current-host comparison;
do not compare its absolute throughput with earlier `GOMAXPROCS=2` results.

| Application run metric, median of three | Before | After |
| --- | ---: | ---: |
| allocated bytes | 313,181,352 | 298,851,680 |
| whole pipeline tx/s | 785.67 | 883.00 |
| Commit validation total ms | 27.658 | 27.462 |
| Commit JSON encoding total ms | 36.811 | 39.421 |
| whole durable Commit total ms | 457.558 | 364.326 |

Allocation decreased 4.58% across the real application pipeline. Throughput varied
widely on the shared host/disk: baseline 633.70–1,154.98 tx/s, candidate
785.70–952.45 tx/s. The throughput ranges overlap, and the small validation-stage
difference does not establish a stable overall throughput gain. Do not attribute
the observed Commit difference to this CPU-only change or claim 1,000 TPS from
these short application runs.

The measurement runner completed and persisted all six raw reports before its
summary printer failed on an incorrect stage key (`commit` versus
`durable_commit`). Summary values above were extracted from the saved reports;
the workloads were not rerun to replace that printer error.

Reproduce from this worktree using the retained before/after binaries:

```sh
env GOMAXPROCS=1 nice -n 10 \
  ./artifacts/chain-performance-20261017/audit-after.test \
  -test.run '^TestFeeAuditEncodingPreservesV1Hashes$' -test.v
env GOMAXPROCS=1 nice -n 10 \
  ./artifacts/chain-performance-20261017/audit-after.test \
  -test.run '^$' -test.bench '^BenchmarkFeeEventAuditHash$' \
  -test.benchtime=200ms -test.count=1
env GOMAXPROCS=1 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/audit-after.test \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

Use `audit-before.test` for the baseline under the same environment and workload.

## Root-scheduled 128-transaction window

This was a separate attempt using the previously frozen `440539fdf` network
binaries, not the audit-encoding candidate. All five binary hashes matched. Root
authorized only 128 transactions offered at 64/s, 1 GiB owned/control RSS,
32 MiB disk growth, at least 1 GiB free and a 425 MiB archive-recovery reserve.
The frozen launcher copy tightened its existing caps and added free-disk checks;
its other behavior and the five binaries were unchanged.

The first admission observed 1,568,165,888 bytes free, sufficient for the floor,
reserve and maximum disk delta. It refused before fixture/node/client startup:
the launcher directly inherited the shared Codex tool service as parent, and the
existing parent sampler counted its approximately 1.47 GB RSS along with the
launcher. Recorded total was 1,526,857,728 bytes, over the actual 1 GiB cap.
The pre-existing fixed error text says “2 GiB”; the receipt's configured cap is
1 GiB, and neither the message nor original receipt was edited to hide this.

The failed window ended after 747 ms with zero child records and zero data growth.
Runner PID 25735 was subsequently absent and all 12 test ports were rebindable.
Root then allowed one normal recovery using the original owned parent-shell
entry. That recovery was rejected by CreateProcess with `os error 35`, before
any shell, runner, handle, fresh-check script or node existed. There was no
further retry. The slot was explicitly returned for IDE work.

The shared tool service remained resident: a preceding read-only sample showed
1,354,288 KiB RSS and system memory free 44%. An owned-shell entry changes the
ownership scope; it does not reduce total host memory. This preceding sample is
not a successful recovery admission. The cause of os35 remains unknown.

The original failed receipt, strict launcher digest, fresh admission, terminal
checks and recovery rejection are preserved in
[the window evidence](evidence/four-node-paced-128-admission-20261017.json).
No transaction, throughput or latency result exists for this attempted window.
The earlier 32-transaction network smoke remains a separate valid observation.
Sustained 1,000 valid business TPS and load-qualified inclusion/finality latency
remain unproven; further network work requires a new Root-scheduled slot.
