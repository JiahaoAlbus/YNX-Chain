# YNX Calendar current plan

Status: **ACTIVE**  
Phase: **FREEZE**  
Runtime source: `b00f32da16218edb90fcc9f9b504607e374077ce`

## Completed checkpoints

- Recovered and verified the designated `36-calendar` worktree, `codex/final-calendar` branch, YNX Chain remote, clean initial state, and Local/Remote equality.
- Preserved recurrence schema v1 and occurrence, this-and-following and entire-series mutation scopes with stable lineage and atomic approval/revert.
- Added explicit Calendar state payload schema version 1 while retaining authenticated legacy schema-zero compatibility.
- Added deterministic HMAC-authenticated backup with SHA-256 state digest.
- Added isolated restore that refuses live/existing targets and rejects tamper, wrong product, incompatible version, stale/future time, absolute/path escape and symbolic-link traversal.
- Added the `ynx-calendar-state` operator CLI and completed a local backup/restore drill with matching digest and live state unchanged.
- Passed targeted Go, Race, Vet, Web, release-manifest, build, smoke and browser gates.
- Pushed runtime source `b00f32da16218edb90fcc9f9b504607e374077ce` and verified Local SHA equals Remote SHA.
- Updated release truth, integration contract, test vector CAL-X-013, Website handoff, migration, operations, observability, SLO/capacity and unit-economics evidence without claiming central/public completion.

## Current slice

1. Validate all modified JSON, release manifests and documentation references.
2. Run the complete Calendar verification set including the state operator build.
3. Commit and push the evidence/recovery checkpoint.
4. Verify Local SHA equals Remote SHA, inspect GitHub Actions/PR/Release state for the final evidence SHA, and update agent memory.
5. Probe `ynxweb4.com/calendar` and preserve `deployedPublic=false` unless exact current-source content and canonical evidence exist.

## Next executable integration slice

Submit `release/integration/calendar-contract.json` and `CAL-X-013` to `29-integration` and `30-security-platform`. Require accepted encrypted offsite retention, independent key escrow, representative restore data, measured promotion/rollback time and immutable recovery evidence before any production RTO/RPO or disaster-recovery claim.

In parallel, keep these dependency gates explicit:

- `02-wallet-auth`: accepted Calendar product registration and deployed verifier/introspection/recovery path.
- `14-ai`: accepted authenticated JSON POST/SSE route.
- `20-cloud`: versioned notes/attachment object contract.
- `25-mail`: canonical invitation/reminder delivery contract.
- `26-data-fabric`: canonical Calendar event envelopes.
- `28-website`: current `/calendar` page and public deployment on `ynxweb4.com`.
- `29-integration`: protocol freeze and shared Testnet orchestration.
- `30-security-platform`: backup encryption/escrow plus release/artifact security acceptance.

The product remains ACTIVE. No central integration, current-source hosted artifact, staging/public runtime, production signing or store release is claimed.
