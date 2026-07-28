# YNX Governance & Protocol Control — Current Checkpoint

Status: **Active**
Phase: **INTEGRATE**
Branch: `codex/final-governance`
Implementation checkpoint: `ea949aacac147505360528583bd7fade12f7cac8`

## Implemented and verified

- A digest-bound registry loads 34 governance objects, 32 bounded integer parameters, 2 canonical SHA-256 upgrade-manifest parameters, and 12 scoped roles.
- Runtime policy must exactly match registered parameter type, scope, and bounds. Proposal creation, voting, finalization, execution preparation, and restore revalidate the authoritative registry.
- The canonical 33-state proposal lifecycle separates approval, timelock, submission, execution, verification, failure, rollback, correction, and archive.
- Ed25519 vote, delegation, canary cohort, and canary-result envelopes have replay protection, immutable revision history, identity binding, and restore-time integrity checks.
- First-class Timelock, Upgrade, Canary, Emergency, Appeal, Discussion, Role, and audit records persist with explicit state transitions.
- Signed execution intents pass through the canonical Chain Core/Comet adapter. Verification reconciles transaction hash, block height, block hash, state root, manifest, source, outcome, and audit identity.
- A multiprocess four-validator lifecycle exercises proposal creation through canonical execution and verification without inferring public deployment.
- Public APIs expose proposals, votes, delegations, roles, parameters, timelocks, executions, upgrades, canaries, emergencies, treasury/provider proposal records, conflicts, appeals, audit, health, version, and metrics.
- The read-only governance UI consumes the real nested proposal and public signed-vote contracts. Fake wallet and unsigned-vote controls were removed.
- The UI has a committed dependency lock, production build, type-check, render smoke test, and zero-known-vulnerability npm audit.
- Governance CI verifies Go tests and vet, JSON metadata, UI build/test/type-check/audit, forbidden text, secret patterns, and deterministic Go binaries.

## Verification

- `bash scripts/verify/governance-check.sh` — passed on 2026-07-28.
- `go test ./...` — passed on 2026-07-28.
- `npm --prefix apps/governance test` — 1 render smoke test passed.
- `npm --prefix apps/governance audit --audit-level=moderate` — 0 known vulnerabilities.
- Remote branch SHA was verified as `ea949aacac147505360528583bd7fade12f7cac8`.

## Truthful release state

- Local implementation, tests, deterministic builds, registry gates, UI verification, canonical execution-adapter integration, and multiprocess lifecycle evidence are complete.
- Shared Testnet acceptance is not complete.
- Explorer, Monitor, Trust, Data Fabric, Security/SRE, and central Integration acceptance are not complete.
- Production signer custody, staging/public endpoints, Vercel/DNS ownership, support/security/status destinations, website handoff, public downloads, and production signing are not available in this workspace.
- No local evidence is represented as a public-chain transaction, public deployment, external audit, or production release.

## Next engineering target

Complete the shared Testnet acceptance matrix with immutable external transaction, indexing, monitoring, trust, and security evidence. Public release then requires operator-provided production custody and deployment destinations.
