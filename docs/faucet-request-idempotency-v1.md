# Faucet request identity and local durability

This candidate adds Core request deduplication. It is not deployed and does not
yet complete the public Faucet service or Wallet/UI request workflow. Public
Faucet POSTs and transaction broadcasts remain frozen during integration.

Before first submission the client must create and persist a request ID with at
least 128 random bits, together with its chain ID, normalized recipient, integer
YNXT amount, and expected transaction hash. The ID uses 32–128 ASCII characters
matching `^[A-Za-z0-9_-]{32,128}$`. It is retained for every identical retry.

`ynx_getFaucetModel([])` advertises `ynx-faucet-request-v1`, the chain ID, hash
scheme, retained-history scope and local durability model. It is read-only and
remains available on frozen followers; a mixed batch containing a mutation is
still rejected. An older server missing this model must not be treated as
supporting safe request retries.

The hash is `0x` plus lowercase hex SHA-256 of the following UTF-8 bytes, with a
NUL byte after **each** field, including the final field:

```
ynx-faucet-request-v1\0<decimal chain ID>\0<request ID>\0
```

For chain `6423` and ID `req_0123456789abcdef0123456789abcdef`, the independently
computed hash is
`0x639126c01ca5f10e55e3fc2a2db5d1522fd176e78b24cc9292bda0d405d90fa7`.

Core `POST /faucet` accepts `address`, `amount`, and optional `requestId`. With a
request ID it returns the existing transaction JSON shape, HTTP 201 for a new
admission, HTTP 200 for the same accepted request, and HTTP 409 for the same ID
with a different recipient or amount. The
`X-YNX-Faucet-Idempotency: ynx-faucet-request-v1` header identifies this handler.
The accepted transaction binds type `faucet`, sender `ynx_faucet`, recipient,
amount, and zero fee. Its nonce comes from the faucet account and must not be
assumed to be zero universally. This protocol is separate from signed BFT
faucet transfers and the ordinary native-transfer fee model.

A snapshot failure before replacement restores accounts, lots, and pending
transactions. A failure after replacement retains the accepted transaction and
returns HTTP 503 with `status=transaction_durability_uncertain`, `requestId`,
`transactionHash`, and `ynxDurability`. An exact repeat only confirms the same
transaction checkpoint; it never credits again. The retained pending/block
history preserves ID-to-payload binding across restarts. No idempotency record
is silently expired. Future history pruning must preserve this binding.

An HTTP ACK or a pending checkpoint does not prove durable mined inclusion.
Consumers must query the original hash and validate the complete Faucet receipt
profile and `ynx-local-durability-v1` proof. If the result is unknown they must
retain the original intent, never replace it with a new ID automatically.
Local snapshot durability is not consensus finality.

Legacy calls without an ID retain their existing shape and gain pre-replacement
rollback. They do **not** gain retry idempotency; the capability explicitly says
`legacyRequestSafeRetry=false`.

Remaining integration: the Faucet service must persist admission and rate-limit
reservations before upstream submission, preserve the original ID and hash on
network loss/cancellation/restart, verify upstream capability and response
identity, and avoid holding global locks during network calls. Wallet and Web
clients must persist their intent before POST. BFT mode needs an independent
stable signed-payload strategy. Those steps are not supplied by this Core-only
change, and all related public acceptance claims remain false.
