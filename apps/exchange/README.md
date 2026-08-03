# YNX Exchange

Native Android/iOS client, responsive Web/desktop companion and Go API for the YNX-owned deterministic testnet venue. It does not claim an exchange listing, production custody, external liquidity, public volume, users, counterparties, or third-party prices.

Run locally only with explicit operator configuration:

```sh
YNX_EXCHANGE_ADMIN_API_KEY='replace-with-operator-secret' \
YNX_EXCHANGE_STATE_PATH='.ynx/exchange/state.json' \
YNX_EXCHANGE_INDEXER_URL='http://127.0.0.1:6436' \
YNX_EXCHANGE_CUSTODY_ADDRESS='ynx1...' \
go run ./apps/exchange/server
```

Without both indexer and custody address, deposit is disabled. Cross-chain and `YUSD_TEST` deposit/withdrawal are always disabled. `YUSD_TEST` is a venue-only deterministic test credit, not a token or stablecoin. Operator allocation is audit-recorded through the API-key-protected test-credit endpoint.

The current authoritative chain/indexer transfer API expresses native transfer amounts as integer YNXT units even though wallet metadata exposes 18 display decimals. The indexer adapter explicitly converts each committed integer unit to the venue ledger's fixed six-decimal representation; no floating point value is used in matching or balances.

The native client uses the exact Task 1 Wallet Auth v1 protocol and a P-256 product-device key stored in platform secure storage. Central registration for `ynx-exchange-v1`, the callback and least-privilege scopes remains an external integration request; missing registration/Gateway routes fail closed. The older Web companion session adapter remains compatibility-only and is not described as central Wallet integration. Its account and every order/cancel/withdrawal authorization are bound to the same compressed secp256k1 public key and canonical `ynx1...` address; mismatched keys, compact-signature mutation and replay fail closed.

The backend creates a short-lived deposit intent before accepting a chain transaction reference. Confirmed deposits, test credits, reservations, withdrawal review and matches produce source-digested ledger/audit records. `/v1/config` reports Gateway, registry, custody, indexer and cross-chain status independently; configuration never implies central acceptance.
