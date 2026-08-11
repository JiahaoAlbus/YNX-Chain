# Execution adapter contract

Strategies target a venue-neutral order intent. They cannot call venues, Wallet,
or provider SDKs directly.

Required adapters:

- `PaperExecutionAdapter`: simulated balance and explicit fill assumptions
- `ShadowExecutionAdapter`: observes real venue state but submits no order
- `ExchangeExecutionAdapter`: bounded no-withdraw subaccount order execution
- `DEXExecutionAdapter`: bounded Strategy Vault session-key Swap/LP/rebalance

The code-level contract is `quantlab.ExecutionAdapter`; every strategy emits
the same `ynx.quant.execution.v1` `OrderIntent`. The machine-readable intent
schema is `integration/execution-adapter.schema.json`. It contains no venue
credential or venue-specific client fields. `requestId` is the idempotency key
and `expectedSequence` rejects gaps or reordering.

Each adapter must translate versioned schemas; validate market, precision and
sequence; reconcile snapshot plus deltas; use bounded retries and idempotency;
return pending/accepted/rejected/unknown semantics; and emit source, `asOf`,
version, request ID, audit ID, transaction/order/fill proof, and failure state.

Exchange assets remain in the user's Exchange subaccount. DEX assets remain in
the user's Strategy Vault. Adapters receive no seed/private key, withdrawal,
owner-change, risk-change, or scope-widening authority. The Quant Engine cannot
increase mandate limits or continue after expiry/revoke/kill.

The local bounded-Testnet pre-trade contract requires a fresh (at most 30
seconds old) oracle reference, healthy-venue observation, estimated gas and
observed daily loss. Wallet-signed limits bind maximum slippage, gas and orders
per minute in addition to notional, position and daily loss. The same signed
envelope bounds projected leverage, drawdown, minimum liquidity, depeg,
concentration, cancel rate, consecutive API failures, VaR and expected
shortfall. Missing, malformed, future, stale or arithmetic-overflowing
observations fail closed before the broker is called.

Current status: `PaperExecutionAdapter` and `ShadowExecutionAdapter` implement
the common contract locally. Paper translates authoritative matched-trade price
and volume into an explicitly simulated fill. Shadow emits
`observed_no_submit`, zero fill and no order ID. Both reject stale/future feeds,
tampered idempotency replay and sequence gaps. Reservations and completed
results use the integrity-protected authoritative state, so completed replay is
stable across restart. An interrupted reservation is retained as
`reserved_outcome_unknown` and refuses duplicate execution until operator
reconciliation. The bounded Testnet broker interface also has injected
risk-observation tests.

Concrete `VenueExecutionAdapter` constructors now implement the Exchange and DEX
interfaces over an owner-supplied narrow transport. They accept only fresh,
terminal, fully bound receipts whose adapter, request ID, sequence, amount,
limit price, source, version and audit identity match the reserved intent.
Accepted/open/partial, stale, future, tampered or malformed responses remain
`reserved_outcome_unknown` and cannot be retried into a duplicate venue action.
Authoritative reconciliation deltas must be exact and activate the persistent
Quant kill switch.

The shipped `HTTPExchangeAdapter` now implements the Exchange owner transport
against `/v1/quant-adapter/account` and `/v1/quant-adapter/orders`. Each call
requires a fresh one-time proof from the user's canonical Wallet-authenticated
Quant Product Session. The proof is supplied by the HTTP request, never stored
in adapter configuration, Quant state, orders, mandates or audit events. The mandate uses the exact
`ynx-quant-execution-adapter-v2` signing payload binds every displayed strategy, identity, capital, risk and execution limit in the
`quant:<strategyHash>` nonce domain, fixes spot leverage to 1x, and grants only
read, submit, reconcile and kill. Every order has an independent
`ynx-exchange-order-v1` Wallet signature.

Remote broker calls run outside the persistent state lock. Quant first commits
an idempotent `reserved_outcome_unknown` record, then calls Exchange, and only
marks the order `submitted_testnet` after a fully bound authoritative response.
Concurrent users therefore do not serialize behind a slow venue request, while
same-key retries cannot create a duplicate order.

No DEX-owner transport is shipped yet, and no public DEX vault transaction or
emergency-exit receipt is claimed. The Wallet → Quant → Exchange path is tested
locally with an ephemeral canonical Product Session, exact mandate and order
signatures, and replay rejection. Public deployment evidence is recorded only
after the same flow succeeds against the released origins; missing, expired,
wrong-product or replayed proofs fail closed.
