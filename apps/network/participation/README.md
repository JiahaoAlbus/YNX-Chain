# Original governance/staking consumer

This package supplies real bounded GET adapters and a private durable Wallet handoff/outbox. It contains no chain signer, broadcaster, guessed Wallet HTTP method or production publisher. `New(..., wallet=nil)` can read and retain exact blocked intents; publication remains `UNSUPPORTED` until the original Wallet owner supplies its actual publisher and lookup adapter. Local IPC identity can authorize preparation of metadata; it does not grant asset or vote authority.

The current source binds `/node/pq-identity`, `/accounts/{owner}/authorization`, `/staking/summary`, `/staking/delegations/{id}`, `/staking/unbondings/{id}`, `/status`, `/governance/proposals/{id}`, `/governance/parameters` and `/transactions/pq/actions/originals/{hash}`. It reuses `consensus.ValidatePQWalletAccountView`, `consensus.ValidatePQWalletIdentityView` and the original `ynxauth.EncodeActionPayload` stake delegate/unbond/withdraw codecs. Native genesis, PQ networkId32, numeric native chain ID and Comet chain ID are independent configured fields. The current CORE assigns its PQ networkId32 from the original native genesis; the consumer does not derive one configured trust field from another. RPC observations never establish those trusted inputs.

The successor CORE has actual native PQ staking lifecycle support, including its original fee, migration validator set, authorization history and seven-day unbonding. This supersedes old read-only binding notes that those APIs were absent. Resource-quota delegation and unsigned legacy `/staking/stake` are never used. Governance registry proposal/weight reports remain available, but lack a native PQ vote codec/executor, genesis-bound snapshot height and fee contract; they remain `UNSUPPORTED` for submission. No Ed25519 registry vote is issued.

The `withdraw` request accepts only the original `unbondingId`, owner, fee cap,
expiry and local request ID. The caller supplies no withdrawal amount, validator
or parent delegation. Preparation checks the signer-owned original unbonding,
its matching parent delegation and nonopaque authorization lineage, committed
record height and original seven-day duration. Reported `/status` block time,
never the local wall clock, determines readiness. Already withdrawn records stay
historical. Both complete original records are bound into the review conditions;
same-hash amount or parent-lineage drift invalidates preflight. A locked record
can become fresh metadata at maturity without modifying its old durable intent.
Only this new action extends its critical-condition shape, preserving existing
delegate/unbond/vote journal bindings and migration bytes.

Ready withdrawal uses exactly `ynxauth.ActionStakeWithdraw` and the original
one-ID canonical payload. The read-only Main DATA projection is
`{kind:"stake_withdraw",fee:"1",payload:{unbondingID:"..."}}`, with no caller
amount, nonce or approval. A reported amount is metadata from the original
unbonding; actual execution determines it from that record. Withdrawal uses the
same durable UNKNOWN, immutable operation ID, cancellation, revocation and cold
lookup path as other typed actions. Tests exercise real temporary canonical PQ
Members and the actual helper/kernel IPC path against explicitly controlled HTTP
fixtures, including missing Wallet refusal and independent-finality false. They
do not supply protected Wallet originals or demonstrate a real funds transfer.

`Prepare` derives the semantic slot from the current authoritative conditions and immutable business target. Two request IDs cannot create another amount/approval in that slot. UNKNOWN operations also fence later nonce projections for the same target. Exact original typed payload, network, owner policy revision, nonce, amount, validator/record, fee cap, expiry and local generation are bound into the internal intent. `Submit` persists UNKNOWN before calling the genuine Wallet publisher once. Every retry or restart uses only lookup/reconciliation of that original operation. Missing, malformed and lost responses preserve UNKNOWN, original IDs and first cause. There is no automatic replacement signature or new nonce.

Explicit `Revoke` seals new local dispatch across restart and advances a durable generation; pending metadata loses local authority. Already submitted effects remain pending reconciliation. Old callbacks can record their original result, and read-only reconciliation remains available after revocation. Ordinary process `Close` cancels/waits for callbacks, retires old prepared metadata, advances its generation and preserves UNKNOWN; it allows the next normal local session to prepare new metadata, with original Wallet approval still required for each effect. Reopening also advances the metadata generation and never revives old prepared approvals. Local projection v1-to-v2 migration only adds generation to the slot index, preserving original intent bytes, operation IDs, UNKNOWN, explicit stopped state and first cause.

A known persistent marker plus Unix flock admits only one live writer and releases ownership on process death, so SIGKILL does not permanently brick restart. Every save first checks the original lock inode. Legacy `.owner` directories remain untouched and block automatic adoption; persistence failure keeps the live fd sealed for reconciliation. Restart never automatically signs or sends an intent.

Actual chain readback must match the original native hash, complete canonical Member/action, owner, network domain, payload, nonce and fee. Effects are retained by digest rather than copying balances into a second authority. The result is explicitly `RPC_REPORTED_COMMITTED` or `RPC_REPORTED_REJECTED`, with independent finality false. Parent receipt verification is a separate gate; an RPC report is not independently verified funds state.

The normal parent-owned kernel-credential IPC service calls `Prepare`, `Get`, `Reconcile` and `Revoke`. HTTP receipt tickets gain no authority here. Shared minimum contracts are recorded in `owners/P09/CONTRACTS/P09-05-06.json`; no shared SDK/Auth/Chain schema is changed. The canonical cmd tests use real HTTP fixture services, existing canonical PQ codecs and temporary library signatures only. They do not execute public business or prove a real Wallet publisher.

`Review` and native `participation_review` expose a read-only local summary even
without Wallet: the retained complete intent/bindings, exact original
`ynxauth.Action.SigningBytes()` ACTION/v1 bytes and their SHA256, a fresh comparison
of the original RPC conditions, and the original Main's three DATA input keys
`kind`, `fee`, `payload`. Amounts/fees stay decimal strings, including values above
JavaScript's safe-integer range. Main derives owner/network/nonce from its own
original policy and creates its own UUID; the P09 ID is a local correlation only.
Neither the summary digest, prepared DATA nor kernel UID supplies approval or
independent finality. Review does not write, sign, publish, look up Wallet or
silently replace stale intent/nonce bytes. Expired/cancelled/cold records remain
readable as historical local metadata.

`Cancel` and native `participation_cancel` retire one local entry without revoking
unrelated work. Cancellation during preflight blocks dispatch. Once publication
may have been entered, cancellation preserves UNKNOWN/original ID/first cause,
cancels the local wait, and allows only original-operation reconciliation. Late
results cannot erase the cancellation marker or make that slot available for a
replacement signature. Cold reopen preserves cancellation; a new normal metadata
session can prepare a fresh unsubmitted intent while the old record stays retired.
Cancelling a pending original does not claim to cancel a transaction on-chain.

The original P01 handoff `network-participation-publisher-current-20261101`
clarifies that source `412ed1be` implements internal Native typed custody, not an
external P09 publisher. Current Main refuses stake delegate/unbond/withdraw with
`PQ_TYPED_CLASSIC_ORIGINALS_NOT_SUPPLIED` before review/ID/signing. Its connected
contract prepare/lookup APIs accept only contract deploy/execute. The required
protected staking witness, trusted Network admission and stable original-operation
publisher/lookup ABI remain original Wallet-owned CODE. Normal assembly therefore
keeps `wallet=nil` and `walletHandoffState:NOT_SUPPLIED`; no IPC transport or Main
UUID is guessed. Native PQ vote kind/executor remains a separate original Core
gap; Ed25519 registry data never supplies that operation.
