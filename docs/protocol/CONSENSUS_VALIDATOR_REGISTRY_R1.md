# Validator registry application slice R1

Source-only handoff on the production worktree /Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain. Starting HEAD was 70a8b3a3b8197fa9bcaca40e4a771b424e34f03d; other owners may advance the shared branch. The adjacent SHA256 manifest identifies this slice's exact working files.

No local Go compilation/tests, C, nodes, benchmarks, deployment, stage or commit. Gofmt and whitespace/source inspection are not runtime acceptance. Actual operator pins are unknown and were not invented.

## Implemented boundary

NewConsensusBootstrap(rawGenesis, pins, boundMigration) accepts three independently configured operator pins: SHA256 of the exact raw Comet genesis bytes, the original native OriginalGenesisHash, and the key-bound migration StateHash. The first is the consensus registry GenesisID; it is not substituted for the original native genesis identity.

The constructor validates the entire migration, full embedded AppState, AppHash, chain ID, explicit initial height and genesis time, valid explicit consensus params, Ed25519-only key allowlist and exact active genesis validator membership. Each validator must match the bound migration's full Ed25519 public key, positive power, native name and ConsensusAddress=SHA256(publicKey)[:20]. Duplicate/missing/substituted members fail. Original raw bytes are hashed before parsing; no normalization changes the pin and no GenesisDoc completion defaults are used.

ConsensusBootstrap fields are private and immutable. State source results are detached. A persisted bootstrap record is evidence only: a registry-bearing state cannot be opened through the old constructor without explicit independently configured bootstrap pins. InitChain cross-checks the actual request's entire validator set, params, time, chain, height and complete AppState against the pinned configuration.

The initial set hash is computed with the actual stock GenesisDoc.ValidatorHash implementation. When bootstrap mode is configured, PrepareProposal, ProcessProposal and FinalizeBlock require the exact original NextValidatorsHash. Missing/changed membership fails closed. This slice supports only the fixed initial set and emits no ValidatorUpdates or ConsensusParamUpdates. Future H+2 membership histories require a separately designed implementation; a caller cannot pass a different set into the private membership source.

## Canonical registration and state

The new envelope type is ynx_validator_registry_v1, with exactly the JSON fields type and wire. wire is lowercase hexadecimal of the complete original ynxconsensusauth registration operation. Exact canonical outer JSON is required: unknown/duplicate fields, alternate whitespace/case/order and trailing data are rejected by re-encoding equality. Maximum outer bytes are 2*MaxRegistrationBytes+128; existing engine/gateway caps were not changed.

Execution delegates real authorization to KeyHistory.Append using the original fixed Ed25519 membership source at the exact approved/execution height. Initial registration uses the genuine old Ed25519 authorization plus both new-key proofs. The existing registry package also enforces rotation/revocation sequence, original prior-event binding and current full-pair authority. These operations change application registry evidence only, not the stock engine signer or active validator set. In particular, a registry EffectiveAt is not a claim that PQ consensus has activated.

Every committed event retains original wire, domain-separated operation hash, distinct outer ABCI transaction hash, ApprovedAt execution height, global event index and actual outer block transaction index. The root is rebuilt by replaying the full original proof history. State validation rejects missing, reordered, changed or mismatched records/root; continuation preserves every previous event and original bootstrap exactly. The full bootstrap record, full events and root participate in the application hash.

Only the first successful registry operation creates a non-nil registry and selects explicit state version 16 / YNX_ABCI_STATE_V16. Merely configuring bootstrap, constructor/recovery/InitChain, failed transactions, and proposals do not initialize it or rewrite old hashes. Nil registry is omitted from existing v14/v15 hash documents. Subsequent empty blocks preserve the registry AppHash.

Registration does not fabricate a native transaction, debit native balances/nonce/lots or imply a fee payment; its signed sequence and original domain are the operation's replay authority. Account policy and native PQ history remain separate. The registration profile is not transaction Whole and cannot be used to authorize future consensus votes.

CheckTx, PrepareProposal and ProcessProposal operate on detached candidates. A failed candidate is discarded without mutating preceding accepted state. FinalizeBlock seals pending state; /validator-registry Query exposes only committed state. The registered original event/ABCI hash can be read back after Commit.

