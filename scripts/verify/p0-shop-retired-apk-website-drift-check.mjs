#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/shop-retired-apk-website-drift-432a0992-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.directTruth.shopAndroidListingStillBrowserVisible, true);
  assert.equal(candidate.directTruth.retiredApkStillPubliclyHosted, true);
  assert.equal(candidate.directTruth.retiredApkHeadHttpStatus, 200);
  assert.equal(candidate.truth.shopAndroidDownloadRemovedFromWebsite, false);
  assert.equal(candidate.truth.retiredApkRouteRemoved, false);
  assert.equal(candidate.truth.websiteRetirementConsistentWithRegistry, false);
  assert.equal(candidate.truth.currentPublicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.publicClientRetirementVerified, false);
  assert.equal(candidate.truth.computerControlVerified, false);
  assert.equal(candidate.truth.installedHistoricalApkRemotelyUninstalled, false);
  assert.equal(candidate.truth.shopAndroidMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerEvidence.commit, acceptance.walletProtocolEvidenceCommit);
assert.equal(evidence.ownerEvidence.remoteReadable, true);
assert.equal(evidence.ownerEvidence.browserVisible, true);
assert.equal(evidence.ownerEvidence.computerControlPassed, false);
assert.equal(evidence.publicDownloadPage.shopAndroidListed, true);
assert.equal(evidence.retiredApkDirectHead.httpStatus, 200);
assert.equal(evidence.retiredApkDirectHead.contentType, "application/vnd.android.package-archive");
assert.equal(evidence.retiredApkDirectHead.contentLength, 253733);
assert.equal(evidence.replacementWeb.centralFollowupTransportSucceeded, false);
assert.equal(evidence.replacementWeb.centralFollowupUsedAsSuccessEvidence, false);
assert.equal(evidence.requiredRemediation.owner, "website");
assert.equal(evidence.truthBoundary.registryV3DeployedPublic, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-032");
assert.ok(task);
assert.equal(task.status, "SHOP_RETIRED_APK_PUBLIC_DRIFT_BLOCKS_RETIREMENT");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.shopAndroidDownloadRemovedFromWebsite = true; },
    (a) => { a.truth.retiredApkRouteRemoved = true; },
    (a) => { a.truth.websiteRetirementConsistentWithRegistry = true; },
    (a) => { a.truth.publicClientRetirementVerified = true; },
    (a) => { a.truth.productsMigratedV2 = 1; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 retired-APK website promotion mutations rejected");
}
console.log("PASS retired Shop APK remains publicly hosted; Website remediation required and retirement/public gates remain false");
