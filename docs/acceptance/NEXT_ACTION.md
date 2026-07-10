# Next Action

Current single action: return to remote core testnet deployment readiness by clearing the trusted host-key approval blocker for Singapore and Silicon Valley, then rerun deploy-readiness evidence. Do not mutate remote hosts or repair known_hosts until those fingerprints are independently confirmed.

Why this action:

- Resource Market production pricing/governance config is now local verified and wired into public-proof requirements.
- The remaining highest-priority gap is no longer another local feature slice; it is getting the core remote testnet safely deployable and publicly provable.
- Singapore and Silicon Valley host keys still need trusted external confirmation before known_hosts repair or deploy mutation.
- Deploy-readiness gate must remain fail-closed until approval and public endpoint evidence are safe.

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
- `make host-key-audit`
- `make host-key-approval-request`
- `make host-key-approval-status`
- `make host-key-approval-check`
- `make host-key-approved-repair-dry-run`
- `make release-manifest-evidence-check`
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

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
- Do not treat `ssh-keyscan` fingerprints as trusted approval.
- Do not add another local feature slice unless host-key approval remains externally unavailable and the next slice is a real tracker gap.
