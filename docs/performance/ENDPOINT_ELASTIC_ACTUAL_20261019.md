# Elastic endpoint policy: actual negative result

Run `39157615295`, exact source `6183555d44a35d908e97fae9407e91d58be10c8f`, fixed tag `codex/chain-elastic-6183555d4`, completed successfully. This is safety/evidence success, not performance acceptance. Original shared submission baseline versus elastic per-endpoint2 policy used one VM/source/compiler/four binaries, gRPC,512 senders ×2 rounds, configured512 offers/s, four submitters/observers, bounded cadence, shared replay and observer/HTTP phase measurement on both sides. Elastic remains default off; no retry was issued.

| Actual metric | Shared baseline | Elastic endpoint policy |
|---|---:|---:|
| Effective inclusion/qualified final TPS, full workload window | 257.007687 | 218.231993 |
| Full workload window seconds | 3.984317 | 4.692254 |
| Actual offer interarrival rate /s | 304.774432 | 298.474143 |
| Offer → inclusion P50/P95/P99 ms | 948.158415 /1344.011766 /1457.670533 | 1070.839351 /1403.431702 /1606.354697 |
| Offer → qualified final P50/P95/P99 ms | 1157.581099 /1531.090819 /1584.182204 | 1256.938161 /1636.492951 /1735.695207 |
| Submission queue P95/P99 ms | 70.499644 /336.820365 | 153.215459 /288.978611 |
| CheckTx callback P95/P99 ms | 43.862216 /87.276480 | 18.632556 /55.446166 |
| Sampled owned RSS bytes | 556249088 | 588607488 |
| Actual workload blocks | 5 | 6 |

Both cases have1024 offered/submitted/accepted/effectively included/quorum-confirmed/qualified final transactions, zero UNKNOWN, timeout, rejection or execution failure. Callback counts are256 per original endpoint in the candidate, each returned once. Actual callback peaks are2 per endpoint and4 overall. Full-window final rate declined15.0874%; final P95 rose6.8841%. Improved CheckTx and queue P99 do not cancel worse queue P95 or inclusion/final tails: `finiteJointAndTailImprovement=false`. Neither policy is promoted and no sustained1000TPS claim follows.

## Real request stages

All1024 original rows per side have exactly one GetConn/GotConn/WroteRequest/first-byte hook, zero write errors and zero overlapping write/first-byte hooks. Quantiles are independently nearest-ranked from original monotonic offsets and checked against original callback duration; case/pair summaries alone were not trusted.

| Original client boundary, P95 ms | Baseline | Candidate |
|---|---:|---:|
| Callback start → GetConn | .053389 | .059080 |
| Connection acquisition | .005229 | .003837 |
| GotConn → write callback | .031909 | .026148 |
| Write callback → first response byte | 26.002881 | 17.018466 |
| First response byte → callback return | 17.412407 | .576319 |

These are client observations. First-byte wait includes transport/server scheduling; the response tail includes body read/JSON decode/identity checking and scheduling. They do not independently identify server locks, pure network time or GC, and percentile components cannot be summed into total latency.

Original observer cumulative wall work was: block queries2403.845134→2241.747393ms; results queries1099.313149→1255.287748ms; durable batches2730.540882→2654.873863ms; decode/validation/replay2057.947934→2119.106716ms; transaction checks579.953394→489.025603ms. Nested/parallel totals are not a disjoint finality partition. Actual shared-cache full replays5→6, joins9→11 and hits6→2; no failed/bypassed replay. Commit handler means across four nodes were5.215–6.862ms with6 calls/node before,5.145–5.973ms with7 calls/node after. The proof retains actual Commit validation/encoding/write/fsync totals; full histograms remain in raw cases, without fabricated point quantiles. This short history does not measure600k-event state cost.

The candidate's last8 transactions landed in its sixth workload block; baseline used five blocks. Supply wait257.424023→620.203511ms and drain625.465577→1262.655657ms increased. These observations explain why lower CheckTx alone does not establish better business completion; they do not isolate the entire15.1% rate difference to dispatch policy. Fixed case order, fresh fixture identities, block boundaries and startup/cache/I/O variation remain limitations. Absolute rates must not be compared to a different runner's earlier pair as if hardware were matched.

## Hardware, guards and retained evidence

Actual AMD EPYC7763 runner,4 OS CPUs, MemTotal16373452KiB, Go1.25.14 linux/amd64, GOMAXPROCS1/GOGC100/GOMEMLIMIT off. Fresh native preflight recorded89508950016 bytes free disk and15564820480 bytes available memory. Both case guards and cleanup passed; pair post-fsync qualified at14082ms with44958449 retained bytes. Four closure scans (two after each case) contained only original launcher33823. Root received real clean-slot evidence before full analysis.

Original pair receipt956343 bytes, SHA256 `d27f4abc2597077d43b18912e5c602895c755f4d51b9de772f7b01674af02f36`, bound to the actual post-fsync terminal and successful job117763997899. Artifact12147527764 ZIP11652965 bytes: selected members recovered with bounded exact206 ranges, CRC/size verification and receipt-bound SHA256. This is not a full-ZIP digest assertion.

[Compact actual proof](evidence/endpoint-elastic-pair-ci-39157615295-actual.json) binds both original clients/cases, full independent readout, post-fsync and closure. All source raw is retained under `artifacts/chain-performance-20261017/endpoint-elastic-pair-39157615295/`; original full log is in sibling `endpoint-elastic-source/pair39157615295-full.raw`. Gzip terminal-source work began independently after this exact version was pinned and is not part of this network result.
