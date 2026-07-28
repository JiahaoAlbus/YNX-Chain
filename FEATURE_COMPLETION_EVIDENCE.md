# YNX Monitor Feature Completion Evidence

Goal state: `ACTIVE`  
Phase: `PROTECT`  
Implementation source: `95817f417bb9d08a8450c09fca884bb89d240eba`  
Last updated: 2026-07-28

This document records feature-level evidence only. It does not declare the product complete, centrally integrated, deployed, signed, or public.

## Protected and locally tested

### Private operator authorization

- Roles: Viewer, transitional Operator, Incident Commander, Backup/Recovery, Security Reviewer.
- Sensitive actions use explicit permissions rather than a single broad role check.
- Password and centrally verified Wallet challenge flows create short Monitor sessions and return explicit capabilities.
- Wallet challenges are single-use and replay attempts fail closed.
- Every authenticated mutation requires an exact allowlisted Origin and the session-bound `X-YNX-CSRF-Token`.
- Evidence: `apps/monitor/server/auth.ts`, `apps/monitor/server/app.ts`, `apps/monitor/server/auth.test.ts`, `apps/monitor/server/rbac.test.ts`.

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

### UI, language, accessibility, and truthful status

- Private operator UI gates affordances by capability and includes desktop/mobile managed browser coverage.
- Twelve locale dictionaries resolve required keys; Arabic formatting executes without failure.
- Process health does not imply ecosystem health, and release identity remains absent unless injected by a real deployment.
- Evidence: `apps/monitor/src/*.test.ts`, `apps/monitor/tests/*.spec.ts`, `apps/monitor/server/app.ts`.

## Current validation set

- `cd apps/monitor && npm test`: 18 passed, 0 failed.
- `cd apps/monitor && npm run build`: passed.
- `cd apps/monitor && npm run test:e2e`: 8 passed, 0 failed.
- `cd apps/monitor && npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- Source checkpoint pushed; local and upstream SHA equal at `95817f417bb9d08a8450c09fca884bb89d240eba`.

## Incomplete or externally dependent

The following requirements are not completed by the evidence above:

- central contract freeze and accepted Wallet/Auth expiry, revoke, device, product, and scope vectors;
- typed authoritative telemetry for consensus, trading, liquidity, Quant, capital, and every YNX product;
- alert correlation, escalation, notification delivery, and controlled automation;
- separately redacted public-status runtime and public communication approval;
- explicit schema migration and rollback-migration drills;
- real backup, isolated restore, region failure, provider failure, or rollback execution evidence;
- shared Testnet integration and public probes;
- SLO load histograms, capacity evidence, and unit economics;
- Monitor threat model, SBOM, provenance, license review, SAST/DAST, artifact scan, reproducibility, signing, installation, and cold start;
- hosted private operator, public `/monitor`, downloads, status page, support/privacy/security URLs, and SEO consumption;
- GitHub Actions, Release, Monitor artifact, production signing, or store release.

## Non-green full preflight

The required repository-wide `go test ./...` preflight is not green due to failures in cross-product consensus, faucet, trust, and missing compiled EVM fixture ownership. These failures are recorded in `product-release.json` and `.ai-bridge/execution-log.jsonl`. They are not treated as Monitor-local test failures, but they block the ordered transition from `PROTECT` to `FREEZE` until accepted owner fixes make the full preflight pass.

The authoritative per-requirement status remains `.ai-bridge/full-goal-coverage.json`; this feature document cannot override it.
