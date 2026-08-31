#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-website-visible-drift-f6ef9d76-20260820.json");
const evidence = readJson(acceptance.driftEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidateAcceptance, candidateEvidence) => {
  assert.equal(candidateEvidence.comparison.visibleDocsRuntimeSourceMatchesCurrentPublicVersion, false);
  assert.equal(candidateEvidence.truth.installedWalletDetected, false);
  assert.equal(candidateEvidence.truth.accountVerified, false);
  assert.equal(candidateAcceptance.truth.productsMigrated, 0);
  assert.equal(candidateAcceptance.truth.aggregateDeployedPublic, false);
};

assert.equal(acceptance.ownerCheckpointCommit, "f6ef9d76dd3a33c9c12b56f0183e700863301cb5");
for (const artifact of [acceptance.driftEvidence, acceptance.screenshot]) {
  assert.equal(fs.statSync(path.join(root, artifact.path)).size, artifact.bytes);
  assert.equal(sha256(artifact.path), artifact.sha256);
}
assert.equal(evidence.visibleWalletAuthCard.runtimeSourceShown, "49e30d999e9a9cbdd2c565021009f2cab0dc125c");
assert.equal(evidence.comparison.currentPublicWalletAuthVersionSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.comparison.visibleDocsRuntimeSourceMatchesCurrentPublicVersion, false);
assert.equal(evidence.truth.computerControlProductSessionFlowVerified, false);
assert.equal(evidence.truth.installedWalletDetected, false);
assert.equal(evidence.truth.accountVerified, false);
assert.equal(evidence.truth.signingVerified, false);
assert.equal(evidence.truth.transactionVerified, false);
assert.equal(acceptance.truth.productsMigrated, 0);
assert.equal(acceptance.truth.integratedCentral, false);
assert.equal(acceptance.truth.aggregateDeployedPublic, false);
assert.equal(acceptance.truth.productionSigned, false);
assert.equal(acceptance.truth.storeReleased, false);
validateTruth(acceptance, evidence);
const task = queue.tasks.find((entry) => entry.taskId === "P0-022");
assert.ok(task);
assert.equal(task.status, "ACCEPTED_VISIBLE_DRIFT_EVIDENCE_CORRECTION_REQUIRED");
assert.equal(task.productsMigrated, 0);
if (process.argv.includes("--self-test")) {
  const mutations = [
    (a, e) => { e.comparison.visibleDocsRuntimeSourceMatchesCurrentPublicVersion = true; },
    (a, e) => { e.truth.installedWalletDetected = true; },
    (a, e) => { e.truth.accountVerified = true; },
    (a) => { a.truth.productsMigrated = 1; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const a = structuredClone(acceptance);
    const e = structuredClone(evidence);
    mutate(a, e);
    assert.throws(() => validateTruth(a, e));
  }
  console.log("PASS 5/5 negative truth mutations rejected");
}
console.log("PASS Wallet/Auth Website pre-correction visible drift is frozen without promoting any client, product, integration, signing or store gate");
