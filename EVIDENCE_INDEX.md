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
- Migration/backup: `MIGRATION_COMPATIBILITY.md`, `OPERATIONS.md`
- Observability: `OBSERVABILITY.md`
- Performance/capacity: `SLO_CAPACITY_PLAN.md`
- Economics: `UNIT_ECONOMICS.md`
- Web/PWA: `apps/oracle/`, `UI_DESIGN_AUDIT.md`
- Release truth: `release/product-state.json`,
  `release/operator-inputs.request.json`

Test commands are enumerated in `FEATURE_COMPLETION_EVIDENCE.md` and the
requirement matrix. Public-access URLs, CI run IDs, container digests,
screenshots, remote restore drill results, and Explorer/Monitor evidence remain absent and are not
represented as complete.

The owner-only Web deployment is recorded in `release/product-release.json`.
Its unauthenticated HTTP 401 proves access control, not public availability.
