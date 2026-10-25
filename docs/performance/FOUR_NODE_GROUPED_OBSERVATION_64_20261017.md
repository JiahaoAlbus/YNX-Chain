# Grouped observation: actual four-validator regression

Root authorized exactly one window for client source c41c62153, app e3b7b4b72,
and the 9,268-byte preparation receipt SHA-256
`150fd78a3c5328f7f617f1ec30786abc25baa7cb37208b5f40d6a2e1513e474f`.
Client binary SHA was `c126aaf97fc0d34ad195558c60c9c2c74d25f4de54a968717cb0074300e70fa4`;
core/fixture/host/Comet/runner matched their original frozen pins. No subsequent
source was built into this window. Hardware remains Apple M4 / 10 logical CPUs /
24 GiB, Go 1.25.7 darwin/arm64, GOMAXPROCS=1, nice 10.

Admission 12:51:35.580 UTC found 64,417,046,528 bytes free, all hashes matching,
owned network processes zero and all twelve ports rebindable. VM free pages
were 101,242 × 16 KiB, an admission sample rather than a peak memory claim.
The owned shell started 12:51:42 UTC (session 15002, shell 69462, runner 69463).
`window-YUvmw3` began 12:51:43.020 UTC and completed in 9,025 ms, cleanup
406 ms, terminal exit zero, first cause null. All original resource caps stayed
unchanged: 45+15 s, 1 GiB owned/control RSS, 32 MiB data, nine long-lived
children, 320 threads with reserve, four submit/four observe, 10 s client,
1 MiB logs/process and the original disk floors/ports.

## Result and actual work

32 fresh senders × two rounds = 64 signed native business transactions, each
round configured at 128 offered/s. All 64 passed ACK identity, code-zero
inclusion, weighted signed quorum, Merkle proof, durable signature/fee/nonce
readback and published Info gates. Both rounds completed. Rejected, failed,
UNKNOWN, timeout, observation-failed and unsubmitted counts were zero.

| Measured work | Previous V2 single observer window | Grouped window |
| --- | ---: | ---: |
| Durable captures | 64 | 19 |
| Fresh store bytes hashed | 2,489,816 | 765,523 |
| Native transaction signatures checked | 64 | 64 |
| Whole snapshot reconstructions | 12 | 13 |
| Full workload tx/s including barriers/drain | 19.764 | 15.680 |
| Final observation P95, ms | 1,571.247 | 1,522.642 |

The grouped window reports exactly 19 Commit queries, Validators queries,
quorum verifications, durable batches and Info queries, with largest batch 7.
Its 600 individual Tx queries include 536 transaction-not-found poll errors;
this remaining RPC amplification is explicit. Replay on changed V2 bytes
re-executed 56 tail blocks / 588 transaction inputs, not extra business TPS.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| CheckTx | 3.864 | 9.378 | 24.182 |
| Code-zero inclusion | 769.006 | 1,486.043 | 1,721.195 |
| Quorum + durability + published Info | 776.824 | 1,522.642 | 1,850.199 |

The full workload lasts 4.081578125 s. Whole-run offered interarrival rate is
29.040076/s, not the per-round configured 128/s. Blocks 4/5/6/7 contain
29/3/30/2 transactions versus the previous window's 32/25/7 over three blocks.
Fresh keys, differing block packing and different host windows prevent causal
TPS/latency conclusions. The optimization demonstrably grouped checks in the
real network, but did not demonstrate higher full-window throughput.
Steady/interior TPS stays null; ten-minute 1,000 TPS remains unproven.

Peak RSS 411,303,936 bytes, data 2,592,768 bytes, threads 70 and long-lived
children nine stayed within caps. At 12:52:09.455 and .457 UTC, independent
checks found the original shell/runner/fixture/four ABCI/four Comet/client PIDs
and groups all absent, and rebound/closed all twelve ports. Root received
formal slot return before offline work. No grant reuse or larger run followed.

Read-only stopped verification passed in 0.10 s (package 0.378 s): exact signed
round payloads with nonce 1/2, authenticated block signatures, all 64 actual
transactions replayed per node and complete state byte-equal across all four.
This is 64 network business transactions and no live node-restart claim.

[Raw preparation, observations, receipts, cleanup and stopped proofs](evidence/four-node-grouped-observation-64-20261017.json)
are retained. Next source work removes the whole-round sender barrier while
keeping one in-flight transaction per account, durable signed-input identities
and permanent quarantine of UNKNOWN submissions. Per-transaction inclusion RPC
polling also needs measurement-led reduction before larger scheduled loads.
