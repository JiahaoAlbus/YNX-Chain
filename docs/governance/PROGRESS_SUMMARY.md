# YNX Governance & Protocol Control — Current Checkpoint

Status: **Active**
Phase: **FREEZE**
Branch: `codex/final-governance`
Last protected remote checkpoint before this slice: `dcbbe1492537a59155b1e128284339cffbd6c7de`

## Implemented and verified

- Runtime Governance Object Registry with 34 versioned control objects.
- Runtime Parameter Registry with 32 bounded, rate-limited, timelocked parameters.
- Machine-readable Role Registry with 12 scoped, expiring, revocable roles.
- Dedicated Emergency Council separated from Technical and Security Council authority.
- Dedicated Execution Operator separated from Treasury Council authority.
- Canonical 33-state proposal state machine from `draft` through `archived`.
- Audit-hashed transition history with strict allowed-transition validation.
- Explicit separation of vote closure, quorum failure, threshold failure, approval, timelock, submission, execution, verification, failure, rollback, correction, and archive.
- Strict proposal content gate for machine diff, motivation, technical/economic/security/user/provider impact, migration, rollback, canary, verification, conflicts, dependencies, evidence, source commit, and release.
- Proposal `ActionHash` binding the exact machine diff, source commit, release, and upgrade manifest.
- Governance state snapshot schema `ynx-governance-state/v2`; v1 requires explicit migration and cannot silently load.
- Fail-closed restore checks for tampered transition history, legacy combined roles, and legacy Emergency approvals.
- Public read APIs: `/health`, `/version`, `/proposals`, `/votes`, `/delegations`, `/roles`, `/parameters`, `/timelocks`, `/executions`, `/upgrades`, `/emergency-actions`, `/treasury`, `/providers`, `/conflicts`, `/appeals`, `/audit`, and `/metrics`.
- `/health` and `/version` report runtime provenance, database status, chain status, timelock state, execution queue, last successful proposal/execution, pending emergency actions, degraded reasons, and dependency states without hard-coded healthy claims.

## Verification

- `go test ./internal/governance ./chain/governance` — passed.
- `go test ./...` — passed.
- State-machine tests cover successful execution, Quorum failure, Threshold failure, failed execution, delayed rollback, duplicate rollback rejection, v1 migration rejection, and transition-history tamper rejection.
- Public-view tests prove Timelock and Execution records derive from the canonical Proposal state and `ActionHash`.

## Truthful release state

- `implementedLocal`: partial, true for the registry, role, canonical state-machine, local persistence, emergency-control, and public-read API slices.
- `testedLocal`: true for these slices.
- `installedLocal`: false.
- `integratedCentral`: false.
- `deployedStaging`: false.
- `deployedPublic`: false.
- `downloadHosted`: false.
- `productionSigned`: false.
- `storeReleased`: false.

## Next engineering target

Implement cryptographically signed vote envelopes with proposal, chain, domain, voter, nonce, expiry, electorate snapshot, and choice binding; reject replay, duplicate, wrong proposal, wrong chain, wrong voter, tamper, and expired votes; then implement explicit replacement/withdrawal policy and persist its audit history. The long-term Governance goal remains Active.
