# Original40087248053 complete same-condition submit8 versus16 result

Original frozen HEAD9d96820e6a6c9a37057d27559b34596efc421144/CODEbc4ed12d129b8ce3631ac6471a64323bbf2b8b67, normal CI40086559982 SUCCESS, same-VM four-node original run40087248053 SUCCESS. The once Root grant pressure1, exact13 sources, dispatch uniqueness, all original receipts, four ELF identities, full signed8192×2 streams, four node raw logs, original two verifier passes, caps and launcher closure independently pass. Original e28 reader recovered549 members/44,515,725bytes; independent verdict607,941bytes SHA80a385fa1b3f6ae9acde79f23466001331e320cb83a136d934dde7e65c91fafb. Raw bytes/cache/failed bounded attempts are retained on WD. Current prepared source is absent from this frozen run.

This finite experiment rejects increasing default submitters: final throughput267.504→265.764/s (-0.6504%), actual offer285.676→283.524/s despite configured1000. Both cases complete8192 effective signed business transactions with zero UNKNOWN/timeouts/notSubmitted/execution failures. Both are37 business blocks per node. CPU77.16→77.09% of one core. A low CPU percentage does not isolate a unique causal bottleneck; blocking/serialized observation and RPC remain measured costs. No sustained1000/600s qualification.

| Actual metric | submit8 | submit16 |
|---|---:|---:|
| finalSubmittedPerMeasurementSecond | 267.504208 | 265.764333 |
| offeredInterarrivalRate | 285.676366 | 283.523980 |
| readerWall.decodeNs (s) | 11.842382 | 12.214467 |
| prefix.suffixReplay.durationNs (s) | 3.854433 | 3.782423 |
| prefix.suffixEncode.durationNs (s) | 1.380226 | 1.542588 |
| certificate.strictJSON.durationNs (s) | 2.529018 | 2.560795 |
| prefix.privateValidate.durationNs (s) | 1.162117 | 1.343451 |
| prefix.suffixSetup.durationNs (s) | 1.161892 | 1.272313 |
| readerGate.waitNs (s) | 15.559084 | 13.846655 |
| readerGate.holdNs (s) | 12.988297 | 13.242035 |

Reader/gate/phase wall totals overlap across concurrent requests or are nested; never sum all rows. Certificate strictJSON alone is2.529→2.561s, and suffix encoding1.380→1.543s. These support measuring the prepared publication axis, not claiming its future speedup.

| Actual business Commit phase mean (ms), four-node148 samples each | submit8 | submit16 |
|---|---:|---:|
| commit | 43.391095 | 41.109968 |
| validate | 39.462619 | 36.989129 |
| validate.app_hash | 25.896152 | 24.118864 |
| validate.semantics | 13.481130 | 12.773146 |
| delta_encode | 0.212881 | 0.239875 |
| write | 0.206613 | 0.180590 |
| file_sync | 1.583075 | 1.204336 |
| journal_maintenance | 1.854316 | 2.436270 |

Commit encoding and fsync are distinct actual samples. Validate/app_hash/semantics are nested; Commit includes all children and maintenance. Four node samples do not multiply business TPS by four.

| Offer to completion latency upper bound, P50 / P95 / P99 (ms) | submit8 | submit16 |
|---|---:|---:|
| Endpoint node Finalize returned | 979.000 / 1489.000 / 1663.000 | 992.000 / 1449.000 / 1662.000 |
| Endpoint node durable Commit returned | 1029.000 / 1549.000 / 1755.000 | 1042.000 / 1487.000 / 1723.000 |
| Client authenticated final observation | 1485.000 / 2093.000 / 2328.000 | 1506.000 / 1985.000 / 2194.000 |

Node points are original endpoint transaction-height Finalize and durable Commit returns matched by block hash with clock error envelopes, not the earliest BFT quorum formation instant. Full signed/native final observation remains independently checked; its later client callback includes observation delay. Node completion join remains a diagnostic and does not independently grant BFT authority.

Reproduce offline with the committed scope-fix qualified-pair reader (source packet/capture/original CI log/original terminal JSON/new output), then qualified-comparison, node-completion per case and node-resources readers. All require the original exact frozen readers and evidence; output paths are create-new. Machine comparison includes immutable raw pins and all latency interval bounds. Next: keep8 default; qualify prepared subphase source normal CI, freeze8→8 prepared-only profile and request a fresh pressure1 Root window. No old grant reuse or new dispatch is implied.
