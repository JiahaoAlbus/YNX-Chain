# Reuse bounded native cryptographic facts across full journal replay

The real 1,024-transaction four-validator workload completed 116.056 final
business tx/s, with submission queue P95 544 ms. Its confirmation client
performed 24 full reconstructions and replayed 15,352 historical inputs.
Repeated reconstruction was therefore measurable client work, not new business
throughput. A short prior reconstruction profile attributed approximately
36.73% of CPU samples to native `SignedTransaction.Verify`, 38.78% to its
decode/verification caller and 23.47% to `runtime.madvise`. This statistical
whole-process sample includes setup/calibration and is not exact phase timing.

`BlockJournalDecoder` now owns the same bounded successful native verification
cache already used by applications: at most 4,096 entries and 4 MiB retained
string data, plus bounded map/ring overhead. Entries bind expected native chain
ID, SHA-256 and the exact retained payload bytes. Only successful strict native
decode and cryptographic verification populate the cache. Invalid, changed or
evicted bytes must pass the complete path again. No reconstructed execution
state, nonce, balance, fee index, file metadata or publication result is cached
by this decoder.

Each Decode creates its own application and replays every complete input through
the same execution code. Checkpoint/frame checks, next height, prior/post
AppHash, full response hash, fee accounting, nonce/replay, rollback and final
state validation all remain. The decoder privately clones its migration and
returns independently owned state/JSON. Its cache mutex permits concurrent
decodes without sharing mutable Apps; the decoder must not be value-copied.

The live durable reader shares one decoder across its four fixed node paths.
Before decoding it still locks/reopens, freshly hashes the complete current
file and verifies stable captured bytes. Current-byte corruption cannot be
hidden by a crypto fact. Every observed business transaction additionally
undergoes the existing independent decode/signature/fee/nonce check, then the
normal quorum/Merkle/publication gates. Schema 11 reports replay crypto facts
separately from replayed inputs and observed-transaction signature counts.
No cache hit is admission, execution, durability or consensus authorization.

Default node recovery and standalone `DecodeBlockJournal` retain their prior
per-call replay caches. The new shared facts are selected only by the readback
decoder. State version 13, V2 journal bytes, ABCI wire behavior and normal node
Commit semantics do not change. The existing frozen network app remains an
independent old binary; no new network measurement used this source stage.

## Exact-input comparison

Apple M4 / 10 logical CPUs / 24 GiB, Go 1.25.7 darwin/arm64, GOMAXPROCS=1,
nice 10. The same test binary reads the same 650,204-byte actual terminal V2
store from `window-RWY2KW`, bound to its exact migration. Each operation fully
replays 11 blocks / 1,024 inputs, verifies the resulting AppHash and byte-equal
canonical snapshot SHA, with all 1,024 fee records. Three 300 ms samples each
run in order **cold / shared / shared / cold / cold / shared**.

| Median complete reconstruction | Fresh per-call facts | Shared verified facts |
| --- | ---: | ---: |
| Time, ms | 138.819764 | 39.331354 |
| Allocated bytes | 31,332,264 | 26,174,033 |
| Allocations | 259,360 | 214,274 |
| Replayed blocks | 11 | 11 |
| Replayed transaction inputs | 1,024 | 1,024 |
| Shared exact-payload crypto hits | Not shared across calls | 1,024 |
| New replay crypto verifications after warm-up | Fresh per call | 0 |

Time falls 71.67% and allocation 16.46%. The shared cache first performs all
1,024 successful full crypto verifications outside timing. Timed iterations
measure the warm exact-input case; cache misses/new inputs still verify in full,
and FIFO eviction can reduce benefit for tails larger than its capacity.
Fresh disk capture/store SHA, independent observed-transaction verification,
RPC and networking are outside this reconstruction benchmark. These are repeated
verification operations, not newly executed business transactions or TPS.

The earlier pressure inventory also measures real 64-transaction and application
1,024-transaction stores. Their checkpoints, accounts and block shapes differ,
so they are descriptive data points rather than an isolated history-growth curve.
[Raw interleaved samples and exact source/binary/input hashes](evidence/replay-facts-comparison-20261017.json)
preserve the actual workload and cache conditions.

```sh
GOMAXPROCS=1 YNX_CHAIN_REPLAY_FIXTURE_ROOT="$PWD" nice -n 10 \
  go test -p 1 ./cmd/ynx-consensus-perf-client -run '^$' \
  -bench '^BenchmarkJournalReadbackPressure$' -benchtime=100ms -count=3
```

For the interleaved comparison, use retained `replay-facts-client.test` with
`-test.bench='^BenchmarkJournalReadbackPressure$/^network1024$/^reconstruct$'`
or `.../^reconstruct_with_shared_facts$`, 300 ms in the six recorded positions.

## Validation and remaining work

Tests verify exact output against uncached replay, owned migration/state/JSON,
concurrent decode, changed complete frame checksums, migration binding,
well-formed wrong signatures, malformed signatures, cached duplicate nonces,
prior/post AppHash and full-response mismatches, and cancellation. The cached
nonce/signature counterexamples can preserve the eventual successful state but
change transaction-result order; full response hashing still rejects them.
Mixed native/Ethereum/AI workflow results remain identical.

Two independent actually committed stores reuse crypto facts while each still
reconstructs its own state and verifies its observed transaction signature. A
real appended empty block forces fresh full reconstruction with unchanged
crypto facts; subsequent same-size file corruption fails despite the warm cache.
Existing default recovery, abrupt exits, state-sync, fee/rollback and journal
tests remain covered by the full suite.

Full consensus PASS 9.476 s, client PASS 2.874 s; targeted race consensus PASS
1.989 s, client PASS 4.998 s. An initial negative test used the normal encoder,
which correctly refused a malformed signature before the fixture reached replay;
the fixture now uses raw JSON to test that decoder path. Final focused/full/race
checks pass. [Raw source/test/profile evidence](evidence/replay-facts-source-20261017.json)
includes the independent profile binary and sampled allocation hotspots.

Next freeze a separate client and schedule the identical 1,024-input shape
against the retained uncached network baseline, without reusing its Root grant.
Actual network improvement remains unmeasured. Continuous ten-minute input and
metrics streaming, larger ready-account capacity, full-state hash/validation
growth and the reader's 16 MiB ceiling still require implementation/resource
planning before claiming stable 1,000 effective business TPS.
