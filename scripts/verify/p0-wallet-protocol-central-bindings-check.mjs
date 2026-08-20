#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-protocol-central-bindings-f1862562-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.acceptedBindings.p0034WebsiteRemediation, true);
  assert.equal(candidate.acceptedBindings.p0035SafeRetirementSource, true);
  assert.equal(candidate.acceptedBindings.ownerTruthMatchesCentral, true);
  assert.equal(candidate.truth.reconciledRuntimeProvided, false);
  assert.equal(candidate.truth.executionLeaseIssued, false);
  assert.equal(candidate.truth.executionLeaseId, null);
  assert.equal(candidate.truth.executionLeaseExpiresAt, null);
  assert.equal(candidate.truth.deploymentAuthorized, false);
  assert.equal(candidate.truth.currentPublicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.installedApprovalVerified, false);
  assert.equal(candidate.truth.computerControlVerified, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.ownerCheckpoint.commit, acceptance.ownerCheckpointCommit);
assert.equal(evidence.ownerCheckpoint.remoteReadable, true);
assert.equal(evidence.ownerCheckpoint.changedFiles, 2);
assert.equal(evidence.centralBindings.websiteRemediation.centralCommit, "27b87b94fbd5603f3ed7c56f4ac3f270e5484a9d");
assert.equal(evidence.centralBindings.websiteRemediation.ownerEvidenceCommit, "df7778fca133818d3d69ec4ca149bfe35d77a280");
assert.equal(evidence.centralBindings.websiteRemediation.promotedGatewayRuntime, false);
assert.equal(evidence.centralBindings.retirementExtension.centralCommit, "f1a394aaa4ca7d9423a0fa779f06cd36b58e1312");
assert.equal(evidence.centralBindings.retirementExtension.acceptedSourceCommit, "bfc11ecb4100725ae8f42c86d220fa0bc2d8212a");
assert.equal(evidence.centralBindings.retirementExtension.reconciledRuntimeProvided, false);
assert.equal(evidence.centralBindings.retirementExtension.deploymentLeaseIssued, false);
assert.equal(evidence.publicBoundary.walletAuthRuntimeSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.publicBoundary.registryV3DeployedPublic, false);
assert.equal(evidence.coordination.coreOwnerReconciliationRequested, true);
assert.equal(evidence.coordination.coreOwnerReconciliationCompleted, false);
assert.equal(evidence.coordination.sshOrDeploymentAuthorized, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-036");
assert.ok(task);
assert.equal(task.status, "OWNER_ACK_BINDINGS_ACCEPTED_RECONCILIATION_STILL_PENDING");
assert.equal(task.executionLeaseIssued, false);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.reconciledRuntimeProvided = true; },
    (a) => { a.truth.executionLeaseIssued = true; },
    (a) => { a.truth.deploymentAuthorized = true; },
    (a) => { a.truth.currentPublicRuntimeUsesRegistryV3 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 owner-ack promotion mutations rejected");
}
console.log("PASS owner checkpoint binds P0-034/P0-035 exactly; reconciliation, lease and deployment remain false");
