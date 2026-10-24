# Complete original four-node Status-tip pair

Original run40078716515/source1c86e2bad07f505ef39db7b324b8db225fde4088 now passes independent full admission. The original frozen archive reader recovered549 public members/44,571,361B and verified full8192x2 signed business evidence. Independent reader repeated the original archive audit with zero network, checked exact grant/once dispatch/source/normalCI/fourELFs, original case/pair receipt SHA against CI terminal records, all resource bounds, client-exit-before-verifier and cleanup. This is finite-pair admission, not sustained1000/s qualification.

Conditions: same Linux x86_64 VM, four logical CPUs; four isolated consensus nodes, eight submit workers/four observers, configured1000/s, bounded cadence, GOMAXPROCS1/GOGC100/GOMEMLIMIT off,8192 transactions each. Only full latest-block discovery versus Status discovery changes. Both retain authenticated block/BFT proof, state execution and persistence. No public network or real accounts involved. The later checkpoint encoding candidate and stream16 source are not part of this run.

| Complete-window metric | Before | After |
|---|---:|---:|
| Actual offered transactions/s |276.17|327.68|
| Effective final transactions/s |258.57|310.36|
| Client CPU seconds |24.52|18.99|
| Offer→client final P95 upper bound ms |2075|2124|
| Aggregate sampled peak RSS bytes |1,034,326,016|1,069,101,056|

Final rate increases20.03%, but inclusion/final tail non-regression fails. Status stays off by default. The after peak leaves only4,640,768B under the1GiB guard; sampled peaks do not establish a stable memory margin.

Real business Commit phase mean/P95 milliseconds (all four node execution samples;38 business blocks per node before,31 after):

| Phase | Before mean/P95 | After mean/P95 |
|---|---:|---:|
| Total Commit |42.478 /82.848|43.496 /79.874|
| State validation |39.246 /74.661|39.307 /71.759|
| Validation state hash |25.652 /48.865|25.827 /50.649|
| Validation semantics |13.528 /27.875|13.378 /25.704|
| Delta encoding |0.179 /0.407|0.223 /0.383|
| Journal write |0.201 /0.302|0.202 /0.315|
| File sync |1.021 /3.036|1.272 /3.366|
| Journal maintenance |1.763 /20.370|2.423 /26.100|

Validation and state hashing dominate this measured Commit path. Stages are nested; percentile values cannot be added. Block density differs, so per-block means do not prove a causal node speedup. Checkpoint maintenance spikes remain separate from delta encoding and file sync.

The full signed stream is joined to original endpoint logs by transaction/block/height. Conservative calibrated upper bounds in milliseconds:

| Offer to observed point | Before P50/P95/P99 | After P50/P95/P99 |
|---|---:|---:|
| Node FinalizeBlock return |1004 /1597 /1806|1032 /1584 /1742|
| Node durable Commit return |1059 /1649 /1871|1085 /1638 /1790|
| Client final observation |1499 /2075 /2482|1540 /2124 /2305|

These distinguish actual node execution and persistence from client observation. Node Commit return is not the earliest instant a BFT quorum formed. The original cryptographic BFT verification remains required; the join alone does not establish network admission. All8192 records per case join without published-Info/durable-state ahead rows; maximum calibration bounds are18,075ns before/15,199ns after.

Portable readers and the machine comparison are in this directory's evidence folder. Original artifacts, raw logs, failed reader attempts, range cache and immutable complete verdict remain on WD. The comparison machine file pins their bytes and SHA256. Original recovery timeout attempts are retained; no node rerun was used to replace this evidence.

Next: bind the explicitly tested16-submit candidate through the existing controller/worker/archive verifier, compare actual offer/queue waiting/CPU and finality under a fresh exact Root window, and continue profiling state validation/hash. Continuous1000 valid final transactions/s for600s and later3–5k/s remain unproven.
