# Next Action

Current single action: prove the Anti-Illegal Request Engine, Request Validity Standard, Appeal, and Transparency APIs on real public endpoints for the new `ynx_6423-1` YNX Testnet. The immediate safe prerequisite is to independently verify the Singapore and Silicon Valley SSH host-key fingerprints, write the confirmed values to ignored `.host-key-approvals.json`, require `make host-key-approval-check` to pass, then correct `known_hosts` only if the trusted fingerprints match and rerun deploy-readiness evidence.

Why this action:

- The Anti-Illegal Request Engine, Request Validity Standard, Appeal, and Transparency APIs are now implemented, covered by local devnet tests, covered by handler-level API tests, and wired into smoke/check commands.
- The final objective now prioritizes public proof for these Chain Law / Appeal / Transparency surfaces over more local EVM/IDE feature expansion.
- Remote mutation is still unsafe because Singapore and Silicon Valley host keys currently fail strict SSH verification.
- The repo now needs a repeatable, non-mutating host-key repair plan so the operator can verify fingerprints out-of-band before any known_hosts update.
- The repo now has a machine-checkable host-key approval step, blank approval-template generator, external approval-request generator, and approval-gated known_hosts repair command, but no trusted approval file is present yet.
- Fresh evidence from 2026-07-09 still shows `.host-key-approvals.json` absent, Singapore/Silicon Valley host-key mismatch, REST/governance HTTP 501, explorer 404, faucet native `anyxt`, and public RPC/indexer/AI/Web4/faucet responses tied to legacy `ynx_9102-1`.
- `remote-blocker-report` and `deploy-readiness-gate` now also require fresh underlying host-key and remote-smoke evidence; a freshly regenerated blocker JSON alone is not enough.
- When host-key mismatches exist, `remote-blocker-report` and `deploy-readiness-gate` now also require fresh `host-key-approval-request` markdown and JSON artifacts, and the JSON rows must match the current scanned mismatch fingerprints so stale or touched fingerprint requests cannot be used for trusted approval.
- Public endpoint evidence that proves the old chain, wrong EVM/Cosmos chain ID, empty validator set, missing validator metadata, missing block growth, or skipped mutable proof actions is now deploy-blocking even when the endpoint returns HTTP successfully.
- `remote-smoke-test`, `verify-testnet`, and `public-proof` now need to prove Chain Law APIs too, not only RPC/faucet/pay/trust/resource/IDE basics.
- `public-proof` now has a second evidence-completeness validator and cannot mark `validPublicProof=true` unless all required remote endpoint, validator, Chain Law, Appeal, Transparency, anti-unreasonable tracking, resource, and IDE checks are present and passed.
- EVM/IDE bounded execution is safely closed for now: keep existing tests green, but do not expand bounded opcode coverage, Counter samples, Hardhat artifacts, or IDE execution unless needed to preserve current tests.

Files to touch:

- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `tmp/host-key-audit/HOST_KEY_REPAIR_PLAN.md` as generated evidence only
- `tmp/verify-testnet/REMOTE_BLOCKERS.md` as generated evidence only
- Deployment scripts, remote smoke/proof scripts, and public proof docs only after host-key approval and deploy-readiness evidence are safe.

Validation commands:

