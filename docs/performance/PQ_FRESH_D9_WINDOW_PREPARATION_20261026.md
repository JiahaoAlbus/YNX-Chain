# d9 exact-source four-node window preparation

## Actual consumed window — run40311847501

Root granted one exact original window with grant3966 bytes/SHA256
`ae5fcf6a48e3011039705c3ec92e64c3f9bebd60c5efd228e93508294224fb73`.
One dispatch exited0 at2026-10-26T11:00:54Z. Actual run40311847501 used exactd9
and the frozen ref. Runtime stopped at the105s active deadline: child3262/-15,
guard105224ms, cleanup complete and empty scans105167/105224. The grant is
consumed. No redispatch, limit extension or increased offered load occurred.

Before completed16 independently validated business callbacks; after completed
zero and retained4 started/unreturned offers as UNKNOWN. The complete32 pair
failed. All148 unique Commit records and148 validation partitions (before92,
after56) bind to the same child/arm/node/H and original source. Seven original
outputs, prepared11/manifest7, actualSOURCE and fourELF pins were checked. The
result ZIP65426 bytes/SHA256
`b8c8a0a464d9de8dd541ed8997e70817066895c8a466ba0518eb9b555f3df76f`
was downloaded once. No local fresh/stage ZIP was downloaded. Original same-VM
fresh intake fetched once; its fresh-only recipe did not fetch stage DATA.

| Before16: offer to observed boundary | P50 s | P95/P99 s |
| --- | ---: | ---: |
| First-node Finalize completion | 2.706 | 3.306 |
| First-node durable Commit completion | 2.832 | 3.551 |
| All-four durable Commit completion | 3.055 | 3.726 |
| Independent verification completion including queue | 17.259 | 19.428 |

Actual proposal receipt and earliest BFT formation were not captured and remain
null. Boot ID and CPU utilization were not measured. PeakRSS735551488 bytes,
threads56, private502602545 and build166448880 were below caps. Deadline is the
actual first cause, not a resource or consensus failure inference.

Restricting physical timers to the same before business heights26–34 yields36
unique node/H records. Outer Commit P50/P95/P99=230.502/318.134/375.300ms;
validate167.887/235.870/265.532ms, JSON39.407/108.194/111.543ms, and
file-sync1.612/4.773/13.002ms. In these36 validation partitions, pq_state accounts
for75.539% of summed timers. Across all92 before records it is72%, while engine
snapshot P50 is0.589ms and its share1.42%. These are node-timer aggregates, not
CPU/wall-time percentages. Different runners still prevent a causal facts A/B;
the completed pair and total latency did not improve to the target.

The after arm's first offer-stage begin is parent101.940228553s. Original source
enforces at least500ms between successful Start offsets, so the last of16 offers
cannot start before parent109.440228553s. Even optimistically granting the
parent clock the entire105s, the offers alone exceed it by4.440228553s, before
completion/proof work. This is a bound from observed parent time plus the source
pacing invariant, not an extrapolated measured after duration or a subtraction
from the differently based guard clock. An unchanged rerun cannot resolve this
window's time budget. Runtime PQ-history revalidation and coordinator/proof
waiting must be reduced in source before another exact grant.

