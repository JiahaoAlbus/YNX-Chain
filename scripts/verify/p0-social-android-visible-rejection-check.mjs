#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/social-android-visible-rejection-ae6c2729-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.acceptedDirectTruth.api36EmulatorOnline, true);
  assert.equal(candidate.acceptedDirectTruth.canonicalAuthorizeResolverExact, true);
  assert.equal(candidate.acceptedDirectTruth.rejectReturnedToSocial, true);
  assert.equal(candidate.acceptedDirectTruth.rejectCreatedNoSession, true);
  assert.equal(candidate.acceptedDirectTruth.coldSecondLaunchNoResurrection, true);
  assert.equal(candidate.acceptedDirectTruth.socialBackendTlsHealthy, false);
  assert.equal(candidate.truth.classificationCanonicalLauncherV1, true);
  assert.equal(candidate.truth.approveClicked, false);
  assert.equal(candidate.truth.productSessionV2RequestVerified, false);
  assert.equal(candidate.truth.productSessionApproved, false);
  assert.equal(candidate.truth.productSessionIntrospected, false);
  assert.equal(candidate.truth.revokeVerified, false);
  assert.equal(candidate.truth.networkLossRetryVerified, false);
  assert.equal(candidate.truth.requestIdVisible, false);
  assert.equal(candidate.truth.physicalDeviceVerified, false);
  assert.equal(candidate.truth.computerControlVerified, false);
  assert.equal(candidate.truth.socialMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.accountAuthorityCreated, false);
  assert.equal(candidate.truth.signVerified, false);
  assert.equal(candidate.truth.transactionVerified, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerEvidence.commit, acceptance.walletProtocolEvidenceCommit);
assert.equal(evidence.ownerEvidence.remoteReadable, true);
assert.equal(evidence.target.androidApi, 36);
assert.equal(evidence.installedPackages.wallet.versionName, "1.0.4-testnet-preview");
assert.equal(evidence.installedPackages.social.versionName, "1.0.0");
assert.equal(evidence.installedPackages.shop.installed, false);
assert.equal(evidence.resolver.activityCount, 1);
assert.equal(evidence.resolver.resolvedActivity, "com.ynxweb4.wallet/.MainActivity");
assert.equal(evidence.visibleFlow.socialBackendTlsHealthy, false);
assert.equal(evidence.visibleFlow.walletApprovalVisible, true);
assert.equal(evidence.visibleFlow.approveClicked, false);
assert.equal(evidence.visibleFlow.rejectClicked, true);
assert.equal(evidence.visibleFlow.productSessionCreated, false);
assert.equal(evidence.secondLaunch.rejectedSessionResurrected, false);
assert.equal(evidence.secondLaunch.fabricatedAccountBalanceTransactionOrChainState, false);
assert.equal(evidence.screenshots.length, 4);
assert.equal(evidence.truthBoundary.classification, "canonical-launcher-v1");
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-033");
assert.ok(task);
assert.equal(task.status, "SOCIAL_ANDROID_REJECTION_VISIBLE_V1_ACCEPTED_V2_BLOCKED");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.productSessionApproved = true; },
    (a) => { a.truth.productSessionIntrospected = true; },
    (a) => { a.truth.socialMigratedV2 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.computerControlVerified = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 Social Android promotion mutations rejected");
}
console.log("PASS Social Android canonical-launcher-v1 rejection accepted; TLS, v2, migration and production gates remain false");
