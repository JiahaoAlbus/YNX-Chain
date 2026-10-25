# ABCI native DEX actions R1 — source candidate

Status: implemented source; this slice has not been compiled or executed locally. CI19 `39099736825` at `8d5080e6caacdcd069ef205978e9b67e760c0a55` passed the prior Resource/engine baseline. It does not validate this later DEX slice. The fixed remote workflow must compile and run these additions before acceptance. No node, public activation, real-account migration or product launch is claimed.

## Actual execution and authorization

The existing Action v1 Member, canonical typed payloads and `PQActionType` envelope now route all eight DEX kinds to the real ABCI executor: asset create/mint/transfer, pool create, liquidity add/remove, exact-input swap and exact-output swap. Together with the existing stake, resource delegation/rental and contract deploy/execute routes, all thirteen current native Action kinds have an ABCI source route. This is Chain protocol functionality, not resumption of the paused Finance product.

`applyPQDexAction` verifies the original pair with the certificate cache against the owner, transaction purpose, exact message and actual execution height. Network/native chain ID, activation/revocation, original Member/ABCI hash replay, exact next nonce, real balance and traceable fee lots are checked. The descriptor passed to the private `applyAuthorizedDexBusiness` contains no reusable verified flag, fake classic signature or alternate ledger. The existing classic gateway still decodes/verifies its actual secp256k1 envelope and historical/current legacy policy before reaching the same executor.

The existing eight-case business switch is extracted from `dex_action.go`; prices, exact-input/output arithmetic, token issuer/mint caps, recipients, LP ownership, deadlines, slippage and actual pool balances remain that one implementation. Admission uses the actual account/lot movement helpers. All mutable account maps, pool maps, event flow slices and other DEX branches detach before changes. Failure during either side of liquidity/swap or charging the fee discards the candidate.

PQ DEX costs Fee1/BW1. Native debits reserve one real fee unit, business executes, then the existing actual PQ fee-lot/nonce/resource charger moves one fee unit to the trusted first active migration validator. The history carries those exact fee flows and one fee event. Classic DEX continues its previous Fee1/BW1 order: its actual classic charger runs before business and does not add fee lot movements. Matching numeric costs do not make these provenance/order semantics identical. No new fee policy or schema/domain/app version is silently activated here.

The shared extraction also fixes self-token-transfer aliasing (same balance must not mint) and checks actual reserve/lot additions for int64 overflow. The new valid self-transfer and failure tests retain real signatures. No historical old event is rewritten to manufacture the new semantics.

## Durable history, cold restore and source migration

Three optional `BFTDexEvent` fields retain new execution evidence: `classicAuthorization` is exact canonical original classic JSON encoded as lowercase hex; `pqTransactionHash` binds the original Member hash; `nativeFlows` is the actual sorted native escrow lot delta. Empty fields are `omitempty`; the frozen old JSON/audit vector asserts byte identity, including an empty optional slice. New nonempty fields are covered by event audit and committed-state hash. `cloneBFTDexEvents` deep-copies flow slices at execution and sealing boundaries.

The new PQ history memo is `ynx-abci-pq-dex-v1:` plus exact original ABCI JSON in lowercase hex. Common metadata gates still reject invented sponsor/resource/log/BlockHash fields. The DEX validator independently rechecks the original historical AND authorization, original hashes, exact transaction fields, event/receipt coverage both ways, nonce sequence, fee-one trace lineage, exact fee event and BW contributions. Current revocation does not invalidate a historically legal action.

Replay begins from the independently supplied original migration DEX state and immutable source event prefix. It reuses the actual business executor in event order to reconstruct every asset, token balance, pool reserve, LP share, audit and complete event, and compares all those final fields. The history native mover validates recorded positive sorted flows, signed amount/direction, known source lot identity and escrow deltas; withdrawals must select the same sorted escrow lots. New classic entries independently verify the original signature, owner/type/hash, historical legacy policy, monotonic non-reused nonce, final nonce bound and exact fee event. Newly retained classic and PQ native pool calls may interleave and survive cold restart.

