# Finance reconciliation identity fence — 2026-09-20

Broker reconciliation now fails closed before durable state mutation when a provider snapshot contains more than one order for the same client order ID. This prevents a later provider row from silently overwriting an earlier row and hiding a duplicate-submit or provider protocol ambiguity.

The dispatcher also binds every accepted snapshot to the exact `alpaca_broker` / `sandbox` authority and to the provider account ID in the current Finance owner's persisted mapping. A cross-tenant or wrong-authority snapshot cannot advance the reconciliation checkpoint or mutate local order state. Provider submission responses now reuse the same full signed-order identity comparison, including order type, limit price, time in force and extended-hours policy.

The regression tests prove duplicate client IDs, wrong provider, wrong environment, wrong account and divergent submission fields leave the checkpoint/provider identity/local state unchanged. This is source and local-test evidence only. Official Sandbox verification, public deployment, Wallet Gateway/Product Session authorization, provider account confirmation, order submission and transactions remain false.
