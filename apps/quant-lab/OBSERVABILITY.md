# Observability

## Implemented locally

- health and version endpoints expose product, service role, version, source
  commit class, operating mode, and `liveFundsEnabled=false`
- WebSocket envelopes expose source, `asOf`, version, confidence, and data
- lifecycle, paper, mandate, revoke, kill, restore, and execution records append
  to an integrity-linked audit chain
- daemon logs use structured key/value fields; user-facing errors omit stack,
  host paths, credentials, and internal provider responses

## Required before staging

- OpenTelemetry traces across Gateway, Quant, Wallet, Exchange/DEX, and evidence
- request ID, error ID, and audit ID propagated on every request and receipt
- Prometheus metrics for requests, latency, status, lock wait, queue age/depth,
  WebSockets, provider calls, reconciliation, risk rejects, kills, and revokes
- alerts for availability/error budget, stale market/oracle data, queue age,
  provider outage/rate limit, reconciliation mismatch, and revoke failure
- dashboard and status-page components with service/version/region context
- monitor integration and tested on-call routing

No SLO dashboard, public status page, trace backend, or alert delivery is claimed
in the current local release state.
