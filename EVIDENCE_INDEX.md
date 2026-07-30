# Evidence Index

- Policy: `security-platform/platform-policy.json`
- Release truth: `release/security-platform/platform-status.json`
- Artifact registry: `release/security-platform/artifact-registry.json`
- Secret inventory metadata and schema: `security-platform/secret-inventory.json`; `security-platform/secret-inventory.schema.json`
- Service identity policy: `security-platform/service-identity-policy.json`
- Service identity and mTLS enforcement: `scripts/security-service-identity.mjs`; `scripts/security-service-identity.test.mjs`
- Policy engine: `scripts/security-platform.mjs`
- Policy regression tests: `scripts/security-platform.test.mjs`
- CI enforcement: `.github/workflows/security.yml`; `.github/workflows/security-platform-deploy.yml`
- Exact-source remote CI: `evidence/security-platform/GITHUB_CI_aa5d5e9.json`
- Branch protection: `evidence/security-platform/GITHUB_BRANCH_PROTECTION_2026-07-27.json`
- Security boundaries: `THREAT_MODEL.md`
- Operations and drills: `OPERATIONS.md`
- Monitoring contract: `OBSERVABILITY.md`
- Migration contract: `MIGRATION_COMPATIBILITY.md`
- Capacity and SLO contract: `SLO_CAPACITY_PLAN.md`
- Cost model: `UNIT_ECONOMICS.md`
- Founder KPI contract: `FOUNDER_KPI_FRAMEWORK.md` and `security-platform/kpis.json`
- Local capacity baseline: `evidence/security-platform/LOCAL_CAPACITY_2026-07-22.json`
- Provider governance: `PROVIDER_INVENTORY.md` and `security-platform/providers.json`
- Third-party dependency notices: `docs/security-platform/THIRD_PARTY_NOTICES.md`
- Current feature truth: `FEATURE_COMPLETION_EVIDENCE.md`
- Public testnet audit: `evidence/security-platform/PUBLIC_GATE_2026-07-22.md`
- Local verification: `evidence/security-platform/LOCAL_VERIFICATION_2026-07-22.md`
- Artifact and restore drill: `evidence/security-platform/ARTIFACT_AND_RESTORE_DRILL_2026-07-22.md`
- Encrypted local restore drill: `evidence/security-platform/LOCAL_RESTORE_DRILL_58fe679.json`
- Local Service Identity and mTLS drill: `evidence/security-platform/LOCAL_MTLS_DRILL_0cb9b58.json`
- Local reproducible artifact, SBOM, provenance, test-signature, and tamper drills: `evidence/security-platform/LOCAL_ARTIFACT_DRILL_53b037e.json`; `evidence/security-platform/LOCAL_ARTIFACT_DRILL_fa5f3ed.json`; `evidence/security-platform/LOCAL_ARTIFACT_DRILL_1853dd4.json`; `evidence/security-platform/LOCAL_ARTIFACT_DRILL_aa5d5e9.json`
- Authoritative-repository reproducible artifact, SBOM, provenance, test-signature, and tamper drill: `evidence/security-platform/LOCAL_ARTIFACT_DRILL_900c314.json`
- Active local test-signed artifact set: `release/artifacts/900c314ddb8f6f56b8713e7df194f26ee0590e06/`
- Clean locked install, build, production dependency audit, and CLI cold start: `evidence/security-platform/LOCAL_CLEAN_INSTALL_aa5d5e9.json`
- Deployment-candidate review: `evidence/security-platform/PLATFORM_INFRASTRUCTURE_2026-07-23.md`
- Dependency remediation: `evidence/security-platform/DEPENDENCY_REMEDIATION_2026-07-22.md`
- Integration contract and vectors: `release/integration/security-platform-contract.json`; `docs/integration/SECURITY_PLATFORM_CROSS_PRODUCT_TEST_VECTORS.json`
- Minimal external input boundary: `release/security-platform/operator-inputs.request.json`

Generated evidence must include a full source commit, UTC timestamps, environment, result, and explicit limitations. Commit-named files or source-commit directories are both accepted. Public evidence must not expose local paths, internal hosts, authentication material, or private operational details.
