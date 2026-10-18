# Fixed V13 fee-chunks integration candidate

This independent, unpublished `1.13.0-source-candidate.2` binds source commit `2dbfc1146a0ca23fdd7ce10dccd4ab80dec5be49`, kernel commit `eb6e3199280adde67426e1c04a5403fc1e31d16a` and complete internal tree `f1342d3123f2366797e71c65a4e160cac377c9f2`. State schema 13, `YNX_ABCI_STATE_V13` and ABCI application 19 are unchanged. The preceding candidate at d47/fc5, its nine files, checker and frozen measured pair remain unchanged and must reject this derivative runtime.

`check.mjs` exports `SOURCE_COMMIT`, `INTERNAL_TREE` and `validateCandidate({repository})`. It reads immutable Git objects at the exact source commit. `source-map.json` preserves all 23 original consumed inputs and the three original published predecessor pins, while `kernelDerivation.kernelFiles` separately pins the three changed kernel leaves. The kernel's original three Go regression functions must exist in those exact sources. The complete internal tree is independently bound; 23 mapped inputs alone are insufficient. The fixed checkout consumer additionally checks current mapped/kernel bytes, HEAD's complete internal tree, dirty tracked internal inputs and untracked internal inputs.

Run from any working directory with a repository containing the original objects:

```sh
node /absolute/path/perf-state-v13-fee-chunks/check.mjs --repository /absolute/path/repository
node --test /absolute/path/perf-state-v13-fee-chunks/check.test.mjs
```

The normal Perf CI receiver is `scripts/verify/perf-v13-fee-chunks-integration-check.mjs`; its original owner selects the corresponding Make/CI target. No generic source fallback, branch lookup, automatic profile replacement or default qualification is added.

All 71 predecessor vector specifications, five original candidate boundary vectors and all original inherited capability assertions remain. The original negative cases remain and new controls reject kernel identity/inventory/hash substitutions and fabricated performance/finality claims. The fixed disk-loader v12 original-hash-before-upgrade checks, empty new DEX collections, exact v13 state-sync requirement, external trusted AppHash, nonce replay and independent checkpoint boundaries are retained. The separate Protocol V15/V16/V17 stream is not made interchangeable. Suspended products receive no new runtime testing or activation from this static check.

These are Node source-contract checks. They compile no Go, execute no signatures or restart, publish nothing and activate no upgrade. Candidate `testedLocal`, packaging/signing/deployment flags remain false. Separately, actual CI 39113606753 at the exact source ran unfiltered `go test ./internal/consensus ./cmd/ynx-abci` successfully, including three unconditional kernel regressions for canonical byte/hash equivalence, late errors/framing and 512 real signed transfers with restart/replay/audit checks. That full CI run was **failure** because the unchanged old fixed-source gate rejected the new tree. Its original proof and raw-log hash are retained in the delivery handoff, not promoted to a complete release gate.

Performance remains unmeasured: no speedup, throughput, BFT finality or deployment claim follows from canonical-equivalence tests. `candidatePerformance` must remain measured false with null TPS/speedup and no finality measurement. The change bounds the fee-array temporary buffer to chunks of 256 records; individual record size and other surrounding state allocations are not newly bounded.

`SHA256SUMS` covers the complete nine-file candidate inventory, including this README and executable checks. The consuming guard pins the manifest hash. The original published release tag, product metadata, cross-product vectors and their bytes are not rewritten.
