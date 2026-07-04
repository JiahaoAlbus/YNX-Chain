# Next Action

Current single action: implement a structured Chain Law / Request Validity rule registry and stronger Trust label metadata.

Why this action:

- Anti-Illegal Request, Request Validity, Appeal resolution, false-positive correction, Anti-Unreasonable Tracking, and Transparency now exist as local persistent APIs.
- The next correctness gap is that classifications are still mostly hardcoded rule branches, and Trust labels have limited source/confidence/expiry metadata.
- This can continue locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/request-validity-check.sh`
- `scripts/verify/anti-illegal-request-check.sh`
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

- Request classifications are backed by named rules that can be inspected through code/API/test evidence.
- Trust labels include source, confidence, evidence, expiry, and appealability metadata without automatic asset seizure.
- New checks pass locally.
- Tracker moves Request Validity and Trust metadata forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
