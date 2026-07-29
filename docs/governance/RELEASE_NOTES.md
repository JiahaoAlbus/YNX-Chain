# Release notes

## v0.4.0-integration (Candidate)

- Added 12 locale boundaries with locale-aware dates and Arabic RTL.
- Made proposal cards native keyboard controls and added semantic loading, error, filter, navigation, and section state.
- Added truthful conflict, recusal, execution receipt, and audit-transition views to proposal detail.
- Added a repeatable system-Chrome test covering keyboard activation, 390px overflow, Arabic RTL, and the conflict, execution, and audit views.
- Verified the exact Product Session product, device, scope, expiry, revocation, body binding, and replay boundaries locally.
- Source evidence: `0ed74c9e737ca6d5bbdf226f6ca487dc398b4755`.

Shared-Testnet acceptance, Explorer/Monitor/Trust/Security evidence, production signer custody, public deployment, public destinations, and immutable hosting remain external blockers.

## v0.3.0-integration (Candidate)

This Governance integration candidate binds protocol changes to an authoritative registry, submits signed execution intents through the canonical Chain Core/Comet adapter, verifies execution receipts, and exposes an honest read-only UI.

### Runtime and integrity

- 34 governance objects, 32 bounded integer parameters, 2 SHA-256 upgrade-manifest parameters, and 12 roles load through a digest-bound startup gate.
- Runtime policy cannot widen, narrow, retype, or rescope registered parameters.
- Proposal creation, voting, finalization, execution preparation, and restore reject registry drift without mutating proposal or timelock state.
- Upgrade manifest changes must use canonical SHA-256 values and match the proposal upgrade hash.
- Governance state v7 preserves signed votes, delegations, timelocks, upgrades, canaries, emergencies, appeals, and audit history.

### Chain integration

- Signed execution intents are broadcast through the canonical Chain Core/Comet client.
- Receipt verification binds transaction hash, block height, block hash, state root, manifest, source, outcome, and audit identity.
- A multiprocess four-validator lifecycle exercises the integrated flow locally.

### Public UI and CI

- Proposal list and detail views consume the real nested API contract.
- Vote history is read from the public signed-vote endpoint and filtered to current revisions.
- Fake wallet connection and invalid unsigned-vote actions were removed; voting guidance points users to an authenticated signing client.
- Vite 8, TypeScript 7, and Vitest 4 are locked in `package-lock.json`.
- Type-check, production build, render smoke test, npm audit, forbidden-text scan, secret scan, Go tests/vet, JSON validation, and deterministic binary comparison run in the governance gate.
- The npm audit reports zero known vulnerabilities.

### Not public or production

This candidate is not shared-Testnet accepted, staging deployed, publicly deployed, production signed, download hosted, or website accepted. Explorer, Monitor, Trust, Data Fabric, Security/SRE, and central Integration evidence remains pending. No local receipt or lifecycle drill is represented as a public transaction.

### Evidence

- Registry gates: `b1b460d8e798f50381c819c80294c679a7fc6d1f`
- UI/CI verification: `ea949aacac147505360528583bd7fade12f7cac8`
- Multiprocess lifecycle: `27921c8298e22616f983c87fd0d8c51a49495cfd`
- Full local gate: `bash scripts/verify/governance-check.sh`

## v0.2.0-local

Introduced signed votes and delegations, first-class timelocks and upgrades, signed canary gates, public read APIs, BFT governance primitives, Solidity governance contracts, and the initial standalone UI.

## v0.1.0-local

Introduced the bounded proposal lifecycle, policy-owned parameters, role and emergency controls, tamper-evident persistence, gateway assertions, backup/restore, observability, and hardened service packaging.
