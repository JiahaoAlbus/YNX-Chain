#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/shop-android-retirement-registry-v3-95253de9-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.executionLeaseIssued, false);
  assert.equal(candidate.truth.publicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.publicClientRetirementVerified, false);
  assert.equal(candidate.truth.shopAndroidMigratedV2, false);
  assert.equal(candidate.truth.shopWebPwaMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.deployedPublic, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.walletProtocolSource.commit, acceptance.walletProtocolSourceCommit);
assert.equal(evidence.walletProtocolSource.remoteReadable, true);
assert.equal(evidence.shopOwnerSource.remoteReadable, true);
assert.equal(evidence.acceptedSourceBehavior.registrySchemaVersion, 3);
assert.equal(evidence.acceptedSourceBehavior.retiredPlatform, "android");
assert.equal(evidence.acceptedSourceBehavior.newAuthorizationHttpStatus, 410);
assert.equal(evidence.acceptedSourceBehavior.newAuthorizationCode, "CLIENT_RETIRED");
assert.equal(evidence.acceptedSourceBehavior.existingSessionsRevoked, true);
assert.equal(evidence.acceptedSourceBehavior.existingDeviceGrantsRevoked, true);
assert.equal(evidence.acceptedSourceBehavior.pendingChallengesPurged, true);
assert.equal(evidence.acceptedSourceBehavior.idempotencyCachePurged, true);
assert.equal(evidence.acceptedSourceBehavior.shopWebPwaRemainsRegistered, true);
assert.equal(evidence.deploymentBoundary.currentPublicRuntimeUsesRegistryV3, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-028");
assert.ok(task);
assert.equal(task.status, "SHOP_ANDROID_RETIREMENT_SOURCE_ACCEPTED_DEPLOYMENT_BLOCKED");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.executionLeaseIssued = true; },
    (a) => { a.truth.publicRuntimeUsesRegistryV3 = true; },
    (a) => { a.truth.publicClientRetirementVerified = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 Shop retirement promotion mutations rejected");
}
console.log("PASS Shop Android registry-v3 retirement accepted as source only; public and migration gates remain false");
