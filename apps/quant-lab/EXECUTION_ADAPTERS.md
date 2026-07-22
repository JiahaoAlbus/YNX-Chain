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
per minute in addition to notional, position and daily loss. Missing, future or
stale observations fail closed before the broker is called.

Current status: `PaperExecutionAdapter` and `ShadowExecutionAdapter` implement
the common contract locally. Paper translates authoritative matched-trade price
and volume into an explicitly simulated fill. Shadow emits
`observed_no_submit`, zero fill and no order ID. Both reject stale/future feeds,
tampered idempotency replay and sequence gaps. The bounded Testnet broker
interface also has injected risk-observation tests. Adapter ledgers are
process-local candidates and are not restart-durable yet.

`ExchangeExecutionAdapter` and `DEXExecutionAdapter` are capability-narrowing
interfaces only. No shipped implementation can submit to either venue. Canonical
venue schema translation, durable sequence/retry matrices, real receipts and
emergency exit are not implemented or deployed.