## Commit and recovery

The existing pending Commit fence is retained. Pre-rename persistence failures keep original memory and pending state; no candidate file is published. After successful rename, directory Sync/Close failure wraps ErrCommittedStateDurabilityUncertain. The exact pending candidate remains fenced: another FinalizeBlock is refused, committed Query/Info remain at the last confirmed state, and Commit retry persists the same pending bytes/state instead of executing transactions again.

Cold construction validates the full state, operator bootstrap and complete proofs before doing a real directory Sync. Failure returns UNKNOWN and no Application is published. Successful confirmation exposes that original visible root/AppHash. This confirms local durability; it does not establish that arbitrary local JSON is the canonical chain checkpoint. The actual Comet handshake/header must independently reconcile the latest application hash. Rewriting a whole local file to a self-consistent earlier history is outside the authority provided by an initial genesis pin alone.

All execution/candidate/Commit paths use the existing Application mutex. The fixed membership source never reacquires it. Production persistence hooks are nil and call real filesystem operations; unexported per-instance hooks are used only by fault-test source. No global fault hook or second signer journal was introduced.

## Startup hook

cmd/ynx-abci accepts the opt-in group:

    -consensus-genesis <exact operator-selected genesis file>
    -consensus-genesis-sha256 <independently pinned raw-file SHA256>
    -original-genesis-hash <independently pinned original native genesis hash>
    -bound-migration-state-hash <independently pinned key-bound migration StateHash>

All hashes are canonical nonzero lowercase 32-byte hex. Partial/mismatched configuration fails. Without the group, the legacy constructor continues and refuses the new registry transaction/state. No values are derived as trusted expected pins from incoming files or a peer.

production.go/systemd generation was not changed. Its future integration hook must carry separately supplied operator configuration into these flags, and must not set the expected hash by hashing the same package it is about to trust. This document does not provide deployment authorization or real operator values.

## Tests written, not run locally

The fixture binds real old Ed25519 validator keys to a real exported migration and builds actual stock Comet genesis bytes. Each positive registration uses genuine CIRCL ML-DSA-87 and SLH-DSA-SHA2-256f possession signatures plus Ed25519 approval. Negative tests corrupt each signature branch independently.

Test source covers:

- Complete InitChain fake-set/power/duplicate/missing/chain/height/time/params/AppState rejection; wrong independent pins; exact raw-byte pin; genesis/migration cross-check even with a changed raw pin.
- Detached membership bounds/bytes, missing/changed NextValidatorsHash, old unconfigured entry refusal, unchanged old v14/v15 hash behavior.
- Check/Prepare/Process isolation, duplicate candidate rollback, first registration's pending v16 AppHash, no engine updates, actual outer transaction indices, unchanged native accounts/lots, committed Query and restart with independent pins.
- Full original wire/operation/ABCI identities, deletion/reordering/tampering/downgrade and append-only checks.
- Real file persistence with injected before-rename and after-rename directory failure, exact UNKNOWN pending identity, blocked repeat Finalize, cold confirmation failure and real successful directory Sync, same-candidate Commit reconfirm without duplicate execution.

Suggested fixed-SHA remote checks, to be scheduled by Root:

    go test ./internal/consensus -run 'Test(ConsensusBootstrap|ValidatorRegistry)' -count=1
    go test ./internal/consensus ./cmd/ynx-abci -count=1

The focused suite must actually run before claiming these cases pass. Full consensus regression is needed because the state serialization, constructor recovery and Commit persistence functions are shared.

## Still not implemented or established

This slice has no Comet fork, new crypto.PubKey/proto type, proposal/vote/extension signature hook, PQ Commit/evidence/light-client verification, remote signer protocol, H+2 membership transition, consensus-parameter activation commitment or state-sync proof implementation. It does not upgrade the public authoritative_producer network and does not manufacture Commit records for its old native history. Original genesis, balances, contracts, data and historical height rules remain distinct from the new candidate consensus registry.

No real engine activation, multi-node operation, remote signing, light-client path or performance result is claimed. The next work remains the reviewed engine integration plan in CONSENSUS_PQ_ENGINE_INTEGRATION_R2.md after this application slice passes actual fixed-source tests.
