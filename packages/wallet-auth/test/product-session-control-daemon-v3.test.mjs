import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON, createWalletSessionControlProof, encodeWalletSessionControlProofHeader, httpBodyDigest } from "../src/index.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { ACCOUNT_PATH, OWNER, registry, token } from "./fixtures/product-session-control-v3-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), daemon = join(root, "scripts/ynx-wallet-gatewayd.mjs"), migrate = join(root, "scripts/ynx-wallet-control-migrate-v3.mjs");
const digest = raw => createHash("sha256").update(raw).digest("hex");
test("real offline CLI and explicitly selected v3 daemon persist exact owner intent while v1 administration remains mounted", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-control-daemon-v3-")); chmodSync(directory, 0o700); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "v2.json"), target = join(directory, "v3.json"), backup = join(directory, "migration-backup.json");
  new ProductSessionGatewayNodeHost(registry, { statePath: source, now: () => new Date(), tokenFactory: () => token("unused") });
  const original = readFileSync(source, "utf8");
  const args = [migrate, "--source", source, "--target", target, "--backup", backup, "--source-sha256", digest(original)];
  const help = spawnSync(process.execPath, [migrate, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0); assert.match(help.stdout, /OFFLINE ONLY/); assert.match(help.stdout, /flock --nonblock --exclusive --no-fork/); assert.match(help.stdout, /not a cross-process/);
  const migrated = spawnSync(process.execPath, args, { encoding: "utf8" }); assert.equal(migrated.status, 0, migrated.stderr); assert.equal(JSON.parse(migrated.stdout).migrated, true);
  assert.equal(readFileSync(source, "utf8"), original); assert.equal(readFileSync(backup, "utf8"), original);
  const again = spawnSync(process.execPath, args, { encoding: "utf8" }); assert.notEqual(again.status, 0); assert.match(again.stderr, /STATE_TARGET_EXISTS/);
  const port = await availablePort();
  const env = { YNX_WALLET_GATEWAY_HTTP_ADDR: "127.0.0.1", YNX_WALLET_GATEWAY_HTTP_PORT: String(port), YNX_WALLET_GATEWAY_STATE_PATH: join(directory, "v1.json"), YNX_WALLET_GATEWAY_REGISTRY_PATH: join(root, "central-registry.json"), YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: target, YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: join(root, "product-session-registry.json"), YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION: "3", YNX_WALLET_GATEWAY_REMOTE_DEPLOYED: "false" };
  let child;
  const start = async () => { child = spawn(process.execPath, [daemon], { env, cwd: root }); await listening(child); };
  t.after(async () => { if (child) await stop(child); }); await start();
  const version = await (await fetch(`http://127.0.0.1:${port}/version`)).json(); assert.equal(version.service, "ynx-wallet-gatewayd");
  const instant = new Date(), body = { intentId: token("daemon-zero-session-intent"), intentIssuedAt: instant.toISOString(), intentExpiresAt: new Date(instant.getTime() + 600_000).toISOString() };
  const request = async label => {
    const now = new Date(), proof = createWalletSessionControlProof({ accountSecret: OWNER, method: "POST", path: ACCOUNT_PATH, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token(label), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30_000).toISOString() });
    const response = await fetch(`http://127.0.0.1:${port}${ACCOUNT_PATH}`, { method: "POST", headers: { origin: "https://wallet.ynxweb4.com", "content-type": "application/json", "x-request-id": `req_daemon_v3_${label}`, "x-ynx-wallet-control-proof-v2": encodeWalletSessionControlProofHeader(proof) }, body: canonicalJSON(body) });
    const parsed = await response.json(); assert.equal(response.status, 200, JSON.stringify(parsed)); return parsed;
  };
  const first = await request("first_00000001"); assert.equal(first.result.revocationConfirmed, true); assert.equal(first.result.receipt.revokedSessionCount, 0);
  await stop(child); await start();
  const retry = await request("retry_00000002"); assert.deepEqual(retry.result.receipt, first.result.receipt);
  const latest = JSON.parse(readFileSync(target, "utf8")); assert.equal(latest.schemaVersion, 2); assert.equal(latest.snapshot.schemaVersion, 3); assert.equal(latest.snapshot.controlIntents.length, 1);
  await stop(child);
  const wrongVersion = spawnSync(process.execPath, [daemon], { env: { ...env, YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION: "2" }, cwd: root, encoding: "utf8", timeout: 5000 });
  assert.notEqual(wrongVersion.status, 0); assert.match(wrongVersion.stderr, /state envelope is invalid/);
});

async function availablePort() { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function listening(child) {
  let output = "";
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`daemon failed to start: ${output}`)), 5000); const read = chunk => { output += chunk; if (output.includes('"event":"listening"')) { clearTimeout(timer); resolve(); } }; child.stdout.on("data", read); child.stderr.on("data", read); child.once("exit", code => { clearTimeout(timer); reject(new Error(`daemon exited ${code}: ${output}`)); }); });
}
async function stop(child) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
