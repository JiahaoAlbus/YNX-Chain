# Target ABCI Whole and PQ Action integration plan R1

Owner: consensus_pq. Production tree: `/Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain`. This plan was prepared from the actual source at `fe834639a01572212fb5903cc988d3e15c85a628`, the local CometBFT v0.38.23 module, and the subsequent parent-reported Run8 success at `69e788b4bd726689ea5d1709fd5ba0162c6ec0da`. No local Go compile/test or service was run. Only this document was written during the inventory phase.

## First executable slice and ownership

Implement **Whole transfer admission first**, retaining the source's partial-business-success semantics. Authentication of the complete Whole is all-or-nothing; business execution is per member in canonical index order. A failed member changes nothing and later members run against the last successful candidate. A batch with no admitted members produces no committed business state or stored proof. A batch with admissions stores exactly one complete proof and the immutable outcome for every index in the same committed state as all admitted effects. Do not reinterpret this as an all-or-nothing business batch.

Minimum Whole write set, after the frozen baseline is released:

| Path | Required change |
|---|---|
| New `internal/consensus/account_batch.go` | Strict Whole transport, private verified-batch lifetime, typed immutable proof/result record, per-member execution, clone/coverage/continuation/query helpers |
| New `internal/consensus/account_batch_test.go` | Genuine Whole signatures/dual trees, partial outcomes, nonce sequence, isolation, current/historical policy, canonical bounds and hash identities |
| New `internal/consensus/account_batch_state_test.go` | Real ABCI proposals/finalization/commit/restart, source duplicate protection, rehashed omission/rewrite and receipt coverage |
| `internal/consensus/account_policy.go` | Recognize batch references in PQHistory and validate them once through their complete proof instead of decoding N fabricated Member wires |
| `internal/consensus/action_transaction.go` | Explicit Whole type and type-specific size boundary; classic bounds remain unchanged |
| `internal/consensus/application.go` | Route Whole; carry/clone the proof map; actual result data and read-only batch query; overflow-safe transfer candidate checks |
| `internal/consensus/state.go` | One optional proof map inside existing CommittedState/hash document; initial/sealed clone, validation, record-presence and backward-compatible absent-field behavior |

No second balance ledger, reconstructed Devnet executor, classic private key or synthetic signature is needed. Source `Runtime.PQBatches` remains immutable source evidence; the new target proof map is an additional proof collection inside the existing committed application state, not an alternative ledger. Root owns BFT gateway/API and deployment configuration closure. New validator signing/fork work is separate.

## Current public codec and trust primitives

`ynxbatch.DecodeWhole`/`EncodeCertificate` and `Verifier.VerifyWholeBatch` (`internal/ynxbatch/codec.go:331`, `verify.go:212`) validate the original wire, both actual signatures and both rebuilt message trees. `ynxauth.DecodeTransfer` and `DecodeAction`/`DecodeActionPayload` validate canonical signed messages and numeric bounds. The target must reuse these rather than create another signing domain or JSON substitute.

The verifier's resolver closes over the complete trusted candidate AccountPolicy and calls `State.TrustedRegistration(owner, TRANSACTION, actualHeight)`. It must never derive `Enabled:true` from certificate-supplied keys or bare `PolicyAt`. A private target batch value can only be constructed after complete verification, remains local to that admission, and cannot be supplied through a request boolean/callback. It owns the original decoded Whole and verifier. Each member refreshes TrustedRegistration at the actual execution height and compares the exact original full key/revision identity before applying effects. Discard/clear it at admission end. A later transaction must authenticate its own batch against its then-current candidate; no handle crosses proposal calls, commits or restarts.

The source pattern is `internal/chain/pq_batch.go:102,138,199`. Its admission helpers are private and cannot be called from consensus. Reusing the existing public crypto/codec primitives with a private target executor avoids exposing an unchecked authorization capability or duplicating cryptography. New-key Whole proofs inside migration remain possession proofs only; they do not acquire current transaction authority. Validator proposal/vote signing is not part of this transaction path.

## Whole transport, identities and exact outcomes

Use a distinct canonical transport type (planned `pq_whole`) carrying the exact original Whole bytes. Keep lower-hex canonical JSON and reject unknown/duplicate/trailing/noncanonical fields. Bound the raw proof by the existing source `chain.MaxPQBatchBytes` (8 MiB) as well as protocol bounds and derive the outer JSON limit with checked arithmetic. The existing `MaxPQTransactionBytes = 2*MaxMigrationBytes+256` cannot simply be reused for every Whole. Do not increase classic transaction or action limits as a side effect.

