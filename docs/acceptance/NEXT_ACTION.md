# Next Action

Current single action: bind release manifest evidence into the public-proof package and validation report. Remote deployment remains blocked, so the next useful chain-construction work is to make future public proof packages carry the same artifact checksum/provenance context that `verify-testnet` now checks over SSH.

Why this action:

- Deploy bundles now include `config/release-manifest.json` with non-secret artifact SHA-256 checksums.
- `make deploy-dry-run` verifies the manifest against the generated release bundle.
- `verify-testnet` has a safe remote path to compare installed `ynx-chaind` checksum against the manifest without printing env files.
- `public-proof` still mainly packages remote-smoke evidence; it should also preserve release manifest provenance once remote deployment exists.

Files to touch:

- `scripts/package/public-proof.sh`
- `scripts/verify/public-proof-evidence-check.mjs`
- `scripts/verify/remote-smoke-test.mjs`
- `scripts/verify/remote-blocker-report.mjs`
- `docs/public-proof`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make smoke-test`
- `make validator-peer-readiness-check`
- `make deploy-dry-run`
- `make release-manifest-check`
- `make verify-testnet-check`
- `make public-proof-evidence-check`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Public-proof package logic has a field/file for release manifest evidence.
- The public-proof validator rejects proof when required release manifest evidence is missing, failed, or inconsistent.
- Remote-smoke or verify evidence has a documented handoff for manifest checksum fields.
- Local fixtures prove missing manifest evidence keeps `validPublicProof=false`.
- Remote deployed/public proof remains `no` until real public endpoints pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
