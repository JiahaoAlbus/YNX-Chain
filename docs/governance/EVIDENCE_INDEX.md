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
- Frozen-candidate reproducible artifact hashes, SBOM summary, source archive, and truthful release status: `docs/governance/evidence/local-artifact-provenance-5640209e.json`
- Historical local artifact evidence: `docs/governance/evidence/local-artifact-provenance-c085e078577f.json`
- Release packager: `scripts/package/governance-release.mjs`
- Third-party license notice: `docs/governance/THIRD_PARTY_NOTICES.md`
- Exact successful Governance Actions runs: six workflows and seven checks on evidence head `fa034972c39451ba74e4a46006384a9e0a82ff59`, including Governance push and PR runs `30522548957` and `30522550810`
- Frozen source candidate: `5640209e9c7df9789916bd99f61124db566842b4`
- Frozen-candidate local gates: Governance control plane, real-Chrome UI, zero-vulnerability npm audit, race tests, full repository tests, contract tooling, immutable Actions pins, and the four-validator nine-process Canary, execution, receipt, and restart lifecycle
- Public-route rejection evidence: `release/evidence/governance-public-route-probe-2026-07-29.json`

Exact product CI and a source-only prerelease are present for the frozen candidate. Shared central-Testnet acceptance receipts, Governance-specific public deployment, production signatures, runnable artifact hosting, and remote backup drills are not yet present and must not be inferred. The current HTTP 200 at `/governance` serves the generic root shell and is explicitly rejected as product deployment evidence.
