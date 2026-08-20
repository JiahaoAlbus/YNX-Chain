# YNX AI observability contract

## Evidence boundary

This document describes the observability behavior implemented by the public YNX AI product process. It does not claim central Monitor acceptance, production alert delivery, or distributed trace export.

## Endpoints

### `GET /healthz`

Local liveness only. A successful response proves that the YNX AI HTTP process can serve requests and expose its embedded build metadata. It deliberately keeps `integratedCentral=false` and `generationLive=false` until direct central and provider-backed evidence exists.

### `GET /readyz`

Dependency-aware readiness. The product performs a bounded request to the configured AI Gateway `/health` endpoint.

- HTTP 200 means the local product and configured Gateway were reachable for that check.
- HTTP 503 means the Gateway was unreachable or returned a non-2xx status.
- The response includes `gatewayStatus`, `gatewayReachable`, `requestId`, `integratedCentral`, and `generationLive`.
- Gateway reachability is not central protocol acceptance and is not provider-generation success.

### `GET /metrics`

Prometheus text exposition with intentionally low-cardinality series:

- completed and active HTTP requests;
- response counts by status class;
- aggregate request duration;
- aggregate response bytes;
- Gateway readiness check outcomes.

No account, conversation, attachment, action, prompt, query parameter, request ID, or raw route parameter appears as a metric label.

### `GET /api/public-status`

Public, redacted Gateway projection. It reports configured model and endpoint reachability without credentials, audit paths, prompts or private state. `gatewayReady` never implies `generationLive`: the current bounded release run returned provider HTTP 429, and the UI exposes that failure without generating substitute content.

## Structured logs

The production entry point supplies a JSON `slog` logger. Every completed request emits:

- event name;
- bounded request ID;
- HTTP method;
- the `ServeMux` route pattern rather than the raw URL;
- status;
- duration;
- response byte count;
- bounded `traceparent` only when supplied.

The middleware never logs request bodies, prompts, attachments, query strings, authorization headers, Wallet accounts, conversation IDs, or provider response bodies. Unknown or unsafe client request IDs are replaced with a server-generated 128-bit random identifier.

## Trace boundary

YNX AI preserves a bounded W3C `traceparent` value in structured request logs for correlation. It does not yet export spans to a tracing backend, and no distributed-tracing completion is claimed.

## Alert and dashboard handoff

Owner 13 Monitor and owner 30 Security/SRE can scrape `/metrics` and probe `/healthz` plus `/readyz`. The public surface is deployed at `https://assistant.ynxweb4.com/`; central dashboards, alert routes, retention and incident paging remain pending owner acceptance.
