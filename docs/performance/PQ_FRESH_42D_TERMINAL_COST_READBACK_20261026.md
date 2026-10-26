# 42d actual cost calibration:105s deadline before after business starts

[Actual run40348378826](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40348378826) completed FAILURE on exact source `42d12277b61b92e82ca96e9e112e437274c6444f`. New Root grant2324/SHA256 `7a1f4b6b4aa8137dad1ed7cd271eef3081a08ae3e30da717fef10941a8f5a425` was verified against final tuple62626/SHA256 `5ff238d10765442bc4dee951ff7eaa3bb587e856f2f4b77d6070ca3cf51b4920`. Exactly one dispatch exit0, one original watcher17691(exit1), no retry/extension. Original normal-source admission and fresh-artifact relocation succeeded.

Original guard firstCause `105s active deadline`, elapsed105327ms, child3016/-15, cleanupComplete=true; empty owned scans105273/105327ms.140 physical Commit +140 validation rows,16 TX +16 final-block proposal/work rows. Before16/16 independently verified; after0 business offers,0 business callbacks. After16 are **never started**, not16 failed transactions or UNKNOWN submissions. The unfinished signing-intent stage and all original histories remain retained.

## Actual rates and latency

Configured maximum2 offers/s is calibration input, not chain capacity. Original first/last offer Start offsets42.184069749/58.305585961s give actual15 inter-offer intervals at0.930434 offers/s. There is no catchup; process/queue preparation and coordination can delay offers. The last independent process Wait completed at65.979679171s.16 unique signed/executed/four-node-durable/proof-validated business transactions over the23.795609422s first-offer-to-last-proof window give **0.672393 completions/s observed in this short window**. This is neither sustained capacity nor a10-minute1000TPS result.34 initial registration births, maintenance, votes and empty blocks are excluded. Server ingress/acceptance timestamps and receive TPS were not measured; CLI completion cannot substitute for them.

Offer-to-boundary P50 / P95 / P99 in milliseconds; all before samples16, after business unmeasured.

| Actual before boundary | P50 / P95 / P99 ms |
| --- | ---: |
| First observed final-block ProcessProposal receipt | 1553.214 / 2283.292 / 2283.292 |
| First observed ProcessProposal ACCEPT | 1585.121 / 2305.804 / 2305.804 |
| First node Finalize completion | 2985.896 / 3850.198 / 3850.198 |
| First node durable Commit | 3337.644 / 4084.308 / 4084.308 |
| All four durable Commit | 3458.584 / 4352.471 / 4352.471 |
| Independent proof process Wait completion, including queue | 7813.323 / 8849.824 / 8849.824 |

First observed accepted final-block proposal is not earliest global arrival. Four-node persistence and independent proof completion are different observations; earliest BFT formation remains unmeasured. Reader did not independently reverify cryptographic proofs here: these are original successful normal verifier/callee outcomes.

## Real setup and why unchanged retry cannot fit

| Actual parent-clock interval | Start/end seconds | Duration seconds |
| --- | ---: | ---: |
| before pq-start-and-activation | 14.958159 / 27.921545 | 12.963387 |
| before initial-execution-and-activation | 29.433443 / 40.826046 | 11.392603 |
| before business-intent-preparation | 40.889403 / 42.158667 | 1.269264 |
| before actual-result-validation | 66.006173 / 66.847919 | 0.841746 |
| before normal-cleanup | 66.847947 / 66.881316 | 0.033369 |
| after original-fixture | 66.881410 / 67.226949 | 0.345539 |
| after pq-start-and-activation | 81.009045 / 90.239433 | 9.230388 |
| after initial-execution-and-activation | 91.714582 / 103.026195 | 11.311613 |
| after gateway-start | 103.026229 / 103.254004 | 0.227775 |

After business-intent preparation only **began at103.254039223s** and never completed before the guard stopped. Even pretending all remaining signing/preparation/start cost is zero,16 offers spaced500ms need the last offer no earlier than110.754039223s: already5.754039223s beyond an optimistic105s parent budget, before its completion. The guard begins before the test parent origin, so real remaining time is no larger. This is a conservative scheduling bound, not a fabricated after duration or a request to extend caps. An unchanged replay is not a meaningful next experiment.

## Actual Commit encoding and durable stages

The92 before rows include setup/empty successor/business blocks;48 after rows contain only initialization. They are deduplicated per arm/node/height and are not multiplied by transaction count. These unequal phase populations cannot be used as a speedup comparison. Milliseconds P50 / P95 / P99:

| Stage | Before all92 physical | After initialization48 physical |
| --- | ---: | ---: |
| Outer Commit | 122.547 / 342.957 / 450.552 | 32.464 / 171.191 / 242.829 |
| validate | 54.570 / 209.084 / 257.741 | 15.870 / 86.490 / 126.439 |
| json_encode | 32.068 / 84.313 / 100.613 | 5.959 / 53.060 / 63.074 |
| write | 0.628 / 4.450 / 26.932 | 0.148 / 0.739 / 1.282 |
| file_sync | 9.470 / 105.545 / 162.426 | 0.698 / 32.504 / 45.596 |
| close_file | 0.014 / 16.389 / 36.876 | 0.011 / 0.036 / 1.660 |
| rename | 0.503 / 15.015 / 27.991 | 0.283 / 16.382 / 27.825 |
| directory_sync | 0.187 / 16.396 / 30.165 | 0.164 / 1.670 / 212.645 |

Before validation partition sums: pq_state55.33%, validator_registry26.25%, app_hash10.81%, engine_snapshot5.66%. These are shares of summed node timers, not wall time or CPU utilization. All34 phase rows and nested hash children are preserved in the diagnostic JSON; hash children are not added twice.

