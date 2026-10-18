# Real persistent PQ paired benchmark source

The performance owner now supplies a separate Go overlay test, scripts/loadtest/overlays/pq_paired_performance_test.go.in, named TestPQPairedPersistentPerformance. It consumes the original crypto owner's newPQLedger/activation/transfer fixture and pqBatchSuccessDiskSnapshot; it does not replace their N1/16/64/1024 correctness tests or write their checkout.

The source was parsed/formatted with gofmt but has not been compiled or run. At the observed1646f015 checkout, pq_batch_success_test.go remained untracked and is absent from aa97f102. A future exact clean production freeze containing that helper is required. The actual preparation CLI rejected the old aa97 request against this dirty/newer checkout; it produced no case directory and did not silently use WIP.

Each invocation signs one Whole using the original real dual-signature provider, extracts its exact Member inputs, clones the same activated ledger twice and runs one N1/16/64 paired case. Nonces are2..N+1, amount1, fee1 and the original1000-balance fixture is explicitly checked to cover both business amounts and fees. Both modes assert every member admitted exactly once, canonical identities, exact account nonce/balance/validator fee/resource/lot-flow state, disk checkpoint reconstruction, exact no-op replay, manual local block checkpoints and cold restart/replay. Complete paired business projections are compared while intentionally different transaction/proof/block identities are excluded from cross-mode byte equality.

Timers separately retain common signing preparation, API-call elapsed sums, actual submission-loop wall time, per-member offer-to-local-checkpoint intervals, manual block work and cold restore. Whole responses share one request, so member latency samples are correlated. No value is labelled BFT TPS or finality; those fields remain null. The source checks a32MiB cumulative private data budget and preserves final snapshots plus exclusive report hashes.

Preparation only, after the original owner freezes a clean descendant of aa97:

    node scripts/loadtest/prepare-pq-paired-benchmark.mjs --source-root ABS_CLEAN_FIXED_CANDIDATE --commit FULL_COMMIT_WITH_SUCCESS_FIXTURE --output-dir NEW_PRIVATE_CASE_DIR --n 1 --trial 1 --write

The new case directory receives a frozen copy of the overlay, overlay.json and prepared.json with exact source/dependency/overlay pins and the Go command/environment. No Go process is started. Root must independently grant/wrap the proposed120s/1GiB profile and disk admission before execution; no unqualified native observer is automatically adopted. Start with N1/trial1, then only after correctness/runtime evidence schedule larger cases and the other paired repetitions.

Three Node recipe controls passed, covering exact source/fixture, drift/dirty refusal, output/target protection and finite scope. [Exact files, hashes, validation and future-freeze requirements](evidence/pq-paired-source-handoff-20261018.json). This is executable-source preparation, not a measured performance result.

## Explicit r2 correction: node-local peer facts

The original d4b943653 overlay pin972d93bc...81148e is superseded for future runs, while its record and Git object remain preserved. Production69e788b4 commitReplicationSnapshot deliberately retains target-local Peers/PeerSyncs in memory and disk; its regression fixture explicitly distinguishes source-produced observations. The original overlay cross-node projection therefore included two fields that are allowed and required to differ.

The r2 overlay removes only these two extra local fields from cross-node comparison, retaining every other business field. Before replication it captures target local facts, then independently compares target memory, disk and an immediate cold restore to that exact baseline. Cold authoritative state must also remain equal. Final per-mode cold module state assertions still include local peers after that node's own block production.

Eight directional Go projection controls mutate balance, nonce, resource use, account lot quantity, global lot provenance, contracts, policy and validator power; each must remain visible to the business projection. The real signed fixture is never mutated by those cloned-snapshot controls. These new Go checks are source-only: gofmt syntax and diff checks passed, but no local Go or benchmark ran. [Exact new overlay pin, unchanged support pins and causal source references](evidence/pq-paired-projection-correction-r2-20261018.json). Protocol should consume this explicit one-leaf replacement only after its state-preservation correctness gate, then run the single controlled N1/trial1.
