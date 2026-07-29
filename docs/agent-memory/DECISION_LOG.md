# Decision log

## 2026-07-29 — Finance observability remains privacy-minimal

Decision: collect route-level operational telemetry only. Logs and metrics exclude Wallet accounts, bearer tokens, request bodies, query strings, balances, activity, notes, budgets and remote addresses.

Reason: Finance handles sensitive personal financial evidence. Correlation and reliability data are necessary, but user-level telemetry is not required for the current reliability objectives.

## 2026-07-29 — Metrics fail closed behind a distinct secret

Decision: protect `GET /metrics` with `X-YNX-Operations-Key`, sourced from mandatory `YNX_FINANCE_OPERATIONS_KEY` with a 32-character minimum.

Reason: operational telemetry should not be a public product API, and the credential must not reuse Wallet, Pay, AI, cursor, backup or signing secrets.

## 2026-07-29 — Counters are explicitly process-scoped

Decision: in-memory counters include process instance, start time and restart-reset language. No persistence or central Monitor integration is claimed.

Reason: truthfully exposing the lifecycle is safer than implying continuity that the runtime does not provide.

## 2026-07-29 — Stable errors are class identifiers, not incident secrets

Decision: map public error codes deterministically to `YNX-FIN-*`; pair each response with a request ID.

Reason: operators can aggregate failure classes and correlate one request without exposing stack traces, internal credentials or user financial data.
