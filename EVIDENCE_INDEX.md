# Evidence Index

All paths are repository-relative and refer to the current source commit only after these changes are committed.

| Evidence | Source | Verification |
| --- | --- | --- |
| Candidate issuance and fee simulation | `internal/economics/model.go` | `go test ./internal/economics` |
| Reproducible medium-usage path | `economics/examples/medium-usage.json` | `go run ./cmd/ynx-economics-sim -input economics/examples/medium-usage.json` |
| Consensus fee event schema and audit hash | `internal/consensus/fee_state.go` | `go test ./internal/consensus` |
| Fee persistence, query, reconciliation, tamper rejection | `internal/consensus/transaction_test.go`, `internal/consensus/fee_state_test.go` | `go test ./internal/consensus` |
| Gateway source/asOf/version/coverage responses | `internal/bftgateway/economics.go`, `internal/bftgateway/ai_gateway_test.go` | `go test ./internal/bftgateway` |
| v7 to v8 migration boundary | `internal/consensus/state.go`, `MIGRATION_COMPATIBILITY.md` | `go test ./internal/consensus -run 'MigratesVersion7'` |
| Recovery and cross-thread ownership | `RECOVERY_AUDIT.md` | Git worktree and status inspection described in the audit |
| Chain Core recovery and deployed-runtime boundary | `CURRENT_RECOVERY_AUDIT.md`, `release/recovery-evidence.json` | strict SSH audit, exact-release four-node verifier, bounded public ingress diagnostic |
| StreamBFT shadow candidate | `internal/streambft`, `docs/architecture/STREAMBFT_CANDIDATE.md`, `docs/formal/streambft` | `make streambft-candidate-check` |
| Deterministic parallel/sequential state-root equivalence | `internal/streambft/executor.go`, `internal/streambft/streambft_test.go` | `go test -race ./internal/streambft` |
| Strategy mandate and owner-only Vault invariants | `internal/assetauth/mandate.go`, `internal/assetauth/vault.go` | `go test -race ./internal/assetauth` |
| Smart Account, session, paymaster, passkey, guardian recovery | `internal/assetauth/smartaccount.go`, `internal/assetauth/recovery.go` | `go test -race ./internal/assetauth` |
| Public primitive schemas and JavaScript builders | `chain/accounts/user-operation.schema.json`, `chain/governance/strategy-mandate.schema.json`, `sdk/js/primitives.js` | `npm test --prefix sdk/js` |

Generated artifacts, remote URLs, transaction hashes, installation proof, deployment proof, and public screenshots are absent unless added here with an exact source commit. Their absence must keep corresponding release booleans false.
