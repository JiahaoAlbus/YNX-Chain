import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJSON, parseCentralRegistryDocument } from "../src/index.js";
import { CanonicalWalletGatewayNodeHost } from "../src/gateway-node-host.js";
import { NOW } from "./fixtures.mjs";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

function alternateRegistry() {
  const registry = approvedRegistry();
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "pending-review";
  social.enabled = false;
  return registry;
}

function registryDigest(registry) {
  return createHash("sha256").update(canonicalJSON(parseCentralRegistryDocument(registry))).digest("hex");
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

test("Gateway state envelope v2 binds the exact parsed registry digest", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-registry-binding-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const envelope = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.registrySha256, registryDigest(registry));
  assert.deepEqual(Object.keys(envelope).sort(), ["registrySha256", "schemaVersion", "snapshot", "stateDigest"]);
  assert.deepEqual(new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }).snapshot(), host.snapshot());
});

test("same-version registry substitution fails closed without rewriting state", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-registry-substitution-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const before = readFileSync(statePath, "utf8");
  assert.notEqual(registryDigest(registry), registryDigest(alternateRegistry()));
  assert.throws(() => new CanonicalWalletGatewayNodeHost(alternateRegistry(), { statePath, now: () => NOW }), code("REGISTRY_STATE_MISMATCH"));
  assert.equal(readFileSync(statePath, "utf8"), before);
});

test("legacy state requires explicit one-time migration and becomes registry-bound", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-registry-migration-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const current = JSON.parse(readFileSync(statePath, "utf8"));
  const { registrySha256: _registrySha256, ...legacyFields } = current;
  const legacy = canonicalJSON({ ...legacyFields, schemaVersion: 1 });
  writeFileSync(statePath, legacy, { mode: 0o600 });

  assert.throws(() => new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }), code("LEGACY_STATE_MIGRATION_REQUIRED"));
  assert.equal(readFileSync(statePath, "utf8"), legacy);
  new CanonicalWalletGatewayNodeHost(registry, { allowLegacyStateMigration: true, statePath, now: () => NOW });
  const migrated = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.registrySha256, registryDigest(registry));
  assert.throws(() => new CanonicalWalletGatewayNodeHost(alternateRegistry(), { statePath, now: () => NOW }), code("REGISTRY_STATE_MISMATCH"));

  writeFileSync(statePath, legacy, { mode: 0o600 });
  assert.throws(() => new CanonicalWalletGatewayNodeHost(alternateRegistry(), { statePath, now: () => NOW }), code("LEGACY_STATE_MIGRATION_REQUIRED"));
  assert.equal(readFileSync(statePath, "utf8"), legacy);
});

test("runtime state downgrade or registry substitution returns 503 with zero rewrite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-registry-runtime-"));
  const statePath = join(directory, "state.json");
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const current = JSON.parse(readFileSync(statePath, "utf8"));
  const { registrySha256: _registrySha256, ...legacyFields } = current;
  const legacy = canonicalJSON({ ...legacyFields, schemaVersion: 1 });
  writeFileSync(statePath, legacy, { mode: 0o600 });
  await serve(host, async base => {
    const rejected = await probe(base);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.payload.error.code, "LEGACY_STATE_MIGRATION_REQUIRED");
  });
  assert.equal(readFileSync(statePath, "utf8"), legacy);

  const substituted = canonicalJSON({ ...current, registrySha256: registryDigest(alternateRegistry()) });
  writeFileSync(statePath, substituted, { mode: 0o600 });
  await serve(host, async base => {
    const rejected = await probe(base);
    assert.equal(rejected.status, 503);
    assert.equal(rejected.payload.error.code, "REGISTRY_STATE_MISMATCH");
  });
  assert.equal(readFileSync(statePath, "utf8"), substituted);
});
