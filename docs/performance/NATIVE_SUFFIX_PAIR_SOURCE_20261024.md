# Explicit native suffix comparison source and actual reader cost, 2026-10-24

Source c2f657c7f3557a4b3cd57fd2a4c2b449816218c4. Previous prototype HEAD2b5dd050a normal CI39986282445 completed SUCCESS; that CI does not qualify the new source. No new network run or grant consumed.

The original native clone constructor now retains original NewApplication suffix initialization. NewBlockJournalNativeSuffixPrefixDecoder and client -native-suffix-setup explicitly select the optimized initializer. This is a deliberate separation of control and candidate after the earlier prototype; the constructor-only evidence at ebe273339 remains historical evidence for that exact source.

The native-suffix-data64 pair uses8 actual submitters,4 observers,2048 native signed DATA64 inputs/side, offer1000, original per-input queues and unchanged effective budgets. Both modes share the same freshly built four ELFs and assigned VM; only second-case nativeSuffixSetup=true differs. Top report and actual reader configuration counters must agree exactly; missing, numeric/string, unexpected, raw/receipt mismatch are refused. All original signature, complete migration/state validation, fees, nonce, execution, quorum, persistence, failure-first ordering and unknown quarantine remain. No automatic/default heavy run was added; workflow adds only an explicit paired-native-suffix-data64 choice and matching prepare/execute routes.

75 controller tests PASS8.965s, explicit actual signed prefix equivalence/corrupt suffix/restart tests PASS.645s and option refusals PASS.412s, original5 negative/rotation/cancellation/certificate tests via constructor-only native-suffix overlay under race PASS3.065s. Complete client regression PASS12.148s; exact source gate14PASS11.118s. Initial controller run failed only a missing copy import in the newly added test, preserved unchanged; import fixed and complete75 tests passed with all assertions retained.

## Actual complete offline reader ABBA

Original2048 signed transaction history, four sequential private store captures across8 original prefix snapshots.32 validations/24 repeated observations and2048 distinct signature mathematics per sample; final and every observed canonical state match. Repeated observations are not new business transactions. AppleM4/darwin-arm64, GOMAXPROCS1/GOGC100/GOMEMLIMIT160MiB. This owner's client/race tests completed before this measurement.

| Order | Initializer | Whole reader ms | Allocation bytes | UserCPU ms | Suffix setup7calls ms |
|---|---|---:|---:|---:|---:|
| 1 | native-suffix-control | 816.068 | 549725744 | 771.652 | 69.888 |
| 2 | native-suffix-candidate | 805.157 | 539599160 | 759.543 | 59.433 |
| 3 | native-suffix-candidate | 809.331 | 539599080 | 762.781 | 70.815 |
| 4 | native-suffix-control | 823.645 | 549731200 | 776.556 | 74.280 |

Mean whole-reader wall change -1.538%, allocation bytes -1.843%, userCPU -1.672%, suffixSetup cumulative wall -9.656%. Constructor-only11.5% is therefore only about1.5% of the complete observed pipeline in these samples; no network TPS gain inferred. One candidate setup70.815ms is worse than the first control69.888ms. Samples are fixed-order finite and do not establish statistical confidence.

The next comparison should measure actual submit/accept/include/final rates and queue-inclusive P50/P95/P99 under Root's fresh pressure1 window, not claim1000 from local savings. Original45s active/15s cleanup/60s case/120s pair and memory/thread/process/retained-data guards remain. At least10-minute sustained1000 and finalP95≤3s remain unachieved.

[Machine evidence](evidence/native-suffix-pair-source-local-20261024-actual.json) includes full four samples, source/raw/probe hashes, exact work counters and limits. [Exact offline probe](evidence/native-suffix-offline-probe-20261024.go.txt) is a Go overlay source, not a production package. Overlay it at cmd/ynx-consensus-perf-client/native_suffix_matched_offline_test.go; set YNX_PREFIX_CLIENT_FIXTURE_DIR to the retained shared-work-phases-source artifact directory, then run go test with the overlay, -run '^TestNativeSuffixMatchedOriginalFourStoreOffline$' -count=1 -v. No nodes or public network are used.
