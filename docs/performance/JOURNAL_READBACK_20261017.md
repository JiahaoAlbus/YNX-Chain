# Journal readback and measured storage peaks

The snapshot-journal backend improved the isolated application pipeline, but
the old load client understood only one JSON snapshot. This change connects the
journal format to bounded client readback and offline replay. It also fixes two
live observation boundaries before preparing a network candidate.

## Durability and concurrency boundaries

A complete checksummed record can be visible before its writer's Sync returns.
Therefore framing/checksums alone cannot establish completed local durability.
The client now reads under a shared `.read.lock`, reopens the data file after
locking to follow compaction, and releases the lock after stable byte acquisition
and before validation/RPC waits. The writer holds the corresponding exclusive
lock through write/Sync/close. The read side never creates lock files or writes
state. Both full-file hashing and the unchanged 16 MiB input ceiling remain.

A separate `.lock` still excludes competing writers immediately. A legitimate
reader must not poison Commit by colliding with that nonblocking writer lock.
The writer instead waits for the reader lock for at most two seconds; a stuck
reader causes a bounded error with unchanged persisted/committed state. Normal
reader release allows that same in-progress Commit to succeed. The lock files
remain fixed inodes across atomic data compaction and are never deleted by
recovery. Read-lock release is idempotent.

Even after a failed write has released its lock, its complete record may remain
visible. A journal observation is only final after local `ABCIInfo` publishes
at least the selected snapshot's height, with equal-height AppHash agreement.
The application's committed view is published after successful persistence.
On restart, recovery now Syncs any selected complete record before publishing
its recovered height. This reconciles complete uncertain prior outcomes without
pretending the earlier call returned an ACK. It does not truncate the evidence.

Info RPC and local readback remain local evidence, not a cryptographic execution
proof or a same-height signed state root. Weighted commit signatures and the
transaction inclusion proof are independently verified as before. The new Info
query adds observation cost; it has not yet been profiled under network load.

## Format and reports

The shared pure decoder checks migration identity, every complete record's
length/checksum/height progression and the newest complete state's full
validation. Empty journals wait; complete corrupt records fail closed. An
incomplete suffix is explicit metadata, not silently repaired by an observer.
The parsed state owns its decoded data; the selected JSON view borrows only
the caller-owned input, never a writer's memory.

Schema-6 observations distinguish selected snapshot SHA-256 from complete store
SHA-256, and retain layout, complete journal bytes, incomplete-tail status and
published Info height/AppHash. Cache reuse still requires fresh hashing of the
entire current file. Metadata/state/index publication occurs together after
validation; cancellation does not mix a new digest with an old cached state.
Final counters and later-nonce admission both require the journal publication
gate. Ordinary atomic-JSON observations retain their existing behavior.

Stopped replay now decodes the selected complete journal snapshot, refuses a
torn suffix in a supposedly clean stopped window, and compares complete
canonical state across nodes. Store digests are retained separately. Independent
read-only blockstore verification and actual payload re-execution remain in
place. No new stopped four-node replay was performed in this source stage.

The runner adds explicit `--state-layout snapshot-journal`; default remains
atomic JSON, and only journal mode passes the new flag to ABCI children. This
preserves compatibility with old frozen default binaries. All 1 GiB RSS,
32 MiB data, 45+15-second, 10-second client, process/thread/log/disk caps remain
unchanged. Preparation still does not start a node or create a work directory.

## Actual storage peak probe

The previous comparison reported final file sizes, not peak data use. The
opt-in probe now samples regular owned files after file Sync but before rename,
after journal compact Sync while old and temp both exist, and after each Commit.
It uses `max(size, st_blocks * 512)`, matching the launcher's accounting.
The final probe uses the two-lock writer/read coordination and recovery Sync.

Both layouts execute the same real 1,024 transfers in 32 blocks of 32. All
per-block AppHashes match. These samples include probe overhead, so their timing
is **not** a new throughput A/B. File allocation metadata was available for all
samples on this macOS external APFS filesystem.

