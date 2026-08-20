#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/shop-retired-client-recovery-bfc11ecb-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.priorRegistryV3AcceptanceExtended, false);
  assert.equal(candidate.truth.executionLeaseIssued, false);
  assert.equal(candidate.truth.currentPublicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.publicRetiredClientRecoveryVerified, false);
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
assert.equal(evidence.acceptedSourceBehavior.rootExport, "productPlatformStatus");
assert.equal(evidence.acceptedSourceBehavior.retiredCode, "CLIENT_RETIRED");
assert.equal(evidence.acceptedSourceBehavior.statusAuthority, "none");
assert.equal(evidence.acceptedSourceBehavior.productSessionAuthority, false);
assert.deepEqual(evidence.acceptedSourceBehavior.actions, ["open-replacement", "return-to-product"]);
assert.equal(new URL(evidence.acceptedSourceBehavior.replacementUrl).origin, "https://shop.ynxweb4.com");
assert.equal(evidence.acceptedSourceBehavior.replacementBoundToRegisteredWebOrigin, true);
assert.equal(evidence.acceptedSourceBehavior.automaticRedirectAllowed, false);
assert.equal(evidence.acceptedSourceBehavior.shopWebRemainsActive, true);
assert.equal(evidence.acceptedSourceBehavior.shopAndroidAuthorityRemainsRevoked, true);
assert.equal(evidence.acceptanceBoundary.priorAcceptanceAppliesOnlyTo, "95253de9c502335285dbb626ebd7ae37c14d6e5f");
assert.equal(evidence.acceptanceBoundary.thisExtensionSourceAccepted, true);
assert.equal(evidence.acceptanceBoundary.thisExtensionDeploymentLeaseIssued, false);
assert.equal(evidence.acceptanceBoundary.currentPublicRuntimeUsesRegistryV3, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-031");
assert.ok(task);
assert.equal(task.status, "RETIRED_CLIENT_RECOVERY_SOURCE_ACCEPTED_PUBLIC_FALSE");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.priorRegistryV3AcceptanceExtended = true; },
    (a) => { a.truth.executionLeaseIssued = true; },
    (a) => { a.truth.currentPublicRuntimeUsesRegistryV3 = true; },
    (a) => { a.truth.publicRetiredClientRecoveryVerified = true; },
    (a) => { a.truth.productsMigratedV2 = 1; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 retired-client recovery promotion mutations rejected");
}
console.log("PASS retired-client recovery accepted as source only; redirect, public and migration gates remain false");
