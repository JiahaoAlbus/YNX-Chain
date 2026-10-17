# ABCI account revocation and complete-source migration, R1

This is a source candidate in the production worktree based on `83beea24810ba8b77293629405798224bcec8196`. No local Go compile/test, benchmark, node, service or deployment was run for this wave. `gofmt` and `git diff --check` are the local checks. Remote CI must establish compilation and execution results separately.

## Actual admission and execution

`TransactionEnvelopeType`, `Application.applyTransaction` and the existing canonical `PQTransaction` transport now accept `account_revocation`. The JSON envelope remains version 1. It carries the original lower-hex revocation wire; it does not introduce another signature domain. Unknown fields, duplicate fields, trailing bytes, alternate hex/JSON encodings and revocation wires beyond the protocol bound are rejected.

The native identity is `SHA256(original revocation wire)`; the separate Comet transaction identity is `SHA256(canonical JSON transport)`. `PQHistory` retains both identities and the complete original memo `ynx-pq-revocation-v1:<wirehex>`.

`State.AdmitRevocation` checks the complete current legal pair through `State.VerifyMember` and `TrustedRegistration`, with both PQ signatures required. The exact execution height, current revision, complete latest revision schedule, current account nonce and signed `RevokeAt = ExecuteAt + 1` are checked before mutation. Proposed keys or classic signatures cannot replace current authorization. This reuses the account revocation protocol implemented by the policy owner; it is independent of validator proposal/vote signing.

`applyPQRevocation` clones the candidate account state, charges fee 1, consumes the signed next nonce and one bandwidth unit, moves exactly one traceable unit to the actual configured fee recipient, records that lot flow, updates its original lineage's `LastInbound` destination, appends the real fee event and installs the returned complete policy. Missing balance/lot lineage and recipient/resource overflow fail before any shared mutation. The original registration records remain intact when the first tombstone changes global policy v1 to v2.

`CheckTx` uses committed height + 1 and does not modify committed state. Proposal preparation and processing apply each candidate in order at the proposal's actual height. Transactions later in the same height may still use the old pair because revocation becomes effective at H+1. New registration/rotation for this terminal owner is closed immediately, including at H. At H+1, both current keys and already scheduled future keys are terminally disabled. Classic native and all existing classic Action/EVM paths remain behind `RequireLegacy`; a tombstone never reopens them. Other owners retain their own authority under global policy v2.

## Persistence, history and transitions

The existing committed v15 document already hashes and persists the complete `AccountPolicy` and `PQHistory`. This wave requires exactly one original target revocation proof per new tombstone and exactly one matching fee event and fee lot flow per proof. Source-anchored tombstones are proven by the complete source runtime rather than copied into fabricated BFT history. Every target proof is rechecked against its original height and canonical transport identity.

The shared chain historical verifier reconstructs the policy before an original migration/revocation event. It excludes future records/tombstones and, for this owner at the same height, events at or after that ledger nonce. A later terminal decision therefore does not invalidate an earlier lawful rotation. Historical transfer verification uses the original execution height with the full final policy.

The ABCI target rejects unexecuted Sponsor/Resource fields, source block hashes and source logs in its own PQ receipts. Target transfer/migration receipts currently have no lot-flow field; target revocation receipts have exactly the flow produced by this executor. Native source transactions retain their own real block hashes/logs inside the immutable runtime. These two receipt formats are not relabeled as each other.

`FinalizeBlock` and `Commit` now compare the candidate with current committed policy and proof history. The shared continuation validator prohibits downgrade, removal or modification of original records/tombstones and changes to network or enable height. Existing target proof entries must remain an exact prefix. Removing both a later tombstone and its proof is rejected at the live transition boundary, even if the candidate hash is recomputed. History cloning now detaches nested lot-flow and log/topic slices so a candidate cannot mutate committed authorization receipts by aliasing.

This does not create an external rollback witness for a malicious replacement of an entire historic database and its anchor. State sync/light-client/validator PQ verification remains a separate integration task.

## Complete authoritative-source import

No new source policy representation is invented. `ConsensusRuntimeState`, `AccountPolicy`, original blocks and the shared `PQBatches` ledger carry the complete global v2 state. Owner query projections must not be used as the migration policy. The existing source runtime boundary calls the complete snapshot validator, including registration/revocation proof coverage, original Whole records/results, native action evidence and history continuity.

Source Whole verification uses the full trusted resolver at each original execution height. Each member of an already authenticated Whole again calls `TrustedRegistration` at its requested height before use. The new migration regression executes a genuine Whole, admits a same-height pending rotation and terminal decision, drains/persists the source, exports it and checks exact proof/result/history preservation. Its members remain historically valid at H and fail current authorization at H+1. Missing Whole records, rewritten member outcomes and deleted/shifted tombstones are rejected even after recomputing the outer migration hash.

The target import regression loads this source v2 state through `NewPersistentApplication`, preserves original queries and accounts without executing source effects twice or fabricating target receipts, executes a lawful transaction for another owner, rejects the canceled pending pair after its scheduled activation, and checks restart equality.

## Validation to run remotely

```sh
go test ./internal/chain -run '^TestConsensusMigrationRevocation' -count=1
go test ./internal/consensus -run '^TestABCI(Revocation|MigratedRevocation)' -count=1
go test ./internal/consensus ./internal/chain ./internal/api -count=1
```

The full consensus package still requires the already documented normal build of both registered contract artifacts and selectors. The focused revocation cases do not replace full regression or deploy/readback checks.

New test source covers genuine current double signatures with separate broken-A and broken-B cases; exact CheckTx/proposal/finalize heights; fee/nonce/bandwidth/lot effects; balance/lineage/overflow failure isolation; old classic/Action/PQ rejection; unaffected other owners; same-height rotation followed by revocation; original proof/fee/tombstone coverage; metadata injection; append-only transitions; canonical bounds; source Whole retention and persistent restart. These are written tests, not a claim that they have passed.

## Remaining boundaries

ABCI admission for a new shared Whole and for non-transfer PQ Action wires is not implemented by this wave. Their source histories are preserved and validated; old classic Action is refused for activated or revoked owners. Existing non-revocation ABCI fee/lot semantics are unchanged and require their own accounting audit. Pay/AI/Trust adapters, unregistered or missing-code contracts, complete cutover coordination and upstream Comet key/proto/commit/evidence/light-client/remote-signer integration retain their prior gates. The public authoritative producer is not claimed to have been converted to Comet by these source changes.
