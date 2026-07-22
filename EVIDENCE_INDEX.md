# Evidence Index

All paths are repository-relative and refer to the current source commit only after these changes are committed.

| Evidence | Source | Verification |
| --- | --- | --- |
| Candidate issuance and fee simulation | `internal/economics/model.go` | `go test ./internal/economics` |
| Reproducible medium-usage path | `economics/examples/medium-usage.json` | `go run ./cmd/ynx-economics-sim -input economics/examples/medium-usage.json` |
| Consensus fee event schema and audit hash | `internal/consensus/fee_state.go` | `go test ./internal/consensus` |
| Fee persistence, query, reconciliation, tamper rejection | `internal/consensus/transaction_test.go`, `internal/consensus/fee_state_test.go` | `go test ./internal/consensus` |
| Gateway source/asOf/version/coverage responses | `internal/bftgateway/economics.go`, `internal/bftgateway/ai_gateway_test.go` | `go test ./internal/bftgateway` |
| v7/v8 to v9 migration boundary | `internal/consensus/state.go`, `internal/consensus/fee_state_test.go` | `go test ./internal/consensus -run 'MigratesVersion'` |
| Delegation, unbonding liability, maturity and withdrawal | `internal/consensus/staking_action.go`, `staking_application.go`, `staking_action_test.go` | `go test ./internal/consensus -run Staking` |
| Staking Gateway and truthful no-yield boundary | `internal/bftgateway/staking.go`, `staking_test.go` | `go test ./internal/bftgateway -run Staking` |
| Rejected-transaction atomicity | `internal/consensus/application.go`, early-withdrawal/retry path in `staking_action_test.go` | `go test ./internal/consensus -run StakingDelegation` |
| Recovery and cross-thread ownership | `RECOVERY_AUDIT.md` | Git worktree and status inspection described in the audit |

Generated artifacts, remote URLs, transaction hashes, installation proof, deployment proof, and public screenshots are absent unless added here with an exact source commit. Their absence must keep corresponding release booleans false.
