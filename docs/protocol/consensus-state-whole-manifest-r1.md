# ABCI Whole transfer source freeze R1

Baseline: Run8 39059614316 at 69e788b4bd726689ea5d1709fd5ba0162c6ec0da passed before this candidate. Source candidate only: gofmt parses/formatting and git diff --check completed; no local Go build/test, benchmark, service or deployment. No git add/commit by consensus_pq. These eight Go files and two docs are the entire owned freeze; unrelated working-tree changes are excluded. Not included in Root's first N1 performance candidate.

Remote focused command: `go test ./internal/consensus -run '^TestABCIWhole' -count=1`, then full consensus with normal pinned-contract build prerequisites and existing chain/API suite. Eight test functions are supplied; none has locally executed.

| Path | Bytes | SHA256 |
|---|---:|---|
| `internal/consensus/account_batch.go` | 16527 | `b74ff73bc7af0d7fc4f933d6607ba7f054514a0981108d793b3f5d7a9d526315` |
| `internal/consensus/account_batch_test.go` | 15622 | `8fe0ba96348a572cfc2704692c515a0e9c13f2d40f07de4ccf0ead94775e2b39` |
| `internal/consensus/account_batch_state_test.go` | 7360 | `621812291aa230454cc541235c4ef6efc70ecbb9f8c441efaf6f22be49353685` |
| `internal/consensus/account_policy.go` | 12320 | `10c636368d599ce747e206ca75a7293c2a9229f77ae87f4f0625afec5a960295` |
| `internal/consensus/account_revocation.go` | 7046 | `77ffa5b4b0bcb86f1eeb6b2e6708a06a1df3bc6f43c86a22d7a79eba819b775a` |
| `internal/consensus/action_transaction.go` | 21404 | `051b9ad28d153484aa9c1498a7b1aa5a6d985656a532b73a459fba1387f9f1a4` |
| `internal/consensus/application.go` | 48794 | `1dab202b752dc6ee7eb9e05626c9ba30945e8c8802e9a84ac27e82a7e74b1858` |
| `internal/consensus/state.go` | 46493 | `babf634752cdbcd811523e6fe90c6a133f54a7986e521926c22ef7735d9b3a70` |
| `docs/protocol/CONSENSUS_PQ_ACTION_INTEGRATION_PLAN_R1.md` | 21273 | `6e1378e850bbafb6c289d1847ba1fb5af84e0b9d79a41ff7bc66e97dca232ce8` |
| `docs/protocol/consensus-state-whole-r1.md` | 10678 | `d9e5ae906362d9d67675a1744e54174797b4ef1b712c4f0b4fc1897153e340c5` |

Minimum source behavior: genuine full-Whole double-signature/dual-tree admission, per-member current trusted policy, original partial outcomes, independent native member identities tied to actual outer hash, shared proof persisted once, original-height restart coverage, source/target replay refusal, rejected-member detached candidate, amount-only transfer lots, overflow guards, append-only proofs/results. Nontransfer Actions, full-size gateway/Comet ingress, multi-validator fee-route equivalence and throughput remain separate gates.
