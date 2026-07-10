# Next Action

Current single action: obtain trusted out-of-band confirmation for Singapore and Silicon Valley SSH host-key fingerprints, then run the existing approval check and approved known_hosts repair dry-run. Do not mutate remote hosts or repair known_hosts until those fingerprints are independently confirmed.

Why this action:

- Fresh host-key audit now shows primary and Seoul strict SSH accepted current host keys.
- Singapore and Silicon Valley both present changed host keys with valid scanned fingerprints.
- Approval request/status files now contain six untrusted fingerprint rows, three per mismatch node.
- Deploy-readiness gate correctly fails closed until ignored `.host-key-approvals.json` contains trusted, externally confirmed fingerprints and approved repair is reviewed.

Files to touch:

- `.host-key-approvals.json` (ignored local file; only after trusted external confirmation)
- `tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md`
- `tmp/host-key-audit/host-key-approval-request.json`
- `tmp/host-key-audit/HOST_KEY_APPROVAL_STATUS.md`
- `tmp/verify-testnet/REMOTE_BLOCKERS.md`
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

- Trusted fingerprints are copied only from an external provider/cloud-console channel, not from `ssh-keyscan` alone.
- `make host-key-approval-check` passes.
- `make host-key-approved-repair-dry-run` shows only the approved Singapore and Silicon Valley known_hosts replacements.
- `make host-key-approved-repair` is not run until the dry-run is reviewed.
- Remote deployed/public proof remains `no` until real public endpoints and strict SSH checks pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
