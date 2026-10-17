# PQ batch admission and receipt contract, source revision R1

This document freezes application framing and public response fields. The code
is a source candidate: no Go compile, execution or deployment is established by
this document. The YNX-BATCH/v0.1 cryptographic wire remains unchanged.

The first fixed pre-batch CI run `39055064993` passed the three Go cryptographic
and account-authorization packages; its ledger/API recovery tests failed. That
result does not validate the new batch and receipt implementation in this file.

## Submission and identity

`POST /transactions/pq/broadcast` accepts a canonical MemberWire. Its certificate
may have any legal protocol size: powers of two from 1 through 1024. One member
still has independent account nonce, balance and fee admission.

`POST /transactions/pq/batches/broadcast` accepts one canonical WholeWire with
`Content-Type: application/octet-stream`. The total request wire is limited to
8 MiB before decoding; the protocol's existing message, aggregate and N bounds
also apply. Every message is a complete unchanged `YNX-NATIVE-TRANSFER/v2`.

The batch identifier is lowercase `0x || hex(SHA256(originalWholeWire))`.
For zero-based member index `i`, its transaction identifier is:

```
0x || hex(SHA256(E(
  UTF8("YNX-NATIVE-BATCH-MEMBER/v1"),
  SHA256(originalWholeWire),
  U32(i)
)))
```

The second field is exactly 32 raw bytes. E uses the original protocol's four
byte big-endian field count, followed by four byte lengths and exact field bytes.
U32 is four byte big-endian. Field order and the domain above are fixed.
`chain.PQBatchTransactionHash(batchHash, i)` implements this application identity.

The existing Transaction DTO retains its original shape. Its Memo is the exact
string `ynx-pq-batch-member-v1:<batchHash>:<canonical decimal i>`. It does not hold
a copy of the certificate or WholeWire. A standalone member's transaction hash
continues to be SHA256 of its original MemberWire, rather than this batch-member
identity. Nonce rules prevent a member admitted through one route from spending
again through the other.

Independent Node identity-codec vectors for an all-zero 32-byte batch digest
(not a valid authenticated WholeWire) are:

| Index | Expected transaction hash |
| --- | --- |
| 0 | `0xc3734379b242cee7e34589669a060798062b01f809b6b749af0ad0ee7c6652c9` |
| 1 | `0x6754ab3d53902b48068d49f9d0974b8e1f8125f3399830b9f4da66c809b6a6bf` |
| 1023 | `0x2e976c0c8997192623c73de89594605ac8d1c1d6d9dabbc48a41deb65950d53d` |

## Business outcome and durability

Both fixed signatures and complete dual trees are verified once for WholeWire.
Each member then checks current full trusted network, owner, algorithm, both
public keys, revision, activation and complete execution fields under the ledger
lock. Its business admission observes earlier successful members in index order.
A rejected member does not consume a nonce, balance or fee and does not stop the
remaining members. This is not atomic business execution.

If at least one member succeeds, the successful mutations and one immutable
shared proof record use one durable checkpoint. A failure before state rename
rolls back all of this request's successful mutations and the record. A failure
after rename retains all successful mutations and the original result vector as
UNKNOWN. Retry uses the identical original WholeWire, confirms that checkpoint,
and never executes previously rejected indices. A fully rejected request writes
nothing and makes no durable replay promise.

The response has `batchHash`, `wireHash` (the same original WholeWire identifier),
`executionHeight` (decimal string), `status`, `replayed`, and `results`.
Status is `durable`, `memory`, `uncertain`, `not_committed`, or `rejected`.
`durable` means this node completed its existing local checkpoint, not BFT finality
or block inclusion. `memory` is used for an in-memory ledger with no data directory.
Persistence failure is HTTP 503 with `Cache-Control: no-store`; cryptographic or
structural rejection is HTTP 422; an ordinary partial business result is HTTP 200.

Each result contains:

- `index`: a safe JSON integer in 0..1023, bound to the original message index.
- `outcome`: `admitted` or `rejected`, separately from outer durability status.
- `transactionHash`: the domain-separated identifier for an admitted member;
  empty for a rejected member.
- `error`: a bounded business rejection reason, empty for an admitted member.
- `batchHash` and `wireHash`: the original complete WholeWire identifier.
- `decimalFields`: string values `amount`, `fee`, `nonce`, `executionHeight`.

