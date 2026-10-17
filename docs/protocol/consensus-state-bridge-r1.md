# Authoritative producer to ABCI state bridge R1

Status: source implementation and test sources only. No Go/C compilation, test execution, node launch, deployment, public cutover, or consensus-validator PQ activation is established by this document.

Source worktree: `/Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain`, branch `codex/ynx-pq-public-upgrade`. The public service identity previously recorded by the parent is `ynx-chaind`, build `65efa82e0615`, chain 6423, `authoritative_producer`; it is not evidence of a running Comet network. This phase began from checked HEAD `ada7ae3a09b6f0a0c26b838cfafe83ffc0c468bf` and is an uncommitted source candidate.

## Implemented boundary

`ConsensusMigrationState` v2 includes the raw original genesis identity, mandatory complete typed `ConsensusRuntimeState`, and explicit account policy. The runtime type follows the actual `devnetSnapshot` fields rather than a manually copied subset, including the newly added `PQBatches` shared Whole-proof map. Full history, source contracts, Pay/AI/Trust/resource/sponsor records, idempotency snapshots, audit chains, balances, nonces and lots are included in the migration hash. Peer observations and checkpoint wall time are normalized, preserving determinism without relabeling operational state as consensus.

Export refuses pending transactions because their account/storage/policy effects are already applied by the authoritative producer. It also refuses outstanding UNKNOWN persistence. A persistent source must have a valid on-disk checkpoint with the same application-state digest and tip. The v2 validator cross-checks duplicated account/validator/DEX/policy views, genesis, source tip, complete block history, sponsor integrity, account registration history and shared batch proofs using the source validators. `RestoreSourceRuntime` deep-restores the actual Devnet maps for adapter validation and readback; it starts no producer or service. This restoration alone is not an ABCI execution acceptance claim.

ABCI state v15 persists and hashes `AccountPolicy`, original post-cutover PQ proof history, and source lot metadata. Old v14 hash calculation retains its original domain and omits all new fields. Old schema documents cannot carry or erase new authorization fields. Historical loader fixtures explicitly construct old v1 migration documents rather than relabeling a modern v2 document as old data.

CheckTx uses `committed.Height+1`; proposal execution uses the actual next height, including callers that omit the request height. Native secp256k1 transfers and all signed Actions, including IDE/EVM calls, check active policy before mutation. Raw Ethereum RLP was not an accepted ABCI transaction envelope and remains rejected. There is no alternate raw-EVM path that bypasses this gate in the inspected application.

The new bounded canonical ABCI JSON transport `{version:1,type:"pq_transfer"|"account_migration",wireHex:...}` contains the already-defined native authorization wire. It creates no new crypto domain. PQ transfers use `ynxauth.State.VerifyMember`; migrations use `AdmitMigration`, including the legitimate current authorization and both new-key proofs. The Comet transaction hash covers the complete JSON; persisted authorization history separately retains the native wire hash. Both identities are verified on restart. Fees/nonces execute in the existing ledger; no proof success is stubbed. The complete TX-BATCH Whole transport is not yet an ABCI admission path in this phase.

Source trace Origin/RiskWeight/LastInbound metadata is used by live Trust trace queries, not replaced with generic lineage. Native transfers update the affected lot metadata. Source history remains queryable under `/migration/transactions/<original-hash>` and retains its original block identities; it is not replayed as new transfers. `/account-policy` exposes the persisted policy.

## Explicit incompatible semantics

The accompanying `FULL_STATE_MIGRATION_MAP_R1.md` records the original source-to-target field differences. R1 refuses ABCI initialization for a nonempty module without an implemented execution adapter. It never silently initializes the module empty:

- Pay: source merchant text is not evidence of a chain signer. Source refunded totals and webhook identity differ from BFT records; settlement action height differs from original payment block height.
- AI: source permissions/proposals can be pure state writes without transaction or signer. Assigning a new Signer/TxHash would invent authority/history.
- Trust/governance: original IDs and audit domains differ; requester/claimant/issuer cannot be replaced with a guessed BFT signer.
- Resource rentals/delegations: the source does not retain all quote bodies required by the target, including expiry material used in quote identity. Reconstructing a quote and historical action is not allowed.
- Resource Sponsor: ownership, allowance, consumption, source signer, idempotency and audit state are available. This is the next concrete adapter target, using explicit source provenance and an independent source-record validator rather than fabricated BFT historical metadata.
- Contracts: preserve the original address and current storage; do not rerun constructors. Actual deployed bytecode, source/hash match and support in the target bounded executor must be demonstrated. Artifact paths alone are insufficient material.

An account-only v1 migration cannot prove absence of these modules or PQ policy and cannot initialize a new ABCI instance through this bridge. Historical state loaders still validate original legacy documents. This is a deliberate cutover gate; it is not a claim that all current public business state is already runnable in ABCI.

## Validation to schedule

Static `gofmt` and `git diff --check` succeeded. A shell command first encountered host `fork failed: resource temporarily unavailable`; a later direct `exec gofmt` completed with exit 0. No test command has been executed by this owner.

With the parent's controlled Go/CIRCL environment and heavy-work slot:

```sh
GOMAXPROCS=2 go test -p 1 ./internal/chain -run 'TestConsensusMigration' -count=1
GOMAXPROCS=2 go test -p 1 ./internal/consensus -run 'TestABCIAccountPolicy|TestABCIPQEnvelope|TestMigrationExecutionClosure|TestMigrationTrace|TestCommittedStateMigratesVersion' -count=1
```

The real PQ test source exercises classic-authorized registration with real dual proof, activation-height rejection of native and IDE/EVM classic envelopes, real PQ transfer, durable restart, proof replay rejection and policy omission rejection. Additional source tests cover pending/UNKNOWN export rejection, complete source-runtime readback, deep-copy separation, original lineage readback and fail-closed refusal of nonempty unsupported business modules.

Full migration export currently deep-copies full source history and repeats source proof validation. That cost requires controlled measurement on a preserved public-state clone. Validator proposal/vote signing, Commit/evidence, light clients, remote signers and Comet fork/protobuf/key-size closure remain separate work.
