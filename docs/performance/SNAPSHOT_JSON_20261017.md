# Snapshot JSON: remove the intermediate compact copy

The persistent Commit path previously called `json.MarshalIndent`, then appended
one newline. Go's implementation first makes an owned copy of the compact JSON,
then allocates the indented output. The compact copy is immediately discarded.

The candidate sends `json.Encoder` output directly into a writer backed by
`json.Indent` and an owned `bytes.Buffer`. This removes the extra compact copy.
The standard encoder supplies the final newline, which Indent preserves. HTML
escaping, map ordering, time encoding, indentation and the final bytes remain
unchanged. Encoding still completes before creating the temporary file. State
validation, private-file permissions, write, file Sync, close, atomic rename and
directory Sync retain their existing order and error paths.

The writer expects the current Go encoder's one complete-value Write. It rejects
multiple fragments or invalid JSON instead of producing a partial snapshot.
Compatibility tests cover that condition so a future Go implementation change
cannot silently corrupt persistence. The adapter uses standard encoding/json
formatting; it does not implement a separate JSON parser or use unsafe aliases.

## Compatibility and recovery

Tests compare exact bytes with the original formatter for nil and empty
collections, sorted map keys, control characters, HTML characters, Unicode,
invalid UTF-8, long fields, fractional timestamps and non-UTC offsets. They also
verify that a later encoding cannot overwrite an earlier returned payload and
that invalid timestamps return an error with no payload.

The complete consensus test binary passed from its correct package directory
(tool wall time 0.808 seconds), including existing mixed-transaction, rollback,
durable restart, replay and abrupt-exit tests. An earlier invocation from the
repository root failed four relative fixture lookups. A subsequent `go test`
invocation could not fork its compiler due to resource unavailability. Neither
attempt is counted as a pass; both are recorded in the evidence. The already
compiled final candidate then passed the ordinary suite from `internal/consensus`.

Six real 1,024-transfer application runs produced identical per-block AppHashes
and final snapshot SHA-256 across baseline and candidate. Each run retained all
1,024 fee events and verified full state after durable restart and replay
rejection. This covers application persistence, not multi-node crash recovery.

## Same-condition comparison

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10; build `-p 1`.
Baseline runtime is `2248efcf8d13266fa01e294c985dca7f0461999d`, using its retained
`audit-after.test` binary. The candidate is `json-after.test`; both execute the
unchanged application performance probe. Only the candidate contains the new JSON
compatibility tests. Binary and source digests, complete raw output and all
application reports are retained in
[the evidence JSON](evidence/snapshot-json-20261017.json).

The encoding microbenchmark uses the existing real 1,024-transfer snapshot,
checks exact output before timing, and excludes file reading/parsing from timing.
Both implementations are measured in the candidate binary. Order is legacy,
candidate, candidate, legacy, legacy, candidate; 200 ms each.

| JSON encoding, median of three | Legacy | Candidate |
| --- | ---: | ---: |
| ns/op | 2,997,763 | 2,838,356 |
| allocated bytes/op | 1,969,094 | 1,338,334 |
| allocations/op | 2,053 | 2,052 |

Encoding allocations decreased 32.0%. The observed median time decreased 5.3%,
but the ranges narrowly overlap; this is a short CPU/encoding observation, not
an overall throughput or finality result.

The application run order was before, after, after, before, before, after. Every
invocation starts from the same migration with 256 accounts, 64 senders,
64 transactions/block and 16 blocks. Offline signing and restart verification
remain excluded from pipeline timing.

| Application run metric, median of three | Before | After |
| --- | ---: | ---: |
| allocated bytes | 298,850,576 | 292,837,808 |
| JSON encoding across 16 commits, ms | 31.383 | 29.910 |
| whole durable Commit, ms | 346.095 | 416.960 |
| application pipeline tx/s | 1,160.16 | 1,049.63 |
| File Sync total, ms | 169.565 | 175.021 |
| Directory Sync total, ms | 130.172 | 172.503 |

The full application pipeline saves 6,012,768 allocated bytes (2.01%). Its total
TPS median decreased in this sample. Baseline throughput ranged 732.68–1,170.84,
candidate 1,020.73–1,156.49; the ranges overlap. Sync times also varied. These
observations establish allocation reduction and byte compatibility, not a stable
throughput improvement or a causal explanation of the whole-Commit difference.

## Reproduction and next gate

From this worktree, run the retained candidate (substitute `audit-after.test` for
the application baseline):

```sh
env GOMAXPROCS=1 YNX_CHAIN_ENCODING_STATE="$PWD/artifacts/chain-performance-20261017/abci-run-1234288681/state.json" \
  nice -n 10 ./artifacts/chain-performance-20261017/json-after.test \
  -test.run '^TestCommittedStateJSON' \
  -test.bench '^BenchmarkCommittedStateJSON$' -test.benchtime=200ms -test.count=1
env GOMAXPROCS=1 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/json-after.test \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

For the complete suite, invoke `go test -p 1 ./internal/consensus` with the same
resource settings, or run the retained binary from `internal/consensus` so relative
fixtures resolve correctly.

This change removes one whole-snapshot copy. It does not eliminate whole-history
validation, hashing, pretty JSON or snapshot rewriting. Those costs still need
growth measurements and a crash-safe incremental persistence design if they
prevent sustained throughput. No new nodes were started during this stage and
the frozen `440539fdf` network binaries were not overwritten. Root must schedule
any further four-node run. At least ten continuous minutes of valid business
traffic, backlog/errors/resources and actual inclusion/finality percentiles are
still required to establish the original 1,000 TPS target.
