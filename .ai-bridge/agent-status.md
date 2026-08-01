# YNX Calendar agent status

- Product: YNX Calendar
- Owner: 36-calendar
- Branch: `codex/final-calendar`
- Phase: FREEZE
- Long-term status: ACTIVE
- Runtime source: `b00f32da16218edb90fcc9f9b504607e374077ce`
- Runtime checkpoint: `b00f32da16218edb90fcc9f9b504607e374077ce`, pushed to `origin/codex/final-calendar`
- Evidence checkpoint: `06f8b2bce60780ca27cf71a0705bfdf060dc57f6`, pushed with Local/Remote equality and Ahead/Behind `0/0`
- Concurrent writer: none detected for this worktree

## Passing Calendar gates

- `go test ./internal/calendar ./apps/calendar/statectl`
- `go test -race ./internal/calendar`
- `go vet ./internal/calendar ./apps/calendar/statectl`
- `npm test` in `apps/calendar`
- `npm run test:release`
- `npm run build`
- `npm run build:statectl`
- `npm run build:android`
- `npm run check:ios`
- `npm run smoke`
- `npm run browser:proof` twice consecutively on distinct process-derived ports
- JSON/JSONL validation, `git diff --check` and `node --check tests/browser-proof.cjs`
- local operator backup and isolated restore drill

## Current runtime capability

- Recurrence schema v1 supports daily, weekly, monthly, yearly, interval, Count/Until, ByDay, ByMonthDay, DST-safe local time and single-occurrence exceptions.
- `/v1/events/{id}/recurrence-preview` supports occurrence-only cancel/modify, this-and-following split and entire-series update.
- Split future series has stable lineage, replay-safe IDs, optimistic concurrency, atomic approval/revert, restart persistence and fail-closed derived-ID collision handling.
- Calendar state payload schema v1 is explicit; authenticated schema-zero legacy state normalizes and future versions fail closed.
- Deterministic backup includes product, version, time, state SHA-256 and HMAC-SHA-256.
- Restore writes only to an isolated relative target and rejects tamper, wrong product, incompatible version, stale/future time, absolute/path escape, symbolic-link and existing-target inputs.

## Recovery evidence

- Empty-state backup: 522 bytes.
- Isolated restore command: 61 ms.
- Restored state SHA-256: `58f20ddf9650f8f3ca038d343694789ee8192273cd80d65bd947a7452ee4b8f4`.
- Live store modified: false.
- Boundary: local control-path proof only; no backup encryption, offsite retention, independent key escrow or production-scale RTO/RPO claim.

## Non-Calendar baseline failures

`go test ./...` is not green because unrelated repository packages previously failed on consensus signer-file permissions, missing IDE contract artifacts, Faucet signer permissions and Trust signer permissions. Calendar tests pass. These failures remain Integration-owned until a fresh repository preflight proves otherwise.

## Release truth

- Current source is locally implemented and tested but not centrally integrated or publicly deployed.
- GitHub inspection for evidence checkpoint `06f8b2bc` returned no PR, no workflow runs and no current-source Calendar release.
- Current-source Android/iOS/macOS install and hosted artifact proof remains incomplete.
- Historical preview artifacts remain bound to `e227c4f0505537b19f4588ea26478c54518f0a4c`, not to the current runtime source.
- `https://ynxweb4.com/calendar` redirects to a generic homepage shell with root canonical; `websitePublished` and `deployedPublic` remain false.
- No staging/public runtime, current-source hosted download, production signing, notarization or store release is claimed.
- Website handoff targets only `ynxweb4.com/calendar`; `huangjeo.com` remains the Founder site.
