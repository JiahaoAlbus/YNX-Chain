# Actual observer native signature facts pair, 2026-10-24

Original once-only [run39996035179](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/39996035179) attempt1 SUCCESS, source73b4abc00503a59128e312bb2ee27e9999c61f1f / immutable tag codex/chain-observer-facts-73b4abc00. Normal source CI39994208480 SUCCESS with6new actual RUN/PASS tests confirmed. Same actual AMD EPYC7763 VM/4logical CPUs, same four ELFs built once, gRPC/DATA64/2048independent signed native inputs each/offer1000/8submitters/4observers/original2048submission and2048each observation queues. Both original suffix initializer, only after observerNativeFacts=true. No public network, state or account was changed.

All4096original rows,2fixtures and8node logs independently reconciled against exact original source validators, raw result/fixture hashes, actual worker inventory, cryptographic/business/quorum/durable proof fields, all3post-fsync terminal hashes and source/binary/host identity. Each2048accepted/effective included/qualified final, no rejected/unknown/unsubmitted/execution failed/timedout/observation failed result. Transient observation error occurrences12745→13401 are preserved; these are not zero error calls. This finite qualified run does not prove10-minute sustained throughput.

## Complete observed result

| Metric | Control | Observer facts |
|---|---:|---:|
| Actual offers interarrival/s |992.130|996.156|
| Actual submission interarrival/s |501.727|515.101|
| Full-window RPC/accepted/effective included/qualified final/s |362.508|380.934|
| Client measurement seconds |5.649531|5.376254|
| Offer→effective inclusion P50/P95/P99 ms |1968.435/3699.281/3814.730|1812.775/3399.774/3557.022|
| Offer→qualified final P50/P95/P99 ms |2400.643/3936.827/4045.249|2112.545/3676.220/3792.059|
| Offered awaiting submission peak |807|850|
| Accepted awaiting observation peak |1073|1022|
| Sampled owned RSS bytes |742281216|771928064|
| Client user/system/total CPU ns |3995867000/131845000/4127712000|3690088000/145978000/3836066000|
| Client CPU percent of one core |73.063|71.352|
| Reader transaction verification cumulative ms |864.266|3.533|
| Reader decode cumulative ms, including waits |5584.067|5387.873|
| HTTP write→first-byte P95 ms |41.142|39.927|
| HTTP first-byte→return P95 ms |23.128|20.815|
| HTTP callback return P95 ms |66.640|59.294|

Finite final rate+5.083%, offer→finalP95−6.620%; P95still3.676s>3s, finitejointfalse/sustainedfalse. Offered queue, RSS and transient errors worsened. All are retained. Local signature-phase reduction is not a network multiplier. Equal full-window stage rates use identical2048numerators and one complete measurement denominator; stage event times differ. Client observed final completion corroborates business/quorum/persistence, distinct from internal two-thirds vote instant. HTTP hook wall times include server/transport/scheduling/body/identity checks; they are not pure server or network CPU. Same-family earlier7763 runs are different VM samples and are not additional matched controls; earlier9V45 results cannot be used as a speed ratio.

Actual observer counters: control feature false/no stats, candidate enabledtrue, lookups2048/hits2048/misses0/fallbackMathVerifications0/fallbackFailures0. Every per-input current-state fee/nonce/height/context check remained. The original replay still independently verified2048unique signatures, retaining its original4096entry/4MiB limits; observer hits do not inflate its replay counters or count as extra business transactions. Expected reader chainID, decoder private migration chainID, SHA256 and full original bytes are bound.

## Real node Commit and remaining work

| Stage | Samples before/after | Before mean ms | After mean ms | Before P95 ms | After P95 ms |
|---|---:|---:|---:|---:|---:|
| commit | 32/28 | 19.025 | 17.759 | 37.639 | 31.786 |
| close_file | 32/28 | 0.008 | 0.008 | 0.010 | 0.012 |
| delta_encode | 32/28 | 0.211 | 0.240 | 0.513 | 0.556 |
| file_sync | 32/28 | 0.803 | 1.038 | 2.845 | 3.775 |
| journal_maintenance | 32/28 | 0.092 | 0.086 | 0.195 | 0.129 |
| prepare_file | 32/28 | 0.034 | 0.030 | 0.074 | 0.040 |
| validate | 32/28 | 17.682 | 16.137 | 33.907 | 27.162 |
| write | 32/28 | 0.186 | 0.210 | 0.496 | 0.344 |
| validate.app_hash | 32/28 | 10.440 | 10.179 | 22.839 | 20.050 |
| validate.semantics | 32/28 | 7.173 | 5.893 | 12.163 | 8.539 |