Three identities are explicit:

1. Actual Comet transaction: `SHA256(canonical outer Whole JSON)`; exactly one Comet TxResult.
2. Batch proof: `0xSHA256(original complete Whole bytes)`.
3. Member business receipt: the existing exported `chain.PQBatchTransactionHash(batchHash,index)`, i.e. `0xSHA256(E("YNX-NATIVE-BATCH-MEMBER/v1", rawWholeHash, U32(index)))`.

The N business receipts must not reuse the one outer hash: current `BFTNativeTransfer` and fee-event insertion would collide. Each admitted receipt and fee event uses its original native member identity; the shared proof also binds the one actual outer Comet hash. Return explicit batch/outer/member identities and every member result through `transactionExecution.resultData`. These are N business outcomes from one Comet transaction, not N invented Comet transactions.

Persist the original Whole once, original execution height, original outer hash and all ordered outcomes. Each admitted target PQHistory entry has only the native member identity and canonical `ynx-pq-batch-member-v1:<batchhash>:<index>` reference plus actual execution fields/time. No certificate is duplicated N times and no Member inclusion proof is fabricated. Initial executor coverage is native transfers; unsupported action messages in an otherwise authenticated Whole are rejected business members, as in the source transfer-only SubmitPQBatch. Later support must never rerun a historically rejected index.

Before execution, inspect both target proof history and immutable source Runtime.PQBatches. Resubmitting a previously committed Whole must not retry its earlier rejected members after balances/nonces change. ABCI rejects it as already executed; read/query reconciliation returns its original result without fee or nonce effects. An all-rejected, never-persisted source attempt has no receipt promise. This matches the source distinction between an ephemeral rejection and a committed partial batch.

CheckTx/PrepareProposal/ProcessProposal use detached candidates and cannot write committed state. Every member receives its own clone of every mutable branch it may touch; failure discards only that member clone. FinalizeBlock appends successful effects in order and one complete proof. Commit persists the single resulting application state. A failed durable save does not convert an uncommitted result into durable success. No per-member file or partial external write is introduced.

On restart and seal, verify one complete proof against its original height; verify result count/order and bounded errors; bind every admitted member to exactly one matching transaction, native receipt and fee event; require rejected members to have none. Rebuild the outer canonical JSON and compare its stored actual Comet hash. Reject orphan proof/receipt/ref, wrong index/hash/height, changed results, omitted policy or changed Whole bytes. Live continuation compares the prior immutable proof map and PQHistory prefix. Historical verification must remain valid after a later terminal tombstone, while new admission resolves current policy per member.

## Transfer accounting: preserve explicit existing semantics

The source `devnet.go:1103-1155` and target `application.go:657-705` both move **amount lots only**, debit amount+fee, credit receiver amount and validator fee, consume one nonce and increment bandwidth once. Neither ordinary transfer path currently moves fee lots. Revocation and native DEX have different explicit fee-lot semantics. Do not silently add fee-lot movements to old transfer history or pretend source and target already use universal lot conservation against liquid balance.

Target transfer differences requiring narrow source-backed treatment:

- The source `validateTransferCreditsLocked` performs credit overflow checks; target credits and `moveTraceableLots` currently lack equivalent receiver/fee/lot overflow guards. Add preflight net deltas accounting for sender/receiver/fee aliases, and lot overflow checks on the detached candidate before mutation.
- Source transfer LastInbound is the actual receiver address; target currently writes the transaction hash. Whole execution must preserve a clearly identified target rule, and the difference must remain explicit in tests/documentation. This is trace metadata, not permission to alter immutable source records. Do not silently rewrite pre-existing source LastInbound values during import.
- Current target Member history omits a LotFlows receipt although its account lots move. A new Whole record can bind exact native transfer fields and the resulting standard native/fee receipts without inventing source logs. If adding an actual target lot receipt, compute it from real preflight movement, make its format explicit, and extend the target validator; do not forge source system logs.
- Self-send and sender-as-fee-recipient must reconcile aggregate account deltas, nonce, bandwidth and lot maps without intermediate overflow or partial updates. Test insufficient amount/fee/lot, maximum nonce/usage/recipient balance, failing middle members followed by a legal next nonce, and exact state equality on rejected candidates.

## Non-transfer Action: actual compatibility map

The canonical native binary Action currently supports stake, delegation, rental and eight DEX kinds (`internal/ynxauth/action.go:18-40`). It does **not** encode sponsor pool mutation, sponsorship, contract call/deploy, Pay, AI, Trust or governance actions. Those cannot be enabled by wrapping an arbitrary old JSON action in a PQ transport.

