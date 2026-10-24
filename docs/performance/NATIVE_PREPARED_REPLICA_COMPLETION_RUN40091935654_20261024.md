# Four-replica durability completion in original run40091935654

The new offline join uses the already qualified original same-VM prepared pair, not a new load run. It binds the exact495446-byte independent verdict SHA256 a7a3c65a1a21aa5eb3a869b9e1442b2da38bf6382539d27934ca3581443d304a, all13 original frozen readers, each original receipt/report, parsed four-node logs, complete signed intent/terminal member identity and the original full stream verifier. Every business transaction joins the same height/block hash/post-state AppHash/transaction coverage across all four replicas. Endpoint publication and calibrated-clock checks remain mandatory.

The following are upper bounds in milliseconds for8192 business transactions per case, with1ms histogram bins and the original measured clock uncertainty included. First/third/all refer to the ordered completion of four durable Commit returns. They are not a voting-power quorum calculation or the earliest BFT quorum formation instant.

| From client offer to | Before P50/P95/P99 | Prepared after P50/P95/P99 |
| --- | --- | --- |
| First replica durable Commit | 970 / 1283 / 1507 | 938 / 1208 / 1331 |
| Third replica durable Commit | 1016 / 1317 / 1550 | 980 / 1264 / 1404 |
| All four replicas durable Commit | 1039 / 1348 / 1572 | 1005 / 1291 / 1412 |
| First-to-last replica Commit spread | 63 / 127 / 130.259 | 78 / 162.348 / 162.348 |

The after-case first-to-last spread tail increased despite lower offer-to-completion quantiles. This finite comparison does not establish the cause. Original client-final P50/P95/P99 upper bounds remain1324/1653/1823ms before versus1258/1551/1701ms after. Quantiles cannot be subtracted to infer a stage gap. Third-replica completion also cannot replace the original BFT proof or client final-observation evidence.

The histogram folds use bounded arrays and keep only one terminal row for negative checks. For each ordered replica statistic, the independently sorted lower/upper clock bounds give conservative order-statistic intervals. The replica spread cancels the common offered timestamp and retains each node's clock uncertainty. Missing heights, changed block hashes, changed post-state hashes and wrong business counts are rejected on actual original inputs in both cases:8 negative checks total. Refactoring the join for reuse reproduced the exact first actual result; both raw outputs remain on WD.

The future frozen grouped-case completion consumer now calls the same join factory, preserving its original endpoint completion output and additionally emitting replica intervals and the helper's exact source hash. Its original hard source check still rejects the prior142dc8024 run without creating an output. No future positive result, new run ID or grant was fabricated. The runtime tag1f21f1f2e and original qualification/admission readers remain unchanged.

Source: evidence/native-prepared-replica-completion-reader-20261024.py. Reproduce with python3 followed by that path, the exact original independent-qualified-verdict-01.json and a NEW output path. Machine evidence is evidence/native-prepared-replica-completion-run40091935654-local-20261024.json. Full signed reads, raw outputs and original logs remain under /Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-prepared-certificate-pair-run-40091935654/. The newly derived results add no network or sustained-TPS qualification. The finite original pair remains398.29→408.79 final business transactions/s over approximately20seconds, below the sustained1000/600s goal.
