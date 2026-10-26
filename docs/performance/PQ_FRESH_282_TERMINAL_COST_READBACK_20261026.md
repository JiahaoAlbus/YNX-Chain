# 282 actual cost calibration: private data limit stopped the pair

[Actual run 40330458629](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40330458629) completed FAILURE. Source `28251767dd8098275e59a96f86935e413e5f1355`; one original dispatch and one result ZIP download, no rerun. Original watcher86612 exited1. This supersedes preparation-only runtime status.

Original guard: firstCause `privateBytes cap exceeded/invalid`, elapsed93626ms, child3269/-15, cleanupComplete=true; empty owned scans93573/93626ms. Actual last sampled private logical bytes540234401 exceed536870912: the failure is a measured cap overrun, not merely an invalid read. RSS peak813985792 bytes (776.277MiB),71 threads; CPU utilization is unmeasured. No pressure-equivalence claim from this isolated four-node, one-VM Linux run.

The profile intentionally offers at most2 transactions/second,16 per arm, four offer/four readback slots. This is bounded cost calibration, not a1000TPS load. Low CPU/memory observations alone would not prove spare business capacity. The engineering target remains1000 effective business TPS for10minutes, P95<=3s, not achieved.

## Actual transaction observations

Before16/16 verified. After13 offers started,9 returned and5 independently verified; source offer ordinals9–12 remain unfinished/UNKNOWN and must not be replayed. Returned5–8 lack completed independent validation;13–15 were never offered. All retained states/data survive.168 physical Commit and168 validation rows,21 callback and21 proposal/work rows. The original source-bound diagnostic reader accepted these exact logs; its fullPairQualified/sustainedTPSQualified remainfalse. No qualified before/after causal comparison.

Times below are actual offer-to-boundary P50 / P95 / P99 in milliseconds (nearest rank). After contains only five completed callbacks and is censored by the resource stop.

| Boundary | Before n=16 | Partial after n=5 |
| --- | ---: | ---: |
| First observed final-block ProcessProposal receipt | 1014.520 / 1912.236 / 1912.236 | 596.847 / 1177.920 / 1177.920 |
| First observed final-block ProcessProposal ACCEPT | 1026.755 / 1935.309 / 1935.309 | 608.750 / 1189.824 / 1189.824 |
| First node FinalizeBlock completion | 1965.276 / 3145.814 / 3145.814 | 1422.697 / 2003.771 / 2003.771 |
| First node durable Commit | 2166.685 / 3333.498 / 3333.498 | 1527.647 / 2124.504 / 2124.504 |
| All four nodes durable Commit | 2404.797 / 3491.345 / 3491.345 | 1630.653 / 2265.102 / 2265.102 |
| Independent proof process completion, including queue | 5170.844 / 6597.184 / 6597.184 | 4056.184 / 4918.998 / 4918.998 |

Actual proposal receipt is bound to the final block hash, exact ABCI hash/H/index and durable node. It is not earliest global network arrival. Independent proof completion is the actual child Wait completion after the original complete proof validation; earliest BFT formation is still unmeasured. Client firstRPC duration is retained separately and never subtracted from parent clocks.

## Commit encoding, persistence and validation

All physical rows include setup, empty successor and business blocks; they are deduplicated by arm/node/height. Four concurrent node timer sums are not CPU or wall time.

| Physical call stage, ms P50 / P95 / P99 | Before n=92 | Partial after n=76 |
| --- | ---: | ---: |
| Outer Commit | 58.563 / 205.084 / 246.282 | 42.660 / 159.143 / 181.081 |
| validate | 25.272 / 114.915 / 130.702 | 22.400 / 106.597 / 115.553 |
| json_encode | 11.285 / 50.890 / 70.173 | 9.029 / 39.237 / 65.730 |
| write | 0.563 / 5.499 / 40.612 | 0.518 / 5.088 / 17.743 |
| file_sync | 9.452 / 48.027 / 148.974 | 4.030 / 31.682 / 66.158 |
| close_file | 0.011 / 11.304 / 40.247 | 0.009 / 0.016 / 2.166 |
| rename | 0.376 / 2.157 / 42.502 | 0.320 / 9.120 / 26.082 |
| directory_sync | 0.171 / 9.105 / 31.561 | 0.157 / 4.911 / 16.069 |

before validation timer shares: pq_state 54.64%, validator_registry 28.77%, app_hash 12.47%. These are shares of summed validation partitions, not utilization. All34 partitions and nested hash-document/hash-encoding samples are retained in the diagnostic JSON; hash children are not added twice.

