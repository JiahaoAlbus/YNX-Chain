# Finance reconciliation identity fence — 2026-09-20

Broker reconciliation now fails closed before durable state mutation when a provider snapshot contains more than one order for the same client order ID. This prevents a later provider row from silently overwriting an earlier row and hiding a duplicate-submit or provider protocol ambiguity.

The dispatcher also binds every accepted snapshot to the exact `alpaca_broker` / `sandbox` authority and to the provider account ID in the current Finance owner's persisted mapping. A cross-tenant or wrong-authority snapshot cannot advance the reconciliation checkpoint or mutate local order state.

The regression test proves both rejected paths leave the checkpoint, provider order ID and local order state unchanged. This is source and local-test evidence only. Official Sandbox verification, public deployment, Wallet Gateway/Product Session authorization, provider account confirmation, order submission and transactions remain false.
