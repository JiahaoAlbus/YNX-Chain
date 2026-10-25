# Remove the owned state-hash JSON copy

State validation and block sealing hash the complete canonical JSON document,
including fee history. `json.Marshal` returns an owned copy of its internal
encoding buffer. That copy is consumed immediately by SHA-256 and discarded.
The growing history therefore adds another large transient allocation at each
hash computation even after per-transaction fee/account copies were removed.

The new encoder hashes the borrowed `json.Encoder` write buffer directly. It
excludes exactly the encoder's final framing newline, preserving
`SHA-256(json.Marshal(document))`. The existing document field order, domain,
version, JSON escaping, map ordering, nil/empty behavior and state format remain
unchanged. The writer fails if the encoder stops writing one complete,
newline-framed value. Encoding errors return no hash. This is not a new hash
scheme, cached state validation, incremental history hash or streaming JSON
encoder: Go still constructs the entire compact JSON internally.

## Same real snapshot, operation-level comparison

Apple M4, Go 1.25.7 darwin/arm64, GOMAXPROCS=1, nice 10, Go -p 1.
The retained actual 1,024-transfer snapshot is 812,656 bytes. Each candidate
must reproduce its original AppHash before timing. Three 150 ms benchmark
samples per implementation:

| State-hash operation | Old Marshal | Borrowed encoder |
| --- | ---: | ---: |
| Median ns/op | 848,039 | 764,852 |
| Median allocated bytes/op | 707,622 | 76,988 |
| Allocations/op | 2,053 | 2,055 |

Allocated bytes fall 89.1%; the two extra small allocations belong to the writer
and hash state. This is one operation, not effective business TPS.

## Same-fixture actual application comparison

The baseline is the retained sparse-native candidate binary built from
`aa121ecc1`. The new candidate was compiled from base `98c2a2c44` plus exactly
the recorded hash-source edits. Candidate source and both binary SHA-256 values
are retained in the evidence. This test build was made before the source commit;
it is not presented as a clean committed network executable.

Six runs use order before/after/after/before/before/after and the same retained
migration and transaction fixture: 256 funded accounts, 64 senders, 16 blocks of
64 real signed transfers, GOMAXPROCS=1. Each performs CheckTx, proposal prepare
and process, actual execution, eight-phase durable Commit, full-state restart
comparison and committed nonce replay rejection. All 16 block hashes and final
snapshot bytes match exactly across all six runs.

| Median per 1,024-transfer run | Before | After |
| --- | ---: | ---: |
| Total allocated bytes | 83,598,088 | 65,565,984 |
| Application pipeline transactions/s | 1,745.41 | 1,723.00 |
| Durable Commit total, ms | 413.202 | 411.480 |
| Validation/hash total, ms | 18.529 | 17.693 |
| Snapshot JSON total, ms | 32.130 | 29.976 |
| File Sync total, ms | 184.696 | 190.612 |
| Directory Sync total, ms | 166.991 | 164.992 |

The consistent benefit is **21.57% less total allocation**. Whole application
throughput did not improve in these measurements; the ranges overlap and the
median is slightly lower. No speed gain is claimed. File/directory sync remains
about 85–86% of Commit time on the shared external boot filesystem. Per-phase
medians need not sum to the median total. No durability operation was removed,
batched or skipped. Fresh admission found 69,490,352,128 bytes free; these
bounded isolated tests did not start a node or listener.

Full candidate consensus tests passed from the package directory. Focused tests
cover exact canonical hashes with historical version/domain values, nil/empty
collections, map ordering, HTML/control/Unicode/invalid UTF-8 escaping, timestamp
offsets, later encoding ownership, invalid timestamps and encoder framing.
The existing broader suite exercises application paths and persisted-state
migrations; the real transaction comparison checks complete final state too.

Raw operation samples, all six application reports, source/binary identities,
phase timings and equality assertions are in
[the evidence JSON](evidence/hash-json-abci-20261017.json).

## Reproduce

```sh
GOMAXPROCS=1 YNX_CHAIN_ENCODING_STATE="$PWD/artifacts/chain-performance-20261017/abci-run-1234288681/state.json" \
  nice -n 10 go test -p 1 ./internal/consensus -run '^$' \
  -bench '^BenchmarkCommittedStateHashJSON$' -benchtime=150ms -count=3
```

For application comparisons run the retained `native-delta-after.test` and
`hash-json-after.test` from `internal/consensus`, setting `YNX_CHAIN_PERF=1`,
`YNX_CHAIN_PERF_DIR` to the existing isolated artifact root, and selecting
`^TestABCITransferPerformance$`. Do not replace the retained migration or claim
these application rates as four-node consensus capacity.

The previously prepared sender-round network candidate still uses the old
frozen core, unchanged. This hash change has not been put into that candidate or
run on four nodes. Continuous ten-minute 1,000 valid business commits/s,
long-history snapshot/readback scaling and internal inclusion/finality timing
remain open. The source goal remains active.
