# Execution adapter contract

Strategies target a venue-neutral order intent. They cannot call venues, Wallet,
or provider SDKs directly.

Required adapters:

- `PaperExecutionAdapter`: simulated balance and explicit fill assumptions
- `ShadowExecutionAdapter`: observes real venue state but submits no order
- `ExchangeExecutionAdapter`: bounded no-withdraw subaccount order execution
- `DEXExecutionAdapter`: bounded Strategy Vault session-key Swap/LP/rebalance

Each adapter must translate versioned schemas; validate market, precision and
sequence; reconcile snapshot plus deltas; use bounded retries and idempotency;
return pending/accepted/rejected/unknown semantics; and emit source, `asOf`,
version, request ID, audit ID, transaction/order/fill proof, and failure state.

Exchange assets remain in the user's Exchange subaccount. DEX assets remain in
the user's Strategy Vault. Adapters receive no seed/private key, withdrawal,
owner-change, risk-change, or scope-widening authority. The Quant Engine cannot
increase mandate limits or continue after expiry/revoke/kill.

Current status: Paper behavior and the bounded Testnet broker interface are
tested locally. Shadow, canonical Exchange and DEX adapters, sequence/retry
matrices, real receipts, and emergency exit are not implemented or deployed.
