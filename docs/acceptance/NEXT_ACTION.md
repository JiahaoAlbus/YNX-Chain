# Next Action

Current single action: independently verify the Singapore and Silicon Valley SSH host-key fingerprints, then correct `known_hosts` only if the trusted fingerprints match and rerun deploy-readiness evidence for the new `ynx_6423-1` YNX Testnet.

Why this action:

- The Anti-Illegal Request Engine, Request Validity Standard, Appeal, and Transparency APIs are now implemented and locally verified.
- The final objective now prioritizes public multi-validator testnet proof over more local feature expansion.
- Remote mutation is still unsafe because Singapore and Silicon Valley host keys currently fail strict SSH verification.
- The repo now needs a repeatable, non-mutating host-key repair plan so the operator can verify fingerprints out-of-band before any known_hosts update.
- `remote-blocker-report` and `deploy-readiness-gate` now also require fresh underlying host-key and remote-smoke evidence; a freshly regenerated blocker JSON alone is not enough.
- `remote-smoke-test`, `verify-testnet`, and `public-proof` now need to prove Chain Law APIs too, not only RPC/faucet/pay/trust/resource/IDE basics.
- EVM/IDE bounded execution remains paused unless needed to preserve existing tests.

Files to touch:

- `scripts/verify/remote-smoke-test.mjs`
- `scripts/verify/remote-smoke-test.sh`
- `scripts/verify/verify-testnet.sh`
- `scripts/ops/host-key-repair-plan.sh`
- `scripts/ops/host-key-audit.sh`
- `scripts/verify/deploy-readiness-gate-check.mjs`
- `scripts/verify/remote-blocker-report.mjs`
- `scripts/verify/deploy-readiness-gate.mjs`
- `scripts/package/public-proof.sh`
- `docs/public-proof/PUBLIC_TESTNET_PROOF.md`
- `docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md`
- `docs/acceptance/GOAL_DIGEST.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`

Validation commands:

- `node --check scripts/verify/remote-smoke-test.mjs`
- `make host-key-repair-plan`
- `make host-key-audit`
- `make deploy-readiness-gate-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`
- `YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test`
- `make remote-blocker-report`
- `make deploy-readiness-gate`

Completion standard:

- `make host-key-repair-plan` produces `tmp/host-key-audit/HOST_KEY_REPAIR_PLAN.md` with current local entries, presented fingerprints, strict SSH output, and commands that are clearly marked as requiring trusted out-of-band fingerprint confirmation first.
- The script does not modify `~/.ssh/known_hosts` or bypass strict SSH checks.
- `make deploy-readiness-gate-check` proves the deploy gate rejects old-format blocker JSON, missing required source evidence, stale required source evidence, missing source files, and explicit endpoint blockers.
- `remote-blocker-report` records freshness for the underlying remote-smoke and host-key-audit evidence, and `deploy-readiness-gate` refuses mutation if either required source is missing or stale.
- Remote smoke evidence includes public Request Validity rule checks and transparency checks before any mutable remote action.
- Mutable remote proof actions, once public endpoints are confirmed as the new chain, include Anti-Illegal Request rejection, governance request lookup/review/reject, Trust appeal lookup/resolution, anti-unreasonable tracking, and final transparency report counts.
- `public-proof` remains invalid unless `remote-smoke-test` passes against public endpoints.
- `PROJECT_STATE.md` records current remote blocker evidence and does not claim public proof while endpoints are old-chain, timed out, or unverified.
- `FEATURE_COMPLETION_TRACKER.md` keeps remote-deployed/public-proof columns as `no` until live public evidence proves otherwise.

Explicitly not doing:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not deploy while `deploy-readiness-gate` is blocked.
- Do not bypass SSH host-key protections.
- Do not run the generated known_hosts repair commands unless the fingerprints are independently verified.
- Do not treat localhost smoke output as public proof.
- Do not claim mainnet, exchange listing, wallet default support, stablecoin issuer support, or third-party partnership.
- Do not claim the goal is complete.
