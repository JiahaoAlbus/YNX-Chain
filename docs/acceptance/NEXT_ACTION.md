# Next Action

Current single action: return to remote core testnet deployment readiness by clearing the trusted host-key approval blocker for Singapore and Silicon Valley, then rerun deploy-readiness evidence. Do not mutate remote hosts or repair known_hosts until those fingerprints are independently confirmed.

Why this action:

- Chain Law / Anti-Illegal / Request Validity / Appeal / Transparency are now locally verified again through unit tests, dedicated smoke checks, and preflight, and remain wired into public-proof requirements.
- Public proof now requires appeal resolution to be followed by Trust evidence false-positive correction summary (`trust.appeal.correctionEvidence.summary`), so a remote proof cannot pass by only changing appeal status without showing reviewer-facing correction evidence.
- Resource Market production pricing/governance config is local verified and wired into public-proof requirements.
- Release manifest evidence now captures observed per-node manifest commit/release/path and fails mismatched release identity locally; this still needs real remote node evidence after deployment.
- Public-proof evidence validation now rejects checks-only evidence unless remote smoke metadata, expected YNX chain identity, release identity, non-local public endpoints, non-local gRPC host, and release-manifest evidence path are present.
- Public-proof evidence validation now also rejects stale evidence whose `gitCommit` or `expected.releaseCommit` does not match the current local HEAD.
- Public-proof package validation now rejects package manifests whose status, `validPublicProof`, remote evidence, release-manifest evidence, generated proof summary, or file SHA-256s are inconsistent.
- Deploy package dry-run now verifies both Nginx and Caddy ingress configs, including managed Caddy snippet packaging plus non-destructive Caddyfile import/candidate-validate/backup/reload command path and executable local installer fixture coverage for the currently observed Caddy-backed primary host shape.
- Deploy package dry-run now verifies the post-restart local service checker is packaged, self-tested, and invoked for the primary full-stack node and every validator with the expected commit, release, chain ID, and mode. This closes a local deployment-package gap only; it is not remote public proof.
- Primary full-stack deploy checks now require `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd` health responses to expose the same expected build commit and release, and dry-run verifies release strings in all four deployed binaries.
- Deploy-readiness gate now rejects fresh remote-smoke evidence if its `gitCommit` / expected release identity is not bound to the current local HEAD.
- Remote-blocker reports now surface stale/wrong remote-smoke evidence identity as a deploy-blocking source issue before deployment is attempted.
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
- `scripts/verify/public-proof-evidence-check.mjs`
- `scripts/verify/remote-smoke-test.mjs`
- `scripts/verify/deploy-readiness-gate.mjs`
- `scripts/verify/remote-blocker-report.mjs`
- `scripts/deploy/deploy-testnet.sh`
- `scripts/deploy/dry-run.sh`
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
- `make public-proof-package-check`
- `make deploy-readiness-gate-check`
- `make deploy-dry-run`
- `scripts/deploy/check-local-services.sh --self-test`
- `make caddy-ingress-check`
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
- Public-proof validation must keep rejecting localhost, old-chain identity, wrong release identity, stale commit/release evidence, missing metadata, missing required checks, failed required checks, and skipped mutable actions.
- Public-proof validation must keep rejecting remote evidence that lacks post-resolution Trust evidence correction summary for appeals.
- Public-proof package validation must keep failed diagnostic packages marked invalid and must reject manifest/evidence/validation/hash mismatches.
- Deploy dry-run must prove the release bundle includes `nginx/ynx-chain.conf`, `caddy/ynx-chain.caddy`, and `scripts/install-caddy-ingress.sh`, with REST/API, Indexer, Explorer, Faucet, RPC, and EVM public routes mapped to the correct local service ports. The Caddy path must preserve an existing `/etc/caddy/Caddyfile` through a managed import block, validate the candidate config before replacement, back up the previous Caddyfile, and have a local fixture that actually runs the generated installer instead of only grepping for command text.
- Deploy dry-run must prove the release bundle includes `scripts/check-local-services.sh`, runs its self-test, and emits post-restart checker commands for the primary full-stack node plus Singapore, Silicon Valley, and Seoul validators using the expected commit, release name, numeric chain ID, and validator/full mode.
- Deploy dry-run must prove `ynx-chaind`, `ynx-indexerd`, `ynx-explorerd`, and `ynx-faucetd` binaries all carry the current release commit/name, and the primary full-stack checker must reject stale auxiliary health build identity.
- Deploy-readiness gate must reject remote evidence generated from an older local commit or mismatched expected release identity, even when the evidence file is fresh.
- Remote-blocker reports must show remote evidence identity mismatch as a source blocker, not only as a later deploy-gate failure.

Explicitly not doing:

- Do not claim remote public proof while public endpoints still show old chain, 501/404, timeout, missing release identity, missing manifest checksum, or skipped mutable proof.
- Do not modify the website repo for this chain-runtime slice.
- Do not expand bounded EVM/IDE execution unless needed to keep existing tests green.
- Do not mutate remote hosts while deploy-readiness gate remains blocked.
- Do not treat `ssh-keyscan` fingerprints as trusted approval.
- Do not add another local feature slice unless host-key approval remains externally unavailable and the next slice is a real tracker gap.
