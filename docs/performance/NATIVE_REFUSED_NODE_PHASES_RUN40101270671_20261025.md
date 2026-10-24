# Actual business-block Commit phases, original refused run40101270671

All eight original node logs were recovered and validated through the existing complete-session node timing parser. Both cases join the same four replica block identities within their own case, with8192 effective transactions per case. Before has36 business blocks per replica (144 replica samples); after has35 (140). Replica samples do not multiply business TPS. The cases differ in block composition, and the original resource monitor refused the run: this table is bottleneck diagnosis only, never a qualified improvement comparison.

All durations are milliseconds. Exact nearest-rank P50/P95/P99, totals and per-node results are retained in the raw JSON; the compact table shows mean/P95.

| Phase | Before mean / P95 | After mean / P95 |
|---|---:|---:|
| commit | 42.1068 / 77.1662 | 42.0678 / 77.0982 |
| validate | 38.5005 / 68.8926 | 38.2820 / 68.0132 |
| semantics | 12.9785 / 25.0408 | 13.1951 / 26.4370 |
| app_hash | 25.4111 / 46.1857 | 24.9875 / 49.9549 |
| delta_encode | 0.2299 / 0.3598 | 0.2233 / 0.4702 |
| write | 0.2034 / 0.3182 | 0.2229 / 0.4006 |
| file_sync | 0.9297 / 2.6222 | 1.0376 / 3.1028 |
| journal_maintenance | 2.1642 / 24.3430 | 2.2000 / 24.9865 |

Validation occupies about91% of mean Commit wall duration; AppHash alone occupies about59–60%. Semantics and AppHash are children already included in validation. Delta encoding, write and file_sync account for much less mean time. Journal maintenance has a tail near24–25ms at P95 and remains a separate investigation target. Phase quantiles must not be added; concurrent/cumulative handler times include lock waits and are not finality latency.

The next runtime optimization priority is the complete validation/AppHash path, including the existing explicitly selected cached-fee encoder. Local encoder speedups remain separate from independent-node runtime benefits. The node selector/pair integration, matching correctness/recovery evidence, fresh Root pressure1 grant and qualified same-condition run remain outstanding. Original grouped-cadence run stays refused; no sustained1000TPS or finality target is established here.

Reproduce using the fixed original logs and exact zero-network integrity proof:

```sh
node docs/performance/evidence/native-refused-node-phases-20261025.mjs ORIGINAL_RUN_DIRECTORY NEW_OUTPUT_JSON
```

The reader pins the original integrity-proof SHA and all eight original log SHAs, validates complete timing sessions and compares replica height/blockHash/AppHash/count identities. Output is created exclusively and always marks performance qualification false. Evidence index: `evidence/native-refused-node-phases-run40101270671-20261025.json`.
