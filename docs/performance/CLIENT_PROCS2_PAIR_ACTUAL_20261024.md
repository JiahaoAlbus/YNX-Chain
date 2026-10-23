# Actual client GOMAXPROCS1 to2 pair, 2026-10-24

Original once-only [run40003573456](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/40003573456) attempt1 SUCCESS, frozen source2e3b7a0042d18cf9a2a62947ce3b0e5faa87e419 / remote immutable tag codex/chain-client-procs2-2e3b7a004. Normal source CI40001570848 SUCCESS with7 actual selected RUN/PASS tests. Same actual AMD EPYC9V74 VM/4logical CPUs, same bootID/PID namespace and four once-built ELFs, gRPC/DATA64/2048independent signed native inputs each/offer1000/8submitters/4observers/original2048queues. Both observer facts enabled and original suffix setup; only actual typed client-local GOMAXPROCS1 versus2 differs. Node environment remains1. This hardware differs from previous7763/9V45 samples; no cross-run speed ratio.

All4096original business rows,2fixtures and8original node logs independently reconciled with the exact original validators, raw/receipt hashes, actual worker/runtime/backend counters, source/binary/host identity, all post-fsync case/pair terminals and original strict node shutdown frames. Each2048offered/submitted/accepted/effective included/quorum confirmed/qualified final, no rejected/unknown/unsubmitted/execution failed/timedout/observation failed business result. Transient observation errors are retained. All three selections recovered once within their unchanged60s range-recovery budgets, exit0; no benchmark retry, whole-ZIP digest or enlarged cap.

## Actual finite result

| Metric | Client1 | Client2 |
|---|---:|---:|
|Actual offer interarrival/s|996.337|995.564|
|Actual submission interarrival/s|750.534|809.625|
|Full-window RPC/accepted/effective included/qualified final/s|524.709|502.973|
|Client measurement seconds|3.903|4.072|
|Offer→effective inclusion P50/P95/P99ms|1700.777 / 2217.924 / 2326.354|1480.794 / 1953.662 / 2040.550|
|Offer→qualified final P50/P95/P99ms|2043.979 / 2585.618 / 2724.216|1779.674 / 2244.237 / 2321.415|
|Offered awaiting submission peak|318|207|
|Accepted awaiting observation peak|1776|1803|
|Sampled owned RSS bytes|779526144|761827328|
|Transient error occurrences|16757|19554|
|Client total CPU ns|2657785000.000|3782491000.000|
|Client CPU percent of one core|68.094|92.895|

Finite final rate-4.142%, offer→finalP95-13.203%. Both finiteP95≤3s, but throughput fell, accepted observation backlog and errors increased, and total client CPU increased42.317%. No joint improvement or sustained1000 qualification. Do not promote client2 as the default. Smaller sampled RSS and faster submission do not override the full result.

## Ordered client stages and node persistence

| Actual observed stage | Mean1 ms | Mean2 ms | P95-1 ms | P95-2 ms |
|---|---:|---:|---:|---:|
|Offer→submission|85.077|67.400|390.040|495.769|
|Submission→CheckTx observed|7.874|6.818|37.742|25.938|
|CheckTx observed→inclusion observed|1579.227|1383.732|2041.768|1880.692|
|Inclusion observed→qualified final observed|329.598|304.839|425.455|451.007|

All2048per-row phase sums are exact. After CheckTx→observed inclusion is78.50% of mean observed final delay. It includes chain waiting/polling/client scheduling; final interval includes quorum/durable proof and scheduling, not an internal BFT vote instant. P95 values are not additive. Actual business block counts3..6 are219/712/1008/109 versus245/989/594/220. Last final occurs3901.772→4070.145ms into the measurement; last-block packing/timing and startup differ, even while most per-input latencies improve. The single observed interior interval is not sustained TPS.

| All-node Commit stage,20 samples each including empty blocks | Mean1 ms | Mean2 ms | P95-1 ms | P95-2 ms |
|---|---:|---:|---:|---:|
|commit|36.094|31.557|134.171|151.053|
|delta_encode|0.217|0.507|0.561|1.386|
|write|0.211|0.216|0.485|0.496|
|file_sync|24.504|14.803|118.593|124.033|
|validate|11.005|15.900|14.672|31.318|
|validate.app_hash|6.082|9.954|9.471|24.277|
|validate.semantics|4.831|5.857|8.228|11.102|

Encoding/write are sub-millisecond means, while file_sync has118.593/124.033msP95 tails on this VM. Writer source is unchanged; block contents, host storage variance and scheduling differ, so this is not a writer optimization. Validation children are included in validate; concurrent/node/client durations cannot be summed as finality.

| Original reader/prefix scope, cumulative ms | Client1 | Client2 |
|---|---:|---:|
|captureNs|200.503|131.362|
|hashNs|14.826|15.458|
|decodeNs|3305.200|3477.318|
|transactionVerifyNs|3.854|4.540|
|gateWait|2173.809|2155.477|
|privateValidate|146.981|237.038|
|privateNativeClone|29.147|35.985|
|suffixSetup|74.158|88.009|
|suffixReplay|490.514|518.058|
|certificatePublish|83.877|104.341|

Both actual observer counters2048lookups/2048hits/0miss/0fallback/0fail, original replay math2048 and4096entry/4MiB cache bounds unchanged. Signature mathematics is already reused; additional client parallelism did not remove prefix serialization/full-state work. Cumulative decoder time includes waits across workers; CPU includes runtime/GC/HTTP and excludes separate nodes. GC/allocator or CPU-contention attribution remains unproven without finer evidence.

## Window and next action

Root exact grant PERF_CLIENT_PROCS2_ONCE_GRANT_20261023T182632Z.json3045B/SHAf315e34c59427caacf930be5f49101fa4213c4e2f06b4369442d14edc0443eb8. Original O_EXCL/fsync once dispatch18:28:28.765747Z returned0, unique original run recovered; no resend/renewal. Both actual nodes_spawned timestamps before18:36:32.398Z. Native34 ran18:34:32→18:35:52Z, full job completedSUCCESS. Case8920/8565ms, pair18039ms/94460967B; all original time/RSS/thread/process/disk/evidence/build guards retained. Admission/slot proof3728B SHAc2abd58c5c1bb3d206e0f80eef097106ec2147fcdbc5d852709b9d3a92c9d7a8. Both case/pair double scans retain exactly original launcher38508/startTicks45442, nodes/workers absent; not wholly empty PG and not direct launcher-exit/proc proof. Normal workflow termination is separate evidence.

Keep default client runtime policy and both negative results. Next owning source work must connect the existing bounded streaming/ready sender to an explicit native-prefix workload, preserving original single-round mode/guards and nonce/UNKNOWN/restart/fee validation. This closes the current inability to measure longer/history-growing loads. Record time-series valid inclusion/final TPS, backlog and stage/resource costs; add targeted runtime/allocator evidence where needed to distinguish state-validation cost from scheduling. No long load or larger budget is activated by this report; Root must separately approve the exact new resource profile. The eventual proof still requires600s/600000unique valid final business transactions at1000/s with finalP95≤3s, followed by the broader throughput targets.

[Complete original qualified readout](evidence/client-procs2-pair-ci-40003573456-actual.json), [ordered phase derivation](evidence/client-procs2-stage-gaps-40003573456-actual.json), [exact original verifier](evidence/client-procs2-runtime-reader-20261024.py).
