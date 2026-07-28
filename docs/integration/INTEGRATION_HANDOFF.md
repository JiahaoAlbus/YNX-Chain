# YNX Monitor Integration Handoff

Status: Candidate, not frozen  
Owner: `13-monitor`  
Source commit: `95817f417bb9d08a8450c09fca884bb89d240eba`  
Last updated: 2026-07-28

## Protected local delivery

The source commit above is pushed to `origin/codex/final-monitor`; local and upstream SHA were verified equal. It provides scoped Monitor authorization for `viewer`, transitional `operator`, `incident_commander`, `backup_recovery`, and `security_reviewer`, plus the versioned incident, backup, restore-evidence, and rollback-proposal control plane.

The permission split remains:

| Permission | Incident Commander | Backup/Recovery | Security Reviewer | Transitional Operator |
|---|---:|---:|---:|---:|
| `incident:create` | Yes | No | No | Yes |
| `incident:manage` | Yes | No | No | Yes |
| `incident:recovery_verify` | No | Yes | No | Yes |
| `incident:postmortem` | Yes | No | No | Yes |
| `alert:acknowledge` | Yes | No | Yes | Yes |
| `backup:record` | No | Yes | No | Yes |
| `backup:verify` | No | No | Yes | Yes |
| `rollback:propose` | No | Yes | No | Yes |
| `rollback:verify` | No | No | Yes | Yes |

The incident lifecycle is:

`open → acknowledged → investigating → mitigated → recovery_verifying → resolved → postmortem_complete`

It supports owner assignment, append-first notes and timeline evidence, ordered transitions, idempotent retry, independent recovery verification, postmortem, restart persistence, tamper rejection, authenticated JSON evidence export, and capability-gated responsive UI. Invalid transitions preserve state. Recovery cannot be verified without evidence, and Incident Commander cannot self-verify recovery.

Typed backup records bind SHA-256, byte size, retention, storage, encryption, RPO/RTO targets, and source evidence. Restore drills bind start/end, observed RPO/RTO, integrity/application checks, failure details, and direct evidence. Security Reviewer verification must be performed by an actor different from the reporter, and an accepted restore requires a previously verified backup.

Rollback remains a proposal only. Monitor records candidate/previous release identity, reason, dry-run evidence, and independent review, but never executes infrastructure commands, moves assets, changes Wallet authority, modifies a Quant mandate, or resumes a paused system.

## Origin and CSRF boundary

Every authenticated non-`GET`/`HEAD`/`OPTIONS` request under `/ops` now requires:

- an exact Origin from `YNX_MONITOR_ALLOWED_ORIGINS`, falling back to the canonical `YNX_MONITOR_PUBLIC_ORIGIN`;
- `X-YNX-CSRF-Token` containing the HMAC token issued with and bound to the presented Monitor session.

Missing Origin, an untrusted Origin, a missing CSRF token, and an invalid token fail closed with `origin_required`, `origin_not_allowed`, `csrf_token_required`, and `csrf_token_invalid`. Old browser sessions that lack the new CSRF field are discarded and must authenticate again.

## Health and version semantics

- `/health` reports only the Monitor control-plane process and state-store readiness. It does not imply that chain, Oracle, Quant, provider, or public services are healthy.
- `/version` exposes Monitor service and contract versions. Commit and release remain `null` until a real deployment injects them.

## Verification bound to the source commit

- `cd apps/monitor && npm test` — 18 passed, 0 failed, including Origin/CSRF negative vectors.
- `cd apps/monitor && npm run build` — TypeScript and production Vite build passed.
- `cd apps/monitor && npm run test:e2e` — managed desktop/mobile suite passed 8/8.
- `cd apps/monitor && npm audit --omit=dev --audit-level=high` — 0 vulnerabilities.
- Git protection — `codex/final-monitor` pushed; local SHA equals upstream SHA at `95817f417bb9d08a8450c09fca884bb89d240eba`.

The repository-wide `go test ./...` preflight was also run and failed in cross-product consensus, faucet, trust, and missing EVM artifact tests outside `13-monitor` ownership. These failures are recorded in `product-release.json`; Monitor does not claim the full monorepo preflight passed and did not modify those owners' code.

## Consumer contract

The machine-readable candidate is `release/integration/monitor-contract.json`; cross-product vectors are in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.

Consumers must not infer health from HTTP 200 alone. Every telemetry adapter must preserve owner-provided `source`, `version`, `asOf`, stale/failure state, and evidence references. Monitor may present and alert on owner facts; it must not redefine chain finality, Oracle prices, Quant PnL, solvency, asset state, or release execution.

## Required owner inputs

- `02-wallet-auth`: accepted Monitor product registration, challenge verification, device/product/scope binding, expiry, and revoke semantics.
- `01-chain-core`: finality, validator, peer, state-sync, snapshot, lane, and execution-conflict telemetry.
- `07-exchange`, `27-dex`, `19-oracle-market-data`: sequence, market, liquidity, liquidation, and source-quality telemetry.
- `08-quant-lab`: strategy, mandate, risk, kill-switch, cost, PnL, fee, and reconciliation telemetry.
- `17-tokenomics`, `21-bridge`, `16-resource-market`, `26-data-fabric`: capital, reserve, exposure, provider, service, revenue, burn, and canonical-event telemetry.
- `28-website`: public `/monitor` entry and consumption of the redacted public-status projection.
- `29-integration`: unique contract freeze and shared Testnet endpoints.
- `30-security-sre-release`: release identity, artifacts, backup, restore, rollback, security evidence, and ownership of the recorded repository preflight failures.

## Current blockers and next action

The current phase remains `PROTECT`: Monitor-local tests, build, E2E, dependency audit, push, and SHA equality pass, but the repository-wide phase-transition preflight is not green and `29-integration` has not frozen the contract. No Testnet, hosted private operator, public status, public deployment, production signing, artifact, install, or cold-start claim is made.

The next autonomous slice is the fail-closed redacted public-status projection and private-data leakage test vectors, followed by Monitor-specific threat-model and supply-chain evidence. The transitional `operator` role remains migration-only and must not be assigned to new principals once scoped-role migration is accepted.
