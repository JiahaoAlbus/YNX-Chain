# YNX Calendar current state

Updated: 2026-08-01T14:42:55Z

- Product: 36 — YNX Calendar
- Product ID: `com.ynx.calendar`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/36-calendar`
- Branch: `codex/final-calendar`
- Runtime source SHA: `b00f32da16218edb90fcc9f9b504607e374077ce`
- Local Git SHA at checkpoint start: `b00f32da16218edb90fcc9f9b504607e374077ce`
- Remote branch SHA at checkpoint start: `b00f32da16218edb90fcc9f9b504607e374077ce`
- `origin/main` SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / Behind: `0 / 0` before the evidence checkpoint commit
- Dirty state: yes — release/evidence/agent-memory checkpoint is validated and awaiting commit; runtime code is already committed and pushed
- Current phase: FREEZE
- Long-term status: ACTIVE

## Latest successful tests

- `go test ./internal/calendar ./apps/calendar/statectl`
- `go test -race ./internal/calendar`
- `go vet ./internal/calendar ./apps/calendar/statectl`
- `npm test`
- `npm run test:release`
- `npm run build`
- `npm run build:statectl`
- `npm run smoke`
- `npm run browser:proof` twice consecutively with different process-derived ports
- JSON validation for eight modified JSON files and eleven JSONL records
- `git diff --check`
- `node --check tests/browser-proof.cjs`
- operator backup and isolated restore drill

## GitHub

- Upstream: `origin/codex/final-calendar`
- Pull request for this head: none observed during recovery
- Branch Actions runs: none observed during recovery
- Current-source release: none
- Historical prerelease: `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f`, bound to source `e227c4f0505537b19f4588ea26478c54518f0a4c`; historical test-only evidence
- Current-source artifact/SBOM/provenance: absent

## Runtime and recovery

- State disk envelope: version 1, HMAC authenticated
- State payload: version 1; authenticated legacy schema zero normalizes; future schema fails closed
- Backup envelope: version 1, deterministic, HMAC-SHA-256 authenticated, SHA-256 state digest
- Restore: new isolated relative target only; live state is not overwritten
- Local drill: 522-byte empty-state backup; 61 ms restore command; state SHA-256 `58f20ddf9650f8f3ca038d343694789ee8192273cd80d65bd947a7452ee4b8f4`
- Production recovery boundary: backup encryption, offsite retention, independent key escrow and representative RTO/RPO remain unaccepted

## Public deployment

- Official product domain: `ynxweb4.com`
- Canonical candidate: `https://ynxweb4.com/calendar`
- Probe on 2026-07-29: HTTP 200, but HTML title/description/canonical are the generic YNX Chain homepage and canonical points to `https://ynxweb4.com/`
- `websitePublished`: false
- `deployedPublic`: false
- `downloadHosted`: false for current source

## Completed

- Worktree/branch/remote identity recovery and protection
- Local/remote runtime SHA equality
- Recurrence schema and all three recurrence mutation scopes
- Explicit state payload schema version
- Deterministic authenticated backup
- Fail-closed isolated restore and operator CLI
- Recovery tests and local drill
- Browser-proof reliability hardening with per-process port ranges, a bounded 45-second health wait and bounded server/process cleanup
- Release truth and public metadata refresh
- Integration contract and CAL-X-013 recovery vector
- Operations, migration, observability, SLO/capacity, unit-economics and evidence documents

## Remaining

- Commit/push the current evidence checkpoint and verify Local/Remote equality
- Recheck GitHub Actions, PR and Release state for final evidence SHA
- Central Wallet/Auth, AI, Mail and Data Fabric acceptance
- Integration contract freeze and shared Testnet
- Security/SRE backup encryption, escrow, artifact, SBOM and provenance acceptance
- Current-source install/cold-start and immutable hosted artifacts
- Real `/calendar` Website page and public content/canonical probes
- Representative capacity, RTO/RPO and unit-economics measurements

## Current risks

- HTTP 200 route fallback could be mistaken for Calendar publication
- Authenticated backups are not encrypted
- Backup verification depends on retained Calendar HMAC key material
- Current single-file state store is not multi-instance or large-scale evidence
- Repository-wide preflight previously had failures outside Calendar ownership

## Evidence

- `apps/calendar/product-release.json`
- `product-release.json`
- `public-product-metadata.json`
- `release/integration/calendar-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `apps/calendar/FEATURE_COMPLETION_EVIDENCE.md`
- `apps/calendar/EVIDENCE_INDEX.md`
- `apps/calendar/OPERATIONS.md`
- `apps/calendar/MIGRATION_COMPATIBILITY.md`
