# Finance execution idempotency fence — 2026-09-20

An execution idempotency key is now unique across all broker outboxes owned by one Finance account. An exact replay for the same order still returns its existing durable outbox, while reuse for another order fails before a CAS commit and leaves that second order `pending_unwired`.

The persisted-state validator rejects duplicate non-empty execution keys, preventing restart or imported-state paths from weakening the invariant. The regression creates two independently approved orders, reopens the store, rejects the cross-order replay and confirms the original same-order replay remains idempotent.

This is source and local-test evidence only. It does not prove official Sandbox credentials, provider account access, public deployment, order submission or a transaction.
