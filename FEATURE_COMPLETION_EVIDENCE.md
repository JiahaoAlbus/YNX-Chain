# YNX Monitor Feature Completion Evidence

Goal state: `ACTIVE`
Phase: `PUBLIC`
Implementation source: `5d42be028b22f10253facfc4f779fcccf0fd69b1`
Last updated: 2026-08-03

This document records feature-level evidence only. It declares the redacted public status surface deployed, but does not declare the private operator plane centrally accepted, the product complete, production-signed, or store-released.

## Protected and locally tested

### Private operator authorization

- Roles: Viewer, transitional Operator, Incident Commander, Backup/Recovery, Security Reviewer.
- Sensitive actions use explicit permissions rather than a single broad role check.
- Password and centrally verified Wallet challenge flows create short Monitor sessions and return explicit capabilities.
- Wallet challenges are single-use and replay attempts fail closed.
- Every authenticated mutation requires an exact allowlisted Origin and the session-bound `X-YNX-CSRF-Token`.
- Evidence: `apps/monitor/server/auth.ts`, `apps/monitor/server/app.ts`, `apps/monitor/server/auth.test.ts`, `apps/monitor/server/rbac.test.ts`.

### Redacted public status

- `/status` reads only a separately configured public source; it never projects private OpsStore incidents, audit actors, backup/restore records, rollback proposals, topology, paths, stacks, or evidence references.
- The source uses `ynx.monitor.public-status-source.v1`, HMAC-SHA256 over canonical JSON, an exact approved publisher ID, an Incident Commander approval record, bounded freshness, and a 256 KiB regular-file limit with symbolic links rejected.
- Unsigned, tampered, wrong-publisher, stale, wrong-role, fake-healthy, private-text, invalid-file, provider-error, and older replayed snapshots fail closed with bounded 503 responses that do not echo source content.
- Repeated identical snapshots are readable; after a newer snapshot is accepted, older `asOf` or `publishedAt` snapshots are rejected within the running process.
- Evidence: `apps/monitor/server/public-status.ts`, `apps/monitor/server/public-status.test.ts`, `MON-PUBLIC-REDACTION-001`, `MON-PUBLIC-INTEGRITY-001`.
- The publisher at `apps/monitor/scripts/publish-public-status.mjs` performs seven bounded real-service probes, signs canonical JSON, writes atomically, and refuses to invent healthy state after probe failure.
- Public evidence: `https://monitor.ynxweb4.com/status`; browser fallback during local DNS propagation: `https://monitor-testnet.43.153.202.237.sslip.io/`.

### Incident lifecycle

- Versioned states: `open`, `acknowledged`, `investigating`, `mitigated`, `recovery_verifying`, `resolved`, `postmortem_complete`.
- Invalid state jumps fail without mutation.
- Repeated target-state requests are idempotent.
- Incident Commander cannot self-verify recovery.
- Recovery verification requires direct evidence from Backup/Recovery.
- Postmortem is blocked until recovery is verified.
- Timeline, audit, notes, assignment, restart persistence, tamper rejection, and authenticated evidence export are covered.
- Evidence: `apps/monitor/server/incident-lifecycle.test.ts`, `apps/monitor/server/store.test.ts`.

### Backup, restore, and rollback evidence

- Backup records include artifact reference, SHA-256, bytes, retention, storage, encryption, RPO/RTO, and direct evidence.
- Restore drills include timing, observed RPO/RTO, integrity/application checks, failure details, and evidence.
- Security Reviewer verification must be independent from the reporting actor.
- A restore cannot be accepted before its backup is independently verified.
- Rollback remains `approved-not-executed`, `verified-not-executed`, or `rejected-not-executed`; Monitor does not execute infrastructure changes.
- Evidence: `apps/monitor/server/recovery-lifecycle.test.ts`.

### Threat model and local supply-chain evidence

