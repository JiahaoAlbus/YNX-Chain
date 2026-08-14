import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { prepareRestartIdempotency, verifyRestartIdempotency } from "../scripts/verify-product-session-v2-restart-idempotency.mjs";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));

test("two-phase verifier proves exact completion response and cleanup across host restart", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-restart-verifier-")); chmodSync(directory, 0o700);
  const recordPath = `/private/tmp/ynx-product-session-restart-${process.pid}-${Date.now()}.json`;
  context.after(() => { rmSync(directory, { force: true, recursive: true }); rmSync(recordPath, { force: true }); });
  const statePath = join(directory, "state.json");
  let running = await listen(new ProductSessionGatewayNodeHost(registry, runtime(statePath)));
  const prepared = await prepareRestartIdempotency({ allowLoopback: true, endpoint: running.endpoint, recordPath });
  assert.equal(prepared.recordMode, "0600"); assert.equal(existsSync(recordPath), true);
  await running.close();
  running = await listen(new ProductSessionGatewayNodeHost(registry, runtime(statePath))); context.after(running.close);
  const verified = await verifyRestartIdempotency({ allowLoopback: true, endpoint: running.endpoint, recordPath });
  assert.equal(verified.completionRequestId, prepared.completionRequestId);
  assert.equal(verified.completionResponseSha256, prepared.completionResponseSha256);
  assert.equal(verified.completionResponseByteIdentical, true);
  assert.equal(verified.cleanupRevoked, true);
  assert.equal(verified.postRevokeCode, "SESSION_REVOKED");
  assert.equal(existsSync(recordPath), false);
});

function runtime(statePath) { return { emitEvent: () => undefined, now: () => new Date(), statePath, tokenFactory: () => crypto.randomUUID().replaceAll("-", "") }; }
async function listen(host) { const server = createServer(host.handler()); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); return { endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }; }