after validation timer shares: pq_state 50.02%, validator_registry 35.67%, app_hash 11.39%. These are shares of summed validation partitions, not utilization. All34 partitions and nested hash-document/hash-encoding samples are retained in the diagnostic JSON; hash children are not added twice.

## Coordinator work and setup

Actual disjoint accumulated call costs per completed callback, ms P50 / P95 / P99. These are not per-invocation quantiles.

| Caller | Before | Partial after |
| --- | ---: | ---: |
| inclusionProbe | 290.310 / 451.103 / 451.103 | 288.268 / 379.925 / 379.925 |
| fullCommitCheck | 60.624 / 168.765 / 168.765 | 70.396 / 80.186 / 80.186 |
| hostContext | 241.161 / 597.542 / 597.542 | 347.831 / 382.152 / 382.152 |

Before probes483 actual calls; full commit checks10 across9 callbacks (7 callbacks reuse already fully checked immutable heights),16 Host contexts. After probes144, checks5 across4 callbacks (1 reuse),5 Host contexts. No invocation is represented as a zero-duration measured call. Inclusive global inclusion/evidence progress spans overlap offers/readbacks and must not be summed.

Before fixture preparation242.190ms; four validator registrations7811.024ms total; PQ start/activation9855.471ms; initial execution/activation9877.548ms; business signing698.310ms. Before normal cleanup completed at parent51.251s; after first-offer staging began at84.594s. Full raw per-phase/per-node spans, incomplete waits and per-transaction hashes/ordinals are in the handoff JSON. Parent offsets and guard durations retain separate origins.

## Private storage: measured categories and actual source paths

Post-cleanup metadata reports two identical scans,851 regular files,540299670 logical bytes. It is not allocated filesystem size or peak/growth-rate measurement.

| Category | Bytes | Files |
| --- | ---: | ---: |
| consensus_wal | 223829148 | 23 |
| blockstore_db | 111164523 | 95 |
| state_db | 7303066 | 56 |
| tx_index_db | 31903314 | 56 |
| evidence_db | 8321 | 48 |
| application_snapshot | 32231132 | 8 |
| application_journal | 0 | 0 |
| sign_state | 545521 | 24 |
| case_metadata | 235244 | 3 |
| other | 133079401 | 538 |

`third_party/cometbft/consensus/state.go:849,857,877,1803` records real messages/timeouts/end heights through the consensus WAL; the corresponding `wal.go:189,201` encoder/WriteSync path is recovery data. `store/store.go:449,480,608` persists original blocks/parts/commits with a synced batch. Neither category proves unnecessary data, and neither is disabled, pruned or relabeled as debug logging.

`internal/consensus/pq_network_business_test.go:840` writes label-specific full migration/genesis/state/schedule/trusted inputs on every `hostContext` call. `pq_network_fresh_business_test.go:1580` calls it per transaction. Repeated immutable material is a concrete source-level optimization candidate and was handed to original Protocol owner: share only byte-identical, identity/hash-checked immutable files, retaining each transaction target/context and complete actual checkpoint capture/Validate/verifier. State with different H/root cannot be reused. No fix or measured storage saving is claimed yet.

The exported metadata contains category aggregates and the largest20 path hashes only. Exact file names/bytes making up the133079401-byte other category cannot be recovered from this result; do not attribute that whole category to Host-context duplicates. Additional per-file accounting needs an original producer change and a separately authorized runtime; no guessed attribution or duplicate artifact GET. All original WAL, signer HRS, application state, proof inputs and UNKNOWN remain retained.

## Source, artifact and evidence

Original seven files are preserved unchanged. Prepared11 fields/manifest7, Source3540 pin, three source leaves, four ELF roles/commit/size/hash and relocated source/manifest/prepared chain were checked against the frozen tuple. No local original fresh/stage source ZIP download or ELF execution. Result ZIP12653528409:71509 bytes, official SHA256 `e93bf5aaae14364b7962d08a8fd0a64182d289a72dc1c86f3e89f72ac844bdd6`.

External full handoff: `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-282-whole-once/TERMINAL_HANDOFF.json`,101673 bytes, SHA256 `84e9be5fee7434f17629c13d7c7fc049be515a131aaaba59562045933445e5f7`. Tracked copies: [handoff](evidence/pq-fresh-282-terminal-handoff.json), [source-bound diagnostic](evidence/pq-fresh-282-terminal-diagnostic.json). Manual raw report352644 bytes/SHA256 `1ffc28621a53714c4dc4fea71b071d86357d4e7c822fa565c5eb3205701ff443`.

No automatic next run, longer window, higher storage cap, dropped history, reduced business count or lowered validation. Root and Protocol receive this actual failure and the precise helper ownership handoff. Source work continues within original boundaries; a fresh runtime needs new explicit scheduling authorization.
