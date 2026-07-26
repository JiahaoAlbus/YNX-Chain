# YNX Governance & Protocol Control — Current Checkpoint

Status: **Active**
Phase: **FREEZE**
Branch: `codex/final-governance`
Protected implementation checkpoint: `3a561ddf3c7ab28b1bf7c1aa0158dfea0ee9c570`

## Implemented and verified

- Runtime Governance Object Registry with 34 versioned control objects.
- Runtime Parameter Registry with 32 bounded, rate-limited, timelocked parameters.
- Machine-readable Role Registry with 12 scoped, expiring, revocable roles.
- Dedicated Emergency Council separated from Technical and Security Council authority.
- Dedicated Execution Operator separated from Treasury Council authority.
- Canonical 33-state proposal state machine from `draft` through `archived`.
- Audit-hashed transition history with strict allowed-transition validation.
- Strict Proposal gate for machine diff, impacts, migration, rollback, canary, verification, conflicts, dependencies, evidence, source commit, and release.
- Proposal `ActionHash` binding the exact diff, source commit, release, and upgrade manifest.
- Governance state snapshot schema `ynx-governance-state/v5`; v1 through v4 require explicit migration.
- Runtime config schema `ynx-governanced-config/v3` requires an explicit bounded Timelock Grace policy; v2 fails closed until migrated.
- Ed25519 signed vote envelopes binding Chain ID, Domain, Proposal ID, Voter ID, Choice, Operation, Revision, Nonce, Electorate Snapshot, SignedAt, and Expiry.
- Voter ID derived from the signing public key; wrong voter/public key, wrong chain/domain/proposal, tamper, expired vote, future vote, duplicate, and replay fail closed.
- Immutable Vote Revision history supporting explicit replacement and withdrawal without voting-power double counting.
- Vote Nonce registry persisted and reconciled against signed history during restore.
- HTTP mutation gate requiring the Product Session account to match the signed Voter ID.
- Public read APIs expose all signed Vote revisions, public keys, signatures, nonces, snapshot evidence, supersession links, and current-revision status.
- Persistent Ed25519 signed Delegation revisions bind chain, domain, delegator, delegate, scope, amount, operation, revision, nonce, start, expiry, override policy, and superseded audit hash.
- Delegation registration, redelegation, revocation, replay rejection, self-delegation rejection, multi-hop/cycle rejection, historical snapshots, partial power, and direct-vote override are enforced without double counting.
- Product Session identity and scope are bound to Delegation HTTP mutations; immutable Delegation history and nonce state survive restore and fail closed on tamper.
- First-class persistent Timelock records bind Proposal ID, exact ActionHash, earliest execution, bounded Grace deadline, public Notice evidence, execution manifest, and an audit-hashed transition chain.
- Timelock cancellation requires the exact ActionHash and an authorized scoped Product Session; early execution, post-Grace execution, duplicate submission, state tamper, and Proposal/Timelock divergence fail closed.
- Emergency Pause, verified execution, failed execution, rollback, expiry, archive, restart recovery, health, public views, and audit output remain synchronized with the Timelock record.
- `/health` and `/version` report real runtime provenance and degraded central dependencies without hard-coded healthy claims.

## Verification

- `go test ./internal/governance ./chain/governance` — passed.
- `go test ./...` — passed.
- Signed-vote tests cover valid cast, Wrong Chain, Wrong Domain, Wrong Proposal, Wrong Voter, Wrong Public Key, Choice Tamper, Wrong Snapshot, Expiry, Future Timestamp, exact Replay, Duplicate Cast, Replacement, Withdrawal, post-restore Replay, signature tamper with recomputed outer digest, Nonce Registry mismatch, and HTTP Session/Voter mismatch.
- Delegation tests cover registration, redelegation, revocation, replay, tamper, self-delegation, multi-hop/cycle rejection, historical snapshot binding, partial amount, direct override tallying, persistence, nonce reconciliation, and HTTP Session/Delegator mismatch.
- Timelock tests cover exact ActionHash binding and cancellation, scoped Session authorization, early execution rejection, bounded Grace expiry, duplicate submission replay, public Notice evidence, submitted/expired/cancelled/paused restart recovery, and digest-valid tamper rejection.

## Truthful release state

- `implementedLocal`: true for registry, canonical Proposal lifecycle, signed Vote and Delegation integrity, persistent Timelock control, local persistence, Emergency control, and public-read APIs.
- `testedLocal`: true for these slices.
- `installedLocal`: false.
- `integratedCentral`: false.
- `deployedStaging`: false.
- `deployedPublic`: false.
- `downloadHosted`: false.
- `productionSigned`: false.
- `storeReleased`: false.

## Next engineering target

Implement first-class Upgrade Runtime records with signed source/manifest identity, migration and rollback binding, canary eligibility, duplicate/conflict rejection, restart recovery, and execution receipt correlation. The long-term Governance goal remains Active.