- `go test ./...`
- `make anti-illegal-request-check`
- `make request-validity-check`
- `make transparency-report-check`
- `make trust-appeal-check`
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`
- `make public-proof-evidence-check`
- `make host-key-repair-plan`
- `make host-key-approval-template`
- `make host-key-approval-request`
- `make host-key-approval-check-test`
- `make host-key-approval-check`
- `make host-key-approved-repair-dry-run`
- `make host-key-approved-repair`
- `make host-key-audit`
- `make deploy-readiness-gate-check`
- `YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test`
- `make remote-blocker-report`
- `make deploy-readiness-gate`

Completion standard:

- Local code must expose and test `POST /governance/requests`, `GET /governance/requests/:id`, `POST /governance/requests/:id/review`, `POST /governance/requests/:id/reject`, `GET /governance/transparency`, `POST /trust/appeals`, and `GET /trust/appeals/:id`.
- Local tests and smoke/check commands must prove request intake, validity classification, illegal rejection, overbroad detection, evidence checks, asset boundary checks, native YNXT direct-freeze protection, appeal intake, transparency records, and persistence.
- `FEATURE_COMPLETION_TRACKER.md` must keep these modules as not remote deployed and not public proof until a real public endpoint passes.
- `make host-key-repair-plan` produces `tmp/host-key-audit/HOST_KEY_REPAIR_PLAN.md` with current local entries, presented fingerprints, strict SSH output, and commands that are clearly marked as requiring trusted out-of-band fingerprint confirmation first.
- `make host-key-approval-template` produces `tmp/host-key-audit/host-key-approvals.template.json` with blank fingerprint values for mismatched hosts only; it must not create or imply a trusted approval.
- `make host-key-approval-request` produces `tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md` and `tmp/host-key-audit/host-key-approval-request.json` for external fingerprint comparison; it must clearly mark current-scan fingerprints as untrusted and must not write `.host-key-approvals.json`.
- `make host-key-approval-check-test` proves the approval checker accepts matched fingerprints and rejects mismatched fingerprints.
- `make host-key-approval-check` remains blocked until ignored `.host-key-approvals.json` contains exact fingerprints confirmed from a trusted external source.
- `make host-key-approved-repair-dry-run` and `make host-key-approved-repair` must fail closed unless `make host-key-approval-check` would pass first. The apply target must back up `known_hosts`, replace only approved hosts from current scan files, and verify strict SSH after repair.
- While `.host-key-approvals.json` is absent, `make host-key-approval-check` must fail closed and no known_hosts repair or deploy mutation is allowed.
- The script does not modify `~/.ssh/known_hosts` or bypass strict SSH checks.
- `make deploy-readiness-gate-check` proves the deploy gate rejects old-format blocker JSON, missing required source evidence, stale required source evidence, missing source files, and explicit endpoint blockers.
- `make deploy-readiness-gate-check` proves semantic public endpoint failures such as legacy-chain, wrong-chain-id, validator-set-empty, validator-metadata-missing, dependent-height-failure, and gated-mutation-skipped are deploy-blocking.
- `remote-blocker-report` records freshness for the underlying remote-smoke, host-key-audit, and conditional host-key-approval-request evidence, compares approval-request JSON rows to current mismatch fingerprints, and `deploy-readiness-gate` refuses mutation if any required source is missing, stale, invalid, or inconsistent.
- Remote smoke evidence includes public Request Validity rule checks and transparency checks before any mutable remote action.
- Mutable remote proof actions, once public endpoints are confirmed as the new chain, include Anti-Illegal Request rejection, governance request lookup/review/reject, Trust appeal lookup/resolution, anti-unreasonable tracking, and final transparency report counts.
- `public-proof` remains invalid unless `remote-smoke-test` passes against public endpoints and `public-proof-validation.json` confirms all required remote proof checks are present and passed.
- `PROJECT_STATE.md` records current remote blocker evidence and does not claim public proof while endpoints are old-chain, timed out, or unverified.
- Current refreshed evidence is `tmp/verify-testnet/remote-evidence.json` generated at `2026-07-09T14:08:00.836Z`, `tmp/verify-testnet/remote-blockers.json` generated at `2026-07-09T14:20:01.780Z`, `tmp/host-key-audit/host-key-audit.txt` modified at `2026-07-09T14:07:45.954Z`, `tmp/host-key-audit/HOST_KEY_APPROVAL_REQUEST.md` modified at `2026-07-09T14:13:01.277Z`, and `tmp/host-key-audit/host-key-approval-request.json` modified at `2026-07-09T14:13:01.278Z`.
- `FEATURE_COMPLETION_TRACKER.md` keeps remote-deployed/public-proof columns as `no` until live public evidence proves otherwise.

Explicitly not doing:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not deploy while `deploy-readiness-gate` is blocked.
- Do not bypass SSH host-key protections.
- Do not commit `.host-key-approvals.json`; it is intentionally ignored.
- Do not run the generated known_hosts repair commands unless the fingerprints are independently verified.
- Do not treat localhost smoke output as public proof.
- Do not claim mainnet, exchange listing, wallet default support, stablecoin issuer support, or third-party partnership.
- Do not claim the goal is complete.
