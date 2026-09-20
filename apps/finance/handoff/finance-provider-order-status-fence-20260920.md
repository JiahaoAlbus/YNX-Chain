# Finance provider order-status protocol fence — 2026-09-20

The Alpaca Sandbox adapter now accepts only the provider order states that the Finance order state machine can interpret. A non-empty but unknown provider state is a `PROVIDER_PROTOCOL_ERROR`, not a successful submission or reconciliation result that later becomes ambiguously `submitted_unknown`.

The regression covers all 17 documented lifecycle states used by this adapter, including `done_for_day` and `suspended`, plus an unknown future state. This is source and local-test evidence only. It does not prove provider credentials, an official Sandbox account, a public release, an order submission or a transaction.
