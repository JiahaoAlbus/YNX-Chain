# 81ce bounded four-node actual cost calibration

Exact candidate `81ce876f006aca44390fea1e2ecf293c6205bae0`, tree `803396fbddd0c9481e51ab0ec914bb14734477d8`. [Original run40363182425/1](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40363182425) was dispatched once under the fresh Root level1 grant; sole original watch40683 terminated1. The original105s active+15s cleanup,512MiB private,1GiB RSS,16process/320thread limits remained. Both arms share the same4 binaries and new code, differing in original readback index mode. This is not a causal old-versus-new optimization trial.

The original guard stopped on private file bytes at101446ms:537727821 exceeded536870912. Child3056 terminated-15; cleanup completed with original empty scans. Peak RSS862998528,threads68. Result artifact12670030786 was downloaded once and verified79668 bytes/SHA256 `589791101efab7b154b43cc4d32651ace7c3c30d71c5372b8cc816d1235ce631` before extracting exactly7 original outputs.

| Actual observation | Before | After, partial |
|---|---:|---:|
| Physical Commit/validation records |92|84|
| Original offer begins / returns |16 /16|16 /14|
| Original independently verified business callbacks |16|10|
| Offer-begin cadence over15 intervals, per second |1.343245|1.348122|
| Verified completions per short observed second |0.966823|0.821016|

After offer ordinals14/15 did not return before termination: retain UNKNOWN, never reoffer. Four other after transactions also lack independent verified completion; successful Host preparation is not business completion. All32 offers began,26 callback rows completed. Acceptance timestamps/TPS remain unmeasured. Short-window rates are not capacity or sustained throughput; after quantiles are censored and exclude unfinished transactions.

| Latency P50 / P95 / P99, seconds | Before16 | After10 partial |
|---|---|---|
| firstNodeProposalReceiptNs | 1.285 / 1.860 / 1.860 | 0.903 / 1.846 / 1.846 |
| firstNodeProposalAcceptedNs | 1.305 / 1.871 / 1.871 | 0.919 / 1.884 / 1.884 |
| firstNodeFinalizeNs | 2.299 / 2.954 / 2.954 | 1.943 / 2.895 / 2.895 |
| firstNodeDurableNs | 2.490 / 3.230 / 3.230 | 2.093 / 3.046 / 3.046 |
| allNodesDurableNs | 2.677 / 3.351 / 3.351 | 2.262 / 3.272 / 3.272 |
| offerToIndependentNs | 5.906 / 7.111 / 7.111 | 5.502 / 6.735 / 6.735 |

Proposal receipt/acceptance, first Finalize, first/all4 durable and independent proof completion are distinct observations. Earliest BFT formation is not timestamped. Both all4-durable P95s exceed3s; the continuous10-minute1000-effective-TPS target remains unachieved.

| Actual Host wall phase P50 / P95, milliseconds | Before16 | After12 preparations |
|---|---|---|
| totalWallNs | 300.042 / 730.759 | 284.486 / 512.164 |
| lightBlocksWallNs | 41.279 / 138.243 | 24.379 / 132.967 |
| inputEncodingWallNs | 1.894 / 76.694 | 1.307 / 2.153 |
| checkpointLoadWallNs | 21.234 / 287.725 | 27.251 / 270.334 |
| checkpointCaptureWallNs | 34.432 / 72.740 | 40.532 / 77.959 |
| checkpointDecodeWallNs | 23.120 / 75.659 | 25.801 / 81.344 |
| checkpointValidateWallNs | 47.059 / 100.891 | 44.674 / 95.922 |
| checkpointRetryWaitNs | 5.908 / 19.999 | 11.672 / 26.441 |
| retainInputsWallNs | 40.875 / 143.845 | 40.469 / 60.855 |
| contextWriteWallNs | 2.801 / 50.340 | 2.532 / 4.355 |

Retry wait samples are8before/5after;8before/7after did not invoke retry and are excluded from duration quantiles. Total includes9 children. Capture includes lock wait/encoding. Preparation counts28 exceed verified business26; no proof credit is created.

The frozen e2ec reader passed the original source-required10-timer diagnostics. Successor97a215665193b7683a4686e63b93b258752fcdd8 separately read the same immutable logs; every original output field was deeply equal. Its outside-helper residual P50/P95 is84/694ms before,63/480ms after, including queue/result delivery/coordinator scheduling, not pure queue wait. Inside-helper residual is approximately10–51us, so the nine child timers cover almost all helper elapsed time. These residuals do not measure CPU and cannot be added across overlapping transactions.

Commit persistence P50/P95 milliseconds: before validate36.36/133.19,JSON17.83/95.34,file fsync10.47/48.86; after validate27.20/102.17,JSON13.79/82.74,file fsync1.83/38.72. These are separate actual stages, not a summed quantile. PQ state remains the largest sum of node validation timers, followed by app hash and validator registry.

Post-cleanup logical file bytes537734597:WAL245964908,blockstore116511579,txindex34213312,application snapshot34579932,other97919618. This is metadata after cleanup, not a historical peak. Earlier42 reached fewer stages, so storage totals are not causal savings comparisons. Original histories and proof inputs remain; no cap increase or history deletion is authorized.

Compared descriptively with the earlier42 failed run, before offer-begin cadence rose from0.930434/s to1.343245/s and all4-durable P95 fell4.352s to3.351s; distinct VM conditions and changed reached stages prevent a causal gain claim. The latest run exposed storage as its actual first guard failure.

Next source work is with Protocol owner: diagnose and reduce full retained WAL/blockstore/Host input amplification while preserving all safety/history/proof contracts, and use actual checkpoint-load/validation/retention tails to choose changes. Perf retains harness/reader ownership. Another runtime requires a new exact source/normalCI/supply tuple and fresh Root grant; no unchanged rerun.

[Full exact terminal handoff](evidence/pq-fresh-81c-terminal-handoff.json) contains original source/artifact/guard/output pins, all phase spans, latency/stage quantiles and resource metadata. Raw7-output evidence remains at `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-81c-whole-once/`.
