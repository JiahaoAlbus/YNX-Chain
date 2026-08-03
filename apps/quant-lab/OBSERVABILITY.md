# Observability

## Implemented locally

- health and version endpoints expose product, service role, version, source
  commit class, operating mode, and `liveFundsEnabled=false`
- WebSocket envelopes expose source, `asOf`, version, confidence, and data
- every HTTP response receives validated/generated `X-YNX-Request-ID` and
  `X-YNX-Trace-ID`; W3C `traceparent` trace IDs are accepted only after strict
  validation; WebSocket envelopes carry the same correlation IDs
- errors use stable public codes plus generated `X-YNX-Error-ID`; parser,
  provider and internal error text is not returned
- lifecycle, paper, mandate, revoke, kill, restore, and execution records append
  to an integrity-linked audit chain
- HTTP access logs are JSON and contain method, route template, status, latency,
  response bytes, role and correlation IDs. They exclude body, query string,
  remote address, credentials and internal provider responses; redaction tests
  prove query secrets are absent
- `/metrics` exports bounded Prometheus counters for request/error/forbidden/
  unavailable totals, cumulative latency/bytes, risk rejects, kills and revokes;
  gauges expose WebSocket activity, kill state, reconciliation delta, pending
  unknown executions and build identity
- `/health` exposes readiness and explicit kill/reconciliation/pending-unknown
  alert signals without treating a deliberate risk stop as fake process failure

## Required before staging

- OpenTelemetry spans and context propagation across Gateway, Quant, Wallet,
  Exchange/DEX and evidence; the current trace ID is correlation only
- audit ID propagation on every mutating HTTP receipt
- Prometheus histograms and metrics for lock wait, queue age/depth, provider
  calls/latency/rate limits and stale feed age
- alerts for availability/error budget, stale market/oracle data, queue age,
  provider outage/rate limit, reconciliation mismatch, and revoke failure
- dashboard and status-page components with service/version/region context
- monitor integration and tested on-call routing

No SLO dashboard, trace backend, public status page, monitor ingestion or alert
delivery is claimed in the current local release state.
