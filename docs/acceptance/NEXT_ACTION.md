# Next Action

Current single action: tighten Trust evidence weighting, reviewer exports, and risk scoring semantics.

Why this action:

- Structured Chain Law / Request Validity rules now exist locally and are inspectable through `GET /governance/request-validity-rules`.
- Governance and tracking review responses now include `ruleIds`.
- Trust labels now carry source, confidence, evidence hash, expiry, appealability, legal status, dispute status, and advisory-only asset effect metadata.
- The next correctness gap is making evidence packets and Trust traces explain how label metadata and lot lineage combine into reviewer-facing risk scoring without treating low-confidence taint as fact.
- This can continue locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/trust-appeal-check.sh`
- `scripts/verify/testnet-smoke-test.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make trust-appeal-check`
- `make request-validity-check`
- `make transparency-report-check`
- `make anti-unreasonable-tracking-check`
- `make smoke-test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Evidence packets expose reviewer-facing label metadata and risk scoring notes.
- Trust trace / evidence output explains confidence, source, expiry, appeal path, and why advisory labels do not freeze or seize assets.
- Low-confidence or expired labels cannot be presented as conclusive risk.
- New checks pass locally.
- Tracker moves Trust evidence/risk semantics forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
