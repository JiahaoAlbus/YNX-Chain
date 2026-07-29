import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { SearchObservability, normalizeRoute } from "../src/observability.js";

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = new Map();
    this.statusCode = 200;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase());
  }
}

test("observability emits bounded IDs, normalized routes, structured logs and metrics", () => {
  let now = Date.parse("2026-07-29T08:00:00.000Z");
  const logs = [];
  const errors = [];
  const ids = ["generated-request-id", "generated-error-id"];
  const telemetry = new SearchObservability({
    clock: () => now,
    randomId: () => ids.shift(),
    randomHex: () => "1234567890abcdef1234567890abcdef",
    logger: line => logs.push(JSON.parse(line)),
    errorLogger: line => errors.push(JSON.parse(line)),
  });
  const response = new FakeResponse();
  const request = {
    method: "GET",
    url: "/api/cases/42f63c82-1dd0-4301-a6ab-0ee20f1d88e7?query=private-value",
    headers: { "x-request-id": "bad id" },
  };

  const context = telemetry.begin(request, response);
  assert.equal(context.route, "/api/cases/:id");
  assert.equal(response.getHeader("x-request-id"), "generated-request-id");
  assert.equal(response.getHeader("x-trace-id"), "1234567890abcdef1234567890abcdef");

  now += 12;
  const errorId = telemetry.captureError(context, Object.assign(new Error("internal detail"), { status: 503 }));
  response.statusCode = 503;
  now += 8;
  response.emit("finish");

  assert.equal(errorId, "generated-error-id");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].errorId, errorId);
  assert.equal("message" in errors[0], false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].durationMs, 20);
  assert.equal(logs[0].route, "/api/cases/:id");
  assert.equal(JSON.stringify(logs).includes("private-value"), false);
  assert.equal(JSON.stringify(logs).includes("internal detail"), false);

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.requests.total, 1);
  assert.equal(snapshot.requests.serverErrors, 1);
  assert.equal(snapshot.requests.latencyMs.p99, 20);
  assert.equal(snapshot.routes[0].status, 503);

  const metrics = telemetry.prometheus();
  assert.match(metrics, /ynx_search_requests_total\{method="GET",route="\/api\/cases\/:id",status="503"\} 1/);
  assert.match(metrics, /ynx_search_server_errors_total 1/);
  assert.doesNotMatch(metrics, /private-value|internal detail/);
});

test("observability preserves valid correlation headers and strips query strings", () => {
  let now = 1000;
  const response = new FakeResponse();
  const telemetry = new SearchObservability({
    clock: () => now,
    randomId: () => "fallback-request-id",
    randomHex: () => "ffffffffffffffffffffffffffffffff",
    logger: () => {},
    errorLogger: () => {},
  });
  const context = telemetry.begin({
    method: "POST",
    url: "/api/search?q=private-value",
    headers: {
      "x-request-id": "client-request-1234",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
  }, response);
  now += 3;
  response.emit("finish");

  assert.equal(context.requestId, "client-request-1234");
  assert.equal(context.traceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(context.route, "/api/search");
  assert.equal(normalizeRoute("not a valid absolute url?query=private-value"), "/not%20a%20valid%20absolute%20url");
});
