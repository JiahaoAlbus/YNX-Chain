#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-protocol-checkpoint-23f1198e-20260820.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.renderedCardAcceptedForOwnerObservedDeployment, false);
  assert.equal(candidate.truth.installedWalletClientVerified, false);
  assert.equal(candidate.truth.accountSignSendTransactionVerified, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerCheckpoint.commit, acceptance.ownerCheckpointCommit);
assert.equal(evidence.ownerCheckpoint.remoteReadbackExact, true);
assert.equal(evidence.card.sourceCommit, "e935b760413898cd1b206f4f816e1eb0e15b4663");
assert.equal(evidence.card.classification, "root-factory-source-only");
assert.equal(evidence.card.rootFactoryConsumed, true);
assert.equal(evidence.card.publicGatewayLifecycleForCardVerified, false);
assert.equal(evidence.card.installedOrBrowserVisibleFlowVerified, false);
assert.equal(evidence.card.migratedV2, false);
assert.equal(evidence.websiteTimelineAudit.ownerObservedSourceIsCurrentRemoteMain, false);
assert.equal(evidence.websiteTimelineAudit.ownerObservationSupersedesCentralAcceptance, false);
assert.equal(evidence.websiteTimelineAudit.centralVisibleAcceptanceIsDeploymentSpecific, true);
assert.equal(evidence.websiteTimelineAudit.publicReadback.runtimeSourceCommit, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(acceptance.accepted.ownerWebsiteObservationOverridesP0023, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-026");
assert.ok(task);
assert.equal(task.status, "CARD_SOURCE_ONLY_WEBSITE_TIMELINE_RECONCILED");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.renderedCardAcceptedForOwnerObservedDeployment = true; },
    (a) => { a.truth.installedWalletClientVerified = true; },
    (a) => { a.truth.integratedCentral = true; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 checkpoint promotion mutations rejected");
}
console.log("PASS Card remains source-only and Website observations remain deployment-scoped");
