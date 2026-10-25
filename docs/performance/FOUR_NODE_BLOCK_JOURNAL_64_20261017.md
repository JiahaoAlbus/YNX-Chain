# V2 block journal: four validators, two sender rounds

Root granted exactly one new window for frozen source
`e3b7b4b72762b8c61ac1d54d2414224b788428c9`. Preparation receipt is 12,249
bytes, SHA-256 `cfe6ad6c5c7a7ce769b88ed913b92fb9c9b68269cf533980bca1edf268a009a5`.
App SHA is `ed2e8403ff1be729330534207cb0af75236fc80cac4ef368b36fe91d2474b79d`,
client `2fefc871ce1603e943933565c09cad34e538b4ac954e8b97c3e9fa03bfc149b7`,
runner `0fe15fd726a928542afa6d503a1a4927bacf42b9f34680cb46e6d8b9753411b2`.
Fixture/host/Comet remain the prior pinned executables. The subsequent grouped
observer source changes were not included in these binaries.

Hardware: Apple M4, 10 logical CPUs, 24 GiB RAM; Go 1.25.7 darwin/arm64,
GOMAXPROCS=1, nice 10. Admission at 12:41:33.507 UTC found 65,203,707,904
workspace bytes free, 127,639 free 16 KiB VM pages, no owned network processes,
all binary hashes matching and all twelve ports rebindable. These are fresh
admission observations, not host-wide peak measurements.

The owned shell started at 12:41:39 UTC (session 60714, shell 37788, runner
37789). `window-oJZYQJ` began 12:41:39.616 UTC, ended after 7,468 ms and
cleaned up in 103 ms; terminal exit was zero, first cause null. Caps stayed
45 s + 15 s cleanup, 1 GiB owned/control RSS, 32 MiB data, nine long-lived
children, 320 threads including reserve, 1 MiB logs/process, four submit/four
observe workers, 10 s client and the original disk floor/reserve and ports.

## Actual network observations

32 fresh isolated senders submitted nonce 1, then nonce 2 only after the entire
first round reached final observation. Each round configured 128 offered/s.
Both rounds completed: 64/64 identity-bound ACKs, code-zero inclusions,
weighted signed quorum proofs, transaction Merkle proofs, local durable
fee/nonce readbacks and published ABCI Info gates. Rejected, failed execution,
UNKNOWN, timeout, observation-failed and unsubmitted counts were zero.
The 121 interim observation errors were transaction-not-found polling results.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| CheckTx | 3.646 | 32.721 | 54.912 |
| Code-zero inclusion | 1,177.894 | 1,545.607 | 1,595.853 |
| Quorum + local durability + published Info | 1,178.988 | 1,571.247 | 1,608.493 |

The 3.23818975 s full workload window completed 19.764129 business tx/s.
Whole-run offered interarrival rate was 37.691978/s because the round barrier
is included. Steady-state/interior TPS is withheld. Blocks 4/5/6 contained
32/25/7 transactions, all covered. Latencies include RPC/poll scheduling.

Reader work: 64 fresh captures, 2,489,816 hashed bytes, 12 reconstructions,
52 exact-byte cache hits, 64 observed-transaction signature checks. Separate
V2 reconstruction replayed 48 tail blocks / 612 input transactions across
cache misses. Those replay inputs are not additional business throughput.
Peak owned/control RSS was 411,303,936 bytes, data 2,539,520 bytes, threads
69 and live children nine.

## Stopped verification and slot return

All four nodes ended at height 6 with 64 fee events and byte-identical state:
AppHash `61fa3809bdfac884c6d762b161d3c6f9c24dd4625180fff8fe9f52b010864c55`,
canonical snapshot SHA-256
`73204c2d263dc2c7d89e1ea3c1bdef5c933652bd3d0f1e0b2caf7eb4c78fcfc9`.
Each V2 store is 50,154 bytes, SHA-256
`f58e36bd9536ee6475b635fb8d26517387a3e186fe3d8a93ba03d1d9fd92bedd`.
Read-only stopped blockstore verification authenticated block signatures,
checked exact signed round payloads/nonces 1 then 2, re-executed all 64 actual
transactions per node and matched the complete reconstructed durable state.
`TestStoppedNetworkReplay` passed in 0.13 s (package 0.551 s). This is 64
business transactions, not 256, and is not a live node restart drill.

Every child exited zero with its process group gone. Independent checks at
12:41:55.756 and .757 UTC confirmed shell/runner/all original child PIDs and
groups absent and rebound/closed all twelve ports. Root received formal heavy
slot return before the offline replay. This grant cannot start another run.

The prior V1 two-round smoke had final P95 1,595.963 ms and full-window
19.323 tx/s. This V2 single sample has the same workload shape/caps but fresh
keys, different block packing and a different host window; it does not isolate
a throughput gain. The interleaved same-fixture application comparison remains
the storage performance evidence. Neither smoke proves ten-minute 1,000 TPS.

Raw preparation, admission, receipt, observations, cleanup, public signed blocks
and stopped replay are retained in
[the evidence JSON](evidence/four-node-block-journal-rounds-64-20261017.json).

Next: integrate and validate per-node/per-height grouped observation, then
freeze a separate candidate and request a fresh comparison window. Continuous
sender-pool scheduling, history growth and at least ten minutes of sustained
1,000 valid final business commits/s remain open.
