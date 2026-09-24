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

Finance can read a native `ynx1` account's persisted Exchange balances, orders, fills and fees through `GET /v1/integrations/finance/account`. Configure `YNX_EXCHANGE_FINANCE_READ_KEY` on Exchange and the identical secret as `YNX_FINANCE_EXCHANGE_READ_KEY` on Finance, with the Exchange base URL in `YNX_FINANCE_EXCHANGE_READ_URL`. Keep the key server-side and distinct from admin, Wallet and Quant keys. Without it the route returns 503; absent economic account records return 404. PostgreSQL mode uses a shared nonce table to reject signed-request replay across service instances. This route only reads the owned Testnet venue; deployment and account approval require separate verification.
