# YNX Monitor Integration Handoff

Status: Candidate, not frozen  
Owner: `13-monitor`  
Source commit: `5914e02134cd17ad20c6d8c9846864861cdfd4a3`
Last updated: 2026-07-29

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

## Public status boundary

`GET /status` is unauthenticated but never reads private OpsStore state. It accepts only a separate `ynx.monitor.public-status-source.v1` document whose publisher is pinned by `YNX_MONITOR_PUBLIC_STATUS_EXPECTED_SOURCE`, whose canonical JSON is protected by HMAC-SHA256 using `YNX_MONITOR_PUBLIC_STATUS_INTEGRITY_KEY`, and whose approval record is signed as part of the source and names `incident_commander` as the approving role.

The file adapter uses `YNX_MONITOR_PUBLIC_STATUS_PATH`, accepts only a regular non-symbolic-link file no larger than 262,144 bytes, and applies `YNX_MONITOR_PUBLIC_STATUS_MAX_AGE_SECONDS`. The route strips approval identity and integrity material, returns `Cache-Control: no-store`, and rejects unsigned, tampered, wrong-publisher, stale, wrong-role, fake-healthy, private-text, invalid-file, provider-error, and older replayed snapshots with bounded 503 responses. Replay prevention is monotonic within the running Monitor process; a hosted publisher must also provide durable sequence/rollback protection across restarts before public verification.

## Health and version semantics

- `/health` reports only the Monitor control-plane process and state-store readiness. It does not imply that chain, Oracle, Quant, provider, or public services are healthy.
- `/version` exposes Monitor service and contract versions. Commit and release remain `null` until a real deployment injects them.

## Verification bound to the source commit

- `cd apps/monitor && npm test` — 35 passed, 0 failed: 31 runtime/UI cases plus 4 supply-chain fail-closed cases.
- `cd apps/monitor && npm run build` — TypeScript and production Vite build passed.
- `cd apps/monitor && npm run test:e2e` — managed desktop/mobile suite passed 8/8.
- `cd apps/monitor && npm run security:check` — audit 0, credential findings 0 across 690 tracked text files, SAST findings 0 across 12 production files, 163 locked production packages reviewed, two clean builds identical, artifact findings 0.
- Generated evidence: `release/monitor/security/` contains the CycloneDX SBOM, third-party notices, dependency review, DAST input plan, build manifest, local unsigned provenance, and gate summary.
- `cd apps/monitor && npm run smoke` — failed because all eight configured central service endpoints were unavailable; no Testnet or dependency-health claim is made.
- Git protection — protected implementation source `5914e02134cd17ad20c6d8c9846864861cdfd4a3`; final branch/upstream equality is verified after the evidence checkpoint push.

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

The current phase remains `PROTECT`: Monitor-local tests, build, E2E, dependency audit, threat model, SBOM, license review, credential/SAST scans, reproducible build, and local provenance pass, but the repository-wide phase-transition preflight is not green and `29-integration` has not frozen the contract. The redacted status route is locally tested only; no approved publisher feed, hosted private operator, hosted public endpoint, Website consumption, public probe, hosted DAST, public deployment, production signing, immutable artifact, install, or cold-start claim is made.

`30-security-sre-release` must also review two disclosed supply-chain facts: the lock file contains both `registry.npmjs.org` and `registry.npmmirror.com`, and the shared repository `scripts/validate/secret-scan.sh` can print a false pass when `rg` is absent. Monitor does not modify that central script and instead uses a built-in scanner with direct evidence.

The next autonomous slice is typed backup, restore-drill, and rollback-proposal operator UI with capability gating, explicit approvals, independent-verifier states, and managed desktop/mobile tests. The transitional `operator` role remains migration-only and must not be assigned to new principals once scoped-role migration is accepted.
