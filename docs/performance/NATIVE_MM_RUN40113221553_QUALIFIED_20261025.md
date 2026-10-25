# Qualified finite four-node pair40113221553

Independent original recovery and resource/business verification now pass: `nativePairQualified=true`, `slotReturned=true`, `sustainedTPSQualified=false`. This is one8192×2 sequential pair, not stable1000TPS/600s capacity. Actual offers remained below the configured1000/s target. The complete goal remains open.

The unchanged frozen302fc reader recovered all549 selected original members,44,126,646 bytes. Its final complete recovery and stream readback used zero network bytes in4.449987s after missing ranges were cached. Original64KiB206/ETag, CRC/SHA, cache128MiB/selected96MiB and60s bounds were retained. Missing-only prefetch published no members or verdict. The independent consumer then reaudited the whole selected manifest with zero network and checked the exact Root grant/CLI correction,13 source readers, ordinary CI, original runtime CI, same VM/source/four ELFs, all resource limits, both complete checker passes, signed streams, node evidence and original double owned closure. The completed priority17/node-parser audit was reused by its exact input/output hashes.

Run/source/configuration:

- Workflow40113221553, attempt1; SOURCEd24e97b8d3373e294a9d7992e07b4ef532bd6dcf / CODEa02fa84574e2e61c379c894f2389dc8d8ada6e73; ordinary CI40111618531SUCCESS.
- Same Linux6.17.0-1022-azure x86_64 guest,4 logical CPUs,16,373,452KiB MemTotal; CPU model string AMD EPYC9V7480-Core Processor describes the host model, not80 guest cores.
- Four isolated consensus nodes; gRPC ABCI, prepared8/current-input reuse, original state hash encoding;8 submitters/4 observers,2048 senders×4 rounds,8192 business transactions each.
- GOMAXPROCS1/GOGC100/GOMEMLIMIT off; only bounded versus grouped4 pacing differs. Original45+15s/case,120s/pair,1GiB sampled owned RSS/process10/thread320, two complete checkers inside45s and storage/log/build caps remain.

| Metric | Bounded | Grouped4 |
|---|---:|---:|
| Final valid business transactions | 8192 | 8192 |
| Submitted / accepted / effective included / quorum-final | 8192 each | 8192 each |
| Business unknown / timeout / execution failure | 0 / 0 / 0 | 0 / 0 / 0 |
| Actual offered events/s | 344.0331 | 372.5327 |
| Whole-window final observations/s | 322.0277 | 349.8607 |
| Measurement window | 25.4388s | 23.4150s |
| Client process CPU | 16.8969s | 16.2265s |
| Client CPU percent of one core | 66.42% | 69.30% |
| Sampled aggregate owned RSS | 978,395,136B | 1,015,623,680B |
| Maximum pending at1s bucket end | 912 | 1000 |
| Pending at final bucket end | 0 | 0 |

The finite throughput difference is+8.643%. This is an observed single-pair difference, not proof that pacing alone caused the gain: append fsync and checkpoint synchronization vary materially. Bucket-end backlog and sampled RSS are not hard instantaneous peaks. Diagnostic error-fact occurrences were63,589/57,795; they can recur for the same transaction and are not failed-business counts or an RPC failure-rate denominator. Do not call the whole run error-free merely because final business failures were zero.

Each original signed transaction was joined to the same-height/blockHash/post-state node completion points and calibrated offer clock. The following are1ms distribution upper bounds, in milliseconds; maximum calibration error bounds were10.656µs/24.467µs. Separate quantiles must not be added or subtracted.

| Offer to event, P50 / P95 / P99 upper | Bounded | Grouped4 |
|---|---:|---:|
| Client-observed effective inclusion | 1198 / 1637 / 1840 | 1166 / 1575 / 1766 |
| Endpoint actual FinalizeBlock return | 1001 / 1442 / 1622 | 969 / 1311 / 1582 |
| Endpoint actual durable Commit return | 1041 / 1502 / 1675 | 1006 / 1370 / 1617 |
| Client final observation | 1392 / 1801 / 2005 | 1363 / 1726 / 1973 |
| All four replica durable Commit returns | 1104 / 1521 / 1731 | 1043 / 1391 / 1652 |

Finalize return is the node's executed-block completion point, not proposal arrival. Durable Commit return is actual completion of the original storage protocol. Both follow the original reported verified BFT proof, but the earliest BFT quorum-formation instant is not measured. Third-of-four replica completion is an order statistic, not a voting-power quorum calculation. Original same-VM/BFT/resource qualification comes from the independent verdict; completion consumers add timing observations only. Client post-Commit observation overhead alone has P95 upper576/526ms, derived per row rather than subtracting unrelated quantiles.

Business Commit means remain35.8625/33.1769ms, with full validation28.7936/28.7913ms and nested AppHash18.5985/18.7528ms. Delta encoding0.2226/0.2185ms and append write0.1807/0.1867ms are small. All checkpoint replacements, including empty blocks, have only eight replica samples per case: checkpoint encode mean17.2842/18.2912ms, file sync mean55.0514/48.5253ms and P95104.1011/83.1142ms. AppHash is included in validation; checkpoint children are included in maintenance. Neither should be summed again. Four replicas do not multiply business TPS.

Client pacing wake-lateness totals changed14.7055→9.8625s and future-target waits7161→2614. Reader-gate wait totals7.8143/7.6028s and hold totals7.0128/6.6243s overlap across observers and cannot be added to derive wall time. These observations, and the actual offer shortfall, mean350/s is not proven to be the chain's capacity ceiling. The next experiment must isolate client feeding/readback contention and the already implemented explicit node AppHash encoder selection, with fresh Root scheduling for any new heavy pair. The encoder option was not mixed into this frozen run. No default activation or new workload is authorized by this report.

Exact H proof files:

- `independent-native-verdict-01.json`:543369B /9f280f584b43af1676ab22238403f6d2cf8996c41dc6a414a2d1db64b8717e67.
- `complete-original-public-recovery.json`:57520B /918df875ac82d8fb4720b0c79b2c7e8774616714f5d9917605874c61fc352f2f.
- `qualified-metrics-and-node-completion-01.json`:22235B /254a6a5c0dc6718a773e83e0fafd620619dfe23ba4ecf90f0653c7e0747bc097.
- Before/after node completion:7294B /a3e6f3859aca79d198e7b59e66d73208bf960feaafbd1927b069fd2a29e477d0 and7287B /df8d35ddbf82c06d9f8e3f9850d8987ac22964cbdd0910915b806ef80ff8c799.

All are under `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-prepared-grouped-mm-pair-run-40113221553/`. This is selected-original integrity, not a recomputed whole-ZIP digest. Small evidence index: `evidence/native-mm-run40113221553-qualified-20261025.json`. The old refused run40101270671 remains refused; this new successful pair had zero exited-MM target hits and therefore does not itself prove that target repair.
