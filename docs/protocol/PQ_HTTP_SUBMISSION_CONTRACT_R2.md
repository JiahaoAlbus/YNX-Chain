# PQ original-wire submission and read reconciliation R2

This is a source contract for the commit containing this document. The previous tested baseline is aa97f102fc72ee89ef3c61b6125256b288694b39 (remote CI 39057017794). R2 adds exact decimal and local-checkpoint fields to the existing GET route; its tests require their own fixed-commit remote CI. Neither source version is evidence of public deployment, account migration, network activation or consensus finality.

## Original request and identity

| Request | Body | Limit |
| --- | --- | --- |
| POST `/transactions/pq/broadcast` | complete canonical MemberWire for a native transfer | 131072 bytes |
| POST `/accounts/{owner}/authorization/migrate` | complete canonical MigrationWire | 262144 bytes |
| GET `/txs/{hash}` | no body; original canonical transaction hash | read only |

POST Content-Type is `application/octet-stream`. Media-type case is normalized and parameters are ignored. The owner in the migration route must normalize to the exact signed intent owner. No JSON/base64 wrapper, new nonce, re-signing, signature replacement or classic cosignature is added by the transport.

For these two POST routes, `transaction.hash`, `transactionHash` when present, and `wireHash` identify `0x` followed by lowercase hex SHA-256 of the entire original binary request. This application identity does not replace either protocol signature/hash branch. The client computes it locally from the saved original bytes and rejects a mismatching acknowledgement. The Whole-batch route has different per-member transaction identities and is outside this two-route Wallet contract.

`nonce`, revisions and heights are unsigned 64-bit values. Transfer amount/fee have unsigned wire encoding but native execution bounds them to signed 64-bit positive amounts/fixed fee 1. Do not advertise successful amounts above 9223372036854775807. Never convert exact integer strings through JavaScript Number.

## POST response

Transfer HTTP 200 is `{transaction, wireHash, decimalFields, replayed, status:"accepted"}`. Migration HTTP 200 is `{transaction, wireHash, decimalFields, replayed, activationHeight, revision, executionHeight, status}`. `replayed` is a boolean and identifies reconciliation of the identical already-admitted bytes, not a second execution.

`transaction` retains the existing native Transaction JSON schema, including numeric amount/fee/nonce/blockNumber and full original history memo. Its numbers are compatibility fields, not a safe JavaScript source of large integer values. `decimalFields` contains decimal **strings** for amount, fee, nonce and executionHeight when the original transaction is present. Migration additionally contains revision and activationHeight; its top-level activationHeight, revision and executionHeight are also decimal strings.

Under v1, migration status is `registered_pending_activation`, `active` or `superseded`. When the terminal-revocation extension is present, an identical historical migration replay instead reports `revocation_pending` or `revoked` for a tombstoned owner; see `PQ_HTTP_REVOCATION_CONTRACT_R1.md`. Unknown states must fail closed. This status describes the account's **next execution** policy. `active` does not prove that the activation height is already committed. Use the account authorization route's separate committed fields for that distinction.

HTTP 503 after uncertain persistence is:

```json
{
  "error": "transaction durability needs confirmation; retry the identical signed request",
  "status": "transaction_durability_uncertain",
  "transactionHash": "0x...original hash...",
  "wireHash": "0x...original hash...",
  "decimalFields": {"amount":"2","fee":"1","nonce":"2","executionHeight":"2"},
  "durabilityVersion": "ynx-local-durability-v1",
  "ynxDurability": {
    "version":"ynx-local-durability-v1",
    "scope":"local-snapshot",
    "status":"uncertain",
    "transactionHash":"0x...original hash..."
  }
}
```

The server text is not authorization for automatic transport retry. Preserve the original bytes, identity, account/network binding and UNKNOWN outcome. A lost response, timeout, parse error, wrong hash or unrecognized DTO is also UNKNOWN. In the current Wallet phase only controlled fixture submission and read reconciliation are authorized; no real account signing or public broadcast is implied.

