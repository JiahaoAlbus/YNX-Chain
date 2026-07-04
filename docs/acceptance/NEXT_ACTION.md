# Next Action

Current single action: add AI Gateway permission and audit model for sensitive actions.

Why this action:

- Pay API now has merchant idempotency, webhook signature lookup, and payment event audit records.
- AI Gateway currently streams session-scoped status, but it does not yet persist permissions, action proposals, or audit records for sensitive actions.
- AI-native workflow safety is a core YNX product surface and can be advanced locally while remote SSH/public ingress blockers prevent safe deployment.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/testnet-smoke-test.sh`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `make test`
- `make smoke-test`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make objective-state-check`
- `make preflight`

Completion standard:

- AI sessions can request explicit scoped permissions before sensitive actions.
- Sensitive AI action proposals are persisted with session, requester, scope, expiry, status, and audit hash.
- AI actions that move value, affect Trust labels, or expose sensitive data cannot be marked executable without explicit approval.
- New checks pass locally.
- Tracker moves AI Gateway forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
