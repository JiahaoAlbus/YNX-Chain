# Evidence index

- Core and security tests: `internal/governance/*_test.go`
- Runtime commands: `cmd/ynx-governanced`, `cmd/ynx-governance-state`
- Central integration contract: `release/integration/governance-app-gateway.manifest.json`
- Threat model: `docs/governance/THREAT_MODEL.md`
- Operations and restore procedure: `docs/governance/OPERATIONS.md`
- Observability contract: `docs/governance/OBSERVABILITY.md`
- Migration contract: `docs/governance/MIGRATION_COMPATIBILITY.md`
- Capacity plan: `docs/governance/SLO_CAPACITY_PLAN.md`
- Economics disclosure: `docs/governance/UNIT_ECONOMICS.md`
- UI design, 12-locale, accessibility, RTL, keyboard, and 390px browser evidence: `docs/governance/UI_DESIGN_AUDIT.md`
- Empty-state local public-read capacity probe: `docs/governance/evidence/local-capacity-494633950eb7.json`
- Reproducible local artifact hashes, SBOM summary, and truthful release status: `docs/governance/evidence/local-artifact-provenance-c085e078577f.json`
- Release packager: `scripts/package/governance-release.mjs`
- Third-party license notice: `docs/governance/THIRD_PARTY_NOTICES.md`
- Exact successful Governance Actions runs: `30416918267` on `4e6c67488e81f5ec82995de81dd25a33861d7dc3` and `30417486460` on `cd328bd5817f32efba259e0ad8948f202ebaf654`
- Public-route rejection evidence: `release/evidence/governance-public-route-probe-2026-07-29.json`

Exact product CI evidence is present. Shared central-Testnet acceptance receipts, Governance-specific public deployment, production signatures, current-candidate hosted downloads, and remote backup drills are not yet present and must not be inferred. The current HTTP 200 at `/governance` serves the generic root shell and is explicitly rejected as product deployment evidence.