| HTTP status | Body and meaning at this fixed source |
| --- | --- |
| 415 | `{error:string}`; unsupported content type, no admission attempted |
| 413 | `{error:string}`; bounded body read failed, no admission attempted |
| 400 | `{error:string}`; empty body or malformed/mismatched migration intent/route, no admission attempted |
| 422 | `{error:string}`; protocol, policy, business or known rolled-back persistence rejection for this invocation |
| 503 with the schema above | original mutation may have persisted; retain UNKNOWN |

A 422 does not prove that a preceding UNKNOWN request had no effect, nor does any HTTP status from an unverified intermediary/deployment prove global absence. The error strings are diagnostic text, not stable machine codes or retry instructions.

## Read reconciliation

GET 200 retains the old native Transaction fields **at the top level**, and adds:

- `transactionHash`: exact native transaction hash.
- `wireHash`: present for these original-wire PQ transfer/migration records, equal to the original hash. It must not be inferred for other native or Whole-member transactions.
- `decimalFields`: amount, fee, nonce, executionHeight and blockNumber as decimal strings; migration additionally revision and activationHeight. A pending transaction has blockNumber `"0"`; executionHeight is its next execution height, not an inclusion proof.
- `source:"authoritative_producer"`, `consensusFinality:false`.
- `ynxDurability`: version `ynx-local-durability-v1`, scope `local-snapshot`, status and original transactionHash, with optional checkpoint/inclusion fields described below.

Transaction, execution height and local durability are captured under one ledger read lock. GET does not retry a write, advance nonce, produce a block or resolve an uncertain checkpoint merely because disk conditions have improved. `Cache-Control: no-store` applies to success and absence, and to PQ POST bodies/responses.

| Durability status | Meaning |
| --- | --- |
| `memory_only` | transaction exists in this process without a persistent data directory |
| `uncertain` | exact current transaction fingerprint is not covered by a completed local snapshot |
| `pending_durable` | complete local snapshot contains the pending transaction; no block inclusion yet |
| `durable` | exact transaction and block inclusion are covered by a completed local snapshot |

For pending_durable/durable, checkpointBlockNumber is an exact hexadecimal quantity; checkpointBlockHash and snapshotIntegrity are `0x`-prefixed hashes. When the observed transaction has blockNumber > 0 and a blockHash, `ynxDurability` also has blockNumber (hex quantity) and blockHash, even if that observed inclusion is uncertain. Only the status identifies checkpoint coverage. Durable local inclusion is not Comet quorum finality, replicated acceptance, policy finality or a cryptographic ancestry/non-omission proof.

GET 404 is `{error:"transaction not found", status:"not_found", transactionHash, source:"authoritative_producer", consensusFinality:false, ynxDurability:{version:"ynx-local-durability-v1", scope:"local-snapshot", status:"not_found", transactionHash}}`. It proves only this producer's current lookup found no record. It must not clear UNKNOWN, authorize nonce reuse, prove rejection or trigger replacement signing. An older server's bare Transaction response or bare `{error}` does not satisfy R2 reconciliation; fail closed when exact fields are required.

## Source and verification boundary

Routes and DTOs: `internal/api/server.go`, `pq_authorization.go`, `pq_reconciliation.go`, `transaction_durability.go`. State: `internal/chain/pq_authorization.go`, `transaction_durability.go`; immutable native schema: `internal/chain/types.go`. Real temporary-account tests: `internal/api/pq_authorization_test.go`, `pq_checkpoint_test.go`, `pq_reconciliation_test.go`. The decimal maximum test exercises serialization only; it does not claim a funded MaxInt64 transaction was admitted.

Remote CI must cover both original migration and transfer UNKNOWN → read-only UNKNOWN → explicit identical fixture reconciliation → pending durable → local block inclusion → process reconstruction. No fixture key or balance establishes real Wallet or public chain authority.
