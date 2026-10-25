# Original MM proof cadence run40113221553

Completion update: full549-member original recovery and independent native/business/resource qualification now PASS. See `NATIVE_MM_RUN40113221553_QUALIFIED_20261025.md` and `evidence/native-mm-run40113221553-qualified-20261025.json`. The earlier pending descriptions below are historical capture-stage status; sustained1000TPS remains unproven.

The original normal workflow completed SUCCESS on frozen SOURCEd24e97b8d3373e294a9d7992e07b4ef532bd6dcf / CODEa02fa84574e2e61c379c894f2389dc8d8ada6e73. Each case ran8192 business transactions and its original two complete checker passes. Before/after case terminal times were34.553/32.256s; pair67.557s. Both original post-fsync case scans and pair scans contain only launcher39609/startTicks44830, so the original runtime slot returned. Independent full selected-archive/stream/resource readback is still pending. Original terminal success is not yet an independent performance qualification.

Original receipt SHA matches the original complete CI log. Nine priority originals (pair/case receipts, client reports, worker reports and logs) passed original ZIP CRC/SHA; an extended17-member priority read also recovered all eight original node logs with zero new network bytes. Client and worker report hashes match the original case receipt. Original whole-window observations:

| Metric | Bounded | Grouped4 |
|---|---:|---:|
| Valid final business transactions | 8192 | 8192 |
| Unknown / timeout / execution failure | 0 / 0 / 0 | 0 / 0 / 0 |
| Actual offered events/s | 344.03 | 372.53 |
| Original final observation transactions/s | 322.03 | 349.86 |
| Client measurement window | 25.439s | 23.415s |
| Offer→effective inclusion P50/P95/P99 upper | 1198 / 1637 / 1840ms | 1166 / 1575 / 1766ms |
| Offer→client final P50/P95/P99 upper | 1392 / 1801 / 2005ms | 1363 / 1726 / 1973ms |

Latency distributions are1ms intervals, not exact points or earliest BFT quorum formation. These are provisional original readings, pending independent complete stream verification; no qualified causal gain or sustained1000TPS claim. The configured offer target was1000/s, but actual offers were much lower, so this run cannot establish a chain capacity ceiling near350/s. Neither case observed an exited-MM transition; successful completion does not demonstrate that target repair during this run.

Eight original node logs pass the frozen1957... parser and equal the original receipt nodePhases. Each case's four replicas agree on business height/blockHash/AppHash/count, covering8192 transactions. There are29 versus28 business blocks,116 versus112 replica observations. Real business Commit means:

| Phase | Bounded | Grouped4 |
|---|---:|---:|
| Commit | 35.8625ms | 33.1769ms |
| Validate | 28.7936ms | 28.7913ms |
| AppHash, included in Validate | 18.5985ms | 18.7528ms |
| Delta encode | 0.2226ms | 0.2185ms |
| Append write | 0.1807ms | 0.1867ms |
| Append file sync | 5.1237ms | 1.5765ms |

All checkpoint replacements, including empty blocks, have eight replica observations per case. Checkpoint encode mean17.2842/18.2912ms; checkpoint file sync mean55.0514/48.5253ms, P95104.1011/83.1142ms. Synchronization variability affects this single sequential pair; its throughput difference cannot all be attributed to pacing. Full P50/P95/P99 and per-node/height detail are retained. Checkpoint children already belong to maintenance, and AppHash already belongs to validation; neither should be summed again. Replica observations do not multiply business TPS.

Root's original6657-byte corrected-transport grant493a8... authorized the single actual dispatch. A prior bool-valued gh stdin failed locally before a remote run existed; original intent/result and API total_count0 remain preserved. The corrected267-byte string-valued stdin has exactly the same six typed workflow semantics. Actual dispatch occurred at2026-10-25 00:47:58+08:00 with fresh pressure1/Q60, within the fresh grant deadline; original run created00:48:00+08:00, attempt1. No second workload was dispatched.

Complete original segmented recovery remains on the frozen302fc... reader and unchanged7164... connection-reuse adapter: exact aligned64KiB206, ETag, CRC/SHA, cache128MiB/selected96MiB,60s bounds. Completed segments and partials are retained. Completed readers01–04 ended at original deadlines/timeouts; none was treated as a successful complete recovery or unknown live process to restart. Subsequent invocations reuse validated cached segments and fetch only missing ranges. The actual runtime is not rerun.

Next: finish original missing ranges, zero-network whole-selected-manifest reauditing and the independent native/worker/resource/complete-business-stream verdict. Then compare actual inclusion/final observations and four-replica durable completion with their clock semantics. AppHash/full validation remains the main measured CPU optimization target; the separately implemented explicit node encoder option is not part of this frozen run. Evidence: `evidence/native-mm-run40113221553-original-terminal-20261025.json` and `evidence/native-mm-node-phases-run40113221553-20261025.json`.
