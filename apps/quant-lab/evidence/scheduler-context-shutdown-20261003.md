# Quant research scheduler cancellation and normal shutdown

Parent checkpoint: 4c0d1dc7afdf10b3ca7e0eee8d05182a13903237.
Scope: ordinary Quant research service, tenant scheduler, app-server lifecycle,
owned tests and isolated PostgreSQL runner. No shared Wallet, grants, formal
release pins, Host or production changes.

The scheduler now propagates its context through durable claim/completion,
market history and backtest calculation. Pre-cancelled work does not claim.
Cancellation after a durable claim leaves that claim intact and produces no
late experiment/completion. Existing next-persisted-due recovery is retained;
there is no immediate replay or Paper/Testnet capital execution.

On normal app-server shutdown the scheduler is cancelled and joined before the
service database pool is closed. This is not proof of abrupt process termination
handling or an OS-signal installed/public test. Legacy non-contextual adapters
remain synchronous: cancellation is observed when they return, not by abandoning
a background goroutine.

## Executed validation

- `go test -race ./internal/quantlab ./apps/quant-lab/server`: PASS; quantlab 3.053s,
  app-server cached PASS.
- `go vet ./internal/quantlab ./apps/quant-lab/server`: PASS.
- Actual local ticker cancellation/join test: PASS, with unchanged post-claim
  persisted state and no late result.
- File and actual PostgreSQL cancellation/reopen/next-due recovery tests: PASS.
- Isolated native PostgreSQL 17.11 runner: 20 focused integration passes and 116
  full regression passes; actual database restart verified; rows remaining 0|0;
  server stopped; productionDatabaseUsed=false.

Retained QA root: `/private/tmp/ynx-quant-postgres-it-0glYOh`.
Integration log SHA256:
`a766bb3675ce14eea5dc47f7b6525f25f0d77f713f5b9fb81c5798b82e7d2ef8`.
Full regression log SHA256:
`88f8e66012623dc4f82f0190780c9eed27240b61ce74715d4ddbc28b9ad9269d`.

## Delivery boundary

Source/local isolated validation only. Public deployment, installed lifecycle,
real Wallet approval, Product Session and real orders/transactions are NOT
VERIFIED by this checkpoint. The unique release owner must incorporate ordinary
hunks in the coherent formal graph; do not deploy this inherited checkout as a
replacement for shared authority. Rollback is the parent ordinary-source delta,
subject to existing compatible-writer and namespace fences; no production
rollback was executed.
