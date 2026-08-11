# YNX Quant Execution Adapter v1

The Exchange exposes one bounded adapter over the authoritative Exchange service. It is not a second matching engine or Quant engine. Orders, balances, reservations, fills, fees, sequence values and reconciliation hashes come from `internal/exchangeproduct` persisted state.

## Mandate

`ynx-quant-execution-adapter-v2` binds the full strategy, product/device identity, capital, risk, frequency, expiry and Testnet-only envelope:

- exact Exchange subaccount;
- exact market;
- allowed methods;
- maximum aggregate open execution notional in fixed six-decimal units;
- leverage (`1` for the current Spot market);
- expiry, no more than 24 hours;
- a `quant:` nonce domain;
- the user's Wallet signature.

HTTP calls additionally require a current canonical Gateway session with the exact Exchange read or trade scope. Every order, cancel, mass cancel and kill also requires its own Wallet-bound action signature and idempotency key. A mandate is not an API key and cannot be exported as one.

## Available methods

- Markets and capability discovery
- Balances, Spot positions (explicit empty set), open orders, actual fills and fees
- Native order book
- Persisted sequenced Market/User WebSocket streams and account-scoped Drop Copy
- Submit within the mandate's aggregate capital ceiling
- Atomic amend within the aggregate ceiling; amended orders lose their old time priority
- Native Stop/Take-Profit/Trailing/OCO within the aggregate ceiling, sourced and triggered only by persisted YNX matches; OCO uses one shared reserve and one exposure amount
- Persisted TWAP within the aggregate ceiling using signed fixed-price protection, deterministic IOC slices, restart continuation and reserve-releasing cancel/kill
- Native iceberg within the aggregate ceiling with total reservation, display-only public depth and deterministic lost-priority replenishment
- Atomic scale plans within the aggregate ceiling with deterministic signed price levels and whole-plan cancel/kill
- Cancel and mass cancel
- Wallet-signed persistent strategy kill, binding the exact nonce domain and atomically cancelling the subaccount's market exposure
- Nonce-domain reconciliation with active/killed status, aggregate exposure, capital, open-order IDs and persisted event sequence

REST namespace: `/v1/quant-adapter/`.

All responses originate from the Exchange source and use explicit source metadata where the response aggregates state. The public capability response includes `source`, `asOf`, `version`, `coverage`, and `status`.

## Fail-closed methods

Leverage changes, funding/complete risk views and strategy pause/resume remain unavailable until their native Exchange primitives and signed control contracts exist. The adapter does not emulate them. Kill is irreversible for that nonce domain; resumption requires a newly signed mandate with a new nonce domain. WebSocket clients recover from an authoritative snapshot sequence or reconnect with `after=<sequence>`; query-string authentication is not accepted.

The following capabilities are structurally forbidden and reported as `allowed=false`:

- withdraw;
- owner change;
- withdrawal-address mutation;
- unapproved transfer;
- risk override;
- API key export.

Unknown or duplicate methods, scope widening, wrong subaccount, wrong market, aggregate capital excess, leverage other than 1, bad nonce domains, expired/overlong mandates and invalid Wallet signatures fail closed. A mass-cancel signature cannot authorize strategy kill.

## Verification

Direct race tests cover authoritative state reads, Spot position truth, order and TWAP submission, aggregate capital across restart, wrong subaccounts, expiry, scope widening, nonce-domain reconciliation, persistent kill across restart, reserve release and the forbidden capability manifest. HTTP tests prove missing-Gateway-session rejection, legacy mass-cancel signature rejection for kill, successful kill and killed-state reconciliation.

Primary implementation and tests:

- `internal/exchangeproduct/quant_adapter.go`
- `internal/exchangeproduct/quant_adapter_test.go`
- `internal/exchangeproduct/server.go`
