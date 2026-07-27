# YNX Trust Center Evidence Index

## Checkpoint identity

- Product: YNX Trust Center
- Branch: `codex/final-trust-center`
- Runtime commit: `d31811280ba741026c74a836a212f78fe88c172a`
- Date: 2026-07-27
- Status: Active, local candidate

## Runtime evidence

| Evidence ID | Claim | Source | Verification |
|---|---|---|---|
| TRUST-EV-001 | Illegal native-YNXT control requests fail closed | `internal/trustproduct/service.go` | lifecycle test |
| TRUST-EV-002 | Overbroad requests cannot be reviewed as valid | `internal/trustproduct/service.go` | lifecycle test |
| TRUST-EV-003 | Evidence is bounded, sourced and visible to the subject | `internal/trustproduct/service.go` | Trust Race suite |
| TRUST-EV-004 | Reviewer and appeal-reviewer roles are separated | `internal/trustproduct/service.go` | lifecycle test |
| TRUST-EV-005 | False-positive appeal corrects the case and disables the label | `internal/trustproduct/service.go` | lifecycle test |
| TRUST-EV-006 | Persistent state is SHA-256 sealed and verified before admission | `internal/trustproduct/service.go` | snapshot integrity test |
| TRUST-EV-007 | Version-1 state is preserved and atomically migrated to version 2 | `internal/trustproduct/service.go` | migration test |
| TRUST-EV-008 | Health truthfully reports persistence capability | `internal/trustproduct/http.go` | HTTP health test |
| TRUST-EV-009 | Exact route scopes reject wildcard, duplicate, unknown and insufficient authority | `internal/trustproduct/authority.go` | `TestCentralSessionScopesAreExactAndRouteEnforced` |
| TRUST-EV-010 | Subject export is cross-subject isolated and omits auth/replay/seal internals | `internal/trustproduct/export.go` | `TestSubjectExportIsPortableAndCrossSubjectIsolated` |
| TRUST-EV-011 | Export response is read-scoped, no-store and has a valid attachment header | `internal/trustproduct/http.go` | authority scope test |
| TRUST-EV-012 | Immutable backup binds exact state bytes, counts and sequence | `internal/trustproduct/backup.go` | backup/restore drill |
| TRUST-EV-013 | Restore rejects unsafe mode, tamper and overwrite before admission | `internal/trustproduct/backup.go` | backup negative tests |
| TRUST-EV-014 | Restored earlier checkpoint cold-starts with byte/state equivalence | `cmd/ynx-trust-backup` | package and CLI tests |
| TRUST-EV-015 | Trust Gateway unsafe signer-key permissions fail deterministically | `internal/trustgateway/gateway_test.go` | Trust Gateway package test |
| TRUST-EV-016 | Real local Trust product server smoke succeeds | `apps/trust-center/check.sh` | output `trust-center-check: ok` |

## Contract and release evidence

- `.ai-bridge/full-goal-coverage.json`
- `product-release.json`
- `public-product-metadata.json`
- `release/integration/trust-center-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `FEATURE_COMPLETION_EVIDENCE.md`

## Verified commands

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center ./cmd/ynx-trust-backup
./apps/trust-center/check.sh
```

All commands above passed at the runtime checkpoint.

## Failed broader command

`go test ./...` failed outside the Trust product slice because generated Solidity devtool artifacts are absent and permission-fixture tests in `cmd/ynx-consensus-tx` and `internal/faucet` fail under the current host filesystem behavior. Trust packages pass; repository preflight remains red.

## GitHub evidence

Direct inspection found:

- branch and upstream: present;
- Local SHA = Remote SHA: true at the runtime checkpoint;
- Actions runs for `codex/final-trust-center`: none;
- Trust-specific GitHub Release: none;
- Trust-specific GitHub Artifact: none.

## Explicitly absent evidence

No evidence currently proves central Gateway registration, authoritative shared-Testnet execution, current Android install/cold launch, iOS build/Simulator execution, staging/public deployment, hosted artifacts, production signing, store release, encrypted remote backup custody or independent audit.
