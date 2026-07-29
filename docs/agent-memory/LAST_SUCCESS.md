# YNX 27 DEX last success

Updated: 2026-07-29T02:27:50Z

The protected branch and remote were equal at `f933440d5cb791044476eb69c58c522d5c91d8a1` with a clean worktree and ahead/behind `0/0`.

Latest verified commands:

- `go test -race ./internal/dex ./cmd/ynx-dex-indexerd ./cmd/ynx-dex-recovery`
- `npm test --prefix sdk/dex` — 21 pass
- `npm run check --prefix sdk/dex`
- `npm test --prefix apps/dex` — 17 pass
- `npm run build --prefix apps/dex`
- `make secret-scan`
- `make static-check`
- `npm run dex:release:test`
- `npm run dex:manifests:check`
- `npm run dex:artifacts:verify`

The authenticated point-in-time DEX Indexer recovery drill is locally tested. It produces an immutable HMAC-authenticated bundle, verifies exact source/deployment bindings, restores into empty isolated destinations and reports observed local backup/restore/verification timing. This does not prove operational RPO on a provisioned Testnet service.

GitHub checks found no DEX PR, no branch Actions run and no DEX Release. No public deployment claim was made.
