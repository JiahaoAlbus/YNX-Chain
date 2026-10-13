import assert from "node:assert/strict";
import test from "node:test";
import { GatewayAdmissionController, forwardedClient } from "../src/gateway-admission.js";

test("isolates per-client windows and bounds global concurrency", () => {
  let now = 1_000;
  const admission = new GatewayAdmissionController({ maxConcurrent: 2, maxPerWindow: 2, windowMs: 1_000, now: () => now });
  const first = admission.enter("198.51.100.1");
  const second = admission.enter("198.51.100.2");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(admission.enter("198.51.100.3"), { ok: false, code: "CONCURRENCY_LIMIT", status: 503 });
  first.release();
  assert.equal(admission.enter("198.51.100.1").ok, true);
  second.release();
  assert.deepEqual(admission.enter("198.51.100.1"), { ok: false, code: "RATE_LIMIT", status: 429 });
  now += 1_001;
  assert.equal(admission.enter("198.51.100.1").ok, true);
});

test("uses the first proxy client without accepting control characters", () => {
  assert.equal(forwardedClient({ headers: { "x-forwarded-for": "203.0.113.5, 127.0.0.1" }, socket: {} }), "203.0.113.5");
  assert.equal(forwardedClient({ headers: { "x-forwarded-for": "bad\nclient" }, socket: {} }), "unknown");
});
