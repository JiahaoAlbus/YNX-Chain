# Amortize directory sync with a bounded snapshot journal

The preceding JSON/hash optimization reduced allocation but did not improve
whole application throughput. Actual Commit timing still attributed most time
to file Sync plus directory Sync. This change keeps a file Sync for every
successful Commit and amortizes atomic replacement/directory Sync over periodic
compactions. It is explicitly selected; the default atomic-JSON path and all
previous frozen network executables remain unchanged.

## Layout and recovery

`NewJournaledApplication` and the ABCI flag `-state-layout snapshot-journal`
select an incompatible new file format. No existing JSON state is converted.
Each record contains the complete unchanged canonical pretty JSON snapshot,
a bounded length, a separate length checksum, and a checksum covering length
and payload. The file header binds the migration state hash. SHA-256 AppHash,
state version, signatures, fees, nonce, execution and state validation remain
unchanged. Every save still calls full state validation and JSON encoding.

An append is acknowledged only after complete record write, file Sync and
close. At most 16 complete records are retained. Before the next append,
compaction copies the latest complete record to a private temp file, Syncs it,
atomically renames it and Syncs the directory. Both sides of that rename contain
the same latest acknowledged state. A stable separate advisory-lock inode
serializes writers across compaction; file identity and size also reject a
stale application instance. Locks are kernel-released, never deleted by recovery.
The layout is currently supported on macOS/Linux; other platforms fail closed.

Recovery scans checksummed complete records, enforces increasing heights and
fully validates the newest state. Only an incomplete final header/payload is
ignored. A complete bad checksum, invalid length/header, migration mismatch or
invalid state fails closed. Startup does not truncate the original file. The
next actual save truncates only the incomplete suffix before appending. A
persistence error retires that writer; pending state is not published and a
second Commit cannot silently retry. Restart may find a complete record from
an uncertain failed call, which must be reconciled, not resubmitted as new work.

The 32 MiB payload ceiling and 16-record ceiling bound this experimental layout.
It still encodes full history and temporarily retains many snapshots. It is
not a delta WAL, a solution to unbounded state growth, or a claim that large
four-node workloads fit Root's existing 32 MiB aggregate data budget.

## Same-condition real transaction comparison

Apple M4, 24 GiB RAM, macOS arm64, Go 1.25.7, GOMAXPROCS=1, nice 10.
Entry free workspace disk: 68,200,943,616 bytes. Both layouts use the exact
same test executable, migration, signatures, transaction order and block times.
The bounded probe uses **32 blocks × 32 transfers = 1,024 actual native
transactions**. This differs from older 16×64 reports; compare only the paired
rows here. The alternate block shape crosses two actual compaction boundaries.

Order is atomic/journal/journal/atomic/atomic/journal, three samples each. Each
run executes real CheckTx, PrepareProposal, ProcessProposal, FinalizeBlock and
durable Commit, then verifies complete restart state and nonce replay rejection.
All 32 per-block AppHashes and the entire final canonical state match across
all six runs. No node, RPC listener, mempool or BFT consensus starts.

| Median per 1,024-transfer run | Atomic JSON | Snapshot journal |
| --- | ---: | ---: |
| Application pipeline transactions/s | 963.93 | 1,441.82 |
| Durable Commit total, ms | 832.892 | 517.328 |
| Validation/hash, ms | 41.263 | 33.595 |
| Snapshot JSON encoding, ms | 71.363 | 56.482 |
| Append/snapshot file Sync, ms | 375.243 | 371.625 |
| Directory Sync, ms | 334.084 | included in maintenance |
| Journal maintenance including two compactions, ms | n/a | 47.811 |
| Total allocated bytes | 100,991,872 | 101,063,056 |
| Final primary store file bytes | 807,792 | 1,594,094 |

The median application rate improves **49.58%** and median Commit time falls
**37.89%** in this bounded comparison. Rates range 936.84–978.78/s for atomic
JSON and 1,371.48–1,444.28/s for the journal. Per-phase medians do not sum to
the median total. All naturally occurring GC/shared-host/IO variation remains
in the raw results. These are application results, not four-node effective
business TPS, inclusion latency, finality latency or sustained capacity.

For these 32 Commits the journal performs 32 append file Syncs plus two compact
file Syncs and two compact directory Syncs, versus 32 file and 32 directory
Syncs in the original path. Separate initial header/lock creation Syncs occur
during constructor/setup and are excluded from both workload timing windows.
Maintenance is included in the journal measurement, not deferred beyond it.

Allocation is essentially unchanged. The tradeoff is additional retained
snapshot bytes and extra copy IO during compaction. The final file size above
is not peak disk use; peak before compaction/temp replacement was not measured
in this comparison. Do not infer resource fit from final size. A future live
guard must still count all owned files and enforce its original limits.

## Safety evidence

The full candidate consensus binary suite passed from the package cwd. After
additional boundary tests, the final focused journal suite passed in 3.745 s;
full client/fixture suites passed in 1.024/0.488 s. The CLI compiles. Tests cover:

- 36 signed transfers plus 36 deliberately failed same-block duplicates,
  two compactions, byte-equal complete serialized state versus the old backend,
  reopen after every block and replay rejection. JSON-equivalent state is the
  comparison contract because existing persisted omitempty collections and
  timestamp locations do not retain in-memory nil/location representation.
- Partial final header/payload recovery, original bytes unchanged during read,
  safe tail replacement at the next real Commit, complete payload/header/length
  corruption, bounds, permissions, wrong migration and legacy format refusal.
- A stale writer and an already-held lock cannot overwrite current state.
  Injected failures after header/payload write, Sync, compact Sync and rename
  preserve in-memory committed state and forbid automatic retry.
- A real child exits with `os.Exit(17)` after an acknowledged Commit and at each
  of five persistence boundaries. Restart preserves complete state and nonce
  fences. A complete record observed after a pre-ACK exit is classified as an
  uncertain recovered outcome. Process exit is not hardware power-loss testing.
- Actual state-sync OfferSnapshot/LoadSnapshotChunk/ApplySnapshotChunk persists
  through this backend and survives restart with the source's complete state.

Private nil-by-default fault hooks are only reachable from package tests. No
runtime command or environment variable can turn them on. Interrupted temp
files are not treated as authoritative snapshots or removed by recovery.

Source and executable hashes, all six reports, phase samples, equality assertions
and qualifications are retained in
[the evidence JSON](evidence/snapshot-journal-abci-20261017.json).

## Reproduce and remaining work

```sh
GOMAXPROCS=1 YNX_CHAIN_PERF=1 YNX_CHAIN_PERF_BLOCKS=32 \
  YNX_CHAIN_PERF_LAYOUT=snapshot-journal \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 go test -p 1 ./internal/consensus \
  -run '^TestABCITransferPerformance$' -count=1 -v -timeout=45s
```

Use `YNX_CHAIN_PERF_LAYOUT=atomic-json` for its same-condition comparator; keep
the retained migration and 32-block shape identical. Normal tests/probes retain
the old 16×64/atomic defaults unless explicitly selected.

The network client still expects one JSON snapshot and therefore rejects this
journal format. Journal-aware bounded readback and stopped replay, peak disk
measurement and a newly reviewed small four-node candidate are next. Do not
activate the new CLI layout under an existing prepared network plan. In
particular the sender-round preparation `5409f1...` still pins old core aa121,
not this storage change. Any four-node run requires a new Root grant.

Continuous ten-minute 1,000 valid business commits/s remains unproven. Full
history encoding, retained journal size, the client's 16 MiB limit, continuous
account-pool scheduling and scalable confirmation observation remain open work.
