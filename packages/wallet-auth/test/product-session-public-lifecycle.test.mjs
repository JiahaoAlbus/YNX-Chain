import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { verifyProductSessionV2Lifecycle } from "../scripts/verify-product-session-v2-lifecycle.mjs";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T11:00:00.000Z");
const token = (label) => createHash("sha256").update(label).digest("base64url");

test("deployment lifecycle verifier proves idempotency, replay rejection and revoke through the persistent host", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-lifecycle-"));
  chmodSync(directory, 0o700);
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  let challenge = 0;
  const host = new ProductSessionGatewayNodeHost(registry, { emitEvent: () => undefined, now: () => new Date(NOW), statePath: join(directory, "state.json"), tokenFactory: () => token(`deployment-lifecycle-${challenge++}`) }, { build: { buildTime: NOW.toISOString(), release: "lifecycle-test", sourceCommit: "e5932a2eb0e5c01ca31a1ba6e03f9872ccf0ef7f" }, remoteDeployed: true });
  const server = createServer(host.handler());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const result = await verifyProductSessionV2Lifecycle({ allowLoopback: true, endpoint: `http://127.0.0.1:${address.port}`, now: new Date(NOW), timeoutMs: 5_000 });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.challengeIdempotent, true);
  assert.equal(result.completeIdempotent, true);
  assert.equal(result.proofReplayRejected, true);
  assert.equal(result.revoked, true);
  assert.equal(result.visibleWalletApproval, false);
  assert.equal(host.snapshot().authority.revokedSessions.length, 1);
});

test("deployment lifecycle verifier floors live proof time at the server-issued Session time", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-lifecycle-live-clock-"));
  chmodSync(directory, 0o700);
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  let challenge = 0;
  const host = new ProductSessionGatewayNodeHost(registry, { emitEvent: () => undefined, now: () => new Date(), statePath: join(directory, "state.json"), tokenFactory: () => token(`deployment-live-clock-${challenge++}`) }, { build: { buildTime: NOW.toISOString(), release: "lifecycle-live-clock-test", sourceCommit: "e5932a2eb0e5c01ca31a1ba6e03f9872ccf0ef7f" }, remoteDeployed: true });
  const server = createServer(host.handler());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const result = await verifyProductSessionV2Lifecycle({ allowLoopback: true, endpoint: `http://127.0.0.1:${address.port}`, timeoutMs: 5_000 });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.proofReplayRejected, true);
  assert.equal(result.revoked, true);
});
