# Bridge Evidence Index

- Runtime source: `internal/bridgegateway`, `cmd/ynx-bridged`
- Process-level verifier: `scripts/verify/bridge-api-check.sh`
- Unit and race vectors: `internal/bridgegateway/gateway_test.go`
- Deployment dry run: `scripts/deploy/dry-run.sh`
- Readiness boundary: `docs/bridge/BRIDGE_INTEGRATION_READINESS.md`
- Feature status: `docs/bridge/FEATURE_COMPLETION_EVIDENCE.md`
- Migration: `docs/bridge/MIGRATION_COMPATIBILITY.md`
- Observability: `docs/bridge/OBSERVABILITY.md`
- Operations: `docs/bridge/OPERATIONS.md`
- Capacity: `docs/bridge/SLO_CAPACITY_PLAN.md`
- Unit economics: `docs/bridge/UNIT_ECONOMICS.md`
- Interface audit: `docs/bridge/UI_DESIGN_AUDIT.md`
- Release notes: `docs/bridge/RELEASE_NOTES.md`
- Consumer manifest: `docs/bridge/consumer-integration-manifest.json`
- Consumer lifecycle vectors: `docs/bridge/consumer-lifecycle-vectors.json`
- Provider status: `docs/bridge/provider-status.json`
- Consumer handoff: `docs/handoffs/bridge-consumers.md`
- Integration gate: `scripts/verify/bridge-integration-check.mjs`

Generated test output is ephemeral and is not public or remote evidence. A release evidence record must bind future logs, artifacts, transaction receipts, API responses, and deployment URLs to the exact source commit that produced them.
