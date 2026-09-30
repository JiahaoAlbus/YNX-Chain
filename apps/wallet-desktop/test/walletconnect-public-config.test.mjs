import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicWalletConnectConfig, loadPublicWalletConnectConfig, parsePublicWalletConnectConfig } from "../src/walletconnect-public-config.mjs";
const projectId = "a".repeat(32);
test("final package loads public Pair config with an empty user environment", async () => {
  const shipped = buildPublicWalletConnectConfig({ YNX_WALLETCONNECT_PROJECT_ID: projectId, API_SECRET: "must-never-be-packaged" });
  assert.deepEqual(Object.keys(shipped).sort(), ["chainId", "projectId", "schemaVersion"]);
  const loaded = await loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async file => { assert.equal(file, "/qa/resources/ynx-wallet-walletconnect-config.json"); return Buffer.from(JSON.stringify(shipped)); } });
  assert.deepEqual(loaded, shipped);
});
test("missing genuine Project ID remains unconfigured; malformed config never downgrades silently", async () => {
  assert.equal(buildPublicWalletConnectConfig({}).projectId, null);
  const missing = await loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } });
  assert.equal(missing.projectId, null);
  for (const change of [{ chainId: "eip155:1" }, { projectId: "wc:secret@2?secret=value" }, { secret: "hidden" }, { schemaVersion: 2 }]) assert.throws(() => parsePublicWalletConnectConfig({ ...buildPublicWalletConnectConfig({}), ...change }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
  await assert.rejects(() => loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async () => Buffer.alloc(2049) }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
  await assert.rejects(() => loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: { YNX_WALLETCONNECT_PROJECT_ID: "invalid" }, read: async () => Buffer.from(JSON.stringify(buildPublicWalletConnectConfig({ YNX_WALLETCONNECT_PROJECT_ID: projectId }))) }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
});
