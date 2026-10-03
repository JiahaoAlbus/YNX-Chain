# Amendment terminal recovery

Inherited baseline: 76a2ae2cbb258149924f8a91a41a3934274e5c9e.

An authenticated exact amendment replay after dead-man cancellation previously returned Forbidden before consulting its durable idempotency record. The regression failed with `exact amendment replay lost terminal effect forbidden`.

The existing order must now exist and belong to the authenticated account before any cached effect is returned. Exact action/digest/order identity reconciliation precedes fresh risk admission. New requests remain forbidden after expiry; changed requests conflict; foreign owners are forbidden. Signature validation is unchanged.

Regression verifies three exact terminal replays, no reserve/order/trade/state mutation, changed and foreign intent fences, fresh request rejection, ledger consistency, and Close/New recovery.

`go test -race ./internal/exchangeproduct -count=1`: PASS, 13.208s. PostgreSQL-only tests retain their environment-gated skips in this invocation; this checkpoint does not claim multi-instance amendment verification.

No shared Wallet/Auth, permissions, storage schema, deployment, public runtime, account approval, signature, or actual testnet trade claim. Ordinary source/test checkpoint only.
