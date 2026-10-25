# Sparse native state: four-validator regression

Root authorized one fresh window using preparation SHA-256
`4db0242660d8a8c734c761fedc98c097b8f9e0078e1b8ec69276bea2f906bfcb`.
All five executables and the frozen runner were freshly hashed before execution.
Core source is `aa121ecc1`; fixture/client source is `bfc41ea23`.
The sparse account/lot implementation is the one measured in
[the structural and same-fixture ABCI comparison](NATIVE_SPARSE_UPDATES_20261017.md).

Window `window-EGiq66` began at `2026-10-17T10:06:00.547Z`, completed in
10,722 ms, and cleaned up in 104 ms. Session 15669 exited zero. No resource
guard fired, retry occurred, or subsequent larger window started.

The same strict limits applied: 1 GiB owned/control RSS, 32 MiB data,
45 seconds active plus 15 seconds cleanup, 10-second client deadline,
four submit/four observer workers, GOMAXPROCS=1, nice 10, nine long-lived
children, 320 threads with reserve, and 1 MiB per log. Entry free space was
73,299,210,240 bytes; the 1 GiB floor plus 425 MiB Root reserve and maximum
data delta remained intact. Peak owned/control RSS was 495,665,152 bytes,
data 6,873,088 bytes, threads 72, and live children nine. RSS is not a
whole-host total.

All 256 transactions were accepted, included with code zero, independently
weighted-quorum verified and matched to local durable fee/nonce evidence.
Rejects, unknown submissions, execution failures, timeouts, observation
failures and unsubmitted transactions were zero. All 112 retained observation
errors were RPC transaction-not-found responses while awaiting inclusion.

The measured offer rate was 127.9894/s and submission rate 126.2137/s.
The complete workload measurement, including observation/drain, lasted
3.027539708 seconds: **84.5571 effective business transactions/s**.
Blocks 4/5/6 contained 61/120/75 transactions, with complete valid coverage.
No complete eligible active-offer interior interval existed, so interior and
steady-state TPS remain null.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| submission queue | 0.001 | 37.422 | 44.855 |
| CheckTx response | 4.540 | 70.647 | 114.301 |
| code-zero inclusion | 1,212.103 | 1,617.781 | 1,701.241 |
| quorum plus local durable state | 1,213.526 | 1,621.725 | 1,707.101 |

These monotonic submission-to-observation durations include RPC, polling and
observer scheduling. They do not identify internal node inclusion/decision
clock times. The durable reader freshly hashed 66,456,603 bytes across 256
attempts, performed 12 whole-snapshot validations, reused 244 exact-digest
snapshots, and verified all 256 transaction signatures. Peak queued submissions
were seven and accepted transactions awaiting observation completion were 195.

All four nodes ended at height 6 with the same snapshot SHA-256
`31747c4cf27cacc6ffbf6d92f957b3c88aa64d1fcae351e0cebb3c2a01171aa4`
and AppHash
`e6a3802dff9775b62eaf1919c64c7eadb4b13726a08f9f13665050dfe0362a99`.
After shutdown, independent read-only blockstore verification checked signed
blocks and prior-state AppHash transitions, re-executed all 256 actual payloads
per node, and found complete state byte-equal (0.23 seconds). This is 256
network transactions, not 1,024. No live restart was performed.

Shell 40909, runner 40911, fixture 40937, ABCI 40965/40989/41013/41037,
CometBFT 41176/41235/41328/41358 and client 41441 were absent at fresh post-stop
checks. All owned child groups were gone, all exit codes zero, and ports
31656–31659, 31757–31760 and 31858–31861 were individually rebound and closed.
The unique heavy slot was returned to Root before offline replay or light tests.

The previous 256@128/s run measured 74.4232/s, inclusion P95 1,577.835 ms and
final-observation P95 1,580.762 ms. This run shares count, nominal offered rate,
topology, process limits and native transaction shape, but uses new keys,
different block alignment, updated bounded tools and a later shared-host
schedule. It is a semantic regression comparison, not a controlled causal
throughput improvement. Exact-input old/new core state equivalence and allocation
comparisons remain in the source-level report linked above.

The original [Commit/history decomposition](FEE_HISTORY_COST_20261017.md)
still identifies full-history validation, encoding and sync costs. Sparse native
updates remove per-transaction account/lot copy amplification; they do not remove
full-snapshot persistence growth. Sustained ten-minute 1,000 valid business
commits/s, long-run backlog/resource behavior and internal inclusion/finality
timing remain unproven. Bounded sender reuse and the long-duration observation
driver remain source work; no new sender-pool feature was mixed into this run.

All preparation identities, observations, resource samples, public signed
blocks, stopped replay and PID/port evidence are retained in
[the evidence JSON](evidence/four-node-native-delta-256-20261017.json).
Private generated keys remain only in the ignored isolated fixture directory.
