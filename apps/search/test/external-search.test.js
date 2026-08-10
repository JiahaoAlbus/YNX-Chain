import assert from "node:assert/strict";
import test from "node:test";
import { ExternalSearchAdapter, EXTERNAL_SEARCH_CONTRACT } from "../src/external-search.js";

const now = new Date("2026-07-29T03:00:00.000Z");
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];

function configured(overrides = {}) {
  return new ExternalSearchAdapter({
    provider: "official-provider",
    endpoint: "https://provider.example/v1/search",
    credential: "credential-reference",
    retentionDays: 30,
    retentionPolicyUrl: "https://provider.example/privacy",
    resolveHost,
    clock: () => now,
    ...overrides,
  });
}

function providerResponse(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    provider: "official-provider",
    health: "available",
    asOf: "2026-07-29T02:59:30.000Z",
    rateLimit: {
      limit: 100,
      remaining: 99,
      resetAt: "2026-07-29T03:01:00.000Z",
    },
    results: [
      {
        title: "YNX public documentation",
        url: "https://docs.example/ynx",
        snippet: "Reviewed external provider result with a direct source link.",
        language: "en",
        publishedAt: "2026-07-28T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("external Search remains unavailable without complete operator configuration", async () => {
  const adapter = new ExternalSearchAdapter({ provider: "official-provider" });
  assert.equal(adapter.status().status, "unavailable");
  assert.equal(adapter.status().credentialExposed, false);
  assert.equal(EXTERNAL_SEARCH_CONTRACT.unavailableWithoutConfiguration, true);
  await assert.rejects(
    adapter.search("YNX"),
    error => error.status === 503 && error.code === "SEARCH_EXTERNAL_PROVIDER_UNAVAILABLE",
  );
});

test("external Search validates provider truth and separates result classes", async () => {
  let observedUrl;
  let observedInit;
  const adapter = configured({
    fetchImpl: async (url, init) => {
      observedUrl = url;
      observedInit = init;
      return jsonResponse(providerResponse());
    },
  });
  const result = await adapter.search(" YNX docs ", { pageSize: 3 });
  const request = JSON.parse(observedInit.body);

  assert.equal(observedUrl.toString(), "https://provider.example/v1/search");
  assert.equal(observedInit.redirect, "error");
  assert.match(observedInit.headers.authorization, /^Bearer /);
  assert.equal(request.query, "YNX docs");
  assert.equal(request.limit, 3);
  assert.equal(request.resultClass, "external-result");
  assert.equal(result.providerBacked, true);
  assert.equal(result.coverage, "external-provider-response-only");
  assert.deepEqual(result.separatedFrom, ["ynx-index-result", "ai-answer"]);
  assert.equal(result.results[0].resultType, "external-result");
  assert.equal(result.results[0].retrieval, "external-provider");
  assert.equal(result.results[0].inference, false);
  assert.equal(result.results[0].rank, 1);
  assert.equal(result.rateLimit.status, "reported");
  assert.equal(result.rateLimit.remaining, 99);
  assert.equal(result.retention.providerReportedDays, 30);
  assert.equal(result.retention.searchCache, "none");
  assert.equal("credential" in result, false);
});

test("external Search rejects mismatched, stale and unsafe provider output", async t => {
  await t.test("provider identity mismatch", async () => {
    const adapter = configured({ fetchImpl: async () => jsonResponse(providerResponse({ provider: "other-provider" })) });
    await assert.rejects(adapter.search("YNX"), /identity mismatch/);
  });

  await t.test("stale response", async () => {
    const adapter = configured({ fetchImpl: async () => jsonResponse(providerResponse({ asOf: "2026-07-29T02:30:00.000Z" })) });
    await assert.rejects(
      adapter.search("YNX"),
      error => error.status === 502 && error.code === "SEARCH_EXTERNAL_PROVIDER_STALE",
    );
  });

  await t.test("unsafe result URL", async () => {
    const adapter = configured({
      fetchImpl: async () => jsonResponse(providerResponse({
        results: [{ title: "Unsafe", url: "http://127.0.0.1/private", snippet: "Rejected." }],
      })),
    });
    await assert.rejects(adapter.search("YNX"), /result URL rejected/);
  });

  await t.test("result hostname resolving to a private address", async () => {
    const adapter = configured({
      resolveHost: async hostname => [{ address: hostname === "rebind.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }],
      fetchImpl: async () => jsonResponse(providerResponse({
        results: [{ title: "Rebinding", url: "https://rebind.example/private", snippet: "Rejected." }],
      })),
    });
    await assert.rejects(adapter.search("YNX"), /result URL rejected/);
  });

  await t.test("retention policy hostname resolving to a private address", async () => {
    const adapter = configured({
      retentionPolicyUrl: "https://private-policy.example/privacy",
      resolveHost: async hostname => [{ address: hostname === "private-policy.example" ? "10.0.0.8" : "93.184.216.34", family: 4 }],
      fetchImpl: async () => jsonResponse(providerResponse()),
    });
    await assert.rejects(
      adapter.search("YNX"),
      error => error.status === 503 && error.code === "SEARCH_EXTERNAL_PROVIDER_CONFIGURATION",
    );
  });

  await t.test("too many results", async () => {
    const results = Array.from({ length: 3 }, (_, index) => ({
      title: `Result ${index}`,
      url: `https://docs.example/${index}`,
      snippet: "Bounded result.",
    }));
    const adapter = configured({ fetchImpl: async () => jsonResponse(providerResponse({ results })) });
    await assert.rejects(adapter.search("YNX", { pageSize: 2 }), /too many results/);
  });
});

test("external Search propagates bounded rate-limit and timeout semantics", async t => {
  await t.test("rate limit", async () => {
    const adapter = configured({
      fetchImpl: async () => jsonResponse({}, { status: 429, headers: { "retry-after": "60" } }),
    });
    await assert.rejects(
      adapter.search("YNX"),
      error => error.status === 429 && error.code === "SEARCH_EXTERNAL_PROVIDER_RATE_LIMIT" && error.retryAfterSeconds === 60,
    );
  });

  await t.test("timeout", async () => {
    const adapter = configured({
      timeoutMs: 50,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    await assert.rejects(
      adapter.search("YNX"),
      error => error.status === 504 && error.code === "SEARCH_EXTERNAL_PROVIDER_TIMEOUT",
    );
  });
});

test("external Search rejects oversized provider responses before parsing", async () => {
  const adapter = configured({
    maxResponseBytes: 1_024,
    fetchImpl: async () => jsonResponse(providerResponse(), { headers: { "content-length": "4096" } }),
  });
  await assert.rejects(adapter.search("YNX"), /too large/);
});
