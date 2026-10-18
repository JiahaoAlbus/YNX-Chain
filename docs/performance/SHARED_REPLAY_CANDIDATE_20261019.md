# Explicit identical-content durable replay candidate

This owning client change follows actual phase run39145119313:19 full durable validations replayed75 blocks and11614 transaction inputs for1024 final transactions, with2770.317ms cumulative decode/replay across concurrent observers. That sum is not one transaction latency. Original per-node Commit encoding and fsync were only milliseconds in this finite case.

The real signed-journal RED test at70c0382214a64289ff46411e5b95cac96293cc2f failed normalCI39145953773 because identical bytes invoked full replay twice. Failure raw remains artifacts/chain-performance-20261017/shared-replay-source/normal-ci39145953773-red.raw,495853B, SHAd7a83bab4ee9bd4245f269f956d211e1c3c1f3c6ee67899bf3e85a387066513f. This was an assertion failure, not a compiler failure.

Candidate0d2a20e923730f6dccf2f9e77c1efaa255ab15cd adds explicit -shared-durable-replay, defaultfalse. It requires paced observer timing and original16MiB store bounds without the extended reader/cache profile. Only a successful complete replay of exact freshly captured block-journal bytes may supply canonical reconstructed JSON. A migration-bound reader retains at most one16MiB canonical entry and four concurrent digest flights. Equal current contents coalesce; changed content gets a new complete replay. Failed and canceled producers never publish successful cache entries. Larger canonical results retain original successful decoding but are not cached.

Every node independently opens its current file, acquires the original journal read lease, hashes it, captures stable bytes and verifies the captured digest before lookup. Each hit receives independent canonical bytes, parses its own mutable state and runs full CommittedState.Validate. Fee and nonce indexes remain path-private. Each business transaction still undergoes original signature, matching fee, nonce and height checks, and the observer still verifies current published Info, quorum and inclusion proof. No node or production consensus path changes; internal tree remainscfbd76d52a6e22ebfae809699a37b6c039cb20f5. Default independent-store full-replay tests remain in the original CI.

Additional counters explicitly separate actual full replay calls, cache hits, in-flight joins, failed producers, bypasses, canonical retention bytes and waiting time. Existing block replay counters report work actually performed; cached logical blocks are not counted again. Decode-phase wall includes cache join wait, independent parsing and validation. Parent/worker sums still overlap.

New tests use real signed committed journals and check independent mutable state, fresh hashing, same-size corruption, deletion, changed generation, future-height refusal, transaction signature refusal, published height, quorum, failure/cancellation and bounded retention. Python34 refusal/source tests passed locally without nodes. Candidate normalCI39146295519 correctly refused a test peer lacking the original read lease file. The test peer was repaired through the original writer, actual signed execution and Commit at488a7435a62531f524bf53f9cc7977730e1bb33e; runtime guards were unchanged. NormalCI39146562337 completed SUCCESS, including all six new candidate tests and the original independent-store full-replay guard. Full raw evidence and source identities are recorded in [source validation](evidence/shared-replay-source-ci-39146562337-actual.json). No candidate network result or improvement multiplier exists yet.

The initial3145B preparation above was subsequently integrated through the original pair controller at4b5352aae88228c9916217710a134834357fa884. NormalCI39147153397 passed37 source/refusal tests. The integrated recipe4988B has SHAc504a71a2d7860693d78d67888ba2d245f3e7071e894c06a15684b770c9ce8c2. Only explicit paired-independent-shared with observer timing on can select this comparison. Old pacing-pair recipes remain byte-identical; all original caps remain unchanged.

## Actual matched pair39147446019

Root granted one original workflow_dispatch at4b5352aae88228c9916217710a134834357fa884. Same VM/source/four ELF files/compiler/512x2/gRPC/bounded-cadence and phase timing on both sides; only shared replay changed. Original120s/45+15/1GiB RSS/32MiB data/64MiB retained/2MiB logs/1GiB build and native guards were unchanged. Both cases actually started: each1024 valid business inclusions and qualified finals, zero UNKNOWN/timeout/reject/execution failure. Both closures were empty twice. Post-fsync terminal qualified=true, firstCause=null,12352ms,44302130B retained.

| Actual finite metric | Independent replay | Shared replay |
| --- | ---: | ---: |
| Full-window effective inclusion/qualified final per second | 252.154055 | 314.247791 |
| Actual offer interarrival per second | 353.455842 | 391.832023 |
| Actual submission interarrival per second | 353.486925 | 390.165412 |
| Offer-to-inclusion P95,ms | 1288.112 | 1268.687 |
| Offer-to-qualified-final P95,ms | 1470.987 | 1357.586 |
| Actual complete replay calls | 17 | 4 |
| Replayed transaction inputs | 10612 | 2370 |
| Cumulative decode/replay wall,ms | 1599.101 | 581.311 |
| Sampled owned peak RSS,B | 566595584 | 575799296 |
| Sampled peak private bytes,B | 21160001 | 20934963 |

Finite final throughput improved24.6253%, final P95 improved7.7092%, inclusion P95 did not worsen. The original finite joint guard passed; sustained qualification remains false. Candidate16lookups=10hits+2joins+4full replays, no failed/bypassed producers; canonical retention1016977B, peak flights1 and cumulative join wait160.514ms. Both cases still independently verified1024 transaction signatures/fee/nonce outcomes.

Adverse changes remain: submission queue P959.848→15.996ms and P9936.523→100.014ms; CheckTx P9517.016→22.947ms. Reader hash4.905→46.994ms and capture20.021→51.105ms increased. Sampled RSS increased9203712B. This is an actual sampled fit in the original caps, not a proof of instantaneous clone peak or2048tier fit.

Before had5 workload blocks/6Commits per node, after4/5. Fixed order, fresh fixture identities and startup/cache/I/O variation limit causal attribution: do not assign all24.6% to cache or infer a general multiplier. Parallel phase sums overlap and include nested scopes; candidate decode includes join wait. Default remains off; no new network run, cap increase, sustained1000TPS or2048tier admission follows.

Canonical [actual readout](evidence/shared-replay-pair-ci-39147446019-actual.json),41645B SHA79fbc5521a1fb3315caf8443f27f13668f3bbdfe339c183fdc32087fb387710d. Raw files remain artifacts/chain-performance-20261017/shared-replay-pair-39147446019/; original log is shared-replay-source/pair39147446019-full.raw. Selected ZIP members were recovered by exact HTTP206, verified by uncompressed size/CRC and individual SHA256. Whole ZIP was not downloaded/hash-verified.
