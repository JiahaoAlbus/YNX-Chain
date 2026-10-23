# Actual native suffix same-VM comparison, 2026-10-24

The candidate did not improve the complete finite workload: qualified final rate569.931→481.583/s (−15.502%), although offer→qualified final P95 improved2028.958→1904.583ms. P99, submission speed, queue peaks and RSS worsened. Finite joint verdict false, sustained verdict false. Do not promote this initializer based on its local cost reduction.

Original once-only [run39989248490](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/39989248490), attempt1, job120536428134 SUCCESS. Exact source0c6f2ad54ccba3c8d8d27543a5b39f0c42b3708c, immutable tag codex/chain-suffix-0c6f2ad54, normal CI39987600317 SUCCESS. Both cases same actual AMD EPYC9V45 VM/4logical CPUs, same4ELFs built once/gRPC/DATA64/2048 signed independent native inputs/offer1000/8 actual submitters/4 actual observers/2048submission queue and2048 each observation queue. Only after nativeSuffixSetup=true. Previous39982425900 used7763: no cross-VM speed multiplier or regression attribution is valid.

All4096 original business rows,2original fixtures and8original node logs are independently reconciled against original receipt/result/fixture/log hashes, actual inventory, exact source validators, original cryptographic/business/quorum/durable evidence and all3post-fsync terminal frames. Each case2048 signed inputs, accepted/effective included/qualified final2048, no unknown, timeout, execution failure, rejection or unsubmitted input. Transient observation error occurrences14798→13120, not zero. This is finite successful business verification, not10-minute sustained performance.

| Metric | Original native suffix setup | Explicit private suffix setup |
|---|---:|---:|
| Actual offer interarrival/s |996.931|999.410|
| Actual submission interarrival/s |909.394|738.865|
| Full-window RPC/accepted/effective included/qualified final/s |569.931|481.583|
| Measurement seconds |3.593415|4.252641|
| Offer→effective inclusion P50/P95/P99 ms |1282.283/1745.216/1823.574|1206.014/1681.878/2148.269|
| Offer→qualified final P50/P95/P99 ms |1551.859/2028.958/2093.174|1456.308/1904.583/2262.021|
| Offered queue peak |399|492|
| Accepted awaiting observation peak |1211|1230|
| Submission queue P50/P95/P99 ms |37.952/322.161/380.652|8.606/721.838/777.571|
| Sampled owned RSS bytes |745123840|755777536|
| Client CPU total ns |2370324000|2522686000|
| Client CPU percent of one core |65.963|59.320|
| HTTP write→first-byte P95 ms |22.977|35.018|
| HTTP first-byte→return P95 ms |9.585|12.484|
| HTTP callback return P95 ms |39.750|44.958|

Full-window rates use the complete measurement denominator and all2048 qualified results, so their equal numeric totals do not imply identical reception/inclusion/finality events. Final completion is client observed corroborated persistence/business/quorum completion, not the internal two-thirds-vote instant. More clientCPU ns with a lower percentage is possible because the wall denominator grew. HTTP hook waits include scheduling/transport/server/body/identity validation; they are not isolated pure network or serverCPU times.

## Actual block coverage and stages

Control effective transaction counts at heights3..6:329/510/773/436. Candidate at heights3..7:298/695/527/463/65. Candidate's last65 inputs required one additional business block. This explains part of this finite measurement's longer completion window; a single fixed-order pair with different fresh keys/startup/block scheduling cannot establish deterministic causal degradation for all future loads. All tail samples remain included; P95 alone is not acceptance.

