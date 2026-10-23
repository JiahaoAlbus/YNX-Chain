# Actual four-node runtime pair 39964428468

The repaired shutdown completed safely on both cases. Independent reread of all
4096 original transactions and both fixtures reproduced the original case/pair
business, signature, inclusion, quorum, durable-state and latency results. All
eight original ABCI logs exactly reproduced the original phase aggregates and
had valid shutdown frames with zero in-flight handlers. This is one finite pair,
not sustained 1000 TPS qualification. The preceding failed run 39957093049 remains
an unqualified diagnostic; it was not converted into a passing baseline.

## Source, conditions and actual closure

Run [39964428468](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/39964428468),
job 120450480861, attempt 1, source cbb4f9160845d58f28f830d88ffb8909a147ef34,
tag codex/chain-drain-cbb4f9160. Normal CI 39962298228 succeeded before Root's
single-use grant. Both cases ran sequentially on the same actual Linux VM,
AMD EPYC 7763, four logical CPUs, using the same four compiled ELF identities.
Configuration: grpc, relative pacing, 2048 independent nonce-1 senders per case,
64-byte data, four submitters and observers, configured 1000 offers/s,
GOMAXPROCS=1, GOGC=100, GOMEMLIMIT off, diagnostic phase timing enabled.
Fresh fixture identities and block scheduling differ between cases.

Post-fsync case windows: 10926/10600 ms; complete pair 22155 ms. Retained pair
94154835 bytes below 128 MiB. Sampled RSS peaks 781086720/770666496 bytes;
threads 63/64; private data peaks 46389356/46745033 bytes. Both case and pair
post-fsync verdicts qualified, with original double empty closure scans bound to
the same launcher/start ticks. The slot returned. No second dispatch or workload
retry was performed. Original 60-second range-recovery timeout records are kept;
only unread cached ranges were continued, with size/CRC/SHA verification.

## Actual business and queue-inclusive completion

Each case: 2048 offered/submitted/CheckTx-accepted/effective-included/quorum-final
transactions. Zero rejected, execution failure, UNKNOWN, timeout, observation
failure or not-submitted outcomes. Transient observer error occurrences remain
11313/12801, not zero errors. Qualified final means client-observed completion
after inclusion/quorum/publication/durable business checks; it is not a directly
measured internal two-thirds-vote timestamp.

| Metric | Shared | Prefix |
|---|---:|---:|
| Measurement window s | 6.404088363 | 6.202805097 |
| Actual offered interarrival/s | 993.977977 | 996.691455 |
| Actual submission interarrival/s | 438.036546 | 447.196659 |
| Full-window effective included/final TPS | 319.795712 | 330.173199 |
| Offer→inclusion P50/P95/P99 ms | 1898.602/3949.265/4081.986 | 1932.802/3858.487/3943.323 |
| Offer→qualified final P50/P95/P99 ms | 2332.837/4472.969/4532.169 | 2326.685/4280.527/4429.482 |
| Queue P50/P95/P99 ms | 383.767/2660.002/2695.668 | 349.729/2550.386/2594.608 |
| CheckTx P50/P95/P99 ms | 2.030/43.216/121.791 | 2.066/42.267/107.858 |
| Offered queue peak | 922 | 926 |
| Accepted observation queue peak | 990 | 1020 |

Finite final TPS increased 3.245%; queue-inclusive final P95 decreased 4.302%.
Inclusion P50 and both queue peaks worsened. Final P95 exceeds 3 seconds, so
finiteJointImprovementObserved=false and sustainedTPSQualified=false. The older
Intel VM pair is not a controlled before/after baseline for this AMD VM.

## All real Commit samples, including empty blocks

Shared has 36 samples; prefix has 32. Quantiles use nearest rank on all original
completed samples, without selecting successful intervals. Different block
counts/scheduling prevent interpreting these differences as an isolated causal
effect. These are node wall times, not end-to-end confirmation latency.

| Phase | Shared mean/P95 ms | Prefix mean/P95 ms |
|---|---:|---:|
| Whole Commit | 17.292/28.366 | 20.060/32.991 |
| Validate | 16.072/26.622 | 18.238/31.676 |
| Semantic validation child | 6.492/12.187 | 7.436/15.695 |
| AppHash child | 9.509/19.506 | 10.622/20.455 |
| Delta encoding | 0.184/0.585 | 0.440/1.664 |
| Write | 0.163/0.384 | 0.182/0.387 |
| fsync | 0.730/2.464 | 1.053/2.964 |
| Prepare file | 0.034/0.056 | 0.033/0.059 |
| Close file | 0.009/0.024 | 0.009/0.020 |
| Journal maintenance | 0.090/0.138 | 0.090/0.173 |

Validation children are already inside Validate. Cumulative parallel/nested
durations must not be added to client finality. This pair provides no evidence
that encoding or persistence became faster.

## Reader work and next source optimization

Client RUSAGE_SELF CPU: 4.913010/4.682113 seconds, or 76.717/75.484 percent of one
core over the measured windows. This includes runtime/GC and excludes node CPU;
it does not prove saturation or pure network cost. Both sides started/returned
2048 callbacks, peak active 4, active at end 0. Overlapping callback busy wall
time was 18.006/17.597 seconds; it is not additive latency.

Shared: 7 full replays, 21 joins, 8237 replayed inputs, 2048 mathematical native
signature verifications plus 6189 exact-input fact hits. Private JSON decode
21 calls/1.589467 seconds; private full validation 0.568964 seconds.

Prefix: 1 full replay, 27 prefix reuses, 8 replayed blocks/2048 inputs, all 2048
native mathematical signature verifications retained. Real phase totals:

| Prefix phase | Calls | Cumulative ms |
|---|---:|---:|
| Gate wait | 28 | 4660.370 |
| Prefix check | 28 | 21.785 |
| Private JSON | 27 | 1291.035 |
| Private Validate | 27 | 309.284 |
| Full replay | 1 | 148.968 |
| Suffix setup | 6 | 168.435 |
| Suffix replay | 6 | 634.311 |
| Suffix encoding | 6 | 89.278 |
| Canonical copy | 21 | 9.409 |
| Certificate publication | 7 | 6.764 |

All these phase error counts were zero. Gate wait is cumulative contention across
parallel readers, not 4.66 seconds of user finality. The next concrete candidate
targets private state/account/fee-history reconstruction, preserving full state
validation, exact source/canonical hashes, caller-private snapshots, signature
verification and quorum checks. No new network window is authorized by this
report. Source/light tests continue; another four-node comparison requires the
next Root-coordinated window.

## Retained evidence and reproduction

[Machine evidence](evidence/drain-runtime-pair-ci-39964428468-actual.json):
1150692 bytes, SHA256 2a8899cec1d614b54dc6e79cd3b54f581bc402cec0b560eee8d6898c1c5936cd.
It includes original-file pins, independently recomputed business/latency facts,
runtime measurements, guard results, all eight terminal frames, phase aggregates
and full phase distributions. Artifact 12506228093 is 23649665 bytes; recovery
verifies selected member/range hashes, not a whole-ZIP digest.

Offline verifiers are retained under
artifacts/chain-performance-20261017/abci-drain-window-source/:
read-runtime-pair.py (eight original input paths then new output path), and
read-node-distributions.mjs (original raw directory then new output path).
They read existing evidence only. The exact raw directory is
artifacts/chain-performance-20261017/drain-runtime-pair-39964428468/.
