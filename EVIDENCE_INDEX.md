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
| Consensus Treasury bucket truth | `internal/consensus/treasury_snapshot.go`, `treasury_snapshot_test.go` | `go test ./internal/consensus -run TreasurySnapshot` |
| Source-labelled Treasury Gateway | `internal/bftgateway/treasury.go`, `staking_test.go` | `go test ./internal/bftgateway -run Staking` |
| Treasury shock and runway model | `internal/economics/treasury.go`, `treasury_test.go` | `go test ./internal/economics -run Treasury` |
| Reproducible Treasury stress scenario | `economics/examples/treasury-stress.json` | `go run ./cmd/ynx-treasury-sim -input economics/examples/treasury-stress.json` |
| Liquid-staking share rate, allocation and reward/slash accounting | `internal/economics/liquid_staking.go`, `liquid_staking_test.go` | `make liquid-staking-candidate-check` |
| Liquid-staking queue, burn, pause, limits, redemption and solvency | `internal/economics/liquid_staking.go`, `liquid_staking_test.go` | `make liquid-staking-candidate-check` |
| Reproducible queue/slash/secondary-discount stress path | `economics/examples/liquid-staking-stress.json` | `go run ./cmd/ynx-liquid-staking-sim -input economics/examples/liquid-staking-stress.json` |
| Liquid-staking non-activation and audit gates | `economics/LIQUID_STAKING_CANDIDATE.md` | Inspect output booleans from `make liquid-staking-candidate-check` scenario |
| Safety Module voluntary stake, shortfall and insurance waterfall | `internal/economics/security_pools.go`, `security_pools_test.go` | `make security-pools-candidate-check` |
| Service-pool condition isolation and no cross-service contagion | `internal/economics/security_pools.go`, `security_pools_test.go` | `make security-pools-candidate-check` |
| Cooldown, max slash, queue haircut, pause and mature exit | `internal/economics/security_pools.go`, `security_pools_test.go` | `make security-pools-candidate-check` |
| Reproducible independent-pool and protocol-shortfall stress path | `economics/examples/security-pools-stress.json` | `go run ./cmd/ynx-security-pools-sim -input economics/examples/security-pools-stress.json` |
| Security-pool non-activation and public-risk boundary | `economics/SECURITY_POOLS_CANDIDATE.md` | Inspect false release booleans and candidate disclosures |
| YUSD test reserve, supply and redemption liability reconciliation | `internal/yusdsandbox/service.go`, `service_test.go` | `make yusd-sandbox-check` |
| YUSD atomic persistence, audit evidence chain and tamper rejection | `internal/yusdsandbox/store.go`, `service_test.go` | `make yusd-sandbox-check` |
| YUSD outage queue, pause exit and strict authenticated HTTP boundary | `internal/yusdsandbox/server.go`, `server_test.go` | `make yusd-sandbox-check` |
| YUSD no-value/no-attestation/no-guaranteed-peg disclosure | `docs/stablecoin/YUSD_SANDBOX.md`, `internal/yusdsandbox/types.go` | `make yusd-sandbox-check` |
| Recovery and cross-thread ownership | `RECOVERY_AUDIT.md` | Git worktree and status inspection described in the audit |

Generated artifacts, remote URLs, transaction hashes, installation proof, deployment proof, and public screenshots are absent unless added here with an exact source commit. Their absence must keep corresponding release booleans false.
