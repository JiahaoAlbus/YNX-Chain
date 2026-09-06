import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const handoff = JSON.parse(readFileSync(new URL("../integration/p0-wallet-protocol-origin-binding-handoff.json", import.meta.url), "utf8"));

test("origin-binding handoff records exact candidate provenance without elevating runtime evidence", () => {
  assert.equal(handoff.runtimeSourceCommit, "5231e7509d6218bbbf25029cf73d456992cc37bd");
  assert.equal(handoff.protocol.authorizationVersion, "2");
  assert.equal(handoff.protocol.registryEntrySchema, 3);
  assert.equal(handoff.protocol.verifierVersion, "wallet-auth-v2");
  assert.deepEqual(handoff.releaseTruth, {
    deployedPublic: false,
    gatewayLoadedPublic: false,
    integratedCentral: false,
    installedClientVerified: false,
    productionSigned: false,
    storeReleased: false,
  });
});

test("origin-binding handoff preserves fail-closed migration and a non-inflated product matrix", () => {
  assert.match(handoff.protocol.legacyRecovery, /SESSION_RETIRED/);
  assert.match(handoff.protocol.nonInference, /No origin is derived/);
  assert.deepEqual(handoff.migrationMatrix.map((entry) => entry.product), ["Social", "Pay", "Shop", "Exchange", "Quant", "Developer", "Video", "Creator Studio", "Calendar", "Finance", "DEX", "Card"]);
  assert.equal(handoff.migrationMatrix.every((entry) => entry.status !== "MIGRATED"), true);
  assert.match(handoff.integrationRequest, /reviewed enabled registry webOrigins/);
});
