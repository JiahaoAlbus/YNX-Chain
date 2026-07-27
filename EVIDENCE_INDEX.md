# Evidence Index

- Recovery and ownership: `docs/oracle/internal/RECOVERY_INVENTORY.md`
- Requirement mapping: `docs/oracle/REQUIREMENT_EVIDENCE_MATRIX.md`
- Feature evidence: `FEATURE_COMPLETION_EVIDENCE.md`
- Security: `docs/oracle/THREAT_MODEL.md`, `docs/oracle/SECURITY_BOUNDARIES.md`,
  `SECURITY_RELEASE_GATE.md`, `release/*.cdx.json`
- Provider rights/status: `docs/oracle/PROVIDER_REGISTRY.md`,
  `config/oracle/provider-candidates.json`
- Consumer schemas: `integration/oracle/v1/`,
  `docs/integration/oracle-consumers.json`
- Consumer implementations: `sdk/oracle/go/`, `sdk/oracle/typescript/`,
  `cmd/ynx-oracle-cli/`
- Cross-product acceptance: `integration/oracle/v1/consumer-handoff.json`,
  `integration/oracle/v1/consumer-test-vectors.json`
- Migration/backup: `MIGRATION_COMPATIBILITY.md`, `OPERATIONS.md`
- Observability: `OBSERVABILITY.md`
- Performance/capacity: `SLO_CAPACITY_PLAN.md`
- Economics: `UNIT_ECONOMICS.md`
- Web/PWA: `apps/oracle/`, `UI_DESIGN_AUDIT.md`
- Release truth: `release/product-state.json`, `release/product-release.json`,
  `release/operator-inputs.request.json`
- Deterministic artifact evidence: `release/evidence/oracle-artifact-manifest-6ba6c39a6661.json`,
  `release/evidence/oracle-artifact-provenance-6ba6c39a6661.json`,
  `release/evidence/oracle-artifact-sbom-6ba6c39a6661.cdx.json`, and
  `release/evidence/oracle-artifact-verification-6ba6c39a6661.json`

Test commands are enumerated in `FEATURE_COMPLETION_EVIDENCE.md`, the
requirement matrix, and `.ai-bridge/full-goal-coverage.json`. The limited-source
public API URL and remote smoke evidence are recorded in
`release/evidence/oracle-public-testnet-f71d5ca.json`. Current-commit local
artifact manifest, provenance, CycloneDX SBOM, hashes, macOS install/cold-start
and isolated SDK consumer evidence are recorded at source commit
`6ba6c39a6661724e07205a265201ac7fa36c91bb`. Artifact hosting, production
signatures, Linux arm64 native cold start, browser accessibility evidence,
central acceptance receipts, live restore/failover measurements, and
Explorer/Monitor proof remain absent and are not represented as complete.

The owner-only Web deployment is recorded in `release/product-release.json`.
Its unauthenticated HTTP 401 proves access control, not public availability.
