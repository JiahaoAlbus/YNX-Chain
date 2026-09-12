# Atomic native finance snapshot v1

Candidate implementation; public deployment must be verified separately. This
extends the existing authoritative ledger, not the ABCI-v13 gateway or a second
ledger with the same chain ID.

`GET /v1/native-snapshot?account=<0x address or ynx1 alias>` returns one atomic
account/DEX observation under a single ledger read lock. The account parameter
is optional for market-only reads. Unknown or repeated query parameters fail.

- `schemaVersion`: `ynx-native-finance-snapshot-v1`.
- `source`: `authoritative chain-native YNX Testnet state`.
- `chainId`, account balance/staked/nonce/nextNonce, asset supplies, balance
  amounts, pool reserves/totalShares/individual shares and block heights are
  decimal strings. `decimals`, `feeBps`, and array/count metadata remain bounded
  JSON numbers. The account nonce is consumed at admission; the next signed
  action uses current nonce + 1. An exhausted uint64 nonce has `nextNonce:null`.
- `nativeUnit=whole-YNXT`, `evmWeiPerYNXT=1000000000000000000`. Native YNXT has
  zero fractional units in this adapter; ERC-style wei projection is separate.
  This does not implement General EVM or fractional native transfers.
- `account` is null for market-only reads. For a requested canonical account,
  `exists:false` explicitly identifies an absent ledger account; its confirmed
  absent holdings are zero. Transport failure or missing coverage is not zero.
- `assets` contains native YNXT and all registered DEX assets. Account `balances`
  contains YNXT and every registered asset, including explicit zero holdings.
  An orphan balance registry fails with 503 and `coverage.complete:false`.
- `pools[].shares` contains the complete sorted `{account,shares}` array.
  `transactionHash` and `txHash` are equivalent aliases. No LP owner is omitted.
- `events` contains all retained DEX events; `stage` is `pending` or `included`.
  Inclusion does not claim local durability or BFT finality. Events can include
  pending changes already reflected in the current reserves and account nonce.
- `atomic:true` and `stateScope=authoritative-current-including-pending` bind
  the response to one current ledger generation. `blockHeight`/`blockHash` are
  the observed chain tip. Several current-state generations can share that tip.
- `snapshotId` is `sha256:` plus SHA-256 of the canonical Go JSON projection
  excluding snapshotId/updatedAt/asOf. It identifies the projection content only.
  `appHash:null` and `consensusFinality:false` are intentional: this is not a
  consensus state root. `durableCheckpoint` describes the last completed local
  checkpoint independently and must not be treated as proof that every current
  account/pool field has persisted.
- `asOf` equals `updatedAt`: the RFC3339Nano UTC observation time captured while
  holding the same read lock. It is neither a block timestamp nor finality time.
- `coverage.complete:true` describes all requested collections. For a market
  read without account, `coverage.balances:false` makes the unrequested scope
  explicit. Separate legacy REST reads remain separate observations.

`GET /v1/native-transactions/{hash}` rechecks a transaction and its exact local
checkpoint evidence under one lock. It returns decimal-string transaction
integers and status `memory_only`, `uncertain`, `pending_durable` or `durable`.
404 is explicitly `not_found`; an unknown result does not authorize a new intent.
The existing `ynx_getTransactionDurability` RPC remains compatible. Retain the
original signed action/request ID and retry that same intent after a lost ACK.

DEX SignedApplicationAction signatures use secp256k1. P256 Product Session
device proofs are a separate authentication mechanism. Address conversion does
not replace signature verification or delegate transaction authority.

All responses use `Cache-Control:no-store`. Existing `/accounts`, `/dex/*`
and their native `items` response shapes are retained for compatibility; clients
requiring atomicity or exact JSON integers must use the versioned snapshot.