- `docs/security/MONITOR_THREAT_MODEL.md` defines assets, trust boundaries, threat scenarios, security invariants, validation evidence, and the exact local-only release boundary.
- `apps/monitor/scripts/supply-chain-gate.mjs` fails closed on missing lock integrity, non-HTTPS resolution, missing or unapproved licenses, prohibited production constructs, non-reproducible builds, and prohibited public artifact strings.
- The built-in credential scanner checked 690 tracked text files with 0 high-confidence findings; it does not depend on the shared repository `rg` script that can produce a false pass when `rg` is unavailable.
- SAST checked 12 production source files with 0 findings. The production dependency graph contains 163 locked packages using approved licenses and records both registry hosts without hiding mirror use.
- Two clean production builds produced identical file manifests; the generated CycloneDX SBOM, notices, dependency review, DAST plan, build manifest, local provenance, and summary are under `release/monitor/security/`.
- Local provenance is deliberately marked unsigned, non-hermetic, and not evidence of a GitHub-hosted artifact, deployment, installation, or production signing.

### UI, language, accessibility, and truthful status

- Private operator UI gates affordances by capability and includes desktop/mobile managed browser coverage.
- Twelve locale dictionaries resolve required keys; Arabic formatting executes without failure.
- Process health does not imply ecosystem health, and release identity remains absent unless injected by a real deployment.
- Evidence: `apps/monitor/src/*.test.ts`, `apps/monitor/tests/*.spec.ts`, `apps/monitor/server/app.ts`.

## Current validation set

- `cd apps/monitor && npm test`: 39 passed, 0 failed, including runtime/UI, signed-publisher, supply-chain fail-closed, and capacity cases.
- `cd apps/monitor && npm run build`: passed.
- `cd apps/monitor && npm run test:e2e`: 8 passed, 0 failed.
- `cd apps/monitor && npm run security:check`: passed with 0 audit vulnerabilities, 0 credential findings, 0 SAST findings, 163 reviewed production packages, two identical clean builds, and 0 artifact findings.
- `.github/workflows/monitor-ci.yml` run `30418246140` passed for `9df7d117c5d0c37f191a888acb81125ca3183b33` and uploaded CI evidence artifact `8710923775` with digest `sha256:2f2e1394d42ba5381f5cc95e7009d16f11032cacde3d6cc2f26f04a8d76e930c`; this is not a release artifact.
- `cd apps/monitor && npm run smoke`: failed because all eight configured central service endpoints were unavailable; no Testnet or dependency-health claim is made.
- Public runtime source: `5d42be028b22f10253facfc4f779fcccf0fd69b1`.
- Remote 25-worker validation returned 100/100 HTTP 200 for `/health`, `/status`, and `/`; p95 latency was 130.5 ms, 32.4 ms, and 16.0 ms respectively.

## Incomplete or externally dependent

The following requirements are not completed by the evidence above:

- central contract freeze and accepted Wallet/Auth expiry, revoke, device, product, and scope vectors;
- typed authoritative telemetry for consensus, trading, liquidity, Quant, capital, and every YNX product;
- alert correlation, escalation, notification delivery, and controlled automation;
- Website catalog consumption of the deployed Monitor product;
- explicit schema migration and rollback-migration drills;
- real backup, isolated restore, region failure, provider failure, or rollback execution evidence;
- full shared Testnet integration beyond the seven public dependency probes;
- sustained-duration SLO load histograms and unit economics beyond the bounded capacity evidence;
- hosted DAST execution, signed/hosted provenance, immutable artifact publication, installation, and cold start;
- centrally accepted hosted private operator roles, downloads, support/privacy/security URLs, and SEO consumption;
- GitHub Release, hosted release artifact, production signing, or store release;
- central acceptance of the disclosed npm registry mirror and remediation of the shared secret-scan false-pass behavior when ripgrep is absent.

## Non-green full preflight

The repository-wide `go test ./...` preflight remains non-green due to failures in cross-product consensus, faucet, trust, and missing compiled EVM fixture ownership. These failures are recorded in `product-release.json` and `.ai-bridge/execution-log.jsonl`. They are not treated as Monitor-local failures and do not negate the bounded public status deployment, but they still block a claim that the entire YNX product graph is complete or centrally accepted.

The authoritative per-requirement status remains `.ai-bridge/full-goal-coverage.json`; this feature document cannot override it.
