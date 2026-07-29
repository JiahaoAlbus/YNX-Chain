# YNX 20 Cloud — Current State

Updated: 2026-07-29T03:06:00Z

## Identity

- Product: `20 — YNX Cloud`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/20-cloud`
- Branch: `codex/final-cloud`
- Repository: `JiahaoAlbus/YNX-Chain`
- Audited checkpoint SHA: `5666b3ebc318fc13749fe3d48b5b607739c56eca`
- Product implementation SHA: `e05db0b5663c151c1805c99ff3f55f433127aa92`
- Latest durable lifecycle runtime SHA: `e7cb63a311115fb8ff643d3cfa4ca1b1c8a89556`
- Remote checkpoint SHA: `5666b3ebc318fc13749fe3d48b5b607739c56eca`
- `origin/main`: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead/behind at checkpoint: `0 / 0` versus `origin/codex/final-cloud`
- Dirty state at checkpoint: clean

## Phase

`testedLocal` with exact-SHA CI and evidence hardening. Central integration, provider-bound staging, public Cloud runtime, immutable hosted release and production signing are not complete.

## Latest successful tests

- `npm --prefix apps/cloud test` — 12/12 passed.
- `npm --prefix apps/cloud run check` — static, accessibility and product-boundary checks passed.
- `npm --prefix apps/cloud run security` — security gate passed for 23 runtime files and 468 locked components.
- `go test -count=1 ./internal/cloud ./apps/cloud/cmd/ynx-cloudd` — passed.
- `go test -race -count=1 ./internal/cloud` — passed on implementation SHA `e05db0b`.

## CI

- Workflow: `Cloud security and recovery gates`
- Run: `30418539097`
- Head SHA: `5666b3ebc318fc13749fe3d48b5b607739c56eca`
- Conclusion: success
- Job: `90470201097`
- Verified: static security/SBOM gate, Cloud control-plane tests, Web/SDK/a11y boundaries, least-privilege image cold-start, Critical/High Trivy gate, artifact upload, canonical auth/API/migration/backup/restore DAST.
- Artifact: `8711035103`, `ynx-cloud-trivy-5666b3ebc318fc13749fe3d48b5b607739c56eca`, expiring 2026-08-28.

## PR, release and artifacts

- Open Cloud PR: none.
- Merged Cloud PR for this checkpoint: none.
- GitHub Cloud Release: none.
- Candidate APK: local/debug-signed artifact pinned to older source `db9bc224`; current `installedLocal` remains false.
- Immutable hosted container/image: none.
- Production SBOM/provenance/signature: not published. Deterministic local SBOM and bounded evidence exist only within documented limits.

## Public deployment and website

- Official domain: `ynxweb4.com`.
- Product status route: `https://ynxweb4.com/cloud` returned HTTP 200 during the 2026-07-29 audit.
- The deployed website bundle registered Cloud as `local`, source `7b3c5f427c17`, with no public runtime or hosted installer.
- Cloud runtime deployed staging: false.
- Cloud runtime deployed public: false.
- Website handoff created: `apps/cloud/integration/website-handoff.json`.
- Handoff created does not equal website deployed or runtime deployed.

## Completed in this recovery slice

- Recovered and verified Worktree, branch, remote, local/remote SHA and prior lifecycle-worker result.
- Added a user-held Web Crypto AES-256-GCM client-encryption envelope.
- Bound authenticated data to exact product, account, context ID and version.
- Added fail-closed tests for tamper, context mismatch, weak keys and missing recovery policy.
- Removed caller-controlled nonce input to prevent accidental nonce reuse.
- Corrected Cloud web callback authority from legacy `ynx.network` to `ynxweb4.com`.
- Retained exact CI container scan report and SHA-256 evidence.
- Updated release truth, public metadata, completion evidence, release notes, goal coverage and website handoff.

## Remaining

- Production-client key custody, recovery-package, key rotation and hardware-backed storage contracts and UX.
- Independent cryptographic review.
- Provisioned object-store provider, KMS, scanner, remote lifecycle, CDN/cache and replication/erasure-coding proof.
- Distributed limiter, sharding and concurrent persisted million-object benchmark.
- Central Wallet/Auth and owner-29 integration acceptance.
- Remote migration, cross-region restore and rollback drills.
- Immutable image/package hosting, reproducible provenance, production signing and store release.
- Owner-28 website deployment of current metadata after owner-29 acceptance.

## Current risks

- A user who loses the client-held encryption key cannot recover plaintext through YNX Cloud.
- The public website’s Cloud status metadata is stale until owner 28 deploys the handoff.
- No provider-bound durability, KMS, CDN, replication or public runtime proof exists.
- The workflow uses GitHub actions that currently emit a Node.js runtime deprecation annotation; CI still passed.

## Primary evidence

- `apps/cloud/product-release.json`
- `apps/cloud/FEATURE_COMPLETION_EVIDENCE.md`
- `apps/cloud/evidence/EVIDENCE_INDEX.md`
- `apps/cloud/evidence/CLIENT_ENCRYPTION_e05db0b.json`
- `apps/cloud/evidence/CONTAINER_SCAN_e05db0b.json`
- `apps/cloud/evidence/PUBLIC_ROUTE_AUDIT_20260729.json`
- `apps/cloud/integration/website-handoff.json`
