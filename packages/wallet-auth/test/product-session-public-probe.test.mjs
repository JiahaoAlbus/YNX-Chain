import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJSON } from "../src/canonical.js";
import { probeProductSessionV2PublicMount, verifyProductSessionV2PublicMountResponse } from "../scripts/probe-product-session-v2-public.mjs";

const requestId = "req_public_probe_fixture_001";
const validBody = canonicalJSON({ error: { code: "UNKNOWN_OR_MISSING_FIELD", message: "Product Session Gateway challenge body fields do not match the protocol schema" }, ok: false, requestId, schemaVersion: 2 });
const valid = (override = {}) => ({ body: validBody, cacheControl: "no-store", contentType: "application/json; charset=utf-8", requestId, status: 400, ...override });

test("public mount verifier accepts only the exact state-free Product Session v2 rejection", () => {
  assert.deepEqual(verifyProductSessionV2PublicMountResponse(valid()), {
    mounted: true,
    path: "/v2/product-sessions/challenge",
    requestId,
    responseErrorCode: "UNKNOWN_OR_MISSING_FIELD",
    responseSchemaVersion: 2,
    stateCreated: false,
    status: 400,
  });
});

test("public mount verifier rejects the observed Chain JSON-RPC fallthrough", () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method is not implemented" } });
  assert.throws(() => verifyProductSessionV2PublicMountResponse(valid({ body, contentType: "application/json", status: 200 })), { code: "UNEXPECTED_HTTP_STATUS" });
});

test("public mount verifier rejects wrong request binding, schema, cache and noncanonical bodies", () => {
  assert.throws(() => verifyProductSessionV2PublicMountResponse(valid({ requestId: "req_other_probe_fixture_001" })), { code: "INVALID_RESPONSE_BINDING" });
  assert.throws(() => verifyProductSessionV2PublicMountResponse(valid({ body: canonicalJSON({ error: { code: "BAD_REQUEST", message: "Rejected" }, ok: false, requestId, schemaVersion: 1 }) })), { code: "INVALID_RESPONSE_BINDING" });
  assert.throws(() => verifyProductSessionV2PublicMountResponse(valid({ cacheControl: "public, max-age=60" })), { code: "CACHE_POLICY_MISSING" });
  assert.throws(() => verifyProductSessionV2PublicMountResponse(valid({ body: `${validBody}\n` })), { code: "NON_CANONICAL_RESPONSE" });
});

test("public mount probe sends only canonical empty JSON and validates the mounted response", async () => {
  let observed;
  const result = await probeProductSessionV2PublicMount({
    endpoint: "https://wallet-auth.ynxweb4.com",
    requestId,
    timeoutMs: 1_000,
    fetchImplementation: async (url, init) => {
      observed = { body: init.body, contentType: init.headers["content-type"], method: init.method, requestId: init.headers["x-request-id"], url: String(url) };
      return new Response(validBody, { status: 400, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
    },
  });
  assert.equal(result.mounted, true);
  assert.equal(result.attemptsUsed, 1);
  assert.deepEqual(observed, {
    body: "{}",
    contentType: "application/json",
    method: "POST",
    requestId,
    url: "https://wallet-auth.ynxweb4.com/v2/product-sessions/challenge",
  });
});

test("public mount probe retries bounded transport failures with the same state-free request", async () => {
  let attempts = 0;
  const observedIds = [];
  const result = await probeProductSessionV2PublicMount({
    attempts: 3,
    endpoint: "https://wallet-auth.ynxweb4.com",
    requestId,
    timeoutMs: 1_000,
    fetchImplementation: async (_url, init) => {
      attempts += 1;
      observedIds.push(init.headers["x-request-id"]);
      if (attempts < 3) throw new TypeError("synthetic transport failure");
      return new Response(validBody, { status: 400, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
    },
  });
  assert.equal(result.attemptsUsed, 3);
  assert.deepEqual(observedIds, [requestId, requestId, requestId]);
});

test("public mount probe allows HTTP only for explicitly enabled loopback preflight", async () => {
  const result = await probeProductSessionV2PublicMount({
    allowLoopback: true,
    endpoint: "http://127.0.0.1:17441",
    requestId,
    timeoutMs: 1_000,
    fetchImplementation: async () => new Response(validBody, { status: 400, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } }),
  });
  assert.equal(result.mounted, true);
});

test("public mount probe rejects noncanonical origins and oversized responses before parsing", async () => {
  await assert.rejects(() => probeProductSessionV2PublicMount({ endpoint: "http://wallet-auth.ynxweb4.com", requestId, timeoutMs: 1_000, fetchImplementation: fetch }), { code: "INVALID_PUBLIC_ORIGIN" });
  await assert.rejects(() => probeProductSessionV2PublicMount({ endpoint: "https://wallet-auth.ynxweb4.com/rpc", requestId, timeoutMs: 1_000, fetchImplementation: fetch }), { code: "INVALID_PUBLIC_ORIGIN" });
  await assert.rejects(() => probeProductSessionV2PublicMount({ endpoint: "https://wallet-auth.ynxweb4.com", requestId, timeoutMs: 1_000, fetchImplementation: async () => new Response("x", { status: 400, headers: { "cache-control": "no-store", "content-length": "65537", "content-type": "application/json" } }) }), { code: "RESPONSE_TOO_LARGE" });
});