If a committed message is not a canonical application transfer, it is a rejected
business member. No amount/fee/nonce values are fabricated for it; its
`decimalFields` contains only `executionHeight` and its hash/index remains bound.

New standalone PQ transfer and migration responses also retain `transaction` and
add `wireHash` plus `decimalFields`. Amount, fee, nonce and transaction execution
height are generated from Go integers as decimal strings. Migration additionally
includes revision and activationHeight strings. This includes UNKNOWN responses.
Legacy numeric Transaction fields must not be used to reconstruct large integers
in JavaScript. Migration's existing top-level executionHeight describes the
current policy query; `decimalFields.executionHeight` describes the original
transaction, including on a later replay.

## Shared history and limits

Snapshot v3 includes optional `pqBatches`, keyed by the batch identifier. Each
record is `PQBatchProof{whole, height, results}`. It contains exactly one immutable
original WholeWire and the original complete result vector. Results here contain
only index, outcome, transactionHash and error; API decimal projections are not
duplicated in persisted history.

History checks verify each shared Whole once and check three directions: every
admitted result has exactly one matching historical or pending transaction at
the original execution height; every referencing transaction has its complete
shared proof; every rejected result has no referencing transaction. Replication
continuation rejects removal or rewriting of an existing Whole, height or result.
Complete snapshots, restart and the full consensus-runtime snapshot boundary all
use this validation. Partial replication state defers transaction coverage until
it is combined with history, before durable replacement.

Each shared proof has the 8 MiB wire bound and at most 1024 results. External
snapshot ingestion retains the existing 256 MiB bound before JSON decoding.
Every persisted proof must have at least one admitted member with an actual
transaction, so proof count is bounded by the referencing historical/pending
transaction count. Orphan proofs are rejected. There is no extra global batch
count or raw-proof-byte admission quota that could permanently halt the ledger;
shared history follows the ledger's existing storage lifecycle. It is not an
authentication cache. No pruning or silent proof eviction is performed, and the
one-entry verification cache exists only for the duration of one call.

## Authorization query views

`GET /accounts/{owner}/authorization` reads all values from one lock. Existing
`executionHeight`, `ledgerNonce`, algorithmVersion and activeRevision describe
the next execution height. Records include pending registrations.

Added fields are `policyView: "next_execution"`,
`recordsView: "includes_pending"`, `source: "authoritative_producer"`,
`committedHeight` (decimal string), `committedBlockHash`,
`committedAlgorithmVersion` (`legacy` if none), and `committedActiveRevision`
(decimal string, omitted if none). The committed policy requires registration
and activation heights at or below the returned tip. This producer view is not a
BFT finality claim, signed light-client proof, or independent policy authority.

Consumers must select an operator-trusted node and authenticated transport.
Session challenge and completion each require a fresh query and must fail closed
on query errors or tip regression. Consumers must not treat a cached
next-execution activation as already committed account authority.

## Trusted producer checkpoint projection

The query additionally returns `checkpointStatus` (`durable`, `uncertain`, or `memory_only`), `checkpointIntegrity` and `recordsComplete: true`, under the same ledger read lock. `durable` requires a real persisted data directory, an acknowledged checkpoint at the exact current tip height/hash, a nonempty snapshot-integrity digest and no outstanding persistence error. The integrity string is empty otherwise. The endpoint sets `Cache-Control: no-store`.

`committedBlockHash` and `checkpointIntegrity` are 64 lowercase hex characters without a `0x` prefix. `committedHeight` is a decimal string. `committedActiveRevision` and its full matching record require both registeredAt and activeFrom at or below that committed height. A pending or next-execution-active revision never becomes committed authority merely by being visible in records. `recordsComplete` describes the complete local owner-history projection, not a cryptographic non-omission proof.

The source is the existing authoritative producer ledger, not BFT finality. A consumer must configure and authenticate its normal operator-selected node, bind original network ID and owner, require durable status, recompute the selected committed record from complete history, and perform fresh reads at challenge and completion. Missing fields, timeouts, rollback of height, same-height hash changes, unknown durability or expired challenge fail closed. A higher height alone does not prove ancestry; this interface provides no light-client proof or reorg witness. A consumer that requires stronger consensus evidence must keep admission disabled until such evidence exists. `checkpointIntegrity` is an audit binding to a local snapshot, not a downloadable authorization secret or independent consensus proof.
