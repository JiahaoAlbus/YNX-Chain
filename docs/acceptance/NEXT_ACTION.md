# Next Action

Current single action: implement and verify Anti-Illegal Request Engine + Request Validity Standard + Appeal / Transparency API as real local code.

Why this action:

- The updated objective names this as the current immediate implementation direction.
- It is a core YNX Chain product feature, not a diagnostic or readiness artifact.
- It does not require remote SSH recovery and can be advanced locally with persistent storage, API handlers, tests, smoke checks, and Makefile targets.
- It turns Chain Law from documentation into executable request intake, validity classification, illegal-request rejection, appeal availability, and transparency records.
- EVM/IDE bounded execution is safely recorded as local verified / not remote deployed and is paused for this higher-priority governance/trust gap.

Files to touch:

- `internal/chain/types.go`
- `internal/chain/devnet.go`
- `internal/api/server.go`
- `internal/chain/devnet_test.go`
- `internal/api/server_test.go`
- `scripts/verify/*anti*request*`
- `scripts/verify/*request-validity*`
- `scripts/verify/*transparency*`
- `scripts/verify/*trust-appeal*`
- `Makefile`
- `docs/api/API_REFERENCE.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

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

Completion standard:

- `POST /governance/requests`, `GET /governance/requests/:id`, `POST /governance/requests/:id/review`, `POST /governance/requests/:id/reject`, `GET /governance/transparency`, `POST /trust/appeals`, and `GET /trust/appeals/:id` are implemented as real handlers over persisted state.
- Requests are classified as `VALID_UNDER_YNX_CHAIN_LAW`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_SCOPE`, `OVERBROAD`, `ILLEGAL_OR_ABUSIVE`, `REQUIRES_GOVERNANCE_REVIEW`, `REQUIRES_USER_NOTICE`, or `REJECTED`.
- Illegal requests, overbroad requests, evidence-free requests, native YNXT direct freeze/transfer/seize requests, signature-bypass requests, fake-risk-label requests, hidden-log requests, and AI auto-punishment requests are rejected or routed to review with rule IDs and transparency entries.
- Appeals are persisted and retrievable, and transparency report entries/counts reflect request intake, rejection/review, and appeal activity.
- Unit tests and smoke/check commands prove the behavior without claiming remote public proof.
- API docs and tracker are updated only after code and checks exist.

Explicitly not doing in this action:

- Do not expand bounded EVM opcode coverage or IDE execution further unless required to keep existing tests passing.
- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
