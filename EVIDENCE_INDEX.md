# YNX Trust Center Evidence Index

## Checkpoint identity

- Product: YNX Trust Center
- Branch: `codex/final-trust-center`
- Runtime commit: `4e78f47e9b2dedee71c12adf9790374412b45356`
- Date: 2026-07-27
- Status: Active, local candidate

## Runtime evidence

| Evidence ID | Claim | Source | Verification |
|---|---|---|---|
| TRUST-EV-001 | Illegal native-YNXT control requests fail closed | `internal/trustproduct/service.go` | `TestCaseLifecycleRoleSeparationCorrectionExpiryReplayRestart` |
| TRUST-EV-002 | Overbroad requests cannot be reviewed as valid | `internal/trustproduct/service.go` | same focused lifecycle test |
| TRUST-EV-003 | Evidence is bounded, sourced and visible to the subject | `internal/trustproduct/service.go` | `go test -race ./internal/trustproduct` |
| TRUST-EV-004 | Reviewer and appeal-reviewer roles are separated | `internal/trustproduct/service.go` | focused lifecycle test |
| TRUST-EV-005 | False-positive appeal corrects the case and disables the label | `internal/trustproduct/service.go` | focused lifecycle test |
| TRUST-EV-006 | Persistent state is SHA-256 sealed and verified before admission | `internal/trustproduct/service.go` | `TestSnapshotIntegrityRejectsOfflineTamperAndMigratesLegacyState` |
| TRUST-EV-007 | Version-1 state is preserved and atomically migrated to version 2 | `internal/trustproduct/service.go` | same migration test |
| TRUST-EV-008 | Health truthfully reports persistence integrity capability | `internal/trustproduct/http.go` | `TestHTTPAuthorizationSecurityAndTransparency` |
| TRUST-EV-009 | Trust Gateway unsafe signer-key permissions are rejected deterministically | `internal/trustgateway/gateway_test.go` | `go test ./internal/trustgateway` |
| TRUST-EV-010 | Real local Trust product server smoke succeeds | `apps/trust-center/check.sh` | script output `trust-center-check: ok` |

## Contract and release evidence

- `.ai-bridge/full-goal-coverage.json`
- `product-release.json`
- `public-product-metadata.json`
- `release/integration/trust-center-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`

## Verified commands

```text
go test -race ./internal/trustproduct ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center
./apps/trust-center/check.sh
```

All commands passed at this checkpoint.

## Failed broader command

`go test ./...` failed outside the Trust product slice because generated Solidity artifacts are absent and unrelated permission fixtures are host-umask-sensitive. This is recorded in `product-release.json`; it is not represented as a passing preflight.

## Explicitly absent evidence

No evidence currently proves:

- central Gateway registration;
- shared-Testnet authoritative end-to-end execution;
- current Android install/cold launch;
- iOS build or Simulator execution;
- staging or public deployment;
- hosted artifacts;
- production signing;
- store release;
- external audit or independent public verification.
