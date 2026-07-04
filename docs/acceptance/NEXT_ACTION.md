# Next Action

Current single action: harden Pay merchant idempotency, event lookup, and webhook audit semantics.

Why this action:

- Trust evidence now exposes reviewer-facing advisory risk summaries with confidence, expiry, appeal path, and non-conclusive label handling.
- Pay API currently supports intents, invoices, refunds, and webhook signatures, but merchant-grade idempotency and event/audit lookup are still thin.
- Payment workflows are a core YNX product surface and can be advanced locally while remote SSH/public ingress blockers prevent safe deployment.

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

- Pay intents, invoices, refunds, and webhook signatures accept and preserve merchant idempotency keys where appropriate.
- Duplicate idempotency keys return the original object rather than creating conflicting merchant records.
- Webhook signatures and payment events can be looked up for audit/replay evidence without exposing signing secrets.
- New checks pass locally.
- Tracker moves Pay API forward honestly without claiming remote proof.

Explicitly not doing in this action:

- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
