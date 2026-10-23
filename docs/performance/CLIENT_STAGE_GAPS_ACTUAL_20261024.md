# Actual original client phase gaps, 2026-10-24

This is a new derivation from all4096 already qualified business rows of run39996035179, source73b4abc00503a59128e312bb2ee27e9999c61f1f; it is not a new load run. The original complete qualified report is bound by its exact1016461bytes/SHA and both original raw result hashes. Both2048-row cases require successful execution and all identity/quorum/transaction/durable proofs. Exact UTC nanosecond timestamps are ordered and each input's four phase intervals sum exactly to its offer→qualified-final interval. No incomplete row is dropped.

| Observed client phase | Before mean ms | After mean ms | After P50 / P95 / P99 ms | After share of total mean |
|---|---:|---:|---:|---:|
| Offered→submission starts |824.820|842.434|413.583 /1992.181 /2015.703|35.549%|
| Submission→CheckTx observed |14.421|13.753|3.207 /59.292 /123.784|0.580%|
| CheckTx observed→inclusion observed |1324.784|1231.620|1271.633 /1641.872 /1745.530|51.971%|
| Inclusion observed→qualified final observed |349.867|281.993|277.578 /412.184 /412.248|11.899%|
| Offered→qualified final observed |2513.892|2369.799|2112.545 /3676.220 /3792.059|100%|

Mean queue delay worsened17.613ms despite the earlier finite TPS gain. CheckTx→observed inclusion improved93.164ms and inclusion→qualified-final observation improved67.874ms. The interval containing inclusion still combines chain waiting, polling and client scheduling. The last interval includes quorum/durable proof processing and client scheduling, rather than an isolated BFT vote time. P95 values are not additive; means above refer to the same complete input population. Serialized wall timestamps differ slightly from the separately recorded monotonic duration fields; do not claim extra sub-microsecond precision.

A small per-input CheckTx share does not rule out a submission bottleneck. The original fixed8workers each retain their callback until completion. Mean HTTP callback wall14.422→13.755ms gives an optimistic8/mean service diagnostic554.693→581.623callbacks/s, before idle/pacing/other work. Actual submission interarrival501.727→515.101/s is consistent with substantial occupancy. This arithmetic is not chain capacity, a sustained rate or a prediction under different load. Simply interpreting low CPU utilization as sufficient capacity would be unsupported.

HTTP mean write→first-byte10.374→10.006ms and first-byte→callback-return3.813→3.439ms remain combined server/network/client scheduling scopes. The new explicit client GOMAXPROCS1→2 pair can test scheduling overlap while retaining workers, queues and node environment; it cannot presume an improvement. Original node encode/write/fsync/validate timings remain in [the complete original pair report](OBSERVER_NATIVE_FACTS_PAIR_ACTUAL_20261024.md); they are separate process scopes and must not be added to these client intervals.

[Actual derivation and all per-block observation spreads](evidence/observer-native-facts-client-stage-gaps-39996035179-actual.json), [exact reader](evidence/client-stage-gap-reader-20261024.py). Earlier timestamp-only derivation/raw outputs are retained in the original owner artifact directory. Five timestamp/order checks covered nanosecond fractions, noncanonical formats and a real qualified row deliberately made unordered. No new safety/throughput acceptance is granted by these calculations. The target remains sustained1000 effective final business TPS for10minutes with finalP95≤3s, still unmet.
