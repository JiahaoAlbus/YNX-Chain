# Next Action

Current single action: implement an independent deployable Trust API (`ynx-trustd`) while preserving `ynx-chaind` as the authoritative persistent Trust, lineage, appeal, and tracking-review state engine.

Why this action:

- Chain Law, Trust labels/evidence, lot lineage, pro-rata tracking, appeals, and anti-unreasonable tracking exist and pass local checks, but public Trust routes still belong to the general chain API process.
- Faucet, Indexer, Explorer, AI Gateway, and Pay Gateway now have independent daemon boundaries. Trust is the largest remaining service-boundary gap that can advance without unsafe remote mutation.
- Remote deployment remains externally blocked by trusted host-key approval and old public endpoints.

Files to touch:

- `internal/trustgateway/`
- `cmd/ynx-trustd/`
- `internal/api/`
- `scripts/verify/trust-api-check.sh`
- deployment, ops, monitoring, env, API/runbook, public-proof, and acceptance files

Validation commands:

- `go test ./...`
- `make trust-api-check`
- `make request-validity-check`
- `make trust-appeal-check`
- `make anti-unreasonable-tracking-check`
- `make smoke-test`
- `make deploy-dry-run`
- `make monitoring-check`
- `make ops-check`
- `make public-proof-evidence-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `make preflight`
- `make objective-state-check`

Completion standard:

- `ynx-trustd` is a real independent process with public health/metrics and build identity.
- Public Trust endpoints enforce authentication, request IDs, rate limits, bounded bodies/exports, and redacted audit records.
- Direct deployed chain Trust bypass is rejected; only authenticated `ynx-trustd` upstream calls reach canonical Trust handlers.
- Existing Trust label, trace, evidence, appeal, false-positive correction, and tracking-review persistence remains authoritative and passes through the daemon.
- Deployment, ingress, monitoring, operations, remote smoke, and public-proof gates are wired.
- Remote deployed/public proof remain `no` until real endpoints pass.

Explicitly not doing:

- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution.
- Do not mutate remote hosts or repair `known_hosts` without trusted audit-bound host-key approval and a passed deploy gate.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, remote deployment, or public proof.
