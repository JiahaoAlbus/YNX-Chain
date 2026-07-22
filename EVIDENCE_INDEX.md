# Evidence Index

All paths are repository-relative and refer to the current source commit only after these changes are committed.

| Evidence | Source | Verification |
| --- | --- | --- |
| Candidate issuance and fee simulation | `internal/economics/model.go` | `go test ./internal/economics` |
| Reproducible medium-usage path | `economics/examples/medium-usage.json` | `go run ./cmd/ynx-economics-sim -input economics/examples/medium-usage.json` |
| Consensus fee event schema and audit hash | `internal/consensus/fee_state.go` | `go test ./internal/consensus` |
| Fee persistence, query, reconciliation, tamper rejection | `internal/consensus/transaction_test.go`, `internal/consensus/fee_state_test.go` | `go test ./internal/consensus` |
| Gateway source/asOf/version/coverage responses | `internal/bftgateway/economics.go`, `internal/bftgateway/ai_gateway_test.go` | `go test ./internal/bftgateway` |
| v7/v8/v9/v10 to v11 migration boundaries | `internal/consensus/state.go`, `MIGRATION_COMPATIBILITY.md`, migration tests | `go test ./internal/consensus -run 'MigratesVersion'` |
| Delegation, unbonding liability, maturity and withdrawal | `internal/consensus/staking_action.go`, `staking_application.go`, `staking_action_test.go` | `go test ./internal/consensus -run Staking` |
| Staking Gateway and truthful no-yield boundary | `internal/bftgateway/staking.go`, `staking_test.go` | `go test ./internal/bftgateway -run Staking` |
| Rejected-transaction atomicity | `internal/consensus/application.go`, early-withdrawal/retry path in `staking_action_test.go` | `go test ./internal/consensus -run StakingDelegation` |
| Consensus Treasury bucket truth | `internal/consensus/treasury_snapshot.go`, `treasury_snapshot_test.go` | `go test ./internal/consensus -run TreasurySnapshot` |
| Source-labelled Treasury Gateway | `internal/bftgateway/treasury.go`, `staking_test.go` | `go test ./internal/bftgateway -run Staking` |
| Native YNXT supply/liability reconciliation and deterministic Merkle proofs | `internal/consensus/solvency_snapshot.go`, `solvency_snapshot_test.go` | `make solvency-check` |
| Fail-closed source-labelled solvency and liability-proof Gateway | `internal/bftgateway/solvency.go`, `staking_test.go` | `make solvency-check` |
| Treasury shock and runway model | `internal/economics/treasury.go`, `treasury_test.go` | `go test ./internal/economics -run Treasury` |
| Reproducible Treasury stress scenario | `economics/examples/treasury-stress.json` | `go run ./cmd/ynx-treasury-sim -input economics/examples/treasury-stress.json` |
| Liquid-staking share rate, allocation and reward/slash accounting | `internal/economics/liquid_staking.go`, `liquid_staking_test.go` | `make liquid-staking-candidate-check` |
| Liquid-staking queue, burn, pause, limits, redemption and solvency | `internal/economics/liquid_staking.go`, `liquid_staking_test.go` | `make liquid-staking-candidate-check` |
| Reproducible queue/slash/secondary-discount stress path | `economics/examples/liquid-staking-stress.json` | `go run ./cmd/ynx-liquid-staking-sim -input economics/examples/liquid-staking-stress.json` |
| Liquid-staking non-activation and audit gates | `economics/LIQUID_STAKING_CANDIDATE.md` | Inspect output booleans from `make liquid-staking-candidate-check` scenario |
| Safety Module cap, cooldown, explicit slash and insurance waterfall model | `internal/economics/safety_module.go`, `safety_module_test.go` | `make safety-module-candidate-check` |
| Reproducible non-activated Safety Module shortfall | `economics/examples/safety-module-shortfall.json`, `cmd/ynx-safety-module-sim` | `make safety-module-candidate-check` |
| Safety Module non-activation and risk boundary | `economics/SAFETY_MODULE_CANDIDATE.md` | Inspect false activation/execution/yield fields from the candidate scenario |
| YUSD test reserve, supply and redemption liability reconciliation | `internal/yusdsandbox/service.go`, `service_test.go` | `make yusd-sandbox-check` |
| YUSD atomic persistence, audit evidence chain and tamper rejection | `internal/yusdsandbox/store.go`, `service_test.go` | `make yusd-sandbox-check` |
| YUSD outage queue, pause exit and strict authenticated HTTP boundary | `internal/yusdsandbox/server.go`, `server_test.go` | `make yusd-sandbox-check` |
| YUSD no-value/no-attestation/no-guaranteed-peg disclosure | `docs/stablecoin/YUSD_SANDBOX.md`, `internal/yusdsandbox/types.go` | `make yusd-sandbox-check` |
| Recovery and cross-thread ownership | `RECOVERY_AUDIT.md` | Git worktree and status inspection described in the audit |
| Chain Core recovery and deployed-runtime boundary | `CURRENT_RECOVERY_AUDIT.md`, `release/recovery-evidence.json` | strict SSH audit, exact-release four-node verifier, bounded public ingress diagnostic |
| StreamBFT shadow candidate | `internal/streambft`, `docs/architecture/STREAMBFT_CANDIDATE.md`, `docs/formal/streambft` | `make streambft-candidate-check` |
| Deterministic parallel/sequential state-root equivalence | `internal/streambft/executor.go`, `internal/streambft/streambft_test.go` | `go test -race ./internal/streambft` |
| Strategy mandate and owner-only Vault invariants | `internal/assetauth/mandate.go`, `internal/assetauth/vault.go` | `go test -race ./internal/assetauth` |
| AppHash-bound mandate/vault state, traceable lots, atomic rejection, audit and migration | `internal/consensus/asset_authorization_action.go`, `internal/consensus/asset_authorization_action_test.go` | `go test -race ./internal/consensus` |
| Quant source/version/coverage API and committed mutation evidence | `internal/bftgateway/quant.go`, `internal/bftgateway/quant_test.go` | `go test -race ./internal/bftgateway` |
| Smart Account, session, paymaster, passkey, guardian recovery | `internal/assetauth/smartaccount.go`, `internal/assetauth/recovery.go` | `go test -race ./internal/assetauth` |
| AppHash-bound sponsored UserOperation, Paymaster budget/lot supply, replay and Gateway proof | `internal/consensus/account_abstraction_action.go`, `internal/bftgateway/account_abstraction.go`, end-to-end tests | `make account-abstraction-check` |
| Serialized-nonce Bundler and committed receipt verification | `internal/bundler/server.go`, `cmd/ynx-bundlerd`, `internal/bundler/server_test.go` | `make account-abstraction-check` |
| Public primitive schemas and JavaScript builders | `chain/accounts/user-operation.schema.json`, `chain/governance/strategy-mandate.schema.json`, `sdk/js/primitives.js` | `npm test --prefix sdk/js` |

Generated artifacts, remote URLs, transaction hashes, installation proof, deployment proof, and public screenshots are absent unless added here with an exact source commit. Their absence must keep corresponding release booleans false.