This is complete DEX-substate replay, not complete whole-chain native monetary replay. Legacy records do not retain every original native account/fee movement. Knowing a source lot ID and maximum original amount cannot independently prove the depositor owned that unspent quantity at every historical point. Live execution uses real balances/lots; historical import additionally depends on the externally trusted migration/checkpoint and existing committed-state/native-supply checks. An attacker who replaces an entire self-sealed history and final state cannot be excluded by a rewritable local marker alone. An independent trusted root/continuous Comet history remains necessary.

The old opaque post-migration DEX representation remains loadable under its original rules and ordinary lawful classic calls continue. It does not silently acquire an invented original authorization. If any post-migration DEX event lacks both proof fields, new PQ DEX admission for that DEX history fails closed; other previously implemented PQ families are unaffected. The valid trusted source migration prefix is preserved and may be followed by new PQ DEX, as a distinct supported bridge.

The remaining original-material bridge is concrete: pre-change source `chain.NativeDexSignedActionInput` does not contain the classic envelope, and `submitNativeDexActionLocked` stored only `signed chain-native DEX action` in `Transaction.Memo`. Its source `Runtime.Blocks/Pending` cannot recreate original signed bytes or omitted request limits. Post-migration Comet blocks retain actual `Block.Data.Txs` and can be read with the engine's `BlockStore.LoadBlock`, but `Application` does not currently retain/accept that independently verified full block sequence as an upgrade input. A future bridge must use the actual original block sequence from the original migration height, original block order/time and a separately trusted final checkpoint, replay all relevant native movements (not just infer flows from today's balances), and verify the old final state before adding evidence. This slice neither invents such a checkpoint nor discards old records. Missing original blocks remain an actual compatibility limitation, not a completed migration.

## Regression source

`pq_native_dex_test.go` uses genuine original N1 dual signatures and the real CheckTx/PrepareProposal/ProcessProposal/FinalizeBlock/Commit/persist/restart paths. It covers all eight kinds; real fee lots/nonce/BW; revoked classic/PQ denial and another owner continuing; classic/PQ native-pool interleaving; source migration then actual swap; bad A/B signatures, valid wrong key/network/chain signatures, inactive policy, replay, wrong fee/nonce, issuer/slippage/deadline/capacity; partial-business rollback; pre-rename rollback and post-rename UNKNOWN with original Commit retry; independent clone isolation; old opaque state preservation; and resealed transaction/event/flow/pool/share/supply/fee/proof/order/nonce tampering.

The old JSON/audit vector is only a serialization compatibility test. It is not used as a fake authorization or acceptance fixture. The previous stake, contract and Resource tests are not modified. Only gofmt, source inspection, an independent Python SHA-256 vector calculation and `git diff --check` were performed locally. Remote CI is required for actual results.

## Owned source and integration delta

Owned Go leaves:

- `internal/consensus/pq_native_dex.go`
- `internal/consensus/pq_native_dex_test.go`
- `internal/consensus/dex_action.go`
- `internal/consensus/pq_native_action.go`
- `internal/consensus/account_policy.go`
- `internal/consensus/state.go`
- `internal/consensus/pq_contract_state.go`
- `internal/consensus/pq_native_resource.go`

This document and `PQ_ABCI_NATIVE_DEX_SOURCE_R1.sha256` form the new slice; the prior Resource R1 manifest remains unchanged. No git staging/commit was performed by this owner.

Root's separate `application.go` hook must be in the same integration: `cloneExecutionState.dexEvents` uses `cloneBFTDexEvents(a.committed.DexEvents)`, replacing the old shallow `append`. Current hook-containing leaf SHA-256: 032980b3f903291ecd54f42dbcc404b082fd9be4c7a175f1cb34f0173362196d. This owner did not write that file. No performance journal, fee format, state version/domain or external integration-tree file was changed by this slice.

Consumer policy source delta from actual CI19 baseline `8d5080e6c`: `account_policy.go` SHA-256 c2bc03df949dd3b0dbe9b7b861e01842ec444d9f23aead919a5f59c65b25c040 → 37a99c4cb49b013be0769964be52db98f995d9df861385b3c48749aa3283c752. The only new bypass of the common family dispatch goes to the full DEX validator called unconditionally by `CommittedState.Validate` before contract fee validation; it is not permission to skip verification. Consumers must not relabel the prior fixed consumer manifest as this new source.