Original artifacts are under
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-d9-whole-once/`.
The complete terminalH is16297 bytes/SHA256
`e7f8b7f67328fc222e7598129b89143f0c6dbbc4e4c15dea2f0138289cd5682b`;
raw report311568 bytes/SHA256
`00071971cb413b867c3c6995c304a4fa9bad031508e23c8a376be39dbda0ce25`.
The exact seven pins, transaction coordinates and business-height subset are
tracked in `evidence/pq-fresh-d9-terminal-diagnostic.json`.

Following this failure, Root assigned only the next fresh harness file to Perf.
Its separate source87a064754 observes accepted ProcessProposal calls and binds
final block hash/H/ABCI/index, preserves original responses/rejects, and emits
at most32 compact512-byte lines from the existing16KiB reserve. Other Protocol
runtime/cache/native/controller/workflow dirty remains with its owners. NewGo
regressions are awaiting the original Linux normal CI; the local attempt never
entered tests because its missing1.26.10 toolchain download was stopped after
recording the owned PID/cwd and actual progress. Do not claim a Go PASS from it.
The paired consumer's previous02cc source normalCI40311452687 whole succeeded;
new proposal-readback JS tests27 passed locally. No new candidate is activated
or qualified for sustained1000TPS by these source/reader checks.

The preparation record below predates the consumed grant; its false runtime
flags and old missing-ref evidence are intentionally preserved as snapshots.


Root handed off producer `d9ba81f2b0806547c0c54cf6fa76df8fd0edf72a`,
tree `00e381d7bd49238d270aa61a392f4754b89647c6`, normal push
`40301495281/1` whole success. The original whole H is 8393 bytes, SHA256
`337c6bb0cc20f824c5ce0c7ad014dc2e8c86d7cc16cc70a6005fd7bab02b157c`.
Its nine referenced evidence files were independently size/hash checked. This
normal CI result is distinct from node performance, deployment and activation.

Actual Git readback retained 32 source contracts. The entire 67-step focused-go
job is equal to the preceding 2cf job after YAML parsing. The current workflow
has twelve top-level jobs; its three added jobs are push-only and not selected
by the fresh workflow_dispatch. The other eight non-focused job conditions
also exclude this exact fresh dispatch. Original controller/intake, 13 inputs,
runner, all resource caps, seven public outputs and fixed client are preserved.

The actual original delivery log supplies a unique fresh SOURCE, 3540 bytes,
SHA256 `ee480b01c9ce1f14975feb6a41bed28c1d2581a5a1839d7b560817be756b873f`.
Its three source leaves match actual d9 Git blobs and the earlier 2cf leaves.
The client remains 70e7, command tree19b9, whole tree4866, original da306 producer;
SOURCE/build-info pins and ELF bytes remain exact. Gateway and proof verifier
match the same-source normal runtime producer's actual clean GoInfo. Consensus
Go test ELF does not claim embedded VCS information. No local ELF execution or
local GoInfo occurred, and original relocation does not rerun GoInfo.

One official metadata request selected the following DATA. Neither ZIP was
downloaded locally; original same-VM intake would fetch fresh once only after
Root's exact grant. Stage remains DATA without GET.

| Role | Artifact | ZIP bytes | Official SHA256 |
| --- | ---: | ---: | --- |
| Fresh | 12641148592 | 82013858 | 694c9d5c34275a74f1ebde3e35e3e385ce3dd0157a24a69f058dc834b074e0ee |
| Stage | 12641485748 | 12186435 | 71b2c4b15b816e8ab32bf2e8ca6cb87e2667a243100c357b85a4778c78db639d |

Four actual fresh ELF pins:

| Role | Bytes | SHA256 |
| --- | ---: | --- |
| consensus.test | 54164555 | 719b839acf24c3ad6085e29083455d30551995b5dcd9c8701623613a6164a410 |
| ynx-bft-gatewayd | 36986090 | 640e3278fd626fdf6dda49e6748df50891d9ed665540b893b03362415e8fa633 |
| fixed perf client | 38595797 | a34a55a856e021c71565b1155b2767951e73147771841fc80f73f6e582a6edec |
| proof verifier | 36700719 | ec02514c2ffb3eb3f869889d575335de946be0f19f5b8388fcb7d2d03714c720 |

## Remaining exact readiness item

The required create-only ref is
`codex/ynx-pq-remote-d9ba81f2b0806547c0c54cf6fa76df8fd0edf72a`.
The earlier actual `git ls-remote --exit-code` returned 2 with zero stdout;
that original missing-ref evidence remains unchanged. Original owner then created
the ref once: GET404, one POST201, independent GET exact d9 and commit/tree GET
exact00e381. Performance checked the 4309-byte H, SHA256
`8a629fe7434c7fe3d226a9ff241b881cf9a2726a3a053a4939e4fbe7e04c15bb`,
and all fifteen original evidence pins. No force/update, workflow or product
execution occurred. Source/ref/metadata readiness is now complete. Actual
prepared, execution readiness, Root START and dispatch remain false.

The old tuple is preserved. Final tuple is
`FINAL_FULL_WINDOW_TUPLE.json`, 69735 bytes, SHA256
`1d29da908c35c4f2655d459fa763c157dc6a24bef5061e2af83f5fbecc34c119`;
final independent source readback is23307 bytes, SHA256
`32c31a99bd9ded6b669a9dde7f93ff20181e7f3b20241db95e30b1b3b928acc0`.
Both originals are in the same preparation directory. Root has these exact pins
for the next once grant; Performance did not dispatch before authorization.

Only Root can schedule a new exact one-time
window at pressure level1. Original 105s active/15s cleanup/120s total, 1GiB RSS,
16 processes, 320 threads, 512MiB private workspace, 1GiB build, 1MiB logs, 200ms
sampling, all disk/memory/reserve floors and >=150s remaining budget are intact.
No boot ID or CPU utilization is fabricated. All seven original terminal
outputs and unsuccessful/UNKNOWN effects must be retained; no replay or cap lift.

## Comparison and next source boundary

The original two arms are the same-binary client `decode-index-again` versus
`reuse-validated-index`. d9 includes a8fee75cf's attempt-local immutable registry/
schedule/snapshot validation facts in both arms. A comparison with the earlier
2cf run on a different runner cannot establish a causal performance gain from
those facts. That would require an original-owner-supplied matched baseline and
candidate comparison. Complete original d9 calibration is still necessary.

The preceding actual 2cf measurements put pq_state at44.61% of summed inner
validation timers. d9 still traverses full PQHistory in account_policy.go;
initial registrations call validatePQInitialRegistrationHistory and real
VerifyPQInitialRegistrationPossession again. This is an actual repeated source
path, but there is no measured partition inside that44.61% yet. Original owner
was given this trace for the next bounded substage measurement and optimization,
with full cold/external validation, immutable ownership, dual proofs, revocation,
nonce, errors and mutation rejection preserved. No unmeasured signature-cost
percentage or cache benefit is claimed.

The remaining real-inclusion timing gap was also handed to original harness
owner: observe ProcessProposal with parent monotonic time and bind actual final
block hash/height/ABCI identity, excluding rejected competing proposals. Current
Finalize/durable/queued proof boundaries remain distinct. This request does not
hot-change the frozen d9 window.

Exact tuple and source readback are tracked under
`evidence/pq-fresh-d9-full-window-tuple.json` and
`evidence/pq-fresh-d9-producer-source-readback.json`. Originals and raw ref
readback remain in
`/Volumes/西部数据/YNX-large-work/chain-performance-20261017/pq-fresh-d9-preparation/`.
Sustained1000 effective business TPS/10minutes and P95<=3s remain unproved.


## Successor queue source (not part of consumed d9)

Perf's single-leaf successor isf1d855b3bb811f5fe286badad73162f91107bfe6,
parent4caa0d4693eaa259808396ed8591e4dc9ce57065, leaf147390 bytes/SHA256
`5c1542b2ba540792016cf3a67da9ff09aa6effb6261e5b9ca6e355981a2301cf`,
blob `e9640af440c0a74ec4c3f121ac989863998a9078`. The original Protocol owner
then committed the corresponding controller/caller/test/workflow pins as
28251767dd8098275e59a96f86935e413e5f1355/tree
`d12159665a09cd5206f0ab9ea89c55af120a7f84` and pushed normally. Original Linux
controller SHA is
`51c75b4d81095836c5403524cfc6d6307c9452b71711b3ec69cb827507f1a4a5`.
Old623a/4890 fresh-source pins must not qualify this successor. Previous4c whole
CI success is not successor282 whole success or a new runtime measurement.

The original offer and readback queues now overlap on the same coordinator.
Only a completed original offer and original Host stores identifying exact
bytes, all four successful executions, block/successor evidence and unchanged
full AND/quorum verification can start its readback. Later signed offers remain
paced at no more than2/s, never catch up, and UNKNOWN is never reoffered. Each
queue keeps four slots. Including four verifier children plus test/gateway/
controller gives an upper bound15 owned processes under the unchanged16 cap;
actual RSS/thread/private/guard admission remains required. Preparation stays
inside the guard. All children are canceled and joined on either stage failure.
The same immutable historical height is fully checked once, with no historical
or ledger deletion. All final account/balance/nonce and cold-stop checks remain.

The three new pipeline tests cover early readback versus last offer,500ms pacing,
read-only readiness without another offer, cancellation/join of both started
Wait sets and both four-slot bounds. Proposal tests additionally cover actual
Application delegation, competing rounds, caller mutation, capacity and null
replicas. Actual new-source Go results must come from the original normal Linux
suite/observer. Perf did not rerun a package or resume the stopped Darwin fetch.
The reader has28 local passing tests and consumes both seven/eight-field logs.

The new source removes the old global submission barrier; it does not prove
that full32 now fits105s. New setup/queue/verification costs, complete source
and artifact/ref pins, normal CI and a new exact Root resource grant remain
required. Both arms enable the new pipeline/core cache, while the original
paired variable remains client index decoding/reuse. This cannot establish an
isolated causal gain for pipeline or core cache, and cannot be relabeled as a
successful controlled source-version A/B. Source ownleaf H is tracked in
`evidence/pq-fresh-pipeline-ownleaf-f1d855b3b.json`; original d9/UNKNOWN records
remain unchanged. No additional pressure run is authorized or started.
