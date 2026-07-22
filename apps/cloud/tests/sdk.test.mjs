import assert from "node:assert/strict";
import test from "node:test";
import { YNXCloudClient, YNXCloudError } from "../sdk/index.js";

test("SDK binds the versioned endpoint and obtains a fresh product token", async () => {
  const calls = [];
  let tokens = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid/",
    product: "cloud",
    getAccessToken: () => `session-${++tokens}`,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [], limit: 25, scanned: 0 }), { status: 200, headers: { "Content-Type": "application/json", "X-Request-ID": "request_1" } });
    },
  });
  await client.list({ view: "recent", limit: 25 });
  await client.quota();
  assert.equal(calls[0].url, "https://cloud.testnet.invalid/api/v1/objects?view=recent&limit=25");
  assert.equal(calls[0].init.headers.get("Authorization"), "Bearer session-1");
  assert.equal(calls[1].init.headers.get("Authorization"), "Bearer session-2");
});

test("SDK surfaces request IDs and does not retry POST mutations", async () => {
  let calls = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid",
    product: "docs",
    getAccessToken: () => "session",
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ error: "scope denied" }), { status: 403, headers: { "Content-Type": "application/json", "X-Request-ID": "request_denied", "X-Error-ID": "error_denied" } });
    },
  });
  await assert.rejects(client.createObject({ kind: "doc", name: "x" }), error => {
    assert.ok(error instanceof YNXCloudError);
    assert.equal(error.status, 403);
    assert.equal(error.requestId, "request_denied");
    assert.equal(error.errorId, "error_denied");
    return true;
  });
  assert.equal(calls, 1);
});

test("SDK retries bounded idempotent reads on explicit backpressure", async () => {
  let calls = 0;
  const client = new YNXCloudClient({
    endpoint: "https://cloud.testnet.invalid/api/v1",
    product: "cloud",
    getAccessToken: () => "session",
    maxRetries: 2,
    fetch: async () => {
      calls++;
      if (calls < 3) return new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "0" } });
      return new Response(JSON.stringify({ usedBytes: 1, limitBytes: 2 }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.deepEqual(await client.quota(), { usedBytes: 1, limitBytes: 2 });
  assert.equal(calls, 3);
});

test("SDK rejects ambiguous products and unsafe identifiers", async () => {
  assert.throws(() => new YNXCloudClient({ endpoint: "https://cloud.testnet.invalid", product: "*", getAccessToken: () => "x" }), /product/);
  const client = new YNXCloudClient({ endpoint: "https://cloud.testnet.invalid", product: "cloud", getAccessToken: () => "x", fetch: async () => new Response() });
  assert.throws(() => client.getObject(""), /identifier/);
});
