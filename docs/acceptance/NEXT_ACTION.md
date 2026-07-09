# Next Action

Current single action: finish validation, commit, and push the Anti-Illegal Request Engine + Request Validity Standard + Appeal / Transparency API local implementation; then move the next real gap to remote deployment/public proof once deploy-readiness blockers are cleared.

Why this action:

- The updated objective names Anti-Illegal Request / Request Validity / Appeal / Transparency as the current immediate implementation direction.
- The local implementation now exists as real persisted chain state, API handlers, tests, smoke checks, and Makefile targets.
- The remaining work for this slice is full required validation, commit, and push; remote deployment/public proof remains blocked by previously recorded SSH/public ingress blockers.
- It turns Chain Law from documentation into executable request intake, validity classification, illegal-request rejection, manual rejection, appeal availability, user notice, and transparency records.
- EVM/IDE bounded execution is safely recorded as local verified / not remote deployed and is paused for this higher-priority governance/trust gap.

Files to touch:

These are the relevant closure files; in this update some handler/type files were verified without needing code edits.

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
- Illegal requests, overbroad requests, evidence-free requests, out-of-scope asset-boundary requests, native YNXT direct freeze/transfer/seize requests, signature-bypass requests, fake-risk-label requests, hidden-log requests, unsupported Trust conclusions, and AI auto-punishment requests are rejected or routed to review/notice with rule IDs and transparency entries.
- Appeals are persisted and retrievable, and transparency report entries/counts reflect request intake, rejection/review, manual rejection, appeal open, and appeal resolution activity.
- Unit tests and smoke/check commands prove the behavior without claiming remote public proof.
- API docs and tracker are updated only after code and checks exist.

Next real gap after this local closure:

- Remote deployment/public proof for these governance and Trust endpoints is still not complete.
- Do not claim public proof until the deploy-readiness gate clears, services are deployed, and real public endpoints are smoke-tested.

Explicitly not doing in this action:

- Do not expand bounded EVM opcode coverage or IDE execution further unless required to keep existing tests passing.
- Do not edit the old `/Users/huangjiahao/Desktop/YNX` project.
- Do not disable deploy-readiness-gate or SSH host-key protections.
- Do not claim public proof for localhost results.
- Do not deploy until real `.env.deploy`, verified SSH, backup, rollback, and deploy-readiness-gate are ready.
- Do not claim the goal is complete.
