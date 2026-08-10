# YNX Exchange evidence index

Runtime evidence commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

## Direct local evidence

- Feature and gap status: `FEATURE_COMPLETION_EVIDENCE.md`.
- Runtime implementation/tests: `internal/exchangeproduct/`.
- Quant contract and controls: `QUANT_EXECUTION_ADAPTER.md`, `internal/exchangeproduct/quant_adapter.go`, `quant_adapter_test.go`, `quant_capital_test.go`, `quant_http_test.go`.
- Migration/compatibility truth: `MIGRATION_COMPATIBILITY.md`, `migration_v8_test.go`.
- Capacity and SLO boundary: `SLO_CAPACITY_PLAN.md`, `evidence/capacity/exchange-local-2026-07-27.txt`, `benchmark_test.go`.
- Source-bound unsigned local artifact: `evidence/artifacts/exchange-darwin-arm64-42f2f48.txt`.
- Local release truth: `apps/exchange/product-release.json`.
- Public Website handoff metadata: `apps/exchange/public-product-metadata.json`.
- Runtime liveness/readiness/request/error/metrics contract: `OBSERVABILITY.md`, `internal/exchangeproduct/server.go`.
- Backup/restore, incident, support and cessation: `OPERATIONS.md`, `TestBackupRestoreDrillPreservesCommittedExchangeState`.
- Security boundaries and residual risks: `THREAT_MODEL.md`.
- Dependency attribution: `THIRD_PARTY_NOTICES.md`, `apps/exchange/SBOM.cdx.json`, `apps/exchange/DEPENDENCY_REVIEW.md`, lockfiles.
- Unit-economics formulas and missing invoice truth: `UNIT_ECONOMICS.md`.
- Recovery provenance: `RECOVERY_AUDIT.md`.
- Product UI audit: `apps/exchange/UI_DESIGN_AUDIT.md`.
- Release notes: `apps/exchange/RELEASE_NOTES.md`.

## Integration freeze

- Machine contract: `release/integration/exchange-contract.json`.
- Owner handoff: `docs/integration/INTEGRATION_HANDOFF.md`.
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Wallet/Gateway requests: `apps/exchange/integration/`.
- Full goal matrix and active plan: `.ai-bridge/full-goal-coverage.json`, `.ai-bridge/current-plan.md`, `.ai-bridge/agent-status.md`.

## Recovered but separately sourced surfaces

- Exchange Mobile release record: `apps/exchange/mobile/product-release.json`, source commit `22604af0717a19b5f8aa9223685c3ad3f049941a`.
- Historical Quant Lab dependency snapshot:
  `evidence/dependencies/quant-lab-historical-release.json`, source commit
  `22604af0717a19b5f8aa9223685c3ad3f049941a`. The canonical owner is
  `08-quant-lab`; this snapshot is not Exchange-owned release authority.

These records are preserved as their own source-bound evidence. They were not relabeled as artifacts of the newer Exchange runtime commit.

## Evidence rules

Every runtime or artifact proof must bind to its exact source commit. Discovery files copied from another worktree are not final proof. Public, staging, hosted-download, production-signature and store states remain false without direct remote evidence. Test credits, Paper output, emulator installs, debug signatures, unsigned binaries and generated migration vectors retain those exact labels.

## Evidence still required

- Successful final-branch CI run inspection and URLs; GitHub Actions listing timed out twice during TLS handshake on 2026-07-27.
- Repository-wide green baseline after non-Exchange owners restore missing generated contract artifacts and resolve key-permission assumptions.
- Immutable historical state fixtures for every shipped schema, forward migration and rollback/export proof.
- Final-commit Android/iOS rebuild, installation, cold-launch and current screenshots.
- Central Wallet/Gateway acceptance against the frozen tuple and negative vectors.
- Approved custody address, authoritative Indexer evidence and withdrawal broadcaster proof.
- Shared two-user Testnet receipts, restart/reconciliation and Explorer/Finance/Monitor evidence.
- Native Margin/Perp, portfolio risk and UltraLiquidity evidence; public deployment and independent verification of the locally tested liability/custody proof; insurance-fund and withdrawal-broadcast evidence.
- Hosted stateful staging/public health and version responses.
- Immutable artifact URLs, production signing, provenance, reproducibility and independent security/legal/accessibility acceptance.
