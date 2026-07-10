# Next Action

Current single action: return to remote core testnet deployment readiness by clearing the trusted host-key approval blocker for Singapore and Silicon Valley, then rerun deploy-readiness evidence. Do not mutate remote hosts or repair known_hosts until those fingerprints are independently confirmed.

Why this action:

- Chain Law / Anti-Illegal / Request Validity / Appeal / Transparency are now locally verified again through unit tests, dedicated smoke checks, and preflight, and remain wired into public-proof requirements.
- Resource Market production pricing/governance config is local verified and wired into public-proof requirements.
- Release manifest evidence now captures observed per-node manifest commit/release/path and fails mismatched release identity locally; this still needs real remote node evidence after deployment.
- The remaining highest-priority gap is no longer another local feature slice; it is getting the core remote testnet safely deployable and publicly provable.
- Singapore and Silicon Valley host keys still need trusted external confirmation before known_hosts repair or deploy mutation.
- Deploy-readiness gate must remain fail-closed until approval and public endpoint evidence are safe.

Files to touch:

- `.host-key-approvals.json` (ignored local file; only after trusted external confirmation)
- `tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md`
- `tmp/host-key-audit/host-key-approval-request.json`
- `tmp/host-key-audit/HOST_KEY_APPROVAL_STATUS.md`
- `tmp/verify-testnet/REMOTE_BLOCKERS.md`
- `scripts/verify/verify-testnet.sh`
- `scripts/verify/release-manifest-evidence.mjs`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `go test ./...`
- `make test`
- `make anti-illegal-request-check`
- `make request-validity-check`
- `make transparency-report-check`
- `make trust-appeal-check`
- `make host-key-audit`
- `make host-key-approval-request`
- `make host-key-approval-status`
- `make host-key-approval-check`
- `make host-key-approved-repair-dry-run`
- `make release-manifest-evidence-check`
- `make verify-testnet-check`
- `make public-proof-evidence-check`
- `make deploy-readiness-gate-check`
- `make deploy-dry-run`
- `make remote-smoke-test`
- `make remote-blocker-report`
- `make deploy-readiness-gate`
- `make env-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Trusted fingerprints are copied only from an external provider/cloud-console channel, not from `ssh-keyscan` alone.
- `make host-key-approval-check` passes.
- `make host-key-approved-repair-dry-run` shows only approved Singapore and Silicon Valley known_hosts replacements.
- `make host-key-approved-repair` is not run until the dry-run is reviewed.
- Remote deployed/public proof remains `no` until real public endpoints and strict SSH checks pass.
- Chain Law local checks stay green, but they do not count as public proof until `remote-smoke-test`, `verify-testnet`, and `public-proof` pass against the deployed public endpoints.
- Release manifest evidence must include observed per-node manifest commit, release, `bin/ynx-chaind` path, manifest SHA-256, and binary SHA-256 matching the expected release before public proof can pass.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
- Do not treat `ssh-keyscan` fingerprints as trusted approval.
- Do not add another local feature slice unless host-key approval remains externally unavailable and the next slice is a real tracker gap.
