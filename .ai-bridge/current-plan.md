# YNX Calendar current plan

Status: **ACTIVE**  
Phase: **FREEZE**  
Runtime source: `9cf30f16c4312b4438d087b1df58cec68df54f15`

## Completed checkpoints

- Confirmed the designated worktree and `codex/final-calendar` branch, created the non-force remote upstream, and verified Local/Remote equality.
- Added recurrence schema v1 with yearly, ByDay, ByMonthDay, DST-safe expansion, invalid-date skipping, and single-occurrence exception data.
- Added explicit occurrence-only, this-and-following, and entire-series preview/approval APIs with stable series lineage.
- Made future-series split approval and rollback atomic, idempotent, version-checked, restart-safe, and fail-closed on derived event collisions.
- Added additive legacy normalization for recurrence schema version and series lineage in stored events and change snapshots.
- Added a reproducible Android build entrypoint that resolves JDK 17–21 and the Android SDK or fails closed.
- Passed Calendar unit, Race, Vet, Web/i18n, browser, Go build, Android debug build, iOS parse/lint, and service smoke gates.
- Frozen the Calendar integration contract, dependency acceptance, cross-product vectors, release truth, and `/calendar` Website handoff without claiming central integration or public deployment.

## Current slice

1. Bind recurrence mutation, migration, conflict and Testnet evidence to runtime source `9cf30f16c4312b4438d087b1df58cec68df54f15`.
2. Update release/public metadata so current source and historical `e227c4f` test-only artifacts remain separated.
3. Validate JSON/JSONL and release manifest gates.
4. Review, commit, push, and verify Local SHA equals Remote SHA.

## Next runtime slice

Prioritize recovery and persistence before further UI expansion:

- add an explicit Calendar state payload schema version;
- implement deterministic backup and authenticated restore to an isolated target;
- reject tampered, wrong-product, incompatible-version, stale and path-escaping restore inputs;
- run destructive restore drills with integrity, restart, RTO/RPO and rollback evidence;
- preserve old-client compatibility and document that rollback migration evidence remains separate from backup restore.

## Known external dependencies

- `02-wallet-auth`: accepted Calendar product registration and deployed verifier/introspection/recovery path.
- `14-ai`: accepted authenticated JSON POST/SSE route.
- `20-cloud`: versioned notes/attachment object contract.
- `25-mail`: canonical invitation/reminder delivery contract.
- `26-data-fabric`: canonical Calendar event envelopes.
- `29-integration`: protocol freeze and shared Testnet orchestration.
- `30-security-platform`: release/artifact security acceptance.
- `28-website`: `/calendar` public page and deployment.

The product is not complete and no public runtime deployment is claimed.
