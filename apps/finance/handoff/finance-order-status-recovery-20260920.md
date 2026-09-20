# Finance order status recovery handoff — 2026-09-20

The per-order **Refresh** control now calls the existing authenticated, owner-scoped `GET /api/broker/orders/{id}/execution-status` route. It validates the response schema, `providerWriteAttempted:false`, exact order identity and a string status before displaying anything, then reloads only the durable Finance workspace.

Previously the control called Broker reconciliation, displayed a provider-read confirmation dialog and could contact the configured Sandbox provider even when the user only wanted persisted execution state. The new path performs no reconciliation, provider write, confirmation dialog or automatic retry.

The browser regression uses an explicitly isolated authority-enabled fixture only to exercise this otherwise unreachable path while the real shared authority remains `PENDING`. It is not public activation evidence. Wallet Gateway authorization, Finance Product Session authorization, provider account verification, public deployment and order submission all remain false.
