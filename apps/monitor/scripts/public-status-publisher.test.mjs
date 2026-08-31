import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedJSON, buildSnapshot } from "./publish-public-status.mjs";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("bounded probe reader cancels before buffering an oversized response", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(262_145)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(boundedJSON(response), /exceeded its limit/);
  assert.equal(cancelled, true);
});

test("publisher records real identity, dependencies, success and failure without inventing healthy state", async () => {
  const startedAt = "2026-08-02T23:00:00.000Z";
  const snapshot = await buildSnapshot({
    probes: [
	  { id: "available", name: "Available service", url: "https://available.ynxweb4.com/health", versionUrl: "https://available.ynxweb4.com/version", dependencies: ["chainRpc"] },
	  { id: "unavailable", name: "Unavailable service", url: "https://unavailable.ynxweb4.com/health", dependencies: ["chainRpc"] },
    ],
    key: "k".repeat(32), source: "ynx.status.publisher", approvalId: "public-probes-v1", timeoutMs: 1_000,
    now: new Date("2026-08-03T00:00:00.000Z"),
    fetcher: async (url) => String(url).endsWith("/version") ? response({ commit: "a".repeat(40), release: "testnet-release", startedAt }) : String(url).includes("unavailable") ? Promise.reject(new Error("offline")) : response({ ok: true, dependencies: { chainRpc: { status: "healthy" } } }),
  });
  assert.equal(snapshot.status, "major_outage");
  assert.equal(snapshot.services[0].status, "operational");
  assert.equal(snapshot.services[1].status, "major_outage");
	assert.equal(snapshot.services[0].sourceCommit, "a".repeat(40));
	assert.equal(snapshot.services[0].release, "testnet-release");
	assert.equal(snapshot.services[0].startedAt, startedAt);
	assert.deepEqual(snapshot.services[0].dependencies, [{ id: "chainRpc", status: "operational" }]);
	assert.equal(snapshot.services[0].message, "Configured public HTTPS probe returned a healthy response.");
	assert.doesNotMatch(snapshot.services[0].message, /\bevidence\b/i);
	assert.equal(snapshot.services[1].sourceCommit, null);
  assert.match(snapshot.integrity.digest, /^[a-f0-9]{64}$/);
});

test("publisher fails closed on invalid, negative, and dependency-failed HTTP 200 health bodies", async () => {
  const snapshot = await buildSnapshot({
    probes: ["malformed", "negative", "dependency"].map((id) => ({ id, name: id, url: `https://${id}.ynxweb4.com/health` })),
    key: "k".repeat(32), source: "ynx.status.publisher", approvalId: "fail-closed-health-v1", timeoutMs: 1_000,
    now: new Date("2026-08-03T01:00:00.000Z"),
    fetcher: async (url) => String(url).includes("malformed") ? new Response("not-json", { status: 200 }) : String(url).includes("negative") ? response({ ok: false }) : response({ ok: true, dependencies: { rpc: { status: "failed" } } }),
  });
  assert.equal(snapshot.status, "major_outage");
  assert.deepEqual(snapshot.services.map((service) => service.status), ["major_outage", "major_outage", "major_outage"]);
});

test("publisher resolves configured dependencies from probes and propagates failure", async () => {
	const snapshot = await buildSnapshot({
	  probes: [
		{ id: "rpc", name: "RPC", url: "https://rpc.ynxweb4.com/health" },
		{ id: "indexer", name: "Indexer", url: "https://indexer.ynxweb4.com/health", dependencies: ["rpc"] },
		{ id: "explorer", name: "Explorer", url: "https://explorer.ynxweb4.com/health", dependencies: ["indexer"] },
	  ],
	  key: "k".repeat(32), source: "ynx.status.publisher", approvalId: "dependency-probes-v1", timeoutMs: 1_000,
	  now: new Date("2026-08-03T02:00:00.000Z"),
	  fetcher: async (url) => response({ ok: !String(url).startsWith("https://rpc.") }),
	});
	assert.deepEqual(snapshot.services.map((service) => service.status), ["major_outage", "major_outage", "major_outage"]);
	assert.deepEqual(snapshot.services[1].dependencies, [{ id: "rpc", status: "major_outage" }]);
	assert.deepEqual(snapshot.services[2].dependencies, [{ id: "indexer", status: "major_outage" }]);
	assert.equal(snapshot.services[2].message, "A configured dependency did not return a healthy response.");
	assert.doesNotMatch(snapshot.services[2].message, /\bevidence\b/i);
});

test("publisher rejects private, reserved, credentialed, and cross-origin identity URLs before probing", async () => {
  const base = { id: "monitor", name: "Monitor", url: "https://monitor.ynxweb4.com/health" };
  for (const probe of [
    { ...base, url: "http://monitor.ynxweb4.com/health" },
    { ...base, url: "https://127.0.0.1/health" },
    { ...base, url: "https://monitor.ynxweb4.com/health?token=secret" },
    { ...base, url: "https://user:password@monitor.ynxweb4.com/health" },
    { ...base, versionUrl: "https://identity.ynxweb4.com/version" },
  ]) {
    await assert.rejects(() => buildSnapshot({ probes: [probe], key: "k".repeat(32), source: "ynx.status.publisher", approvalId: "public-url-gate-v1" }));
  }
});

test("publisher keeps only commit-shaped source identities", async () => {
  const snapshot = await buildSnapshot({
    probes: [{ id: "monitor", name: "Monitor", url: "https://monitor.ynxweb4.com/health" }],
    key: "k".repeat(32), source: "ynx.status.publisher", approvalId: "commit-shape-v1",
    fetcher: async () => response({ ok: true, commit: "release-preview" }),
  });
  assert.equal(snapshot.services[0].sourceCommit, null);
});
