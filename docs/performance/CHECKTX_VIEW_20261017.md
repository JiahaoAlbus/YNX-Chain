# CheckTx: remove the redundant complete state clone

CheckTx used to clone every committed application record before calling
`applyTransaction`. The execution layer already isolates every supported
transaction before mutation: native transfers copy the account slice and the
touched lot maps, while application actions and Ethereum transactions clone
the complete execution state. The first CheckTx clone was redundant.

The candidate passes an immutable committed-state view under the existing read
lock. All 47 committed-field references are preserved. `cloneExecutionState`
now clones that same view through the existing value-clone function, preserving
the proposal and finalization paths' independent state. CheckTx retains the
read lock throughout signature verification, nonce/fee/balance checks and the
transaction-level clone. No signature or execution check is skipped. No mempool
nonce reservation or speculative acceptance is introduced.

## Isolation and equivalence

New tests compare CheckTx responses with isolated transaction execution and
assert that repeated checks leave the entire committed state unchanged. Native
cases cover valid execution, late lot/fee failure, malformed transactions, fee
recipient aliases and spare capacity in account/history slices. Eight concurrent
CheckTx calls per native case must also preserve the complete backing arrays.
This is a concurrent behavior test; the race detector was not run.

The existing mixed native/Ethereum/action/account-abstraction test now performs
the same response/state comparisons before proposal handling. Its subsequent
duplicate-nonce rejection, real execution, fee ordering and durable restart
assertions remain in place. The comparisons preserve each action's actual
admission result; they do not assume every mixed input is accepted by CheckTx.

The baseline passed the new focused isolation/mixed tests before runtime changes.
The complete final candidate test binary passed from `internal/consensus`,
including the existing rollback, restart, replay and abrupt-exit tests.

Six independent actual 1,024-transfer application probes produced identical
per-block AppHashes and final snapshot bytes across baseline and candidate.
Every run accepted and executed 1,024 valid signed transactions, retained all
fee records, performed the original durable write sequence, compared full state
after restart and rejected a committed replay.

## Same-condition measurements

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10; build `-p 1`.
Baseline runtime: `727065d7319af0d0d1b336b1fe4f2dccbb5fc386`. Both retained binaries
include identical new tests and the unchanged application performance probe.
Microbenchmark and application order: before, after, after, before, before,
after. The microbenchmark runs 200 ms per invocation and uses the existing real
1,024-transfer fixture, signing the next valid native nonce outside timing. It
also checks that the repeated admission calls did not mutate committed state.

| CheckTx microbenchmark, median of three | Before | After |
| --- | ---: | ---: |
| ns/op | 150,250 | 159,923 |
| allocated bytes/op | 127,589 | 33,785 |
| allocations/op | 590 | 70 |

Per-call allocation decreased 73.52%. The microbenchmark time median increased
6.44%; baseline observations ranged 143,546–612,119 ns/op, candidate
103,682–328,876 ns/op. These variable timings do not establish a stable per-call
latency improvement.

The application workload remains 256 seeded accounts, 64 senders,
64 transactions/block, 16 blocks, using the original identical migration.
Offline signing and restart verification remain outside pipeline timing.

| Application run metric, median of three | Before | After |
| --- | ---: | ---: |
| total allocated bytes | 292,839,488 | 197,006,176 |
| CheckTx total across 1,024 transactions, ms | 189.167 | 121.304 |
| whole durable Commit total, ms | 477.753 | 349.123 |
| application pipeline tx/s | 882.98 | 1,169.35 |

Whole-pipeline allocation decreased 32.73%, or 95,833,312 bytes. The CheckTx
stage median decreased 35.87% in these application runs. Throughput observations
ranged 621.20–1,007.24 before and 1,063.47–1,236.12 after. Commit timing also
changed substantially despite no persistence-code change, and the microbenchmark
timing direction differs. Report these as short observations on a shared host,
not sustained throughput or an isolated causal estimate of TPS improvement.

All raw runs, output, hardware/runtime fields, binary/source digests and state
equivalence results are in
[the evidence JSON](evidence/checktx-view-20261017.json).

## Remaining CPU work and network gate

A separate profiled candidate probe completed with the same 1,024 real transfers;
it is excluded from the six-run A/B. Its full CPU sample includes offline setup,
signing/encoding, application execution and restart. Of 790 ms sampled,
`SignedTransaction.Verify` had 380 ms cumulative and `applyTransaction` 320 ms;
these are overlapping call-tree costs, not additive or pipeline-only percentages.
The complete cumulative profile output and that run's report are retained.

Signature verification remains a material CPU cost. A subsequent optimization
can investigate reuse of already verified immutable transaction data, but it must
retain actual cryptographic verification on misses, bind any entry to the exact
bytes and chain, bound memory, and always recheck mutable state such as nonce and
balance. No such cache is introduced by this change. Whole-history snapshot
growth also remains unresolved.

No network nodes were started during this stage. The earlier frozen network
binaries are unchanged. A fresh Root-scheduled four-validator window is still
required for the 128-transaction paced probe and later longer runs. The original
target remains at least ten continuous minutes of 1,000 valid business commits/s,
with errors/backlog/resources and actual inclusion/finality P50/P95/P99. This
single-process application result does not establish that acceptance.

## Reproduction

From the performance worktree (substitute `before` for the baseline):

```sh
env GOMAXPROCS=1 YNX_CHAIN_CHECKTX_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/checktx-after.test \
  -test.run '^$' -test.bench '^BenchmarkCheckTxTransfer$' \
  -test.benchtime=200ms -test.count=1
env GOMAXPROCS=1 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/checktx-after.test \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

For the complete suite, run the retained binary from `internal/consensus` so all
relative fixtures resolve, or use `go test -p 1 ./internal/consensus` with the
same resource settings.
