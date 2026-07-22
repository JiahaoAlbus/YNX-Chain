# Evidence Index

All paths are repository-relative and refer to the current source commit only after these changes are committed.

| Evidence | Source | Verification |
| --- | --- | --- |
| Candidate issuance and fee simulation | `internal/economics/model.go` | `go test ./internal/economics` |
| Reproducible medium-usage path | `economics/examples/medium-usage.json` | `go run ./cmd/ynx-economics-sim -input economics/examples/medium-usage.json` |
| Per-lane base-fee adjustment, capacity and fee-cap rejection | `internal/economics/fee_market.go`, `fee_market_test.go` | `make fee-market-candidate-check` |
| Priority/service fees, separate burns and exact four-way splits | `internal/economics/fee_market.go`, `fee_market_test.go` | `make fee-market-candidate-check` |
| Sponsored payer attribution and deterministic event audit hash | `internal/economics/fee_market.go`, `fee_market_test.go` | `make fee-market-candidate-check` |
| Reproducible congestion/idle/sponsorship fee path | `economics/examples/fee-market-stress.json` | `go run ./cmd/ynx-fee-market-sim -input economics/examples/fee-market-stress.json` |
| Fee-market non-activation and migration gates | `economics/FEE_MARKET_CANDIDATE.md` | Inspect false consensus/governance/Explorer booleans |
| Seeded Low/Medium/High Monte Carlo and agent-ledger accounting | `internal/economics/macro_stress.go`, `macro_stress_test.go` | `make macro-stress-check` |
| Issuance/burn/net supply, validator and Treasury distributions | `internal/economics/macro_stress.go`, `macro_stress_test.go` | `make macro-stress-check` |
| Stable reserve/depeg, liquidity/Sybil, governance and Bridge/Oracle stress | `economics/examples/macro-stress.json` | `go run ./cmd/ynx-macro-stress-sim -input economics/examples/macro-stress.json` |
| Mainnet gate pass-rate and non-forecast boundary | `economics/MACRO_STRESS_MODEL.md` | Inspect `forecast=false`, `mainnetReady=false`, and scenario gate rates |
| `/ynxt` and `/economics` canonical dashboard routes | `internal/explorer/economics_web.go`, `economics_web_test.go` | `make economics-public-ui-check` |
| Source/as-of/version/coverage economics API and truthful release/risk flags | `internal/explorer/economics_web.go`, `economics_web_test.go` | `make economics-public-ui-check` |
| Twelve locales, Arabic RTL, runtime failures and risk semantics | `internal/explorer/economics_web.go`, `UI_DESIGN_AUDIT.md` | `make economics-public-ui-check` |
| Keyboard, reduced motion, light/dark and 390px containment | `internal/explorer/economics_web.go`, `UI_DESIGN_AUDIT.md` | `make economics-public-ui-check` |
| Economics Website/SEO integration contract | `docs/coordination/WEBSITE_ECONOMICS_HANDOFF.md` | Review canonical route, metadata, FAQ and acceptance sections |
| Machine-readable public metadata and release booleans | `public-product-metadata.json`, `product-release.json` | `make economics-public-package-check` |
| Social asset bytes, SHA-256 and implementation source commit | `internal/explorer/assets/economics-og.png`, `product-release.json` | `make economics-public-package-check` |
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
| YUSD local backup digest and fresh-path restore | `internal/yusdsandbox/service_test.go`, `OPERATIONS.md` | `make yusd-restore-drill` |
| Economics Request ID, health and Prometheus metrics | `internal/explorer/economics_web.go`, `economics_web_test.go`, `OBSERVABILITY.md` | `make economics-public-ui-check` |
| Economics local latency, throughput, allocation and coverage boundary | `evidence/performance/economics-local-benchmark.json`, `SLO_CAPACITY_PLAN.md` | Re-run `go run ./cmd/ynx-economics-bench` against its exact `sourceCommit` |
| Unit-cost formulas and currently unavailable billing/user inputs | `UNIT_ECONOMICS.md` | Review zero/unknown/undefined boundaries |
| Threats, trust assets and execution boundaries | `THREAT_MODEL.md`, `SECURITY_BOUNDARIES.md` | Review authority and remaining-gate tables |
| Complete resolved dependency inventory | `release/sbom.cdx.json`, `THIRD_PARTY_NOTICES.md` | `make economics-supply-chain-check` |
| Dependency, secret and static scan truth | `release/security-scan-evidence.json`, `SUPPLY_CHAIN_SECURITY.md` | Re-run named commands; unresolved npm High remains explicit |
| Reproducible unsigned local binary and cold start | `release/reproducible-build-evidence.json` | Repeat allowlisted build twice and compare SHA-256 |
| Scoped release changes and known gaps | `RELEASE_NOTES.md`, `product-release.json` | `make economics-public-package-check` |
| Recovery and cross-thread ownership | `RECOVERY_AUDIT.md` | Git worktree and status inspection described in the audit |

Generated artifacts, remote URLs, transaction hashes, installation proof, deployment proof, and public screenshots are absent unless added here with an exact source commit. Their absence must keep corresponding release booleans false.
