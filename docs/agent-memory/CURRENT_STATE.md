# YNX Docs Current State

Updated: `2026-07-29T02:36:11Z`

## Identity

- Product: `35 — YNX Docs`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/35-docs`
- Branch: `codex/final-docs`
- Repository: `https://github.com/JiahaoAlbus/YNX-Chain.git`
- Runtime source SHA: `3c404c4f4d2c9967e660882349a19c94aebd08f1`
- Runtime source remote SHA: `3c404c4f4d2c9967e660882349a19c94aebd08f1`
- Main SHA at recovery: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Runtime source ahead/behind: `0/0`
- Checkpoint SHA: the Git commit containing this file; resolve with `git rev-parse HEAD`

## Current phase

- Goal status: `ACTIVE`
- Phase: `PROTECT`, requesting central `FREEZE` review
- Expected dirty state after the containing checkpoint commit: clean
- Public/runtime truth: local development only

## Latest successful tests

- `go test ./internal/cloud -count=1`
- `go test -race ./internal/cloud -count=1`
- `go vet ./internal/cloud`
- `go test ./apps/cloud/cmd/ynx-cloudd`
- Prior protected Web and mobile checks remain recorded in `product-release.json` and `.ai-bridge/full-goal-coverage.json`.

## CI, PR, release and artifacts

- GitHub Actions: no runs returned for `codex/final-docs`; this is **no CI evidence**, not a pass
- Pull request: none for `codex/final-docs`
- Release: repository releases exist for other products; no YNX Docs release was found
- Artifact: none retained or hosted for YNX Docs
- SBOM/provenance: absent
- Code scanning: no analysis exists for the repository API query
- Dependabot alerts: disabled for the repository
- Secret scanning: disabled for the repository

## Public deployment

- Runtime deployed public: `false`
- Website published: `false`
- Canonical route: `https://ynxweb4.com/docs`
- Canonical route verified live for this SHA: `false`
- `huangjeo.com` is not used as the YNX Docs product domain.

## Completed locally

- Product/Wallet fail-closed boundary
- Document/folder create, rename, move and atomic duplicate
- Version-aware autosave, explicit conflicts and offline recovery
- Version history and restore-as-new-version
- Version-bound comments, replies, resolve and reopen
- Share, link and access-request service contracts
- Text, Markdown, HTML and JSON export with source/output hashes
- Selected-version AI review boundary
- Trust evidence payload boundaries
- Schema v1→v2 migration
- Hash-verified local backup/restore operator
- Health, readiness, version, Prometheus metrics, structured request logs and correlation IDs

## Remaining

- Central contract acceptance and YNX 29 freeze
- Monitor dashboard ingestion and alert rehearsal
- Shared Testnet E2E
- Collaboration protocol bake-off/freeze
- Rollback and old-client migration drills
- Complete Web/mobile feature parity and browser/device evidence
- SLO/capacity/RPO/unit-economics evidence
- SBOM, provenance, scanned artifacts, signing and hosting
- Website publication and public runtime proof

## Current risks

- Local success must not be promoted to integrated, Testnet, staging, public or release status.
- Central repository failures outside YNX 35 still block a truthful full-repository green gate.
- Metrics and log retention/cardinality remain unaccepted by YNX 13/30.

## Evidence

- `release/integration/docs-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `docs/operations/OBSERVABILITY.md`
- `product-release.json`
- `public-product-metadata.json`
- `.ai-bridge/full-goal-coverage.json`
