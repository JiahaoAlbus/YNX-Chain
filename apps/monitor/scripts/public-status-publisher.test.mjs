import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { buildSnapshot } from "./publish-public-status.mjs";

test("publisher records real success and failure without inventing healthy state", async () => {
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const snapshot = await buildSnapshot({
      probes: [
        { id: "available", name: "Available service", url: `http://127.0.0.1:${address.port}/health` },
        { id: "unavailable", name: "Unavailable service", url: "http://127.0.0.1:1/health" },
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
    assert.match(snapshot.integrity.digest, /^[a-f0-9]{64}$/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
