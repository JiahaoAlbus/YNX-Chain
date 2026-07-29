# YNX Trust Center Evidence Index

## Checkpoint identity

- Product: YNX Trust Center
- Branch: `codex/final-trust-center`
- Runtime and hosted artifact commit: `1baeccada8e72eab8277803973d0e598dcf19b51`
- Date: 2026-07-29
- Status: Active Testnet preview; not centrally integrated or publicly deployed

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
| TRUST-EV-017 | Release binaries and archive are reproducible | GitHub Actions run `30416831778` | two-build hashes and deterministic archive pass |
| TRUST-EV-018 | Hosted preview includes SBOM, provenance, notices and checksums | GitHub prerelease `trust-center-v0.1.0-testnet-preview.1` | seven uploaded release assets |
| TRUST-EV-019 | Hosted archive is bound to the verified source commit | release asset and `verification.json` | SHA-256 `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850` |

## Contract and release evidence

- `.ai-bridge/full-goal-coverage.json`
- `product-release.json`
- `public-product-metadata.json`
- `release/integration/trust-center-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `docs/handoffs/trust-center-website.md`
- `FEATURE_COMPLETION_EVIDENCE.md`
- `THREAT_MODEL.md`
- `evidence/trust-center-release-cb1dcbc/`: retained source-bound local artifact evidence.
- GitHub Actions run `30416831778`: successful Linux amd64 build/install/security gate at `1baeccad`.
- GitHub prerelease `trust-center-v0.1.0-testnet-preview.1`: hosted unsigned archive, SBOM, provenance, verification, checksum and notices.

## Verified commands

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
./apps/trust-center/check.sh
node scripts/package/trust-center-release.mjs --allow-dirty --out tmp/trust-center-release-ci-fix --evidence tmp/trust-center-evidence-ci-fix
GitHub Actions trust-center run 30416831778
```

All commands above passed for the Trust product slice. The GitHub run used Go 1.25.12 and pinned `govulncheck` 1.6.0, produced identical binaries across two builds, deterministic archive SHA-256 `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850`, a linked-runtime CycloneDX SBOM and notices, focused secret/placeholder scans, module verification, a clean vulnerability-database result, and clean install/cold-start identity evidence.

## Failed broader command

`go test ./...` failed outside the Trust product slice because generated Solidity devtool artifacts are absent and permission-fixture tests in `cmd/ynx-consensus-tx` and `internal/faucet` fail under the current host filesystem behavior. Trust packages pass; repository preflight remains red.

## GitHub evidence

- Branch and upstream: present.
- Local/remote match at artifact source `1baeccada8e72eab8277803973d0e598dcf19b51`: true.
- Successful Actions run: `30416831778`.
- Workflow artifact ID: `8710457317`; digest `sha256:c01af21b81c56e3c3687c039fd568a46fd28e9b782465aa5ee2645ba17972a7c`.
- Prerelease: `trust-center-v0.1.0-testnet-preview.1`.
- Hosted archive: `ynx-trust-center-1baeccada8e7-linux-amd64.tar.gz`, 4,526,557 bytes.
- Hosted archive SHA-256: `92805078f0a8daebc1e329a293e625d161b600c70371d4cfb7a2ed57e47d1850`.

## Explicitly absent evidence

No evidence currently proves canonical central Gateway registration, authoritative shared-Testnet execution, current Android install/cold launch, iOS build/Simulator execution, staging/public deployment, the live `https://ynxweb4.com/trust-center` route, production signing, store release, encrypted remote backup custody or independent production audit.
