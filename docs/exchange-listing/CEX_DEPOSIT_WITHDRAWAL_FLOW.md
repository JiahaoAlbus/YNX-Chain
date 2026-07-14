# CEX Deposit Withdrawal Flow

## Deposit

1. Store one canonical lowercase `0x...` account; `ynx1...` is a checksummed display/query representation of the same 20-byte account. No memo or tag is used.
2. Observe committed blocks and indexer continuity. Match transaction recipient, amount, hash, block hash/height, and successful receipt.
3. Treat duplicate observations of the same hash as idempotent. A block identity mismatch, observed reorg, or excessive indexer lag must pause crediting.
4. The package uses two confirmations only for deterministic fixtures. The production credit threshold is intentionally unset and requires independent operations/risk approval.

## Withdrawal

1. Allocate the next sender nonce from authoritative state and construct `ynx-native-json-envelope-v1` for chain ID `6423` with fee `1` YNXT unit in the current bounded runtime model.
2. Sign outside the online package with approved production custody. Test vectors contain deterministic public test signatures and no production private-key material.
3. Broadcast canonical JSON to `/transactions/broadcast` or its `0x`-hex bytes through `eth_sendRawTransaction`.
4. Require the returned hash to equal the locally derived canonical envelope hash, then monitor block inclusion and receipt identity. Exact replay is safe; changed nonce reuse must fail.

The current public authoritative release does not yet expose the complete candidate broadcast/history/nonce behavior. Deposits and withdrawals must remain disabled until the exact candidate release, custody controls, confirmation policy, rollback procedure, and public evidence are approved.
