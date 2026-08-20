#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, p))).digest("hex");
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-sdk-authoritative-origin-203be5e1-20260820.json");
const ownerAudit = readJson(acceptance.ownerAudit.path);
const checkpoint = readJson(acceptance.sdkCheckpoint.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.artifactPublished, false);
  assert.equal(candidate.truth.npmRegistryPublished, false);
  assert.equal(candidate.truth.productsMigrated, 0);
  assert.equal(candidate.truth.installedWalletClientVerified, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
};

for (const artifact of [acceptance.ownerAudit, acceptance.sdkCheckpoint]) {
  assert.equal(fs.statSync(path.join(root, artifact.path)).size, artifact.bytes);
  assert.equal(sha256(artifact.path), artifact.sha256);
}
assert.equal(acceptance.ownerSourceCommit, "203be5e108be468350591615a64d5d36ab87a8f1");
assert.equal(ownerAudit.acceptedRuntime.origin, "https://wallet-auth.ynxweb4.com");
assert.equal(ownerAudit.acceptedRuntime.sourceCommit, acceptance.acceptedRuntimeSource);
assert.equal(ownerAudit.acceptedRuntime.versionBuildIdentifiable, true);
assert.equal(ownerAudit.historicalAggregateOrigin.origin, "https://rest.ynxweb4.com");
assert.equal(ownerAudit.historicalAggregateOrigin.versionStatus, 405);
assert.equal(ownerAudit.historicalAggregateOrigin.versionBuildIdentifiable, false);
assert.equal(ownerAudit.decision.callerMayOverrideFactoryOrigin, false);
assert.equal(checkpoint.centralVerification.focusedTestsPassed, 18);
assert.equal(checkpoint.centralVerification.fullWalletAuthTestsPassed, 240);
assert.equal(checkpoint.centralVerification.packageDryRun.name, "@ynx-chain/wallet-auth");
assert.equal(checkpoint.centralVerification.packageDryRun.files, 69);
assert.equal(checkpoint.centralVerification.packageDryRun.factoryIncluded, true);
assert.equal(checkpoint.centralVerification.packageDryRun.typesIncluded, true);
assert.equal(checkpoint.decision.productFactoryOrigin, acceptance.acceptedOrigin);
assert.equal(checkpoint.decision.probeDefaultOrigin, acceptance.acceptedOrigin);
assert.equal(checkpoint.decision.lifecycleDefaultOrigin, acceptance.acceptedOrigin);
assert.equal(checkpoint.decision.callerMayOverrideFactoryOrigin, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-024");
assert.ok(task);
assert.equal(task.status, "SDK_AUTHORITATIVE_ORIGIN_SOURCE_ACCEPTED_PRODUCTS_UNMIGRATED");
assert.equal(task.productsMigrated, 0);
if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.artifactPublished = true; },
    (a) => { a.truth.npmRegistryPublished = true; },
    (a) => { a.truth.productsMigrated = 1; },
    (a) => { a.truth.installedWalletClientVerified = true; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 negative SDK truth mutations rejected");
}
console.log("PASS Wallet/Auth SDK pins the build-identifiable wallet-auth origin; source checkpoint accepted with 0/12 products and no package publication claim");
