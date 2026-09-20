# Finance provider-error classification fence — 2026-09-20

An unclassified broker adapter error no longer becomes a definitive provider rejection. Since such an error cannot prove whether the provider accepted the request, Finance persists `submitted_unknown`, records `provider.submission_unknown` and blocks a second dispatch until provider reconciliation resolves the order.

An explicit `PROVIDER_REJECTED` result is still terminal only when accompanied by a bounded provider request ID. The regression proves both the unknown state and the duplicate-dispatch fence.

This is source and local-test evidence only. It does not prove public deployment, an installed release, official Sandbox credentials, provider-account access, an order submission or a transaction.
