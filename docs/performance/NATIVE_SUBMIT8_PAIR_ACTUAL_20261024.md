# Native submitter 4→8 actual same-VM comparison, 2026-10-24

Source f72a3d5c71150471429db753f71e0114c759ab2c; normal CI39980477606 success. Original once-only run [39982425900](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/39982425900), attempt1 success. Both actual node admissions preceded the original grant deadline. No redispatch or benchmark retry.

Both cases used the same assigned AMD EPYC7763 VM, 4 logical CPUs, same four built node ELFs, gRPC, DATA64,2048 independent signed transfers, target1000 offers/s,4 observers, actual queues2048/[2048]*4. Both native private state copy enabled; submitter count alone changed4→8. Fixed order, finite samples; not a10-minute test and no sustained1000 claim. Earlier9V45 runs are different hardware and excluded from this comparison.

All4096 original rows,2 fixtures and8 original node logs were independently checked by fixed-source validators, including exact receipt/log hashes, original post-fsync terminals, signatures/business/nonce/fee facts, all2048 included and final per case, no unknown, rejected, failed, timeout or unsubmitted transactions. Transient polling error occurrences remained13110→12532, not zero. Exact selected ZIP members have CRC/size/SHA verification; no claim of whole archive download/digest verification. Recovery observation caps remained60s; before and after first invocations exited142, preserved unchanged; cached range continuations completed0 without re-running workload.

| Metric | Native4 | Native8 |
|---|---:|---:|
| Actual offer rate/s | 993.508 | 993.608 |
| Submission interarrival/s | 436.882 | 516.900 |
| Full-window RPC/accepted/effective included/qualified final per second | 339.885 | 370.530 |
| Client measurement seconds | 6.026 | 5.527 |
| Offer→included P50/P95/P99 ms | 1908.458/3729.730/3796.365 |1905.033/3542.890/3699.422 |
| Offer→qualified final P50/P95/P99 ms |2292.262/3997.469/4060.547 |2303.790/3859.352/3982.670 |
| Offered queue peak |879|809|
| Accepted awaiting observation peak |1045|1084|
| Sampled owned RSS bytes |734121984|742039552|
| Client CPU as percent of one core |74.473|74.686|

Finite final rate improved9.016%, final P95 improved3.455%; final median, accepted observation queue and RSS worsened. Final P95 exceeds3s, finite joint verdict false, sustained verdict false. Full-window inclusion/final rates happen to have equal numerators2048 and denominator; this does not mean their timestamps or delays coincide. Client observed final completion includes corroborated persistence/business/quorum evidence, distinct from internal two-thirds vote instant.

## Actual node Commit stages

32 samples each side across4 nodes, including empty blocks; nearest-rank quantiles. Nested validation children are already part of validate. Parallel node durations cannot be summed into finality latency. Writer implementation is unchanged; variation is not a disk optimization effect.

| Stage | Native4 mean ms | Native8 mean ms | Native4 P95 ms | Native8 P95 ms |
|---|---:|---:|---:|---:|
| commit | 18.832 | 17.782 | 32.901 | 34.178 |
| close_file | 0.008 | 0.013 | 0.010 | 0.030 |
| delta_encode | 0.250 | 0.217 | 0.572 | 0.632 |
| file_sync | 0.813 | 1.288 | 2.804 | 7.331 |
| journal_maintenance | 0.089 | 0.093 | 0.136 | 0.236 |
| prepare_file | 0.041 | 0.031 | 0.065 | 0.053 |
| validate | 17.375 | 15.915 | 31.579 | 30.069 |
| write | 0.244 | 0.213 | 0.424 | 0.545 |
| validate.app_hash | 9.910 | 9.432 | 17.175 | 19.739 |
| validate.semantics | 7.399 | 6.284 | 16.890 | 10.783 |

## Readback bottleneck and next source change

Cumulative decoder gate wait3779.243→3418.606ms; private state validation510.651/27calls→399.983/23; suffix initialization256.208/6→249.103/5; suffix replay818.805/6→876.735/5; certificate publication204.646/7→247.762/6; native private copy59.468/27→44.957/23ms. Original durable reader transaction verification829.766→732.259ms. These are nested/overlapping wall scopes, not additive latency or isolated CPU attribution. Aggregate CPU does not establish client CPU saturation or pure network cost.

The existing suffix initializer calls NewApplication: migration Validate, CanonicalJSON (itself Validate), JSON private clone, and genesis-state allocation; the generated committed state is immediately overwritten with the already privately reconstructed and fully validated state. Next implement a private suffix initializer retaining full migration validation/private ownership and every state/signature/fee/nonce/replay check, measure local before/after allocation and time, then obtain a new exact Root window for any further network comparison. Do not infer a speedup before measuring it.

## Closure wording and evidence

Original case and pair two-scan observations contain exactly owned=[34383], launcherStartTicks42945. Nodes/worker descendants are absent; original monitoring launcher is intentionally present. This is not a wholly empty process group and does not directly observe launcher exit. The original native workflow step then completed normally and the original job reached SUCCESS; those are separate terminal evidence. The earlier immutable admission snapshot is preserved, including its then-pending raw-readout field; final readout now explicitly marks fullOriginalBusinessRawReadoutPending=false. No new dispatch permission is implied.

Machine evidence: [native-submit8-pair-ci-39982425900-actual.json](evidence/native-submit8-pair-ci-39982425900-actual.json). Raw originals and exact reproducible readout command are retained under artifacts/chain-performance-20261017/native-submit8-source and native-submit8-pair-39982425900; the reader takes pair,2 case receipts,2 client files,2 fixtures,original CI log,new output and automatically requires all8 original node logs. Dependency source pins and the exact reader SHA are embedded in the output.

The exact independent reader is also saved as [native-submit8-runtime-reader-20261024.py](evidence/native-submit8-runtime-reader-20261024.py); bytes match the embedded verifier hash.
