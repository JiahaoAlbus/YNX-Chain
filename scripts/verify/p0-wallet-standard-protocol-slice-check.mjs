#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-standard-protocol-66782e91-20260820.json");
const candidate = readJson("packages/wallet-auth/integration/p0-wallet-connectivity-candidate.json");
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

assert.equal(acceptance.consumedCommit, "66782e91e36125f1a8b9985f652ca849d5a6117e");
for (const file of acceptance.files) {
  const absolute = path.join(root, file.path);
  assert.equal(fs.statSync(absolute).size, file.bytes);
  assert.equal(sha256(file.path), file.sha256);
}
assert.equal(candidate.contract.standardWalletConnection.ynxTestnet.evmChainId, 6423);
assert.equal(candidate.contract.standardWalletConnection.ynxTestnet.evmChainHex, "0x1917");
assert.match(candidate.contract.standardWalletConnection.gatewayFailureRule, /MUST NOT remove an established standard provider connection/);
assert.match(candidate.contract.productSession.failureRule, /Do not manufacture a local Product Session/);
assert.equal(acceptance.boundary.historicalRuntimeObservationSupersededBy, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(acceptance.boundary.productsMigrated, 0);
assert.equal(acceptance.boundary.installedInteropVerified, false);
assert.equal(acceptance.boundary.integratedCentral, false);
assert.equal(acceptance.boundary.aggregatePublic, false);
const task = queue.tasks.find((entry) => entry.taskId === "P0-018");
assert.ok(task);
assert.equal(task.status, "ACCEPTED_PROTOCOL_SOURCE_PRODUCT_CONSUMPTION_REQUIRED");
assert.equal(task.productsMigrated, 0);
console.log("PASS 66782e91 protocol slice: Standard Wallet remains independent, Product Session remains optional, historical runtime is superseded and product migration stays 0/12");