| Source native Action | Existing ABCI behavior | Required integration |
|---|---|---|
| `stake`, Fee=0 | No supported stake action. Resource validator requires stake = imported stake + target delegations only (`resource_state.go:211-231`) | Real typed stake executor: move liquid to staked, increment compute as source, consume signed nonce once, preserve source lot convention. Add authenticated stake receipt coverage to expected-stake validation; not a fake delegation |
| delegate, Fee=0 | Legacy target delegate charges Fee=1 and bandwidth+1; preflight hard-codes SignedActionFeeYNXT (`resource_application.go:43-55`) | Use native fee/usage rules explicitly, retain exact policy/request hash, signer=provider, beneficiary stake/capacity, live idempotency and source import collision checks |
| rent, Fee=0 | Legacy target rent charges Fee=1 and bandwidth+1; source applies signed quote/settlement with zero transaction fee | Recompute genuine quote from committed policy, exact signed expiry/max price and actual block time; charge price once, split provider/protocol income with alias-safe arithmetic, preserve sponsor-reserved resource floor; consume nonce once without extra bandwidth fee |
| DEX eight kinds, Fee=1 | Similar arithmetic and issuer/pool checks exist; target charges fee first without fee lots; source does business then fee+lot and rollback | Factor pure business executor, isolate accounts/assets/balances/pools/shares/events, reserve/preflight fee, execute deterministic business, then exact source fee lot movement and nonce/bandwidth once. Retain deadlines/slippage/issuer authority and actual logs/events |
| sponsor/contracts/Pay/AI/Trust | Classic typed handlers exist, but the native PQ Action codec has no such kinds | Protocol/schema extension with complete typed signed inputs and independent tests is required before routing; retain current fail-closed behavior |

Native Action Member admission supports any legal N/index and verifies `TRANSACTION` purpose through the same full current policy. Native resource/stake Fee must remain 0; DEX Fee must remain 1. Existing `SignedApplicationAction.ValidateBasic` requires a compressed classic public key and the old fee/unit schedule (`action_transaction.go:266-317`). Do not manufacture this type with an empty signature or synthesize/sign a classic envelope to call its executor.

Introduce a private typed execution request after real authorization, containing actual owner/nonce/fee/kind, decoded typed payload, original proof reference and separate native/outer identities. Existing classic admission may adapt into the same business executor only after its own real signature/policy check. Keep authentication at the entrypoints and effect logic shared; do not add an exported `verified bool` or a user-selectable fee mode.

`applyDexAction` currently mutates shared slice/map backing storage after `chargeApplicationAction` without an entry clone (`dex_action.go:255`), so failure can affect a sibling candidate. Detach all affected branches before reusing it. Resource and contract handlers have narrower clones, but their hash/fee/nonce and request assumptions still require explicit refactoring rather than a superficial call-through.

## Action proof/objects/history interfaces to share

Existing `chain.SubmitPQAction` (`pq_action.go:28`) is a locked wall-clock Devnet mutation and must not run inside ABCI. Existing `encodePQActionMemo`/`decodePQActionMemo` bind `E(original MemberWire, canonical execution policy JSON)`; delegate/rent carry the complete original policy, other kinds carry an empty second field. `pqRentalQuote` uses the signed expiry plus supplied execution time. These are useful pure pieces, but currently private.

The crypto owner confirmed there is no additional frozen public Action helper. A later explicitly assigned extraction should expose pure typed memo decoding/encoding, resource object/income identity functions and history's proof/execution-field/quote core. Keep native source system log/BlockHash/position validation in its own snapshot layer. Current `validateHistoricalPQAction` invokes source system-log checks and cannot be passed an invented pending transaction to bypass those checks for BFT history.

Resource IDs also differ: source PQ object IDs bind complete network+owner+kind+idempotency key; target legacy IDs derive from the outer tx hash. Source protocol-income label is `protocol-resource-fee`; target legacy label is `resource-protocol-fee` (`resource_application.go:141`, `resource_state.go:183`). Source PQ fields `PQTransactionHash` must survive imports. Use explicit PQ projection/validation preserving native IDs and labels, not silent renaming. Genuine new target signer/H/tx/audit metadata is lawful because it is produced by new execution; existing source records remain under their source anchor without manufactured signatures or quotes.

Idempotency must check both target records and source PQ history/object IDs. The same key/body returns or reconciles the original completed result without consuming another nonce/fee; a conflicting body is rejected. The target cannot accept a source-completed idempotency key simply because its legacy target index is empty. Preserve the actual source quote body when PQ history proves it, while old source rental records without that proof still have no invented quote.