Actual coordinator accumulated call wall times per verified callback, ms P50 / P95 / P99:

| Caller | Actual before |
| --- | ---: |
| inclusionProbe | 331.908 / 704.582 / 704.582 |
| fullCommitCheck | 70.284 / 247.641 / 247.641 |
| hostContext | 656.112 / 1157.285 / 1157.285 |

274 actual inclusion probes;10 full historical commit checks across9 callbacks,7 callbacks reused already checked immutable heights;16 Host contexts. The0.656/1.157s Host P50/P95 includes original checkpoint readiness/capture/full validation/retention and is not pure copying CPU. The prior282 source already showed H+1 completion can overlap the Host span. Probe counts changed from483 to274, but per-callback cost did not establish a speedup. The before observed latency is worse than prior282; source differences and separate CI VMs prevent causal attribution to a single optimization or to hardware. Do not infer a regression cause or a benefit from the functional tests.

## Resources, storage and comparison limits

One isolated Ubuntu24.04 Linux VM, four actual nodes in the original process, GOMAXPROCS2/GOGC50/GOMEMLIMIT1536MiB; original smaps/proc guard. Actual kernel `6.17.0-1022-azure`, 4 logical CPUs. CPU utilization/model/frequency/steal were not captured. This is not four independent VMs or public network traffic.

Peak owned RSS717123584 bytes (683.902MiB),64 threads, private438720311 bytes (418.396MiB), build167174439. Private512MiB did not fire in this run. The whole32 still failed on time. Post-cleanup two identical metadata scans report438720619 logical bytes:

| Category | Bytes | Files |
| --- | ---: | ---: |
| consensus_wal | 222869372 | 20 |
| blockstore_db | 94247505 | 90 |
| state_db | 6053992 | 56 |
| tx_index_db | 27709735 | 56 |
| evidence_db | 8315 | 48 |
| application_snapshot | 28003204 | 10 |
| application_journal | 0 | 0 |
| sign_state | 618236 | 24 |
| case_metadata | 194622 | 3 |
| other | 59015638 | 313 |

The prior282 stop had21 completed business callbacks and later after progress; this run has16/0. Different reached stages and different VMs mean the lower total/other bytes cannot be called101MB or any measured causal saving. No historical WAL/HRS/application/proof input is deleted or pruned. The metadata still exposes category totals/top20 path hashes only, not a complete measured per-file attribution.

## Original evidence and next source action

Original result ZIP12662018107,65326 bytes/SHA256 `87b8265a6ea671d3c65df0b94afafacebee2b9b8ee6d91379c342c980d85d5f2`, unique download verified against official metadata before safe new-only extraction. Seven original outputs are unchanged. Prepared11/manifest7 fields, Source3540/three source leaves/four ELF roles/commits/sizes/hashes, prepared and relocated manifest pins, guard binary/command/caps match the exact tuple. No local original fresh/stage archive GET, ELF execution or local GoInfo was used.

[Complete terminal handoff](evidence/pq-fresh-42d-terminal-handoff.json), [original-log diagnostic](evidence/pq-fresh-42d-terminal-diagnostic.json). External H at `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-42d-whole-once/TERMINAL_HANDOFF.json` is 91737 bytes/SHA256 `f5d6a670b5e29436c7552319a6e8a07074dcceeb3e833a0d5e062aace95c764d`. Raw manual report298179/SHA256 `46f4d30294381616015385ea96f3749fc57d135063365dabc55420dc0a660c5a`. Original exact-source diagnostic reader accepted the actual16 callback/proposal/work joins; its fullPairQualified/sustainedTPSQualified remainfalse.

Root and original Protocol owner receive the real failed scheduling bound and measured pq_state/registry/Host-path costs. Next implementation must remove measured duplicated work while preserving complete live checks, cold restoration, signed history, nonce/replay protections and original H+1/full quorum proof path. Do not blindly lower activation heights, skip preparation, shrink business count, extend105s, raise storage caps, delete history or retry an unchanged known-nonfitting window. There is no new runtime authorization.1000 sustained business TPS/P95<=3s remains the full goal, not achieved.

## Why low offered pressure is not spare chain capacity

The original single coordinator synchronously performs readiness/Host preparation before returning to offer scheduling. Its disjoint w1/w3/w4 call wall timers total17.769513279s inside the23.795609422s first-offer-to-last-proof window:6.116326791s probes,0.847010002s full commit checks and10.806176486s Host context. That is74.68% of this observation window occupied by those calls, with Host alone45.41%. They include disk/checkpoint/validation waits; this is not CPU utilization and these are not assumed recoverable savings. Consensus nodes and existing child proof processes may run during the same intervals.

The coordinator cannot launch the next offer while that synchronous Host call runs. This concrete caller path helps explain why configured2/s became0.930434/s actual offer cadence; it does not prove a causal share for each lost offer. The original Protocol owner has received both the validation/capture hotspot and the need to distinguish bounded preparation from scheduling. Any future asynchronous repair must return errors to the coordinator, keep all original offer/proof slots bounded, join/cancel every helper and preserve complete Host/AND/quorum/cold validation; current Fatal helpers must not be moved onto workers. No new framework, driver, validation skip or larger cap is authorized by this observation.

[Exact coordinator occupancy supplement](evidence/pq-fresh-42d-coordinator-occupancy.json),2028 bytes/SHA256 `d4966401ebdc9a1bd5b0710ae2a797aedda3a59ccce010461f5abda33777b301`. The original full terminalH pin remains unchanged. A repaired source and actual new runtime would be required to prove any improvement.
