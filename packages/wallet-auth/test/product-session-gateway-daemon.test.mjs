import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const daemon = fileURLToPath(new URL("../scripts/ynx-wallet-gatewayd.mjs", import.meta.url));
const centralRegistry = fileURLToPath(new URL("../central-registry.json", import.meta.url));
const productRegistry = fileURLToPath(new URL("../product-session-registry.json", import.meta.url));

test("gateway daemon routes v2 to the durable Product Session host without replacing v1 administration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-gateway-daemon-v2-")); chmodSync(directory, 0o700);
  const port = await availablePort();
  const child = spawn(process.execPath, [daemon], { cwd: packageRoot, env: { ...process.env, YNX_WALLET_GATEWAY_HTTP_ADDR: "127.0.0.1", YNX_WALLET_GATEWAY_HTTP_PORT: String(port), YNX_WALLET_GATEWAY_STATE_PATH: join(directory, "v1.json"), YNX_WALLET_GATEWAY_REGISTRY_PATH: centralRegistry, YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: join(directory, "v2.json"), YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: productRegistry } });
  try {
    await listening(child);
    const version = await fetch(`http://127.0.0.1:${port}/version`); assert.equal(version.status, 200); assert.equal((await version.json()).service, "ynx-wallet-gatewayd");
    const options = await fetch(`http://127.0.0.1:${port}/v2/product-sessions/challenge`, { method: "OPTIONS", headers: { origin: "https://finance.ynxweb4.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-request-id" } });
    assert.equal(options.status, 204); assert.equal(options.headers.get("access-control-allow-origin"), "https://finance.ynxweb4.com");
    const invalid = await fetch(`http://127.0.0.1:${port}/v2/product-sessions/challenge`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_daemon_v2_mounted_001" }, body: "{}" });
    assert.equal(invalid.status, 400); assert.notEqual((await invalid.json()).error.code, "ROUTE_NOT_FOUND");
  } finally { child.kill("SIGTERM"); await exited(child); rmSync(directory, { recursive: true, force: true }); }
});

test("remote daemon refuses activation without explicit reviewed v2 registry and state paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-gateway-daemon-remote-")); chmodSync(directory, 0o700);
  try {
    const result = spawnSync(process.execPath, [daemon], { cwd: packageRoot, encoding: "utf8", timeout: 5_000, env: { ...process.env, YNX_WALLET_GATEWAY_HTTP_PORT: "18446", YNX_WALLET_GATEWAY_STATE_PATH: join(directory, "v1.json"), YNX_WALLET_GATEWAY_REGISTRY_PATH: centralRegistry, YNX_WALLET_GATEWAY_REMOTE_DEPLOYED: "true", YNX_WALLET_GATEWAY_SOURCE_COMMIT: "a".repeat(40), YNX_WALLET_GATEWAY_RELEASE: "test-v2-mount", YNX_WALLET_GATEWAY_BUILD_TIME: "2026-08-20T11:45:55.000Z" } });
    assert.notEqual(result.status, 0); assert.match(`${result.stdout}${result.stderr}`, /requires explicit YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH and YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function availablePort() { const server = createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port; }
async function listening(child) { let output = ""; await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`daemon did not listen: ${output}`)), 5_000); const consume = (chunk) => { output += chunk; if (output.includes('"event":"listening"')) { clearTimeout(timer); resolve(); } }; child.stdout.on("data", consume); child.stderr.on("data", consume); child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`daemon exited ${code}: ${output}`)); }); }); }
async function exited(child) { if (child.exitCode !== null) return; await new Promise((resolve) => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2_000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