The resource validator must reconcile each new PQ action's original Member/native identity, object, quote when applicable, income, event/idempotency and nonce; later revocation is checked at original H for history and current H for new execution. Stake effects should be derived from authenticated receipts in the same committed ledger, not duplicated into a second authoritative account map.

## Action stages and later write sets

After Whole is proven, the smallest additional implementation is native **stake Member** with a typed `account_action.go` executor/proof history validator and focused tests. It needs `account_policy.go`, router, `application.go`, `state.go`, and `resource_state.go` for honest stake reconciliation. It must not claim all non-transfer Actions from this first kind.

Delegate/rent add `account_action_resource.go/test`, explicit shared pure helper extraction by the chain owner, and changes in `resource_application.go`, `resource_state.go`, `migration_resource_market.go/query` for native identities/labels, imported idempotency and signed quote recovery. DEX adds `account_action_dex.go/test` and a safe refactor of `dex_action.go` plus existing fee/trace helpers. Tests must compare real admitted source-native and target effects under equivalent policy/time, plus target restart and failure isolation. Old records remain byte/provenance compatible.

Contract PQ support is a later protocol slice. It must sign complete address/calldata or source/code/constructor data plus request/idempotency/fee/resource decisions; then invoke the existing real bounded runtime with the actual PQ owner, retain imported address/storage/source anchor and generate actual new receipts/logs. No constructor rerun for imported contracts, fake successful receipt, arbitrary JSON escape hatch or signer substitution is permitted. New codec changes require shared SDK vectors, not a consensus-only domain pretending to be the existing protocol.

## Transport and deployment closure outside the first executor patch

Current production/network generators use Comet defaults (`production.go:268`, `network.go:166`). The actual v0.38.23 module defaults are mempool MaxTxBytes=1,048,576 (`config/config.go:799`), RPC MaxBodyBytes=1,000,000 (`:448`) and block MaxBytes=22,020,096 (`types/params.go:99`). Source Whole's 8 MiB raw bound is not currently end-to-end reachable through canonical hex JSON, and JSON-RPC base64/HTTP overhead adds another expansion. Do not report full-size wire acceptance because a direct ABCI call succeeded. Type bounds, mempool/P2P batch behavior, RPC body/header/response limits, proposal block budget and upstream ingress must be aligned in a separate reviewed configuration/transport slice or report an explicit smaller supported deployment bound.

The existing BFT gateway transfer/resource routes cap bodies at 16 KiB and demand classic envelopes (`bftgateway/gateway.go:620`, `resource.go:15`). Its block mapper returns one native transaction per Comet envelope and knows only old native/Action formats (`gateway.go:555`). Root must add PQ submission and parent/member mapping/query/readback without claiming N Comet transactions. POST transport is preferable to expanding Whole JSON again inside the current GET hex query. The gateway's 4 MiB response read bound also needs explicit treatment for large block/proof queries. These are acceptance gates, not authorization to deploy.

## Minimum real verification matrix

- Genuine N=1/2/4 and maximum supported deployment N, separate broken-A/broken-B signature and either tree-root/message mutation, wrong network/purpose/full key/revision/current tombstone, malformed/canonical/overbound wire.
- First success, failed middle member, later legal next nonce: exact same partial decisions and amounts as source SubmitPQBatch; all-rejected makes no persisted proof; same full proof replay never retries old failures.
- One actual outer hash, original Whole hash, exact derived member hashes; complete shared proof once; accepted receipt+fee coverage and no rejected receipt. Source batch resubmission after migration cannot replay its failed indexes.
- Snapshot candidate before/after CheckTx, PrepareProposal, ProcessProposal and failed member, including accounts, lots, policy, native/fee receipts and nested slice backing storage. No rejected-path alias mutation.
- Successful finalize/commit/restart with byte/hash-stable history; current H+1 tombstone rejection and original-H history acceptance; omission/rewrite/orphan/history-prefix attacks rejected after outer rehash.
- Action stages add source-equivalent Fee0/Fee1, nonce/compute/bandwidth, stake/escrow/settlement conservation, quote TTL/max price, sponsor reservation, duplicate/conflicting idempotency, DEX partial failure and expired/slippage/issuer cases, real bounded contract effects only after the codec exists.

Tests and source completion are distinct from Comet-network/public gateway/readback acceptance. No throughput, fork compatibility, consensus PQ activation or public cutover claim follows from this plan.
