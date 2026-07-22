# Bridge Evidence Index

- Runtime source: `internal/bridgegateway`, `cmd/ynx-bridged`
- Process-level verifier: `scripts/verify/bridge-api-check.sh`
- Unit and race vectors: `internal/bridgegateway/gateway_test.go`
- Deployment dry run: `scripts/deploy/dry-run.sh`
- Readiness boundary: `docs/bridge/BRIDGE_INTEGRATION_READINESS.md`
- Feature status: `docs/bridge/FEATURE_COMPLETION_EVIDENCE.md`
- Migration: `docs/bridge/MIGRATION_COMPATIBILITY.md`
- Data lifecycle and cessation: `docs/bridge/DATA_LIFECYCLE.md`
- Observability: `docs/bridge/OBSERVABILITY.md`
- Status and support contract: `docs/bridge/STATUS_AND_SUPPORT.md`
- Operations: `docs/bridge/OPERATIONS.md`
- Capacity: `docs/bridge/SLO_CAPACITY_PLAN.md`
- Unit economics: `docs/bridge/UNIT_ECONOMICS.md`
- Interface audit: `docs/bridge/UI_DESIGN_AUDIT.md`
- Release notes: `docs/bridge/RELEASE_NOTES.md`
- Consumer manifest: `docs/bridge/consumer-integration-manifest.json`
- Consumer lifecycle vectors: `docs/bridge/consumer-lifecycle-vectors.json`
- Provider status: `docs/bridge/provider-status.json`
- Route adapter contract: `docs/bridge/ROUTE_ADAPTER.md`
- Route adapter gate: `scripts/verify/bridge-route-adapter-check.mjs`
- Asset catalog contract: `docs/bridge/ASSET_CATALOG.md`
- Consumer handoff: `docs/handoffs/bridge-consumers.md`
- Integration gate: `scripts/verify/bridge-integration-check.mjs`
- Read-only SDK: `sdk/bridge`
- SDK gate: `scripts/verify/bridge-sdk-check.sh`
- Data lifecycle gate: `scripts/verify/bridge-data-lifecycle-check.sh`
- Threat model: `docs/bridge/THREAT_MODEL.md`
- Security boundaries: `docs/bridge/SECURITY_BOUNDARIES.md`
- Relayer key lifecycle: `docs/bridge/RELAYER_KEY_LIFECYCLE.md`
- Third-party notices: `docs/bridge/THIRD_PARTY_NOTICES.md`
- Supply-chain gate: `scripts/verify/bridge-supply-chain-check.sh`
- Public product metadata: `docs/bridge/public-product-metadata.json`
- Machine release state: `docs/bridge/product-release.json`
- Capacity evidence: `docs/bridge/capacity-evidence.json`
- Restore evidence: `docs/bridge/restore-evidence.json`
- Evidence gate: `scripts/verify/bridge-evidence-check.mjs`

Generated test output is ephemeral and is not public or remote evidence. A release evidence record must bind future logs, artifacts, transaction receipts, API responses, and deployment URLs to the exact source commit that produced them.
