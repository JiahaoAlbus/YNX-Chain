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

The native client uses the exact Wallet Auth v1 protocol and a P-256 product-device key stored in platform secure storage. The exact `ynx-exchange-v1` client, callback, bundle and five least-privilege scopes are approved for public-Testnet Wallet sessions. Session completion and every account read use fresh proof-bound requests; bearer-only authentication is rejected. Protected order, cancel and withdrawal actions still fail closed until the Wallet-reviewed product-action contract is deployed and attested. The Web companion remains a public read-only terminal and never accepts pasted or browser-stored bearer tokens.

The backend creates a short-lived deposit intent before accepting a chain transaction reference. Confirmed deposits, test credits, reservations, withdrawal review and matches produce source-digested ledger/audit records. `/v1/config` reports Gateway, registry, custody, indexer and cross-chain status independently; configuration never implies central acceptance.

## Durable state and horizontal scaling

`YNX_EXCHANGE_STATE_PATH` is a local JSON snapshot backend for development and isolated fixtures only. Its `/health` and `/version` responses explicitly report `stateBackend: "file_snapshot"` and `multiInstance: false`; it must not be deployed as a horizontally scaled venue.

For a multi-instance deployment, set `YNX_EXCHANGE_DATABASE_URL` to the operator-provisioned PostgreSQL DSN. The service creates its own `ynx_exchange_state` table, refreshes the durable snapshot at the API boundary, and saves mutations with revision compare-and-swap. A concurrent update returns a conflict instead of silently overwriting an order or idempotency record. The database endpoint and credentials are runtime-only configuration and must never be placed in Web assets, release evidence, or logs.
