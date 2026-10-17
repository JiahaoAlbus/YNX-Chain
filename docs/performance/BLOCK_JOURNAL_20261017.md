# V2 checkpoint plus block execution journal

The V1 journal still writes a full history snapshot every block. A smaller
retention target reduced its peak but added synchronization/compaction cost.
V2 instead appends the complete signed block execution input and periodically
replaces the file with one canonical-state checkpoint. This is a separately
selected format and does not reinterpret or overwrite V1/atomic-JSON data.

## Execution and durability contract

`NewBlockJournaledApplication` / `-state-layout block-journal` select V2.
The default remains atomic JSON. FinalizeBlock captures an owned protobuf copy
of the entire request before executing that copy. This includes all request
metadata and failed transactions, not only successful native transfers. The
record binds prior/post AppHash and SHA-256 of the complete protobuf response,
including transaction results/events. Later caller mutations cannot change
the persisted request or expected response.

The magic/header binds this format and migration. Frames retain independent
length and payload checksums. Every successful Commit validates the pending
state, appends a complete record, Syncs and closes the file, then publishes the
committed state. The fixed writer/read locks, bounded read exclusion, stale-file
identity checks and poisoned-writer behavior are reused from V1.

After 16 tail blocks or a 4 MiB soft tail target, before the incoming append,
the previous committed state is written to a private checkpoint temp, Sync'd,
renamed atomically and directory-Sync'd. Both sides of the rename contain the
same previous acknowledged state. State-sync also enters through an explicit
checkpoint replacement and clears any pending request. No error removes the
original data or automatically resubmits an uncertain block/transaction.

Recovery validates the checkpoint and re-executes every complete tail request
through the same application code. It enforces exact next height, prior hash,
post-state hash and full response hash. FinalizeBlock's normal sealing includes
full state validation. Complete invalid records fail closed; only an incomplete
final frame is ignored. Recovery preserves the original tail bytes and Syncs
the recovered file before publishing Info. A subsequent actual save replaces
only the incomplete suffix. Complete records after a failed/unacknowledged call
are uncertain recovered outcomes, not invented successful acknowledgements.

Bounds are explicit: checkpoint frame at most 512 MiB, protobuf request at most
8 MiB, encoded delta at most 16 MiB, and at most 16 complete tail blocks. These
are backend limits, not permission to allocate that much in a scheduled window.
The larger checkpoint ceiling permits future history growth work, but neither
its resource fit nor ten-minute acceptance has been measured. Replay uses
current execution semantics; upgrades still require compatibility/migration
validation, especially because complete response hashes include logs/events.

## Same-condition real workload comparison

Apple M4, Go 1.25.7 macOS arm64, GOMAXPROCS=1, nice 10. The exact same test
binary runs both the V1 4 MiB policy and V2. Both use the same retained migration,
32 blocks × 32 actual signed transfers = 1,024, block times and transaction
order. Order is V1/V2/V2/V1/V1/V2, three repetitions each. Per-run full restart
state and nonce replay rejection are required. All 32 block AppHashes and all
final canonical snapshot bytes match across all six runs.

| Median per 1,024-transfer workload | V1 full-snapshot journal | V2 block journal |
| --- | ---: | ---: |
| Application pipeline transactions/s | 1,553.09 | 1,950.48 |
| Durable Commit total, ms | 470.164 | 340.617 |
| Total allocated bytes | 101,174,840 | 78,464,336 |
| Final primary file bytes | 2,358,502 | 641,617 |
| Checkpoint/compaction replacements | 4 | 1 |
| Restart/recovery, ms | 23.511 | 94.394 |

The application-rate median improves 25.6%, Commit time falls 27.6%, and
allocation falls 22.4%. All V2 runs write 579,584 delta payload bytes and
350,342 checkpoint payload bytes during the measured workload; frame headers
and initial setup are separate. Maintenance is included, not deferred beyond
the measurement. Full state hashing/validation is still performed.

V2 trades restart CPU for less steady-state write work: the final recovery
replays 16 blocks / 512 actual transactions instead of parsing only a latest
full snapshot. Constructor/setup and recovery are excluded from pipeline TPS
and separately reported. These are short application results, not sustained
four-node capacity or inclusion/finality latency.

In separate instrumented runs, peak owned application-directory accounting
including old+temp at Sync-before-rename is **4,513,792 bytes for V1 versus
716,800 bytes for V2** (84.1% lower). V2's compact sample contains four regular
files and 714,622 logical bytes; physical block metadata was available.
These probe timings are not used for the speed comparison. The scope excludes
migration/configuration, logs and Comet DB; it is not four-node budget acceptance.

All raw comparison/peak reports, source/test-binary hashes and equality
assertions are in [the evidence JSON](evidence/block-journal-20261017.json).
The performance binary was compiled from the recorded base plus the recorded
source hashes before this source commit; no clean network build is implied.

## Safety checks

The full candidate consensus test binary passed from its package cwd. Focused
V2 tests passed in 3.664 seconds; client/fixture suites passed in 1.613/0.457 s
and the CLI compiled. Coverage includes:

- 36 signed transfers, 36 failed duplicate nonces, 36 invalid envelopes, two
  checkpoint replacements, full canonical comparison with atomic JSON and
  reopen/replay rejection after every block.
- Exact request ownership across later height/time/transaction/header/proposer
  mutations and returned-response mutation.
- Mixed Native, Ethereum and signed AI permission/proposal/approval execution,
  with identical reconstructed application state. No external AI call is made.
- Truncated header/payload recovery; complete checksum corruption; valid outer
  checksums cannot hide wrong prior/post hash, response hash, height or protobuf.
- Actual state-sync restore to a V2 checkpoint and a later signed next nonce.
- Real `os.Exit(17)` after acknowledgement and at header write, payload write,
  append Sync, checkpoint Sync and checkpoint rename. Restart retains complete
  states/nonce fences. These are process-exit tests, not hardware power-loss tests.
- Failed persistence leaves committed memory unchanged and retains pending
  evidence; that writer cannot retry. Restart reconciles a complete uncertain
  delta. V1 and atomic readers reject V2 instead of silently converting it.

## Reproduce and remaining work

```sh
GOMAXPROCS=1 YNX_CHAIN_PERF=1 YNX_CHAIN_PERF_BLOCKS=32 \
  YNX_CHAIN_PERF_LAYOUT=block-journal \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 go test -p 1 ./internal/consensus \
  -run '^TestABCITransferPerformance$' -count=1 -v -timeout=45s
```

Use `snapshot-journal` for the same-binary comparator and keep the migration
and 32-block shape identical. Only the separate peak pass adds
`YNX_CHAIN_PERF_STORAGE_PROBE=1`.

The load client/runner do not yet accept V2; current readers fail closed on its
magic. V2 readback, incremental replay caching and per-block grouped confirmation
are next before any V2 network candidate. No V2 nodes started in this stage.
The separately authorized 64-transaction network run used the exact frozen
`46645ba99` V1 candidate, with its own report and evidence. It did not use this
code or the intervening byte-target change. Continuous ten-minute 1,000 valid
business commits/s and its full latency/error/resource gates remain unproven.
