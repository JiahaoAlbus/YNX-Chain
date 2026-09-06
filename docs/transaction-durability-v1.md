# Local transaction durability v1

This contract applies to `ynx-chaind` native ledger RPC on `/evm`, with the Ethereum native adapter either enabled or disabled. It covers Ethereum legacy RLP hashes and native signed JSON hashes, including Android's canonical `consensus.SignedTransactionHash`. It proves one node completed a local snapshot file sync, atomic replacement, directory sync and integrity-marker write/sync. It does not prove BFT finality, remote replication, source authenticity, historical replay validity or migration safety.

## Capability discovery

Call `ynx_getDurabilityModel` with `params: []`. The exact v1 object is:

```json
{"version":"ynx-local-durability-v1","scope":"local-snapshot","receiptField":"ynxDurability","transactionStatusMethod":"ynx_getTransactionDurability","nativeTransactionField":"ynxNativeTransaction","minedStatus":"durable","pendingStatus":"pending_durable","consensusFinality":false}
```

`ynx_getFeeModel.durability` contains the same object. The fee-model version remains `ynx-ethereum-native-v1`; that old version alone never implies durability support. A missing method, absent field, unknown version or malformed object is unsupported/unconfirmed, never an implicit success. Both queries are read-only through the mutation-freeze and follower guards. Standard signed submission still follows those mutation guards.

## Transaction state and exact encodings

Call `ynx_getTransactionDurability` with exactly one string transaction hash. All transaction hashes, block hashes and snapshot-integrity values in this contract are exactly `0x` plus 64 lowercase hex characters. Heights and native nonces are strings containing minimally encoded lowercase hexadecimal quantities (`0x0`, `0x1`, ...), limited to uint64. Never convert them through floating-point numbers. Native ledger/block REST may use unprefixed hashes or integer heights; those REST encodings must not be copied into this RPC contract without explicit validation/conversion.

Every state object requires string `version`, `scope`, `status`, and `transactionHash`. Version and scope equal the capability constants above. The remaining exact field sets are:

| status | Further required fields | Meaning |
|---|---|---|
| `durable` | `blockNumber`, `blockHash`, `checkpointBlockNumber`, `checkpointBlockHash`, `snapshotIntegrity` | The complete transaction and mined inclusion are covered by this local completed checkpoint. |
| `pending_durable` | `checkpointBlockNumber`, `checkpointBlockHash`, `snapshotIntegrity` | The pending transaction was locally persisted. It has no mined block fields and is not a mined confirmation. |
| `uncertain` | None; an observed `blockNumber`/`blockHash` pair may appear together | Current transaction or inclusion is not covered by confirmed local persistence. No checkpoint attestation fields appear. |
| `memory_only` | None; an observed block pair may appear together | This process has no persistent data directory. It cannot attest local durability. |
| `not_found` | None | The current node does not observe that hash. This does not prove rejection, absence from another node, or safe replacement. |

For `durable`, mined height is positive and checkpoint height is at least mined height. `snapshotIntegrity` is the authenticated version-2 snapshot integrity digest, including its saved time; it is not a whole-file byte SHA256, a Merkle inclusion proof, or a signature authenticating the server. The checkpoint block identity can advance after later successful writes. The snapshot digest normally changes after a cold constructor re-save even when all ledger values and the mined block are unchanged.

## Receipts and native fields

`eth_getTransactionReceipt` returns null for missing or pending transactions. A mined receipt is returned only with `ynxDurability.status == "durable"`. Its transaction hash and mined block number/hash must exactly match the same fields in the proof. Proof fields are read from one immutable completed checkpoint; the full persisted transaction fingerprint includes amounts, fee, nonce, type, timestamp, logs and block binding. Transaction index and cumulative fees also come from that checkpoint, not a second live-block lookup.

