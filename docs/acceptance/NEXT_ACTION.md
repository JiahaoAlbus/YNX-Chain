# Next Action

Current single action: implement an independent deployable Pay merchant backend (`ynx-payd`) while preserving `ynx-chaind` as the authoritative persistent payment-state engine.

Why this action:

- Anti-Illegal Request, Request Validity, Appeal, Transparency, native YNXT protection, Resource Market, validator peer readiness, Faucet, Indexer, Explorer, and the new standalone AI Gateway have local code and dedicated checks.
- Pay intents, invoices, refunds, webhook signatures, idempotency, and audit hashes exist, but public Pay routes still belong to the general chain API process. The objective requires a real Pay API, not only in-process handlers.
- Remote deployment is externally blocked by trusted Singapore/Silicon Valley host-key confirmation and old public endpoints. This does not justify stopping core implementation.
- The Pay daemon should own merchant API authentication, request IDs, rate limits, public health/metrics, webhook ingress/signing policy, redacted access audit, and dedicated deployment/ingress. Chain runtime should continue owning canonical payment records and idempotency state.

Files to touch:

- `internal/paygateway/`
- `cmd/ynx-payd/`
- `internal/api/`
- `scripts/verify/pay-api-check.sh`
- `scripts/deploy/`
- `scripts/ops/`
- `infra/systemd/`
- `infra/docker/`
- `infra/monitoring/`
- `.env.deploy.example`
- `ENV_INTAKE_FORM.md`
- `docs/api/API_REFERENCE.md`
- `docs/operations/OPERATIONS_RUNBOOK.md`
- `docs/acceptance/FEATURE_COMPLETION_TRACKER.md`
- `docs/acceptance/PROJECT_STATE.md`
- `docs/acceptance/NEXT_ACTION.md`

Validation commands:

- `go test ./...`
- `make test`
- `make ai-gateway-check`
- `make smoke-test`
- `make deploy-dry-run`
- `make caddy-ingress-check`
- `make monitoring-check`
- `make ops-check`
- `make public-proof-evidence-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- `ynx-payd` is a real independent process with public health/metrics and injected build identity.
- Merchant API credentials come only from a dedicated secret env file and never appear in responses, logs, manifests, or the shared chain env.
- Public Pay endpoints enforce authentication, rate limits, request IDs, bounded bodies, and redacted audit records.
- Direct deployed chain `/pay/*` bypass is rejected; only authenticated `ynx-payd` upstream calls can reach canonical chain payment handlers.
- Existing intent/invoice/refund/webhook/idempotency/audit-hash behavior remains persistent and passes through the daemon.
- Docker, systemd, monitoring, release manifest, backup/rollback, dedicated ingress, post-restart local checks, remote smoke, and public-proof required checks are wired.
- Local verification is reported as local only. Remote deployed/public proof remain `no` until real endpoints pass.

Explicitly not doing:

- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution.
- Do not mutate remote hosts or repair `known_hosts` without trusted audit-bound host-key approval and a passed deploy gate.
- Do not use `ssh-keyscan` output as trusted approval.
- Do not claim mainnet launch, exchange listing, stablecoin issuer support, wallet default support, partnerships, remote deployment, or public proof.
- Do not replace canonical chain payment persistence with an in-memory gateway copy.
