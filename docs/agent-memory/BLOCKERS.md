# YNX Monitor Blockers

Updated at: `2026-07-29T02:48:31Z`

## MON-BLOCK-001 — Repository phase-transition preflight

- Owner: central owners of consensus, faucet, trust, and EVM fixture paths.
- Evidence: `go test ./...` failures recorded in `product-release.json`.
- Impact: phase remains `PROTECT`; Monitor cannot claim full repository readiness.
- Prepared work: Monitor-local tests, build, E2E, security gate, and evidence are green.
- Resume condition: accepted owner fixes make the exact repository preflight pass.

## MON-BLOCK-002 — Central contract and shared Testnet freeze

- Owner: `29-integration` and each authoritative dependency owner.
- Evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md` and `docs/integration/INTEGRATION_HANDOFF.md`.
- Impact: `integratedCentral` and `testnetVerified` remain false.
- Prepared work: candidate contract, vectors, public-status boundary, and handoff exist.
- Resume condition: frozen unique versions, endpoints, credentials, and executed negative vectors are supplied.

## MON-BLOCK-003 — Public status and Website deployment

- Owner: approved public-status publisher, `28-website`, and deployment owner.
- Evidence: no hosted endpoint, Website consumption, public probe, or `ynxweb4.com/monitor` deployment evidence.
- Impact: `deployedPublic` remains false.
- Prepared work: signed, source-pinned, stale/replay-aware local `/status` projection and public metadata exist.
- Resume condition: approved publisher feed, durable anti-rollback sequence, hosted service, Website consumption, and direct public probes.

## MON-BLOCK-004 — Security/SRE release acceptance

- Owner: `30-security-sre-release`.
- Evidence: `release/monitor/security/dependency-review.json`, `provenance.json`, and the shared `scripts/validate/secret-scan.sh` behavior.
- Impact: hosted artifact, signed provenance, installation, and production release remain false.
- Prepared work: threat model, local SBOM, notices, license/integrity review, built-in credential/SAST gate, reproducible build, artifact scan, and DAST plan.
- Minimal external input: accept or replace the disclosed npm mirror sources; repair the shared false-pass path when `rg` is absent; provide signed artifact/provenance policy and hosted DAST/recovery environment.
- Resume condition: central acceptance evidence is bound to an exact source commit and artifact digest.
