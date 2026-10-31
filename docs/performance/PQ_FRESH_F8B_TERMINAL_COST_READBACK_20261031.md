# f8 original bounded four-node cost readback — 2026-10-31

Source `f8b819c00d3baa809d6c475f6dad4f5bcda22353`; original run [41178187822/1](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/41178187822). Official remote state is completed/failure. This is isolated cost calibration, not sustained load qualification.

The original grant was consumed once. The sole result ZIP (artifact13034275545,74137 bytes) matched official SHA-256 `d22274dfd24a0ce118572477e0a04fc455083fad43b40cc4e7c092f86b979dfa`; all seven originals were retained. Frozen source-bound reader exited0, and independent physical phase joining passed. Neither observation upgrades the failed pair into a successful run.

## Actual stop and business observations

Private directory limit caused termination at100739ms: sampled538946192 bytes >536870912. Cleanup completed. Maximum sampled RSS804724736 bytes and63threads; CPU utilization was not measured. Before arm had16 independent callbacks; after arm4. After offers8–11 have no observed return and remain UNKNOWN; offers4–7 returned without a verified callback. Do not replay them. Missing completion is not rejection.

## Measured stages

Milliseconds, nearest-rank P50/P95/P99. Physical samples include setup/empty/business commits and are deduplicated by arm/node/height; they are not multiplied by transaction count.

| Stage | Before (92 commits) | After (76 commits, censored arm) |
|---|---:|---:|
| validate | 37.797/144.899/179.016 | 34.843/118.205/138.326 |
| json_encode | 37.200/146.466/181.941 | 27.882/119.875/148.836 |
| write | 0.676/2.409/21.444 | 0.640/1.152/9.563 |
| file_sync | 1.415/20.093/28.931 | 1.205/6.267/28.801 |
| directory_sync | 0.186/9.893/16.280 | 0.183/1.961/26.029 |

PQ state validation accounts for60.90%/56.31% of summed validation timers in before/after; app hash24.76%/22.58%. These are sums across replicas, not CPU or critical-path shares. Fee history is not separately timed here, so these numbers do not establish fee-history copying as the dominant cost. Protocol owner received the raw findings for finer pq_state measurement and source optimization.

## Business latency observations

Seconds, P50/P95/P99,16 before callbacks and4 completed after callbacks. The after subset is censored and cannot establish causal improvement.

| Observation from original offer | Before | After partial |
|---|---:|---:|
| firstNodeProposalReceiptNs | 1.458/2.220/2.220 | 0.665/1.411/1.411 |
| firstNodeProposalAcceptedNs | 1.492/2.240/2.240 | 0.675/1.425/1.425 |
| firstNodeFinalizeNs | 2.659/3.420/3.420 | 1.505/2.565/2.565 |
| firstNodeDurableNs | 2.855/3.712/3.712 | 1.643/2.694/2.694 |
| allNodesDurableNs | 3.184/3.846/3.846 | 1.827/2.802/2.802 |
| offerToIndependentNs | 6.933/8.371/8.371 | 5.011/6.964/6.964 |

Proposal receipt/acceptance, execution completion, four-replica durable observation, and independent proof completion are different boundaries. Earliest BFT certificate formation was not measured. Before independent completion P95 exceeds3seconds; this run does not satisfy the latency or1000TPS target.

## Retained storage and next implementation

Two identical post-cleanup metadata scans total538954527 bytes: consensus WAL267998200 (~49.7%), blockstore113317564, tx index32364157, application snapshots32700912. New otherKinds metadata identifies host-input-state49710272, host-context5153712, client-wire3907168. These are retained bytes, not historical category peaks or write rates. Preserve history and durable safety; do not remove files or increase caps to turn this run green.

Local-only negative readiness hint `a4b63d3e8843c19a07bb2a53b1db3cb6079555fd` remains separate from this f8 run. Its four-file source-pin/CI closure V2 was handed to Protocol, with git apply --check passing; no application, build or runtime benefit is claimed here. Root received the full terminal handoff and the request to schedule the next qualified candidate at pressure level1 under unchanged comparison conditions. No new runtime was dispatched.

The current implementation direction is to reduce needless full payload probes when original successor tips are insufficient, and to have Protocol split/optimize measured pq_state validation and JSON encoding while retaining full checks and fsync. Four-node paired and sustained performance remain unproven.

## Evidence

Local original directory: `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-f8b-whole-once`. Committed handoff: `evidence/pq-fresh-f8b-terminal-20261031.json` (52531 bytes, SHA-256 `a42556205d36dc213c757d56e517d68067d0104f7a6aae4256913d11dba93ed2`). Exact reader command and raw input/output pins are retained there.
