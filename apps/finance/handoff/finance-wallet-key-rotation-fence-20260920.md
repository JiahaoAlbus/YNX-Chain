# Finance Wallet-key rotation fence — 2026-09-20

Finance broker orders are now bound to the Wallet public key in the current account mapping throughout their durable lifecycle. A different key cannot create a challenge, and rotating the mapping after challenge creation blocks approval, consumption and provider dispatch before any provider-side call.

The dispatch fence records `ACCOUNT_MAPPING_CHANGED` and moves the durable order/outbox to `execution_blocked`. Earlier stages fail before their CAS commit, so they do not create an order, mutate approval state or create an outbox. Legacy mappings with an empty key remain loadable for read-only recovery, but cannot create or advance a trading order; a verified mapping key is mandatory for every write stage.

The regression covers all four boundaries independently and exercises the production callback's combined `VerifyAndConsumeBrokerOrder` path after both key rotation and legacy empty-key recovery. Both negative callback cases leave the full durable brokerage state byte-for-byte equivalent in memory. Go Finance/command tests and race tests pass. This remains source and local-test evidence only: it does not prove public deployment, installed runtime, official Sandbox access, provider account approval, order submission or a transaction.
