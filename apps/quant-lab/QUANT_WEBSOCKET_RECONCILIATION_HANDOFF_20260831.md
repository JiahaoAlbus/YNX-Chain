# Quant durable WebSocket reconciliation handoff

Status: source-tested only. No public runtime, Wallet approval, strategy authorization, signing, order, capital, or Testnet execution claim is made here.

## Transport behavior

`GET /v1/stream` now emits a `snapshot` at connection time and a `reconciled` envelope only when the integrity-protected Quant state changes. Each envelope includes the existing request/trace identifiers, source provenance, source metadata, and a state-derived event identifier. The connection uses periodic server ping frames and client pong handling so a closed browser connection is released rather than retained indefinitely.

The reconciliation comparison uses the durable revision plus integrity fingerprint. This matters for the filesystem snapshot backend, where the numeric revision can remain zero even though a persisted state change occurred. File storage continues to advertise `degraded_single_host`; multi-instance readiness remains PostgreSQL-only.

## Safety boundary

The WebSocket remains read-only. It cannot invoke Wallet, issue a mandate, sign, submit a paper/Testnet order, transfer assets, change a strategy lifecycle, or clear a kill switch. A state refresh failure produces a retryable `FIN_SOURCE_UNAVAILABLE` message and closes the connection so clients reconnect from an authoritative snapshot.

## Local evidence

`go test ./internal/quantlab ./apps/quant-lab/server` now covers initial stream provenance plus a persisted kill-switch change becoming a `reconciled` message. `go vet ./internal/quantlab ./apps/quant-lab/server`, `npm --prefix apps/quant-lab test`, and `npm --prefix apps/quant-lab run build:wallet` pass. Public deployment and direct browser/installed-provider evidence remain separate gates.