All32/28original Commit samples across4nodes, including empty blocks; nearest-rank. Writer source unchanged, different block sizes/empty blocks/fsync variation are not caused writer optimizations. Nested semantics/app_hash are included in validate, not additive finality.

Effective business blocks3..8: control205/442/597/183/176/445, candidate208/515/470/135/245/475. Both six business blocks, and every2048result remains counted. Finite startup, new identities, block scheduling and fixed order limit causal/statistical confidence.

Prefix private operations remain substantial: gateWait3487.185→3576.859ms, privateValidate492.152/23calls→392.526/23, suffixSetup192.840/5→228.320/5, suffixReplay682.197/5→659.321/5, certificatePublish206.025/6→188.422/6, nativeClone53.302/23→45.893/23. Each has0phase errors. These are nested and overlapping wall scopes across four observer workers, not additive CPU or finality. Client processCPU includes decoder/HTTP/runtime/GC and excludes separate node processes, so it alone cannot attribute pure node/server/network costs.

Next test client-local GOMAXPROCS1→2 as an explicit single-variable candidate while keeping8submitters/4observers/original suffix setup/observer facts and node environment1 unchanged. It is a scheduler-overlap hypothesis, not proven CPU headroom or throughput. Initial Go-only draft proves actual runtime2 is in the failed-setup report and previous scheduler is restored on every return; race PASS1.529s. Its controller/actual runtime binding/normalCI/newRoot window remain pending, and it is not part of this measured source73b4. No new load is authorized by this report.

For eventual10-minute proof, existing streaming components support900s,1million terminal records,1024one-second bins and2GiB combined encoded evidence. Current optimized native8/prefix/facts scope deliberately remains single-round and rejects streaming/ready-pool/enlarged cache. These capacities do not activate a long load. Extend separately with measured history/memory/durable/evidence costs and Root-selected budgets; keep full original history/fees/nonce/UNKNOWN.600k metric additions are not600k executed transactions.

## Window, original recovery and closure

Root once grant PERF_OBSERVER_FACTS_ONCE_GRANT_20261023T173112Z.json4293B/SHA723bc59769ae6c1187208b9980224de6ef32f74dd316ed0f2b6dfe7d7d32def7. Original dispatch17:33:23.157318Z followed O_EXCLonce/trigger records and fsync; gh returned0 and unique original run recovered, no retry. Both actual node-spawn timestamps independently before original17:41:12.301Z deadline. Native step17:39:03→17:40:36; job completed17:40:58. Cases10108/9672ms, pair20397ms/allretained93488508B, original post-fsync verdicts qualified/nullcause. No caps enlarged or timer weakened.

Two closure observations retain only original launcher38972/startTicks43824, with nodes/worker descendants absent. This is not a wholly empty process group or direct post-exit launcher/proc scan. Original normal workflow step/job terminal evidence is separate. Slot-return proof3772B/SHA073512e1b4338f343257421e36867e26ef7d419748e8248702c3dd8fe69b2e20 preserves its earlier full-raw-pending snapshot; final readout now fullOriginalBusinessRawReadoutPending=false. No new dispatch permission.

Artifact12520002155/23476591B selected original members verified with206ranges/CRC/size/SHA; no whole ZIP digest claim. Before recovery first hit original60s observation cap and exited142, preserved; cached continuation completed0. After recovered0 within the same cap. No benchmark rerun, expanded readout cap or substituted dataset.

[Full actual readout](evidence/observer-native-facts-pair-ci-39996035179-actual.json), [exact independent reader](evidence/observer-native-facts-runtime-reader-20261024.py). Reader takes original pair/2case receipts/2client results/2fixtures/fullCIlog/new output, requires all8logs and original terminal-run JSON, embeds its own SHA and3frozen source dependencies. Retained originals live under artifacts/chain-performance-20261017/observer-native-facts-pair-39996035179 and observer-native-facts-source. Goal remains unachieved: sustained1000qualified final business TPS for at least10minutes and finalP95≤3s still require proof.
