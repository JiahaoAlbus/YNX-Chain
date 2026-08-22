#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-website-runtime-source-production-20260820.json");
const ownerEvidence = readJson(acceptance.ownerPostdeployEvidence.path);
const evidence = readJson(acceptance.integrationDirectEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.installedWalletClientVerified, false);
  assert.equal(candidate.truth.accountVerified, false);
  assert.equal(candidate.truth.productsMigrated, 0);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
};

for (const artifact of [acceptance.ownerPostdeployEvidence, acceptance.integrationDirectEvidence]) {
  assert.equal(fs.statSync(path.join(root, artifact.path)).size, artifact.bytes);
  assert.equal(sha256(artifact.path), artifact.sha256);
}
assert.equal(ownerEvidence.truth.productMigrationsCompleted, 0);
assert.equal(ownerEvidence.truth.renderedVisibleCardVerifiedAfterDeployment, false);
assert.equal(evidence.officialProduction.websiteSourceCommit, "09d5be41436404bba74315d0013c0229cab1e32b");
assert.equal(evidence.officialProduction.deploymentId, "dpl_awLjPQTGudm2huQmNHPk9UpmugfV");
assert.equal(evidence.officialProduction.readyState, "READY");
for (const key of ["apexDocs", "wwwDocs", "apexRuntime", "wwwRuntime", "apexFrontendAsset", "wwwFrontendAsset"]) {
  assert.equal(evidence.publicReadback[key].status, 200);
}
assert.equal(evidence.publicReadback.apexDocs.bytes, 4748);
assert.equal(evidence.publicReadback.apexDocs.sha256, "d4ab589c6b113e95168d0d2d2032c1792c7d1ad990d287f298efb8b130bafa1f");
assert.equal(evidence.publicReadback.wwwDocs.status, evidence.publicReadback.apexDocs.status);
assert.equal(evidence.publicReadback.wwwDocs.bytes, evidence.publicReadback.apexDocs.bytes);
assert.equal(evidence.publicReadback.wwwDocs.sha256, evidence.publicReadback.apexDocs.sha256);
assert.equal(evidence.publicReadback.apexRuntime.bytes, 1900);
assert.equal(evidence.publicReadback.apexRuntime.sha256, "635fefdcc1cd5675a1787a9bf17c87102ccadd1c8232450be7b847333fe75941");
assert.equal(evidence.publicReadback.apexRuntime.runtimeSourceCommit, acceptance.walletAuthRuntimeSource);
assert.equal(evidence.publicReadback.wwwRuntime.runtimeSourceCommit, acceptance.walletAuthRuntimeSource);
assert.equal(evidence.publicReadback.apexFrontendAsset.sha256, "8726a271e7109da6883df6f09dd05345f3fc036f61d81dcf47c7a1e5b7bef11b");
assert.equal(evidence.visibleBrowserAcceptance.runtimeSourceShown, acceptance.walletAuthRuntimeSource);
assert.equal(evidence.visibleBrowserAcceptance.runtimeSourceMatchesPublicVersion, true);
assert.equal(evidence.visibleBrowserAcceptance.installedWalletClientVerifiedShown, false);
assert.equal(evidence.visibleBrowserAcceptance.accountSignSendTransactionOrChainDisconnectVerifiedShown, false);
assert.equal(evidence.visibleBrowserAcceptance.productsMigratedShown, 0);
assert.equal(evidence.visibleBrowserAcceptance.centralIntegrationShown, false);
assert.equal(evidence.visibleBrowserAcceptance.aggregatePublicReadinessShown, false);
validateTruth(evidence);
const task = queue.tasks.find((entry) => entry.taskId === "P0-023");
assert.ok(task);
assert.equal(task.status, "WEBSITE_RUNTIME_SOURCE_CORRECTED_VISIBLE_ACCEPTED");
assert.equal(task.productsMigrated, 0);
if (process.argv.includes("--self-test")) {
  const mutations = [
    (e) => { e.truth.installedWalletClientVerified = true; },
    (e) => { e.truth.accountVerified = true; },
    (e) => { e.truth.productsMigrated = 1; },
    (e) => { e.truth.integratedCentral = true; },
    (e) => { e.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(evidence);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 negative publication truth mutations rejected");
}
console.log("PASS Website apex+www publication and visible 6cf runtime source accepted; all client, product, central, aggregate, signing and store gates remain false");
