# Actual first data64 / 2048-input / offer1000 case

Run **39164390241**, job **117784182049**, source
**b61d6b05306c9a452077cf79029be8fd165bff37**, immutable tag
`codex/chain-data64-b61d6b053`. Normal source CI39163960713 succeeded first.
Root granted exactly one dispatch under the 8841-byte contract SHA256
`1fb971e762d83540b1df2d4741e35f4d9cd6cf3de36dc087092d2e292329117e`.
There was one dispatch and no retry. All other workflow booleans stayed false.

The finite case qualified: all2048 signed public inputs match the original fixture
bytes, index, hash, distinct sender and nonce1. Every row passed the existing
signature/business/proof/quorum/durable fee+nonce/published-info qualification.
UNKNOWN, terminal timeout, rejection and execution-failure counts are zero.
Original errorOccurrences17469 remains recorded: transient observation/polling
conditions are not zero merely because all rows ultimately qualified.

## Actual performance: neither throughput nor end-to-end latency target achieved

Four validators, grpc, four submission workers and four observers, relative pacing,
shared durable replay. No endpoint fair/elastic, ready pool, streaming or gzip.
2048 independent test senders, one transfer each. Client full window6.164609945s.

| Measurement | Actual |
| --- | ---: |
| Configured offers/s | 1000 |
| Actual offer interarrival/s | 993.960749 |
| Actual submission interarrival/s | 494.120165 |
| Full-window RPC submission/s | 332.218911 |
| Full-window accepted/s | 332.218911 |
| Full-window valid business inclusion/s | 332.218911 |
| Full-window qualified final confirmation/s | 332.218911 |
| Peak offered awaiting submission | 753 |
| Peak accepted awaiting observation completion | 1064 |

| Latency, milliseconds / 2048 samples | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| Submission queue | 269.165 | 2126.221 | 2162.201 |
| CheckTx response | 1.316 | 40.421 | 100.598 |
| Offer to valid business inclusion | 1579.263 | 3953.929 | 4096.981 |
| Offer to qualified final confirmation | 1939.990 | 4388.472 | 4473.766 |
| Submission to qualified final confirmation | 1732.536 | 2269.974 | 2356.231 |

Queue-inclusive final P95 is **4.388s**, above3s. The2.270s submission-to-final
P95 excludes queue and must not replace it. Block heights3..8 contain respectively
234,577,484,132,233,388 valid workload transactions. The sole complete active-offer
interior interval gives594.776/s over0.813752s; it is not sustained throughput.
No ten-minute steady-state result exists. These are client observations completing
all original proofs; they do not separately timestamp the internal instant when
votes first reached the consensus threshold.

## Measured stages and next bottleneck

Each node recorded seven durable Commit samples, heights2..8, including the
initial empty-business block. Average milliseconds per Commit:

| Node | delta encode | write | fsync | semantic validation | AppHash validation |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0.235 | 0.167 | 43.127 | 4.831 | 6.809 |
| 1 | 0.150 | 0.158 | 0.745 | 4.275 | 5.496 |
| 2 | 0.234 | 0.189 | 10.269 | 4.704 | 7.136 |
| 3 | 0.192 | 0.168 | 8.885 | 5.238 | 6.065 |

The semantic/AppHash child durations are already within parent validate. Node0
height6 fsync alone took297.14ms; node2 height4 took68.56ms and node3 height6 took
58.51ms. Do not infer a general fsync distribution from these28 samples or claim
validation is the sole bottleneck. All original per-block values are in the proof.

Client HTTP P95: connection acquisition0.0044ms, write-to-first-byte28.283ms,
first-byte-to-return14.534ms. Hooks fired once for all2048 transactions; zero
write errors,2039 reused connections. These include server/transport/scheduling
and response/decode work, not pure serverCPU or network time.

Durable reader cumulative load5.670s, decode5.431s, transaction verification0.928s;
shared flight wait2.685s is nested within decode. There were24 snapshot validations,
6 actual full replays,14 joins,4 hits, zero shared failures; replay processed27
blocks/7475 input visits, with2048 successful original signature facts and5427
fact hits. Observer durable-business batches total6.599s across28 attempts (4
transient errors). Parallel/nested values cannot be summed into finality latency.

Next source action: split shared replay production, flight wait, canonical-byte
copy, private JSON decode and private state validation before choosing an observer
optimization. Keep measuring submission dispatch/HTTP backlog: the offered load
nearly reached1000/s while actual submission was494/s. Preserve all crypto,
fee/nonce/replay, publication, persistence and original proof gates. Any speedup
requires a new same-VM/source/binaries/workload comparison with Root scheduling.

## Resources, cleanup and evidence

Actual Linux x86_64 Azure VM, AMD EPYC9V74, four logical CPUs, MemTotal16373452KiB;
Go1.25.14, GOMAXPROCS1/GOGC100/GOMEMLIMIToff. Different CPU from the earlier failed
32MiB case plus changed budget/diagnostics means this is **not a matched speedup**.
Sampled peak owned RSS709234688B, threads65, build118950948B. Post-fsync private
bytes46882121 fit the separate64MiB cap; original32MiB profile/default unchanged.
64MiB finite fit is not a long-history or600k-transaction storage bound.

Original receipt SHA256
`bef4bdaccf1cb2fce60c87bc4911a6beb8d8f3dba51def56f7fa61a21c213c62`
matches the original qualified post-fsync terminal (13911ms). Last two owned scans
at13799/13853ms contained only launcher34313/startTicks32297. Cleanup and slot
return verified and sent Root. No new run is authorized by this result.

Selected original artifact12150277228 members were recovered with exact numeric206
ranges, original CRC/size and member SHA checks; no whole-ZIP digest is claimed.
The independent readout verified all2048 original fixture/result rows, original
phase/counter equality, fixed source/profile/caps, four-node validation children,
post-fsync receipt identity and final double closure. It is not a second independent
cryptographic consensus implementation.

Tracked proof: `evidence/oneshot-data64-ci-39164390241-actual.json`.
Raw original receipt/client/fixture/node logs and complete readout remain under
`artifacts/chain-performance-20261017/oneshot-data64-39164390241/`.

While waiting for the granted slot, an explicitly recorded read-only Go overlay
also measured16 validations of the original retained1024-transfer state on the
local Mac. Median semantic0.599ms/AppHash1.036ms/total1.682ms. This is a separate
local retained-state cost probe, without new transactions, execution, consensus or
business TPS, and must not be compared as a network improvement. Original fixture
pins and probe/raw are retained under `oneshot-data64-source/`.
