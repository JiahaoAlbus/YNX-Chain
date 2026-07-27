# YNX Monitor Integration Handoff

Status: Candidate, not frozen  
Owner: `13-monitor`  
Source commit: `0e5b128fe3022ebc99a5401b107b57b11edc1efb`  
Last updated: 2026-07-27

## Delivered in this checkpoint

YNX Monitor now provides explicit least-privilege authorization for `viewer`, transitional `operator`, `incident_commander`, `backup_recovery`, and `security_reviewer`. Sensitive routes check permissions rather than a broad role name. Password and Wallet-backed sessions return the effective permission set so the UI and server consume the same contract.

The current permission split is:

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

The Monitor incident runtime now uses the versioned lifecycle:

`open → acknowledged → investigating → mitigated → recovery_verifying → resolved → postmortem_complete`

It supports owner assignment, append-first notes and timeline evidence, ordered transitions, idempotent retry, independent recovery verification, postmortem, restart persistence, tamper rejection, authenticated JSON evidence export, and capability-gated responsive UI. Invalid transitions return an explicit conflict and do not modify state. Recovery cannot be verified without evidence, and Incident Commander cannot self-verify recovery.

The recovery evidence runtime now records typed backup artifacts with SHA-256, byte size, retention, storage, encryption, RPO/RTO targets, and source evidence. Restore drills record start/end, observed RPO/RTO, integrity/application checks, failure details, and direct evidence. Security Reviewer verification must be performed by a different actor from the Backup/Recovery reporter, and an accepted restore requires a previously verified backup.

Rollback remains a proposal only. Proposals bind the candidate release, previous release, reason, and dry-run evidence. A different Security Reviewer may mark the proposal `verified-not-executed` or `rejected-not-executed`; Monitor never executes infrastructure commands, moves assets, modifies Wallet authority, changes a Quant mandate, or resumes a paused system.

## Health and version semantics

- `/health` reports only the Monitor control-plane process and state-store readiness. It does not imply that chain, Oracle, Quant, provider, or public services are healthy.
- `/version` exposes the Monitor service and contract versions. Commit and release remain `null` until a real source commit and release identity are injected.

## Verification

- `cd apps/monitor && npm test` — 17 tests passed, 0 failed, including typed backup/restore/rollback positive and fail-closed vectors.
- `cd apps/monitor && npm run build` — current TypeScript and production Vite build passed.
- `cd apps/monitor && npm run test:e2e` — managed desktop/mobile lifecycle suite passed 8/8 after two abandoned managed-harness listeners were identified and safely terminated.

## Consumer contract

The candidate machine-readable contract is `release/integration/monitor-contract.json`. Cross-product vectors are in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.

Consumers must not infer health from HTTP 200 alone. Every telemetry adapter must preserve owner-provided `source`, `version`, `asOf`, stale/failure state, and evidence references. Monitor may present and alert on owner facts; it must not redefine chain finality, Oracle prices, Quant PnL, solvency, or asset state.

## Required owner inputs

- `02-wallet-auth`: accepted Monitor product registration, challenge verification, role assignment, expiry, and revoke semantics.
- `01-chain-core`: finality, validator, peer, state-sync, snapshot, lane, and execution-conflict telemetry.
- `07-exchange`, `27-dex`, `19-oracle-market-data`: sequence, market, liquidity, liquidation, and source-quality telemetry.
- `08-quant-lab`: strategy, mandate, risk, kill-switch, cost, PnL, fee, and reconciliation telemetry.
- `17-tokenomics`, `21-bridge`, `16-resource-market`, `26-data-fabric`: capital, reserve, exposure, provider, service, revenue, burn, and canonical-event telemetry.
- `28-website`: public `/monitor` entry and redacted public-status presentation.
- `29-integration`: unique contract freeze and shared Testnet endpoints.
- `30-security-sre-release`: release identity, artifact, backup, restore, rollback, and security evidence.

## Current blockers

This checkpoint is local and tested across unit/API, production build, and managed desktop/mobile browser E2E. It is not yet bound to protected source commits, accepted by central integration, deployed to shared Testnet, hosted publicly, or represented as Production. The broad `operator` role remains solely as a migration bridge and must not be assigned to new principals after scoped roles are available.

The typed recovery runtime records and verifies evidence only. No local fixture proves that a real backup exists, a real restore succeeded, or a real rollback was executed. Those claims require accepted Security/SRE release manifests and an isolated restore or rollback drill.

## Exact next engineering action

Create an implementation checkpoint, bind this handoff and machine-readable contract to its exact source commit, push `codex/final-monitor` with upstream, and verify local/remote SHA equality. After protection, continue with origin/CSRF enforcement and the separate redacted public-status contract while central recovery inputs remain unavailable.
