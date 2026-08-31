#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/shop-retired-apk-website-remediation-df7778fc-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.acceptedDirectTruth.websiteAndroidDownloadRemovalVerified, true);
  assert.equal(candidate.acceptedDirectTruth.retiredBinaryHosted, false);
  assert.equal(candidate.acceptedDirectTruth.retirementStatusRoutePublic, true);
  assert.equal(candidate.acceptedDirectTruth.retiredRouteHttpStatus, 410);
  assert.equal(candidate.acceptedDirectTruth.retiredRouteBodyExact, true);
  assert.equal(candidate.acceptedDirectTruth.automaticRedirect, false);
  assert.equal(candidate.acceptedDirectTruth.websiteRetirementConsistentWithRegistry, true);
  assert.equal(candidate.truth.deploymentSourceCommitDirectlyBound, false);
  assert.equal(candidate.truth.currentPublicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.publicRegistryV3RetirementVerified, false);
  assert.equal(candidate.truth.shopWebPwaRootFactoryMigrated, false);
  assert.equal(candidate.truth.shopProductMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.installedApprovalVerified, false);
  assert.equal(candidate.truth.computerControlVerified, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerEvidence.commit, acceptance.walletProtocolEvidenceCommit);
assert.equal(evidence.ownerEvidence.remoteReadable, true);
assert.equal(evidence.visibleDownloadPage.shopAndroidDownloadLinkPresent, false);
assert.equal(evidence.visibleDownloadPage.shopWebLink, "https://shop.ynxweb4.com/shop/");
assert.equal(evidence.retiredApkRoute.centralHttpStatus, 410);
assert.equal(evidence.retiredApkRoute.bytes, 175);
assert.equal(evidence.retiredApkRoute.sha256, "be1e83c77bcde293bf9b6f5db06b15a7c5c958b666f4f277a831984553e9b34c");
assert.equal(evidence.retiredApkRoute.body.code, "CLIENT_RETIRED");
assert.equal(evidence.retiredApkRoute.body.automaticRedirect, false);
assert.equal(new URL(evidence.retiredApkRoute.body.replacementUrl).origin, "https://shop.ynxweb4.com");
assert.equal(evidence.retiredApkRoute.laterTimeoutsUsedAsSuccessEvidence, false);
assert.equal(evidence.walletAuthRuntime.httpStatus, 200);
assert.equal(evidence.walletAuthRuntime.bytes, 301);
assert.equal(evidence.walletAuthRuntime.sourceCommit, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.walletAuthRuntime.registryV3DeployedPublic, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-034");
assert.ok(task);
assert.equal(task.status, "SHOP_WEBSITE_RETIREMENT_REMEDIATED_REGISTRY_V3_STILL_FALSE");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.currentPublicRuntimeUsesRegistryV3 = true; },
    (a) => { a.truth.publicRegistryV3RetirementVerified = true; },
    (a) => { a.truth.shopProductMigratedV2 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 Website-remediation promotion mutations rejected");
}
console.log("PASS Shop Website retirement remediated; Gateway Registry v3, migration and aggregate gates remain false");
