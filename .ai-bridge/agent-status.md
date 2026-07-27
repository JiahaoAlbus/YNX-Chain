# YNX Bridge Agent Status

- Product: YNX Bridge & Interoperability
- Status: ACTIVE
- Phase: TESTNET
- Workspace: designated YNX 21 worktree verified
- Branch: `codex/final-bridge`
- Verified source commit: `a1c640e00cc06924244834e2f2a77d18849aa834`
- Upstream: `origin/codex/final-bridge`
- Local/remote relation: synchronized at `a1c640e00cc06924244834e2f2a77d18849aa834` before this evidence update
- Concurrent writer risk: none detected for the 21-bridge worktree
- Dirty state: migration evidence generator, evidence record, and coordination updates pending checkpoint commit
- Public execution: disabled
- Public read-only deployment: present at `https://rest.ynxweb4.com/app/bridge`
- Executable YNX route: unavailable
- Real deposit/withdrawal evidence: absent
- Bridge-specific GitHub Actions run: absent
- Bridge-specific Release and Artifact: absent

## Current verified tests

- `go test -race ./internal/bridgegateway ./cmd/ynx-bridged` — passed
- `go test ./...` — passed
- `go build ./cmd/ynx-bridged` — passed
- `make no-placeholder-check` — passed
- `make secret-scan` — passed
- `make bridge-migration-check` — passed with Race detector and machine-readable evidence
- `make bridge-restore-check` — passed; corruption rejected, local restore to health approximately 13.07 ms, accepted mutation loss 0
- `make bridge-provider-check` — failed closed after two Circle Sandbox connection timeouts

## Last protected engineering slice

Commit `a1c640e00cc06924244834e2f2a77d18849aa834` adds deterministic v6 backup rollback/forward recovery testing, a migration gate, and current v7 rollback policy. The commit was pushed and is the source bound by `docs/bridge/migration-rollback-evidence.json`.

## Next action

Protect the migration evidence update, correct stale Bridge status records, then add Bridge-specific CI and reproducible candidate artifacts.
