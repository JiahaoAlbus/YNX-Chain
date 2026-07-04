# Next Action

Current single action: implement appeal resolution / false-positive correction records and a dedicated anti-unreasonable tracking policy model.

Why this action:

- Anti-Illegal Request, Request Validity, Appeal intake, and Transparency report now exist as local persistent APIs.
- Appeal / Dispute is still intake-only, so false-positive correction is not yet a complete workflow.
- Anti-unreasonable tracking is currently covered only through overbroad request classification; it needs explicit policy records and checks.
- This does not depend on remote SSH recovery and moves a core product module forward while deployment remains blocked.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/anti-unreasonable-tracking-check.sh`
- `scripts/verify/trust-appeal-check.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make anti-illegal-request-check`
- `make request-validity-check`
- `make transparency-report-check`
- `make trust-appeal-check`
- `make anti-unreasonable-tracking-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- Appeals can be resolved with an auditable decision and false-positive correction status.
- Unsupported Trust conclusions and unreasonable tracking requests are rejected or routed to governance review with transparency entries.
- New checks pass locally.
- Tracker moves Appeal / Dispute, False Positive correction, and Anti-Unreasonable Tracking forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
