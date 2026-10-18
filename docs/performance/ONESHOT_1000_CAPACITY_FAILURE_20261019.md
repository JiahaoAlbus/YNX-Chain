# First 2048-input offer1000 run: actual capacity refusal

Run 39161413763, source 5e88fa9c9a5f174cac2b5b3e8607cd88a3694682,
artifact 12148564689. This is a failed diagnostic, not a qualified performance case.
The original contract and 32 MiB profile remain unchanged. No automatic retry ran.

The first refused sample at 6741 ms charged 33,587,249 private bytes against
33,554,432; RSS was 721,408,000 bytes against 1 GiB. Cleanup completed and the
last two owned-process scans contained only the same launcher identity. The
post-fsync terminal remained qualified=false and the old slot was returned.

Final original ZIP member sizes total 40,191,359 bytes, exactly the post-fsync
charged value. Major components are txindex 6,929,296; consensus WAL 6,551,390;
client report 6,293,333; ABCI journals 6,022,200; Comet state DB 5,418,424;
genesis copies 3,658,668; blockstore 2,839,367; signed inputs 1,150,987 bytes.
Direct process logs total only 133,944 bytes: LevelDB .log files are database
content, not stdout. This final-size breakdown does not reconstruct per-file
allocation at the instant of refusal.

Even removing the entire report hypothetically leaves 33,898,026 bytes, still
343,594 above the original cap. Do not remove history/proofs/WAL or describe
report compression alone as a capacity solution.

The recovered original client contains 1487 confirmed, 230 timeout,
1 submission_unknown and 330 not_submitted rows. All 2048 original signed public
inputs match the fixture bytes and transaction hashes. Existing confirmed-row
proof flags are intact; this offline check is not a fresh cryptographic replay.
The resource stop censors the result: finite prefix final rate 444.27/s and
confirmation P50/P95/P99 1633.74/1943.82/1981.70 ms must not qualify throughput or
latency targets. Unknown writes are not retried.

## Actual Commit phase measurements

Four recovered original ABCI logs each contain five durable block-journal-v2
Commit samples, heights 2 through 6, including the initial empty business block.
Means in milliseconds per Commit, over those five samples:

| Node | delta encode | write | file sync | validate |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.155 | 0.190 | 1.496 | 7.885 |
| 1 | 0.302 | 0.210 | 1.503 | 10.107 |
| 2 | 0.192 | 0.195 | 2.219 | 8.233 |
| 3 | 0.267 | 0.231 | 1.210 | 9.271 |

For these observed samples, validation costs more than delta encoding or fsync.
This does not locate validation's internal cost in fee-history copying, nor prove
what dominates sustained finality. The next source investigation should split
that validation and observer replay work before optimizing a presumed bottleneck.
Cumulative ABCI/observer/reader times include nested or parallel work and cannot
be added into end-to-end confirmation latency.

## Separate explicit data64 source profile

`supply-2048x1-data64` is separately registered with 64 MiB private-data capacity.
It preserves the original 2048 signed inputs, offer1000, four submission workers,
four observers, grpc/relative pacing, shared replay, all original per-row gates,
1 GiB RSS, 320 threads, 45+15 second window and log/disk/memory guards. Initial
disk admission additionally reserves the selected 64 MiB. Actual samples retain
their original byte values; exceeding 64 MiB still fails and preserves firstCause.

Default and existing profiles remain at 32 MiB. There is no fallback from the
failed profile. Reading the recipe starts no nodes. A new source CI, exact
contract and separate Root grant are necessary before one new execution. This
profile is a capacity experiment, not a performance improvement or ten-minute
capacity proof; 64 MiB is not established as an upper bound by this failed prefix.

Local differential validation: controller 59 tests PASS (2.361 s), original native
resource controller 13 tests PASS (0.005 s). Tests include actual retained byte
values under both budgets, unchanged workload/business gates, refusal above64,
other resource limits and the larger initial disk reserve. No new network ran.

Original selected-member recovery records and raw evidence are retained under
`artifacts/chain-performance-20261017/oneshot-1000-39161413763/`.
The tracked actual evidence is
`evidence/oneshot2048-ci-39161413763-failure-actual.json`.

## Validation child timing source

The existing opt-in Commit diagnostic now records `validationStagesNs.semantics`
and `validationStagesNs.app_hash` from the actual ordered validation calls. These
are children already included in `stagesNs.validate`, not additive stages.
Disabled diagnostics call the original Validate method with no child clock reads
or allocations. Both success and first-error behavior remain unchanged; all three
storage formats share this path. LastCommitTiming returns private child maps.

Targeted actual signed execution tests PASS (0.563 s): atomic JSON, snapshot
journal and block journal each commit and reopen; diagnostic-on and diagnostic-off
durable bytes are identical; invalid pending state cannot alter persisted bytes;
returned child-map mutation cannot change retained diagnostics. The memory-only
path remains non-durable. Raw: `validation-child-final.raw` in the same artifact
directory. This implements measurement only. Child costs are not yet measured
on four nodes and no optimization benefit is claimed.
