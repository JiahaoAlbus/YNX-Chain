# Fee witness time-run component experiment

The existing immutable fee journal already avoids copying the complete historical fee slice on each attempted native transfer. A remaining copy at sealing belongs to the exact-value mutation witness. The retained actual1024-transfer fixture contains16 consecutive timestamp runs. The current compact witness copies a full24-byte time.Time per event even when adjacent values are identical.

The archived measurement candidate stores the variable string/height fields per row and one exact time.Time per consecutive run. Equality uses Go value equality, including location and monotonic representation; time.Equal is insufficient. Shared metadata and every reconstructed fee field are compared completely. Mixed metadata, empty input and high timestamp entropy use the original witness. The candidate is test-only and has no runtime selector or default activation.

On Apple M4, darwin/arm64, Go1.25.7, GOMAXPROCS1, six100ms component samples in ABBAAB order measured witness creation plus full comparison against the same retained real history:

| Measurement | Original | Candidate |
| --- | ---: | ---: |
| Median ns/op | 86,308 | 66,901 |
| Sample range ns/op | 83,775–87,678 | 66,547–69,038 |
| Bytes/op | 114,944 | 90,896 |
| Allocations/op | 3 | 4 |

Observed median time decreases22.49% and allocated bytes20.92%, with one additional allocation. These are local component measurements, not full sealing, Commit, network throughput or latency improvements. The component benchmark excludes state/account schema guards, hashing and semantic validation; it cannot establish the overall gain.

Focused race validation passed in1.654s package time. Tests cover every fee field at timestamp-run boundaries/endpoints, caller mutation after snapshot creation, wrong lengths, nil/empty, mixed metadata and high-entropy fallback, same instants in different locations, and concurrent read-only witness checks. No public validation, signature, fee, nonce, journal or consensus behavior was changed.

Source is preserved in experiments/fee-witness-time-runs-candidate-20261024.patch and an exact WD copy. The patch applies cleanly at base2ec211be6. Reproduce with git apply of the patch, then GOMAXPROCS=1 go test -race ./internal/consensus -run '^TestFeeWitnessTimeRunsExperiment$' -count=1 -timeout=30s. Benchmark each mode with GOMAXPROCS=1 go test ./internal/consensus -run '^$' -bench '^BenchmarkFeeWitnessTimeRunsActualHistory/(original|candidate)$' -benchtime=100ms -count=1 -timeout=30s; use original,candidate,candidate,original,original,candidate order for the recorded experiment. The newly created test source was removed from the active runtime tree only after exact archival; the full experiment remains reproducible.

Machine evidence and raw file hashes are in evidence/fee-witness-time-runs-component-local-20261024.json. All raw samples and race output remain under /Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-prepared-grouped-pair-source-1f21f1f2e/fee-witness-time-runs-*. The final source adds fallback/concurrency safety coverage after the benchmark; its final digest and the benchmark-time source digest are recorded separately.

Complete sealing follow-up: the candidate was connected to an explicit private seal mode, retaining the original runtime default. Both modes executed account/history cloning, initial hash, all original schema/ownership guards, witness creation, semantic validation and exact witness comparison. Full state byte/AppHash equality, original public validation, atomic persistence/reopen and identical first errors for tampered audit/invalid time passed. Complete mutation coverage and concurrent witness safety passed race2.875s. Fsync/encoding phase output is retained for correctness inspection; race-mode durations are not performance conclusions. An actual abrupt-exit candidate measurement was not performed because the candidate was not selected.

Six200ms complete-seal samples in ABBAAB order measured original median1,560,036ns versus candidate1,641,859ns (+5.24%). Original range1,555,053–1,651,732ns overlaps candidate1,619,012–1,753,900ns, so this is not a general causal regression claim. Allocation medians are820,246 versus796,198B (about2.93% less),5068 versus5069allocations. The component speedup did not establish a full-seal speedup; the candidate remains unselected. No timer, hash, witness, fee policy or runtime default was activated based on component results.

The complete candidate and safety/benchmark tests are retained in experiments/fee-witness-time-runs-full-seal-unselected-20261024.patch, with exact copies of every experimental source on WD. Only this experiment's owned edits were restored after archival; the patch applies cleanly at65beec168. Machine evidence and all six raw hashes are in evidence/fee-witness-time-runs-full-seal-unselected-local-20261024.json. Reproduce its tests with GOMAXPROCS=1 go test -race ./internal/consensus -run '^TestSealTimeRun' -count=1 -timeout=30s; benchmark ^BenchmarkSealTimeRunsActualHistory/(original|candidate)$ with200ms in the same ABBAAB order. No failure output or experiment source was discarded.

Next: leave the original witness selected and prioritize the measured supply-wait/full-hash costs. The pending four-node grouped-cadence run remains frozen at1f21f1f2e with original witness/hash and is not mixed with this experiment. Root's pressure1 admission is still required for that run. Neither this completed local comparison nor the earlier component comparison establishes business/network TPS or sustained capacity.
