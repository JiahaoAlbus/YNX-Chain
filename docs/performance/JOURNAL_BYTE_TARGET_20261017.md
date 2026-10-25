# Byte-aware full-snapshot retention

The 16-record journal improved the application pipeline but the measured peak
application directory reached 10,760,192 bytes for only 1,024 transfers. Four
such directories exceeded Root's entire 32 MiB window budget before including
Comet/configuration. This change makes retention respond to encoded size as
well as record count; it does not raise any resource cap.

The opt-in snapshot journal now has a **4 MiB soft retention target**, retaining
the existing 16-record hard limit. Before appending a record that would exceed
the target, it atomically compacts to the latest complete record, provided more
than one record exists. A one-record store cannot shrink further, so it is not
rewritten merely to pretend the target is met. The subsequent append may
necessarily exceed the target for large snapshots. Every Commit still Syncs
the new full record. Every compaction still Syncs its temp file and directory.

No record format, AppHash, validation, rollback, recovery or readback contract
changes. Old journals remain readable and are compacted at a subsequent actual
save, not modified by a read. The default atomic-JSON backend is unchanged.
The already frozen `46645ba99` network candidate also remains unchanged.

## Same-condition measured tradeoff

Apple M4, Go 1.25.7 darwin/arm64, GOMAXPROCS=1, nice 10, shared external disk.
Both binaries use the same two-lock coordination, recovery Sync, state hash and
retained migration. The only runtime difference is the byte retention policy.
Each run has 32 blocks × 32 actual signed/executed/persisted transfers = 1,024.
Order is before/after/after/before/before/after, three samples each. Restart
state equality and committed nonce replay rejection must pass. Every block
AppHash and the final complete canonical snapshot match across all six runs.

| Median per 1,024-transfer run | Record-count policy | 4 MiB target |
| --- | ---: | ---: |
| Application pipeline transactions/s | 1,346.09 | 1,273.71 |
| Durable Commit total, ms | 555.561 | 603.774 |
| Compactions | 2 | 4 |
| Total allocated bytes | 101,100,912 | 101,174,320 |
| Final primary file bytes | 1,594,094 | 2,358,502 |

The lower footprint costs throughput: the median application rate declines
**5.38%**. It is not another speed improvement. The final file happens to be
larger because the compaction boundaries moved; final size is not peak size.

The separate instrumented peak probe samples file allocation after Sync but
before rename, at compact temp Sync while both files exist, and after each
Commit. Its timing is not part of the throughput comparison. The target's four
compact samples account for 4,276,224 / 4,513,792 / 4,419,584 / 4,374,528 bytes.
Peak application-directory accounting drops from **10,760,192 to 4,513,792
bytes (58.05%)**. Accounting uses `max(size, st_blocks * 512)` and includes both
fixed lock files; physical block metadata was available.

Four application directories at that peak would account for 18,055,168 bytes.
This is not a measured four-node resource result and excludes Comet DB,
validator/migration files and process logs. No claim of fitting the full 32 MiB
window or sustaining 1,000 effective network transactions/s is made.

The soft target excludes the compaction temp copy and is not a hard disk cap.
For newly written stores, if F bounds each serialized frame and B is the target,
retention can require roughly `max(B, 2F) + F` during compaction. A previously
larger journal can require more during its first compaction. The unchanged
32 MiB payload ceiling also means this backend cannot by itself carry the
original ten-minute high-history goal. These limits are not hidden by the
smaller observed peak.

Raw application reports, binary identities, equality assertions, and the full
separate peak report are in
[the evidence JSON](evidence/journal-byte-target-20261017.json).
The previous peak source is retained in
[its final receipt](evidence/journal-storage-peaks-v2-20261017.json).

## Validation and reproducibility

The complete candidate consensus binary suite passed from its package cwd.
Focused safety tests passed, including existing abrupt exits, damaged/torn
records, writer conflict, readback wait and state-sync. A new actual-transfer
test forces byte-triggered compaction before the record-count limit, compares
complete canonical state with atomic JSON, and reopens after each block. A
separate tiny-target test proves oversized snapshots remain an explicit soft
limit and do not cause pointless one-record compactions. Client/CLI checks run
against the source API; no network executable was replaced or node started.

Use retained `journal-readback-final.test` before and `journal-byte-target.test`
after, from `internal/consensus`, with `YNX_CHAIN_PERF=1`,
`YNX_CHAIN_PERF_BLOCKS=32`, `YNX_CHAIN_PERF_LAYOUT=snapshot-journal`, and the
same `YNX_CHAIN_PERF_DIR` migration. Select `^TestABCITransferPerformance$`.
Only the separate peak pass adds `YNX_CHAIN_PERF_STORAGE_PROBE=1`.

## Next substantive storage step

Byte-aware retention reduces the current peak; it does not remove repeated
full-history encoding, writes, or validation. The next storage implementation
should retain a canonical V13 checkpoint plus signed block execution deltas in
a separately versioned format. Each block still requires a complete checksummed
record and file Sync; periodic checkpoint replacement keeps file/directory
Sync and crash recovery. Replay must reconstruct identical complete state and
check each recorded post-state AppHash, including failed-transaction rollback.
State-sync replacement must also enter through an explicit checkpoint path.
The precise FinalizeBlock request fields must be taken from current execution
code, not inferred from the native-only benchmark.

For confirmation, whole-store reads must be grouped around a block observation
and matched to all its real transactions. A byte budget alone cannot make
per-transaction full-history scanning sustain 1,000/s. Shared evidence needs
explicit capture times/identities and the published-state durability gate,
without substituting cached metadata for current bytes or retrying UNKNOWN
submissions. Both storage and confirmation changes still need their own source
tests, same-input comparisons and fresh Root-scheduled network evidence.
