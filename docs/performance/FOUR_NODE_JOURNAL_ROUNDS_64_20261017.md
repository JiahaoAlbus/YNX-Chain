# Four validators: two rounds of 32 isolated senders

Root granted one fresh window for exact prepared receipt 12,538 bytes / SHA-256
`cd130d8eb17c1debd6c6b41c7d3b68ff697842ab11b88c8a373c646757959a0f`.
All executable/runner hashes matched before execution: frozen source `46645ba99`,
app `e37a06be...`, client `8f898d32...`, runner `b2765152...`, fixture
`ee04f25e...`, original host sampler and CometBFT v0.38.23. The later byte-target
and V2 block-journal code were not included or rebuilt into this window.

Fresh admission found 66,976,579,584 bytes free, no owned network processes,
and all 12 ports rebindable. The owned shell started the runner at
`2026-10-17T12:14:04Z`, session 48361, shell 36194 / runner 36195.
Window `window-25hlrg` began `12:14:04.568Z`, ended in 7,506 ms and cleaned up
normally in 103 ms. No guard, probe failure, forced retry or first cause occurred.

All original caps remained: 45 s active + 15 s cleanup, 1 GiB owned/control RSS,
32 MiB aggregate data, 320 threads with control reserve, nine long-lived children,
1 MiB logs, 10 s client, four submit/four observe workers, GOMAXPROCS=1,
1 GiB free floor plus 425 MiB Root reserve. Actual peaks were 413,532,160 RSS
bytes, 3,166,208 data bytes, 71 threads and nine live children. RSS does not
include all unrelated host applications.

## Exact workload and observations

32 new ephemeral senders each submitted nonce 1, waited for the entire first
round's final observation, then submitted nonce 2. Both rounds completed:
**64/64** verified ACKs, code-zero inclusions, weighted quorum proofs and local
durable readbacks. All 64 additionally passed the journal's published ABCI Info
height/AppHash gate. Rejects, failed execution, unknown submissions, timeouts,
observation failures and unsubmitted inputs were zero.

The retained 128 observation errors were all tx-query transaction-not-found
responses while waiting for inclusion. There were no local readback/Info errors.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| CheckTx response | 5.145 | 34.405 | 54.942 |
| code-zero inclusion | 1,223.806 | 1,591.327 | 1,689.956 |
| quorum + durable + published Info | 1,226.110 | 1,595.963 | 1,691.282 |

The full measured workload window was 3.312112916 s, giving 19.323 completed
business transactions/s. The configured 128 offered/s applies within each
round. Whole-run interarrival rate was 37.096/s because the two-round barrier
is included. This deliberately bounded reuse regression is not saturation or
a throughput comparison. Steady-state and active-offer interior TPS remain
null. Blocks 4/5/6 contained 32/26/6 valid observed transactions with complete
coverage. Durations include RPC/polling/observer scheduling, not internal clocks.

Durable readback freshly hashed 7,386,026 bytes over 64 attempts, performed 11
whole-snapshot validations, reused 53 exact-byte cache entries and verified all
64 native signatures. No metadata shortcut replaced current file bytes.

## Convergence, nonce reuse and cleanup

Every stopped node has height 6, 64 fee events, all 32 senders at nonce 2 and
balance 9,996. All four selected-snapshot SHA-256 values equal
`e079eea85673c890d0be6fd85c40258bd3ef5b697999029c6f6a8d5c3484d27a`.
Each V1 store is 207,425 bytes with SHA-256
`131d2cab4659ba093819f3fb55937adb126cce59b75e6b14d680b2088c9ebac3`.
All AppHashes equal
`c368da58f2622b051c549bdf9d2e013a0ac3d2070b1363f7ab08010a8fad2c5f`.

After shutdown, independent read-only blockstore signature verification and
actual payload re-execution passed for all four nodes in 0.09 s, with complete
state byte-equal. This remains 64 network transactions, not 256. No live node
restart occurred. Same-height signed headers still authenticate the preceding
state; local durability/Info and stopped replay are separate evidence.

Fixture 36222, ABCI 36248/36272/36296/36320, CometBFT
36345/36369/36393/36417 and client 36455 all exited zero with groups gone.
The shell/runner and every child PID/group were independently absent at both
`12:14:33.724Z` and `.726Z`; ports 31656–31659, 31757–31760 and 31858–31861
were individually rebound and closed on both passes. Root received actual START
and terminal status, and the heavy slot was formally returned before offline
source-only inspection. No second/larger window started under this permission.

All preparation, fresh admission, raw observations, resource samples, both
PID/port checks, public signed blocks, replay and nonce readback are retained in
[the evidence JSON](evidence/four-node-journal-rounds-64-20261017.json).
Private fixture keys remain only in the ignored isolated runtime directory.

The P95 goal passes at this short load; sustained ten-minute 1,000 effective
business transactions/s and internal node inclusion/finality timing remain
unproven. Future V2/continuous-load work needs its own candidate and fresh Root
schedule, not reuse of this completed slot.
