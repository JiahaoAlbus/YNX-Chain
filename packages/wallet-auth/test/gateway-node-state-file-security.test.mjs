import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import { NOW } from "./fixtures.mjs";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

function privateDirectory(root, name) {
  const directory = join(root, name);
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

function code(expected) {
  return caught => caught?.code === expected;
}

async function serve(host, run) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function probe(base) {
  const response = await fetch(`${base}/v1/wallet/not-registered`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { payload: await response.json(), status: response.status };
}

test("Gateway state reader rejects symlink, hard-link and non-regular paths without touching the target", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-state-path-security-"));
  const sourceDirectory = privateDirectory(root, "source");
  const attackDirectory = privateDirectory(root, "attack");
  const sourcePath = join(sourceDirectory, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath: sourcePath, now: () => NOW });
  const target = readFileSync(sourcePath, "utf8");

  const symlinkPath = join(attackDirectory, "symlink.json");
  symlinkSync(sourcePath, symlinkPath);
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath: symlinkPath, now: () => NOW }), code("STATE_UNAVAILABLE"));
  assert.equal(readFileSync(sourcePath, "utf8"), target);

  const hardLinkPath = join(attackDirectory, "hard-link.json");
  linkSync(sourcePath, hardLinkPath);
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath: hardLinkPath, now: () => NOW }), code("STATE_PERMISSIONS"));
  assert.equal(readFileSync(sourcePath, "utf8"), target);

  const directoryPath = privateDirectory(attackDirectory, "directory-state");
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath: directoryPath, now: () => NOW }), code("STATE_PERMISSIONS"));
  assert.equal(readFileSync(sourcePath, "utf8"), target);
});

test("Gateway state reader rejects broad file mode and noncanonical JSON without rewriting", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-state-content-security-"));
  const statePath = join(root, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const canonical = readFileSync(statePath, "utf8");

  chmodSync(statePath, 0o640);
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }), code("STATE_PERMISSIONS"));
  assert.equal(readFileSync(statePath, "utf8"), canonical);

  chmodSync(statePath, 0o600);
  const noncanonical = `${canonical}\n`;
  writeFileSync(statePath, noncanonical, { mode: 0o600 });
  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }), code("STATE_TAMPERED"));
  assert.equal(readFileSync(statePath, "utf8"), noncanonical);
});

test("runtime symlink replacement returns 503 with zero target mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-state-runtime-security-"));
  const activeDirectory = privateDirectory(root, "active");
  const targetDirectory = privateDirectory(root, "target");
  const statePath = join(activeDirectory, "state.json");
  const targetPath = join(targetDirectory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const target = readFileSync(statePath, "utf8");
  writeFileSync(targetPath, target, { mode: 0o600 });
  unlinkSync(statePath);
  symlinkSync(targetPath, statePath);

  await serve(host, async base => {
    const rejected = await probe(base);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.payload.error.code, "STATE_UNAVAILABLE");
  });
  assert.equal(readFileSync(targetPath, "utf8"), target);
});