| Node Commit stage | Samples before/after | Before mean ms | After mean ms | Before P95 ms | After P95 ms |
|---|---:|---:|---:|---:|---:|
| commit | 20/24 | 10.782 | 9.712 | 19.129 | 16.891 |
| close_file | 20/24 | 0.007 | 0.007 | 0.010 | 0.010 |
| delta_encode | 20/24 | 0.194 | 0.156 | 0.498 | 0.288 |
| file_sync | 20/24 | 0.706 | 0.717 | 1.919 | 1.268 |
| journal_maintenance | 20/24 | 0.073 | 0.066 | 0.108 | 0.087 |
| prepare_file | 20/24 | 0.026 | 0.029 | 0.036 | 0.044 |
| validate | 20/24 | 9.581 | 8.563 | 18.267 | 13.344 |
| write | 20/24 | 0.187 | 0.166 | 0.342 | 0.358 |
| validate.app_hash | 20/24 | 5.595 | 5.013 | 11.700 | 8.600 |
| validate.semantics | 20/24 | 3.892 | 3.446 | 7.872 | 6.057 |

All20/24 original Commit samples across4nodes, including empty blocks, nearest-rank. Nested semantics/app_hash are already included in validate, not additional latency. Node writer code is unchanged; smaller/different blocks and fsync variation are not an initializer-caused writer optimization.

SuffixSetup cumulative135.122ms/3calls→44.133ms/4calls, but suffixReplay290.116/3→448.197/4, certificate publication59.444/4→98.711/5, private native copy23.031/15→96.832/18, gate wait1644.136→1959.072ms. Reader transaction verification759.669→568.212ms. These nested/concurrent wall scopes cannot be summed into client finality or treated as isolated CPU attribution. Lower local setup cost did not make the whole measured path faster.

## Once window, recovery and closure

Root grant PERF_NATIVE_SUFFIX_ONCE_GRANT_20261023T164141Z.json4257B/SHA14753e34a3df1c6407d4baaa40dd0578b13d31d700fcd2d4b48a53eed84da28a. Dispatch16:44:11.477856Z was preceded by exclusive once-dispatch and trigger files plus fsync; original gh returned0, unique original run recovered, no retry. Both actual nodes_spawned Unix times independently checked before original17:01:41.799Z deadline. Cases7270/8001ms; pair15729ms/allretained92864543B, all post-fsync caps qualified.

Two case/pair scans retain only original launcher34189/startTicks32808: node/worker descendants absent, not a wholly empty process group and not a direct post-exit launcher/proc observation. Original native step completed16:48:29, original job16:48:45. Slot-return proof3735B/SHA6a7dbaf335159b436107c9a5e17a356a6d3dcf22f7a82672b47d9b775461ba8c preserves its earlier full-raw-pending=true snapshot. Final full readout now explicitly has fullOriginalBusinessRawReadoutPending=false. No new dispatch permission exists.

Original artifact12517023233/23210306B. Only selected ZIP members recovered, with original206ranges/CRC/size/SHA checks. Before/after first recoveries exited142 under original60s observation cap; originals preserved, cached continuations exited0. No larger cap, whole-ZIP digest claim, benchmark retry or replacement dataset. Local pre-dispatch fragment comparator initially omitted trailing newlines on3fragments; original failure retained, exact literal bytes+line verified against unchanged18source pins/15guards before any trigger. No source or resource guard changed to pass.

[Full actual machine readout](evidence/native-suffix-pair-ci-39989248490-actual.json), [exact reader](evidence/native-suffix-runtime-reader-20261024.py). Reader takes original pair,2case receipts,2client results,2fixtures,original CI log and a new output; automatically requires all8logs and matching original terminal-run JSON, pins its own bytes and3source dependencies. Raw originals remain under native-suffix-pair-39989248490 and native-suffix-source artifact directories.

Next owning source target is duplicate observer native signature mathematics already completed during validated replay. A separate offline overlay has a real cross-reader chain RED and repaired expectedChainID binding, plus original2048 signature/fee/nonce/height/context and race/eviction checks; it is not integrated into production or this network run. Keep the original initializer control as default, add an explicit bounded observer-fact candidate with those negative tests and real mode counters, then qualify normal CI before any newly scheduled four-node comparison. Sustained1000 qualified finals/s for10minutes remains unachieved.