Every mined receipt includes `ynxNativeTransaction` with exactly four fields: `type` (native transaction type string), `amountYNXT` and `feeYNXT` (canonical signed decimal int64 strings), and `nonce` (native uint64 hex quantity). For an ordinary signed transfer these are `type:"transfer"`, positive whole-YNXT amount, `feeYNXT:"1"`, and the native nonce starting at 1. Ethereum wire nonce 0 maps to native nonce 1. Wallets must compare all these values with their own exact signed intent, plus hash/from/to, rather than accepting any well-formed values. The amount and fee are whole native ledger units, never wei.

With the adapter enabled, existing Ethereum `type:"0x0"`, fixed-fee gas/effectiveGasPrice, and `ynxFeeWei` remain available. With the adapter disabled, the old 21000-gas legacy projection is not an exact native fee contract; native JSON consumers use `ynxNativeTransaction` to validate fee/amount/nonce. `GET /txs/{hash}` and `eth_getTransactionByHash` remain observed-state reads. They do not replace a durable mined receipt.

The v1 parser must reject unknown or missing fields inside `ynxDurability`, `ynxNativeTransaction`, and the exact capability object. Unknown fields on the outer JSON-RPC or standard receipt object may be ignored. Reject wrong types, noncanonical encodings, unknown status/version/scope, partial block pairs, checkpoint fields on uncertain states, lower checkpoint height, conflicting hashes/heights, and intent mismatches. The bundled JSON Schema specifies structure; bindings, uint64/int64 range and comparisons with the signed intent remain semantic checks.

## Errors, retry, and Wallet outbox

A mined but unconfirmed receipt returns JSON-RPC error `-32002` and no receipt result. `data.status` is `transaction_durability_uncertain`, `data.transactionHash` is the original hash, `data.durabilityVersion` is the v1 constant, and `data.ynxDurability` is the matching uncertain state. A memory-only mined query returns `-32004`, status `transaction_durability_unavailable`, and matching `memory_only` proof. Invalid hash/arity returns `-32602`.

If an already admitted identical signed transfer cannot checkpoint its current inclusion, replay returns `-32002` with the same structured uncertain data. Native REST uncertainty remains HTTP 503/no-store and exposes the same fields at top level. A replay success returns its normal hash/result, not a mined confirmation: it may have persisted only a pending transaction. Continue querying and clear the Wallet outbox's mined-pending state only after a fully validated durable mined receipt. `pending_durable` means locally stored and awaiting inclusion, never terminal completion. Retain the original signed bytes/hash across app restart; do not replace an uncertain transaction, alter nonce, or sign another copy to hide the ambiguity.

The runtime publishes a checkpoint only after all durable-write steps succeed. A replacement or rebase withdraws old evidence before writing, so receipts can temporarily be uncertain during checkpoint I/O, and a failure conservatively leaves evidence unavailable until the next successful checkpoint. Same-request replay checks the complete checkpoint fingerprint, including mined inclusion, for ordinary signed transfers, native DEX actions and Resource Sponsor idempotent actions. Replays do not debit twice. Cold byte loading alone does not attest fsync; the normal constructor's successful re-save establishes this process's evidence. Out-of-process mutation of the data directory and filesystem/hardware durability violations are outside this software contract.

## Verification and release

`receipt_durability_test.go` exercises admission-marker, block-before-rename and block-marker failures, exact replay, independent cold copies, native signed JSON and Ethereum hashes, disabled/enabled adapter, memory-only rejection and frozen follower reads. `transaction_durability_test.go` exercises the in-flight producer boundary, four concurrent checkpoint writers, full same-hash transaction fingerprint mismatch, cold read without re-save, and DEX/Resource Sponsor mined replay. No production transaction is used.

This revision does not change snapshot schema, balances, lots, source signatures or execution/fee semantics. It changes which RPC responses qualify as local confirmation. A previous candidate binary lacks this contract. Public rollout requires newly frozen source/binary hashes and consumer integration; old fee model, old successful tests, `status:0x1`, or a replay hash cannot establish compatibility.
