import { randomBytes, randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const DYNAMIC_SEGMENT_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{32,}|\d{6,})$/i;

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function normalizeRoute(rawUrl) {
  let pathname = "/unknown";
  try {
    pathname = new URL(rawUrl ?? "/", "http://localhost").pathname;
  } catch {
    // Keep a bounded fallback and never log the raw malformed URL.
  }
  return pathname
    .split("/")
    .map(segment => (DYNAMIC_SEGMENT_PATTERN.test(segment) ? ":id" : segment))
    .join("/")
    .slice(0, 240);
}

function acceptedRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : null;
}

function traceIdFromHeader(value) {
  if (typeof value !== "string") return null;
  return TRACEPARENT_PATTERN.exec(value)?.[1] ?? null;
}

function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

export class SearchObservability {
  constructor({
    service = "ynx-search",
    clock = () => Date.now(),
    randomId = () => randomUUID(),
    randomHex = bytes => randomBytes(bytes).toString("hex"),
    logger = line => console.log(line),
    errorLogger = line => console.error(line),
    sampleLimit = 2_000,
  } = {}) {
    this.service = service;
    this.clock = clock;
    this.randomId = randomId;
    this.randomHex = randomHex;
    this.logger = logger;
    this.errorLogger = errorLogger;
    this.sampleLimit = sampleLimit;
    this.startedAt = new Date(this.clock()).toISOString();
    this.total = 0;
    this.errors = 0;
    this.durations = [];
    this.routes = new Map();
  }

  begin(req, res) {
    const requestId = acceptedRequestId(req.headers?.["x-request-id"]) ?? this.randomId();
    const traceId = traceIdFromHeader(req.headers?.traceparent) ?? this.randomHex(16);
    const context = {
      requestId,
      traceId,
      method: String(req.method ?? "UNKNOWN").toUpperCase().slice(0, 16),
      route: normalizeRoute(req.url),
      startedAtMs: this.clock(),
      finished: false,
      errorId: null,
    };
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-trace-id", traceId);
    res.once("finish", () => this.finish(context, res.statusCode));
    return context;
  }

  captureError(context, error) {
    const errorId = this.randomId();
    context.errorId = errorId;
    this.errorLogger(JSON.stringify({
      timestamp: new Date(this.clock()).toISOString(),
      level: "error",
      service: this.service,
      event: "request-error",
      requestId: context.requestId,
      traceId: context.traceId,
      errorId,
      method: context.method,
      route: context.route,
      errorClass: error?.name ?? "Error",
      retryable: Number(error?.status ?? 400) >= 500,
    }));
    return errorId;
  }

  finish(context, statusCode) {
    if (context.finished) return;
    context.finished = true;
    const durationMs = Math.max(0, this.clock() - context.startedAtMs);
    const status = Number(statusCode) || 0;
    const routeKey = `${context.method} ${context.route} ${status}`;
    const prior = this.routes.get(routeKey) ?? { method: context.method, route: context.route, status, count: 0, durationMs: 0, maxDurationMs: 0 };
    prior.count += 1;
    prior.durationMs += durationMs;
    prior.maxDurationMs = Math.max(prior.maxDurationMs, durationMs);
    this.routes.set(routeKey, prior);
    this.total += 1;
    if (status >= 500) this.errors += 1;
    this.durations.push(durationMs);
    if (this.durations.length > this.sampleLimit) this.durations.splice(0, this.durations.length - this.sampleLimit);
    this.logger(JSON.stringify({
      timestamp: new Date(this.clock()).toISOString(),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      service: this.service,
      event: "request-completed",
      requestId: context.requestId,
      traceId: context.traceId,
      errorId: context.errorId,
      method: context.method,
      route: context.route,
      status,
      durationMs,
    }));
  }

  snapshot() {
    const uptimeSeconds = Math.max(0, (this.clock() - Date.parse(this.startedAt)) / 1_000);
    return {
      schemaVersion: "1.0.0",
      service: this.service,
      startedAt: this.startedAt,
      uptimeSeconds,
      requests: {
        total: this.total,
        serverErrors: this.errors,
        errorRate: this.total ? this.errors / this.total : 0,
        latencyMs: {
          p50: percentile(this.durations, 0.5),
          p95: percentile(this.durations, 0.95),
          p99: percentile(this.durations, 0.99),
          max: this.durations.length ? Math.max(...this.durations) : 0,
          sampleCount: this.durations.length,
        },
      },
      routes: [...this.routes.values()].sort((left, right) => `${left.method} ${left.route} ${left.status}`.localeCompare(`${right.method} ${right.route} ${right.status}`)),
    };
  }

  prometheus() {
    const snapshot = this.snapshot();
    const lines = [
      "# HELP ynx_search_requests_total Completed HTTP requests.",
      "# TYPE ynx_search_requests_total counter",
    ];
    for (const route of snapshot.routes) {
      const labels = `method=\"${escapeLabel(route.method)}\",route=\"${escapeLabel(route.route)}\",status=\"${route.status}\"`;
      lines.push(`ynx_search_requests_total{${labels}} ${route.count}`);
    }
    lines.push(
      "# HELP ynx_search_request_duration_milliseconds_sum Sum of request latency in milliseconds.",
      "# TYPE ynx_search_request_duration_milliseconds_sum counter",
    );
    for (const route of snapshot.routes) {
      const labels = `method=\"${escapeLabel(route.method)}\",route=\"${escapeLabel(route.route)}\",status=\"${route.status}\"`;
      lines.push(`ynx_search_request_duration_milliseconds_sum{${labels}} ${route.durationMs}`);
    }
    lines.push(
      "# HELP ynx_search_request_duration_milliseconds_max Maximum observed request latency in milliseconds since process start.",
      "# TYPE ynx_search_request_duration_milliseconds_max gauge",
    );
    for (const route of snapshot.routes) {
      const labels = `method=\"${escapeLabel(route.method)}\",route=\"${escapeLabel(route.route)}\",status=\"${route.status}\"`;
      lines.push(`ynx_search_request_duration_milliseconds_max{${labels}} ${route.maxDurationMs}`);
    }
    lines.push(
      "# HELP ynx_search_server_errors_total Completed HTTP responses with status 500 or greater.",
      "# TYPE ynx_search_server_errors_total counter",
      `ynx_search_server_errors_total ${snapshot.requests.serverErrors}`,
      "# HELP ynx_search_process_uptime_seconds Process uptime in seconds.",
      "# TYPE ynx_search_process_uptime_seconds gauge",
      `ynx_search_process_uptime_seconds ${snapshot.uptimeSeconds}`,
      "",
    );
    return lines.join("\n");
  }
}

export { normalizeRoute };
