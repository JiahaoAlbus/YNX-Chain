#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/finance-product-session-source-consumption-f711745d-20260820.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.financeMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.approvalVerified, false);
  assert.equal(candidate.truth.callbackVerified, false);
  assert.equal(candidate.truth.revokeRestoreRetryVerified, false);
  assert.equal(candidate.truth.accountSignTransactionVerified, false);
  assert.equal(candidate.truth.productionInstalledClientVerified, false);
  assert.equal(candidate.truth.deployedPublic, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerSource.commit, acceptance.ownerSourceCommit);
assert.equal(evidence.ownerSource.remoteReadbackExact, true);
assert.equal(evidence.ownerSource.changedFiles, 21);
assert.equal(evidence.acceptedSourceBehavior.walletAuthSourceCommit, "203be5e108be468350591615a64d5d36ab87a8f1");
assert.equal(evidence.acceptedSourceBehavior.rootFactoryConsumed, true);
assert.equal(evidence.acceptedSourceBehavior.javascriptReceivesPrivateKey, false);
assert.equal(evidence.directEvidence.publicStateFreeChallengeMount.stateCreated, false);
assert.equal(evidence.directEvidence.disposableAndroidEmulator.walletSchemaMismatchRejected, true);
assert.equal(evidence.directEvidence.disposableAndroidEmulator.sessionCreated, false);
assert.equal(evidence.centralVerification.financeRootTestsPassed, 10);
assert.equal(evidence.centralVerification.financeMobileTestsPassed, 9);
assert.equal(evidence.centralVerification.financeMobileTypecheckPassed, true);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-027");
assert.ok(task);
assert.equal(task.status, "FINANCE_V2_SOURCE_CONSUMED_RUNTIME_ACCEPTANCE_BLOCKED");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.financeMigratedV2 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.approvalVerified = true; },
    (a) => { a.truth.productionInstalledClientVerified = true; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 Finance promotion mutations rejected");
}
console.log("PASS Finance consumed root factory source; approval, callback, migration and public gates remain false");
