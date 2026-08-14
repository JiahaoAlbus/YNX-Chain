import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { buildSnapshot } from "./publish-public-status.mjs";

test("publisher records real identity, dependencies, success and failure without inventing healthy state", async () => {
  const startedAt = "2026-08-02T23:00:00.000Z";
  const server = createServer((request, response) => {
    const body = request.url === "/version"
      ? { commit: "a".repeat(40), release: "testnet-release", startedAt }
      : { ok: true, dependencies: { chainRpc: { status: "healthy" } } };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const snapshot = await buildSnapshot({
      probes: [
		{ id: "available", name: "Available service", url: `http://127.0.0.1:${address.port}/health`, versionUrl: `http://127.0.0.1:${address.port}/version`, dependencies: ["chainRpc"] },
		{ id: "unavailable", name: "Unavailable service", url: "http://127.0.0.1:1/health", dependencies: ["chainRpc"] },
      ],
      key: "k".repeat(32),
      source: "ynx.status.publisher",
      approvalId: "public-probes-v1",
      timeoutMs: 100,
      now: new Date("2026-08-03T00:00:00.000Z"),
    });
    assert.equal(snapshot.status, "major_outage");
    assert.equal(snapshot.services[0].status, "operational");
    assert.equal(snapshot.services[1].status, "major_outage");
	assert.equal(snapshot.services[0].sourceCommit, "a".repeat(40));
	assert.equal(snapshot.services[0].release, "testnet-release");
	assert.equal(snapshot.services[0].startedAt, startedAt);
	assert.deepEqual(snapshot.services[0].dependencies, [{ id: "chainRpc", status: "operational" }]);
	assert.equal(snapshot.services[1].sourceCommit, null);
    assert.match(snapshot.integrity.digest, /^[a-f0-9]{64}$/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
