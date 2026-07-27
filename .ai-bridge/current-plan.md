# YNX Calendar current plan

Status: **ACTIVE**  
Phase: **FREEZE**  
Runtime source: `4ed42274a7abca2aaea0a426faa1c5548f8fd63e`

## Completed checkpoint

- Confirmed the designated worktree and `codex/final-calendar` branch.
- Created and pushed the final remote branch without rewriting history.
- Added recurrence schema v1 with yearly, ByDay, ByMonthDay, DST-safe expansion, and single-occurrence cancellation/modification.
- Added a reproducible Android build entrypoint that resolves JDK 17–21 and the Android SDK.
- Passed Calendar unit, Race, Web/i18n, browser, Go build, Android debug build, iOS parse/lint, and service smoke gates.

## Current slice

1. Freeze the Calendar-owned integration contract, dependency acceptance, and cross-product vectors.
2. Correct release truth so current runtime source and older hosted preview artifacts cannot be confused.
3. Establish public metadata and the `/calendar` Website handoff without claiming public deployment.
4. Validate all machine-readable records, review changes, commit, push, and verify Local SHA equals Remote SHA.

## Next runtime slice

Implement explicit recurrence mutation scopes:

- occurrence-only cancellation/modification;
- this-and-following split with deterministic series linkage;
- entire-series update;
- replay, version conflict, DST, rollback, restart, and conflict tests.

## Known external dependencies

- `02-wallet-auth`: accepted Calendar product registration and deployed verifier/introspection/recovery path.
- `14-ai`: accepted authenticated JSON POST/SSE route.
- `25-mail`: canonical invitation/reminder delivery contract.
- `26-data-fabric`: canonical Calendar event envelopes.
- `29-integration`: protocol freeze and shared Testnet orchestration.
- `30-security-platform`: release/artifact security acceptance.
- `28-website`: `/calendar` public page and deployment.

The product is not complete and no public runtime deployment is claimed.
