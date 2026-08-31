#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-public-readback-357ade64-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.registryV3ShopRetirementDeployedPublic, false);
  assert.equal(candidate.truth.installedWalletApprovalVerified, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerCheckpoint.commit, acceptance.ownerCheckpointCommit);
assert.equal(evidence.ownerCheckpoint.remoteReadable, true);
assert.equal(evidence.publicReadback.walletAuthVersion.status, 200);
assert.equal(evidence.publicReadback.walletAuthVersion.sourceCommit, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.publicReadback.apexAndWwwRuntimePublication.status, 200);
assert.equal(evidence.publicReadback.apexAndWwwRuntimePublication.sourceCommit, evidence.publicReadback.walletAuthVersion.sourceCommit);
assert.equal(evidence.transportBoundary.subsequentApexMultiRequestSampleHadTlsFailure, true);
assert.equal(evidence.transportBoundary.failedSampleUsedAsSuccessEvidence, false);
assert.equal(evidence.websiteTimeline.ownerReportedSourceIsRemoteMain, false);
assert.equal(evidence.websiteTimeline.overridesCentralP0023, false);
assert.equal(acceptance.accepted.registryV3ShopRetirementPublic, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-030");
assert.ok(task);
assert.equal(task.status, "PUBLIC_RUNTIME_IDENTITY_REFRESHED_REGISTRY_V3_STILL_FALSE");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.registryV3ShopRetirementDeployedPublic = true; },
    (a) => { a.truth.installedWalletApprovalVerified = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.integratedCentral = true; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 public-readback promotion mutations rejected");
}
console.log("PASS public Wallet/Auth and Website records bind exact 6cf source; registry v3 and client gates remain false");
