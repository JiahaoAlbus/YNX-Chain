# Faucet durable admission v1 — candidate integration contract

Status: source candidate, **not enabled on public Testnet**. Public Faucet writes, signing and broadcasts remain frozen until the coordinated Core, Faucet service and client release is verified. This document does not grant a production mutation authorization.

## One intent, one retained request ID

Before the first submission the client generates at least 128 random bits, encodes a 32–128 character ID using ASCII letters, digits, `_` or `-`, and durably stores that ID with the recipient and whole-YNXT amount. Send `POST /request` or `/faucet` to **ynx-faucetd**:

```json
{"requestId":"req_0123456789abcdef0123456789abcdef","address":"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80","amount":100}
```

This is a non-production example. The service accepts the corresponding `0x7e5f4552091a69125d5dfcb7b8c2659029395bdf` address as the same recipient. Owned user interfaces display `ynx1`; the chain transaction retains its canonical EVM-compatible account field. Units are whole YNXT, not wei.

Clients should explicitly save the resolved amount. An omitted amount uses the service default only for a new admission. For an already admitted ID, omission retains the original admitted amount even after the default or maximum changes. An explicit different recipient or amount returns `409`. A changed IP does not turn a matching existing ID into a new request or charge a second quota.

The legacy request body without an ID is accepted for compatibility and receives a server-generated random ID. It cannot make a lost HTTP response safely retryable for a client that never received the ID. Do not implement automatic retry by generating another ID.

## Responses and recovery

- `201`: newly admitted request accepted; `transaction` contains the verified receipt, `requestId` and `transactionHash` retain the original intent.
- `200` with `replayed: true`: same admitted request, possibly a previously stored receipt. This is not a fresh balance query or consensus-finality claim.
- `409`, `status: request_id_conflict`: ID conflicts with its stored recipient or amount. Keep the original record and reconcile it; do not silently allocate a replacement ID.
- `429`, `status: rate_limited`: new admission exceeds the configured IP/recipient quota. Existing matching admissions remain retryable.
- `503` with `requestId`, deterministic `transactionHash` and `retrySameRequest: true`: keep exactly that request and investigate/retry only it. A timeout, unknown upstream response, or local receipt persistence failure is not evidence that no funds moved.

Error states include `upstream_capability_unavailable`, `admission_unavailable`, `transaction_result_uncertain`, and `receipt_persistence_uncertain`. None instructs the client to create a new ID. Responses use `Cache-Control: no-store`. No consensus finality or installed-wallet completion is inferred from an HTTP status.

## Core boundary and downgrade behavior

Faucet service checks the read-only `ynx_getFaucetModel` JSON-RPC capability on the configured Core, binding the chain ID, version `ynx-faucet-request-v1`, ID pattern and deterministic hash scheme. It sends the mutation only to the new **Core** route `POST /faucet/requests`, which requires an ID. Core's legacy `/faucet` remains separately compatible. The service never falls back to that legacy route and does not follow HTTP redirects. Thus an old Core that ignores unknown JSON fields cannot silently treat a retried durable request as a new legacy grant.

Successful Core responses must identify the idempotency version and match the expected hash, transaction type, faucet sender, canonical recipient, amount and zero fee. The hash algorithm and vectors remain those of `internal/chain/faucet_request.go` from source 90643ffd38d970f526df99e96e818220330710f8. Chain history must be retained across upgrades and recovery.

## Durable service state and deployment

`--admission-db` / `YNX_FAUCET_ADMISSION_DB` selects the private persistent database, defaulting to `<request-log>.admissions.db`. The existing pinned bbolt dependency provides a single exclusive process lock and synced transactions; concurrent requests within that process share the store. This is not an active-active multi-replica design.

Admission, recipient/amount binding and quota consumption commit before the first Core mutation. Completion stores the validated receipt. Neither an uncertain result nor a full admission registry deletes the original ID. `--max-admissions` / `YNX_FAUCET_MAX_ADMISSIONS` defaults to 100000 retained records; at capacity new IDs fail closed while existing IDs remain readable/retryable. Raising capacity requires an operational resource review; the implementation is not an unlimited-throughput claim.

The initial database imports recent `sent`/`error` quota charges from the existing request log. Malformed/oversized migration logs, wrong chain identity, symlink/non-private/empty existing database files, or a locked database fail closed. Preserve the database and the latest chain state during every deployment; never roll back to an old copy or delete it to clear an error. Legacy requests with lost IDs cannot be reconstructed as new durable requests by this migration.

The BFT signing adapter keeps its existing behavior and explicitly rejects supplied request IDs. Its broadcast recovery is a separate contract and is not certified by these authoritative-Core tests.

## Acceptance still required

Local synthetic tests exercise lost acknowledgements, cold replays, quota and capacity retention, simultaneous duplicates, 32 independent requesters, invalid receipts, old routes/redirects, database failures, default changes and explicit Core ID enforcement. Independent review includes close/reopen/in-flight RPC interleavings. These tests do not demonstrate public Testnet readiness, load SLOs, installed-wallet approvals, or website/native client integration. Public release remains coordinated and frozen pending those checks.
