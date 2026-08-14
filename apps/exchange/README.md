# YNX Exchange

Native Android/iOS client, responsive Web/desktop companion and Go API for the YNX-owned deterministic testnet venue. It does not claim an exchange listing, production custody, external liquidity, public volume, users, counterparties, or third-party prices.

Run locally only with explicit operator configuration:

```sh
YNX_EXCHANGE_ADMIN_API_KEY='replace-with-operator-secret' \
YNX_EXCHANGE_STATE_PATH='.ynx/exchange/state.json' \
YNX_EXCHANGE_INDEXER_URL='http://127.0.0.1:6426' \
YNX_EXCHANGE_CUSTODY_ADDRESS='ynx1...' \
YNX_EXCHANGE_FINANCE_READ_KEY='inject-the-same-distinct-32-character-secret-as-finance' \
go run ./apps/exchange/server
```

For a multi-instance deployment, set `YNX_EXCHANGE_DATABASE_URL` to a dedicated
PostgreSQL database. The service creates/uses `ynx_exchange_state`, imports an
existing integrity-verified `YNX_EXCHANGE_STATE_PATH` snapshot only when the
database is empty, and guards every transition with an integrity-hash
compare-and-swap. `/api/ready` reports `postgres-cas-multi-instance` only when
that backend is active; the compatible file backend reports
`file-cas-single-host` and must not be advertised as multi-instance.

Without both indexer and custody address, deposit is disabled. Cross-chain and `YUSD_TEST` deposit/withdrawal are always disabled. `YUSD_TEST` is a venue-only deterministic test credit, not a token or stablecoin. Operator allocation is audit-recorded through the API-key-protected test-credit endpoint.

The current authoritative chain/indexer transfer API expresses native transfer amounts as integer YNXT units even though wallet metadata exposes 18 display decimals. The indexer adapter explicitly converts each committed integer unit to the venue ledger's fixed six-decimal representation; no floating point value is used in matching or balances.

The native and Web clients use the current Wallet Auth Product Session protocol and a P-256 product-device key stored in platform secure storage. The exact `ynx-exchange-v1` client, native/Web callbacks, bundle and five least-privilege scopes are approved for public-Testnet Wallet sessions. Session completion and every account request use fresh proof-bound requests; bearer-only authentication is rejected. Spot limit orders, isolated-margin transfers, perpetual limit orders and exact order cancellations use a separate Wallet-reviewed action signature and are re-verified by the venue. Native withdrawals remain a separate unimplemented broadcast gate. Public market data remains usable without login.

The optional `exchange-finance-read-v1` owner endpoint exposes sanitized, account-bound persisted evidence to the Finance server only. It uses a separate timestamped, nonce-single-use HMAC credential injected as `YNX_EXCHANGE_FINANCE_READ_KEY`; this credential is never a Wallet session, never reaches clients and grants no order, transfer, withdrawal or risk mutation. Its exact schema and negative boundary are frozen in `release/integration/exchange-finance-read-contract.json`.

The backend creates a short-lived deposit intent before accepting a chain transaction reference. Confirmed deposits, test credits, reservations, withdrawal review and matches produce source-digested ledger/audit records. `/v1/config` reports Gateway, registry, custody, indexer and cross-chain status independently; configuration never implies central acceptance.