| Application run-directory data | Atomic JSON | Snapshot journal |
| --- | ---: | ---: |
| Sampled peak accounted bytes | 1,597,440 | 10,760,192 |
| Final primary file bytes | 807,792 | 1,594,094 |
| Journal compaction peak samples | n/a | 5,222,400 and 10,760,192 |

The application-directory scope excludes migration, validator configuration,
logs and Comet DB. Four journal application directories alone would account for
43,040,768 bytes at this observed peak, already above the current 33,554,432-byte
whole-window cap. This is a planning limit, not a measured four-node run.
The cap is not raised. A large journal network run is not prepared from these
results; byte-bounded retention/delta storage remains necessary source work.

[Final peak samples and raw reports](evidence/journal-storage-peaks-v2-20261017.json)
include temporary-file peaks. The earlier pre-two-lock probe is separately
retained in [the first receipt](evidence/journal-storage-peaks-20261017.json).
Both observed the same byte peaks; the final receipt includes the additional
empty coordination lock file. Neither receipt claims whole-host or network RSS.

## Validation and next gate

Final source validation on GOMAXPROCS=1, nice 10, Go -p 1:
full consensus 8.429 s, client 1.302 s, fixture 0.480 s, CLI compile PASS;
runner prepare-only tests 0.670 s. Coverage includes:

- Journal decode versus actual writer/recovery state across two compactions;
  real fee/nonce matching, exact digest cache reuse, tamper, tail metadata,
  insufficient height, cancellation and original-file preservation.
- Reader exclusion while a writer is active, no lock creation, idempotent release,
  successful Commit after normal reader release, and bounded failure for a stuck
  reader without persisted-state mutation.
- Visible-but-unpublished state and wrong published hashes cannot become final;
  final counters and next-round nonce gates also reject missing Info evidence.
- Existing transaction, atomic reader, state-sync, injected fault and actual
  `os.Exit(17)` recovery tests remain passing.

The next candidate is only 32 ephemeral senders × two rounds = 64 transactions
at 128 offered/s within each round, with a new core/client and explicit journal
layout. It requires independently frozen hashes and a fresh Root grant. The
old sender-round preparation `5409f1...` remains unchanged and pins its old
core; no permission is transferred from that plan. No nodes started here.

One ordinary light exec admission failed with OS error 35 and created no process
or session. Its dependent edits/build were not executed. The existing test
session was polled to terminal PASS, Root was informed, and later ordinary exec
calls succeeded. This does not establish a global fix for that host condition.

Sustained ten-minute 1,000 valid business commits/s remains unproven. Large-state
retention, the read ceiling, per-transaction full-store readback and continuous
account-pool scheduling are still work toward the original goal.

## Separate prepared candidate

Core/client source commit is
`46645ba99e802dc5c15e5c2a943f0c6b9520590b`. Both executables were built from
that clean checkout in `network-bin-journal-readback`; unchanged fixture/host
executables were linked from their prior frozen candidates and their hashes
matched. Preparation did not create a network directory or launch any nodes.
Fresh build admission found 68,604,039,168 bytes free in the workspace filesystem.

The receipt
`artifacts/chain-performance-20261017/journal-readback-network-prepared-46645ba99.json`
is 12,538 bytes, SHA-256
`cd130d8eb17c1debd6c6b41c7d3b68ff697842ab11b88c8a373c646757959a0f`.
Its tracked copy is [here](evidence/journal-readback-preparation-20261017.json).
App SHA-256 is
`e37a06be433009e2e44368938ae8f8b7ec27c1be99f8d14bcf7da926ee448ebb`;
client SHA-256 is
`8f898d32bbbfba81273b24c864a4903b8390c88ba4a129c660f289ad018a0172`;
the standalone runner SHA-256 is
`b2765152ea0e60c9291939b711892f730f1d073d7ae180b413d914b2518bbd6c`.
Build information and source hashes are independently recorded; no unavailable
embedded VCS stamp or network acceptance is inferred. The plan remains only
64 total transactions under all original strict caps, awaiting a fresh Root slot.
