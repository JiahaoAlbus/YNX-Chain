# Next Action

Current single action: implement an independent deployable Resource Market API (`ynx-resourced`) while preserving `ynx-chaind` as the authoritative persistent resource policy, delegation, rental, and income engine.

Why this action:

- Resource policy, quote, delegation, rental settlement, provider/protocol split, income, and analytics exist and pass local checks, but public routes still belong to the general chain API process.
- Faucet, Indexer, Explorer, AI, Pay, and Trust now have independent daemon boundaries. Resource Market is the largest remaining service-boundary gap that can advance without unsafe remote mutation.
- Remote deployment remains blocked by trusted host-key approval and old public endpoints.

Files to touch:

- `internal/resourcegateway/`
- `cmd/ynx-resourced/`
- `internal/api/`
- `scripts/verify/resource-api-check.sh`
- deployment, ops, monitoring, env, API/runbook, public-proof, and acceptance files

Validation commands:

- `go test ./...`
- `make resource-api-check`
- `make resource-market-check`
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

- `ynx-resourced` is a real independent process with public health/metrics and build identity.
- Public Resource Market routes enforce authentication, request IDs, rate limits, bounded bodies, and redacted audit.
- Direct deployed chain Resource Market bypass is rejected; only authenticated `ynx-resourced` upstream calls reach canonical handlers.
- Existing policy, quote, delegation, rental, income, and analytics persistence remains authoritative and passes through the daemon.
- Deployment, ingress, monitoring, operations, remote smoke, and public-proof gates are wired.
- Remote deployed/public proof remain `no` until real endpoints pass.

Explicitly not doing:

- Do not expand bounded EVM opcodes, Counter samples, Hardhat artifacts, or IDE execution.
- Do not mutate remote hosts or repair `known_hosts` without trusted audit-bound host-key approval and a passed deploy gate.
- Do not claim mainnet, listing, issuer support, wallet default support, partnerships, remote deployment, or public proof.
