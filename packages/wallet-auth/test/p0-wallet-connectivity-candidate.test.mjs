import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const candidate = JSON.parse(readFileSync(new URL("../integration/p0-wallet-connectivity-candidate.json", import.meta.url), "utf8"));

test("P0 wallet connectivity candidate keeps standard transport independent and Product Session optional", () => {
  assert.equal(candidate.status, "CANDIDATE");
  assert.equal(candidate.owner, "wallet-protocol");
  assert.deepEqual(candidate.contract.standardWalletConnection.independentOf, ["YNX Gateway", "Product Registry", "Product Session", "Data Fabric", "Monitor"]);
  assert.equal(candidate.contract.standardWalletConnection.ynxTestnet.evmChainId, 6423);
  assert.equal(candidate.contract.standardWalletConnection.ynxTestnet.evmChainHex, "0x1917");
  assert.equal(candidate.contract.standardWalletConnection.ynxTestnet.externalDappAccountFormat, "0x-prefixed EVM account only");
  assert.match(candidate.contract.productSession.failureRule, /Do not manufacture a local Product Session/);
});

test("P0 candidate requires durable callback state and error identity instead of generic offline/device-proof copy", () => {
  assert.deepEqual(candidate.contract.pendingCallback.recordFields, ["schemaVersion", "pendingId", "requestDigest", "nonce", "productClientId", "bundleId", "callback", "deviceKeyReference", "createdAt", "expiresAt", "state"]);
  assert.match(candidate.contract.pendingCallback.callbackRule, /exactly one response query field/);
  assert.match(candidate.contract.pendingCallback.rejectionRule, /CALLBACK_PENDING_MISSING/);
  assert.equal(candidate.errorContract.clientState.includes("PRIVATE_SERVICE_DEGRADED"), true);
  assert.equal(candidate.errorContract.rules.some(rule => rule.includes("Do not use Offline")), true);
  assert.equal(candidate.errorContract.rules.some(rule => rule.includes("UNKNOWN_OR_MISSING_FIELD") && rule.includes("PRODUCT_SESSION_PROTOCOL_REJECTED")), true);
  assert.equal(candidate.errorContract.rules.some(rule => rule.includes("INVALID_DEVICE_PROOF") && rule.includes("PRODUCT_SESSION_DEVICE_PROOF_REJECTED")), true);
});

test("P0 candidate records public runtime evidence without elevating it into successful end-to-end proof", () => {
  assert.equal(candidate.observedRuntime.health.truthfulStatus, "remote-canonical-wallet-gateway");
  assert.equal(candidate.observedRuntime.negativeSchemaProbe.code, "UNKNOWN_OR_MISSING_FIELD");
  assert.match(candidate.observedRuntime.limits.join("\n"), /not successful public end-to-end Wallet\/DApp evidence/);
  assert.equal(candidate.diagnosis.confirmed.some(item => item.id === "P0-DIAG-001"), true);
  assert.equal(candidate.diagnosis.notYetReproduced.length, 2);
});
