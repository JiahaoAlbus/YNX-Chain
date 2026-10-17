# V2 readback and block-batch verification foundation

V2 previously had node recovery and storage comparisons but no load-client
decoder. This change connects its pure replay to bounded live readback and
stopped replay, without opening a second writer or invoking a submission path.

`DecodeBlockJournal` uses the node's same checkpoint/delta interpreter against
caller-owned bytes. Every complete frame/checkpoint, next height, prior/post
AppHash and complete response hash is checked; transaction execution uses the
same signature/nonce/fee/rollback logic. The returned full state and canonical
snapshot JSON are independently owned. The decoder creates no file or lock,
performs no Sync/truncation, and submits nothing. Context checks bound replay
between records and before returning evidence.

The client detects V2 before reading, uses the existing read exclusion lock,
reopens after lock acquisition to follow checkpoint replacement, hashes the
entire current file and retains its 16 MiB input limit. It releases the lock
before CPU validation or RPCs. Exact-byte cache hits may reuse reconstruction;
any changed bytes must pass fresh replay. Full-store SHA-256 and reconstructed
canonical-snapshot SHA-256 remain separate. Schema 7 retains the published
ABCI Info height/AppHash gate for both journal formats. Next-nonce admission and
final counters enforce that gate too. Local readback/Info is still not a
cryptographic execution proof; independent weighted quorum and inclusion
verification remain mandatory in the observer.

Readback stats now separate tail blocks/transaction inputs replayed on cache
misses from per-observation transaction signature verifications. Replayed
inputs can include failed transactions and are never added to business TPS.
Stopped replay automatically selects the reconstructed V2 state, retains store
digests separately and refuses incomplete tails in a clean stopped window.
No V2 four-node stopped replay has yet been performed.

## Bounded same-block batch interface

`verifyBlockBatch` verifies a unique list for one node and one inclusion height
against one fresh state capture. It accepts at most 2,048 transactions and
8 MiB of signed inputs. Every transaction is still decoded, signature-verified
and matched to its actual fee/type/payer/hash/height and account nonce. One
invalid transaction, duplicate, missing record, canceled/expired context or
corrupt store returns no batch success evidence. The shared capture has an
explicit observation time after validation; publication/consensus gates remain
outside this disk-verification API.

Ordinary single-transaction readback delegates to a batch of one. **The current
network observation scheduler still submits batches of one.** The new API and
its microbenchmark do not establish live grouped observation or improved
network throughput. The next scheduler change must collect accepted transactions
by node/block, reuse verified block evidence safely and report common capture
times without backdating final completion or retrying UNKNOWN submissions.

## Operation-level measurement

Apple M4, Go 1.25.7 darwin/arm64, GOMAXPROCS=1, nice 10, Go -p 1. The input
is the retained real 1,024-transfer V2 store (641,617 bytes), its exact migration,
and all 32 actual signed transactions from the final block. Both implementations
are cache-warmed before timing. Three 150 ms samples per case:

| One operation verifies all 32 transactions | 32 individual reads | One batch |
| --- | ---: | ---: |
| Median ns/op | 13,398,083 | 3,774,200 |
| Current store bytes freshly hashed | 20,531,744 | 641,617 |
| Signatures verified | 32 | 32 |
| Median allocated bytes/op | 200,714 | 129,147 |
| Allocations/op | 2,144 | 1,434 |

The read step takes about 3.55× less time and hashes 96.875% fewer bytes, while
retaining all signature checks. A batch does not reuse metadata instead of
reading current bytes. The fixed store means timed iterations hit the exact
digest cache; changing a checkpoint/tail additionally costs full reconstruction.
These are verification-operation results, not newly executed transactions,
submission rates, network TPS, latency under load or ten-minute acceptance.

[The raw samples and exact fixture paths](evidence/block-journal-readback-batch-20261017.json)
retain both signatures/operation and bytes/operation to make that distinction
inspectable. To reproduce:

```sh
GOMAXPROCS=1 \
  YNX_CHAIN_BATCH_STATE="$PWD/artifacts/chain-performance-20261017/abci-run-3560683502/state.json" \
  YNX_CHAIN_BATCH_MIGRATION="$PWD/artifacts/chain-performance-20261017/local-performance-migration.json" \
  nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client -run '^$' \
  -bench '^BenchmarkDurableBlockBatch$' -benchtime=150ms -count=3
```

## Safety and source validation

The frame reader now distinguishes checkpoint and delta length limits. Known
remaining byte counts prevent a valid checksummed length from allocating a
missing 512 MiB payload. File recovery uses a bounded SectionReader; pure
readback uses a bounded byte reader. A real allocation-counter test verifies
that the absent large tail remains below 1 MiB allocation, and oversized delta
frames are rejected before allocation. No resource/window cap was raised.

Tests compare pure readback with actual live Query state and writer recovery
across checkpoint replacement, verify original file preservation, explicit
incomplete tails, same-size corruption despite caches, published-height lag,
duplicate/bad-signature/missing-fee/future-height batch failures, cancellation
and whole-batch failure without partial success. Existing actual abrupt exits,
mixed transaction replay, state-sync and atomic/V1 reader tests remain passing.

Final full source checks passed: consensus 11.645 s, client 1.741 s, fixture
0.427 s, CLI compile, runner prepare-only tests 1.002 s. One attempted light
exec admission failed with OS error 35 and created no process/session; its
dependent checks did not run. The previous benchmark session was confirmed
terminal PASS, Root was informed, and a later ordinary admission completed
the final checks. No global host repair is claimed.

The runner now explicitly prepares `block-journal` as an allowed layout without
changing default atomic behavior, four submit/four observer workers, 1 GiB RSS,
32 MiB data, 45+15-second lifecycle, 10-second client, port/thread/log or disk
limits. A separate frozen 32-sender × two-round native regression candidate is
the next network gate and requires a fresh Root grant. The completed V1 slot
and its executables are not reused as permission or represented as V2 evidence.

Incremental replay caching, actual grouped observation, continuous account-pool
scheduling and at least ten minutes at 1,000 effective final business commits/s
remain work under the original goal. No V2 node started in this source stage.
