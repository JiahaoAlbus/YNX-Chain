# YNX Calendar agent status

- Product: YNX Calendar
- Owner: 36-calendar
- Branch: `codex/final-calendar`
- Phase: FREEZE
- Long-term status: ACTIVE
- Runtime source: `9cf30f16c4312b4438d087b1df58cec68df54f15`
- Runtime checkpoint: pushed to `origin/codex/final-calendar`; Local/Remote equality verified
- Concurrent writer: none detected for this worktree

## Passing Calendar gates

- `go test ./internal/calendar`
- `go test -race ./internal/calendar`
- `go vet ./internal/calendar`
- `npm test` in `apps/calendar`
- `npm run build`
- `npm run build:android`
- `npm run check:ios`
- `npm run smoke`
- `npm run browser:proof`
- `node --check tests/browser-proof.cjs`
- `npm ci` reported zero known npm vulnerabilities

## Current runtime capability

- Recurrence schema v1 supports daily, weekly, monthly, yearly, interval, Count/Until, ByDay, ByMonthDay, DST-safe local time, and single-occurrence exceptions.
- `/v1/events/{id}/recurrence-preview` supports occurrence-only cancel/modify, this-and-following split, and entire-series update.
- Split future series has stable lineage, replay-safe IDs, optimistic concurrency, atomic approval/revert, restart persistence, and fail-closed derived-ID collision handling.
- Legacy stored recurrence records and pending changes normalize recurrence version and series lineage during load without reset or data replacement.

## Non-Calendar baseline failures

`go test ./...` is not green because unrelated repository packages currently fail on consensus signer-file permissions, missing IDE contract artifacts, Faucet signer permissions, and Trust signer permissions. Calendar tests pass. These failures are retained as Integration blockers and are not modified from this worktree.

## Release truth

- Current source is locally implemented and tested but not centrally integrated or publicly deployed.
- Current-source Android/iOS/macOS install and hosted artifact proof remains incomplete.
- Hosted Android/iOS/macOS preview artifacts remain bound to `e227c4f0505537b19f4588ea26478c54518f0a4c`, not to the current runtime source.
- GitHub directly confirms the historical tag is a prerelease targeting `e227c4f0505537b19f4588ea26478c54518f0a4c`, published on 2026-07-18, with the recorded asset digests and byte sizes.
- No production signing, notarization, public runtime deployment, or store release is claimed.
