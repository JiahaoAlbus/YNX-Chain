# YNX Calendar agent status

- Product: YNX Calendar
- Owner: 36-calendar
- Branch: `codex/final-calendar`
- Phase: FREEZE
- Long-term status: ACTIVE
- Runtime source: `4ed42274a7abca2aaea0a426faa1c5548f8fd63e`
- Remote checkpoint: pushed to `origin/codex/final-calendar`
- Concurrent writer: none detected for this worktree

## Passing Calendar gates

- `go test ./internal/calendar`
- `go test -race ./internal/calendar`
- `npm test` in `apps/calendar`
- `npm run build`
- `npm run build:android`
- `npm run check:ios`
- `npm run smoke`
- `npm run browser:proof`
- `npm ci` reported zero known npm vulnerabilities

## Non-Calendar baseline failures

`go test ./...` is not green because unrelated repository packages currently fail on signer-file permission checks and missing IDE contract artifacts. Calendar tests pass. These failures are retained as Integration blockers and are not modified from this worktree.

## Release truth

- Current source is locally implemented and tested but not centrally integrated or publicly deployed.
- Hosted Android/iOS/macOS preview artifacts remain bound to `e227c4f0505537b19f4588ea26478c54518f0a4c`, not to the current runtime source.
- GitHub directly confirms the historical tag is a prerelease targeting `e227c4f0505537b19f4588ea26478c54518f0a4c`, published on 2026-07-18, with the recorded asset digests and byte sizes.
- No production signing or store release is claimed.
