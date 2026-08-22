#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/retired-client-recovery-bfc11ecb-lease-decision-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateDecision = (candidate) => {
  assert.equal(candidate.decision.centralSourceAccepted, true);
  assert.equal(candidate.decision.consumerSdkUseAccepted, true);
  assert.equal(candidate.decision.runtimeCandidateAccepted, false);
  assert.equal(candidate.decision.executionLeaseIssued, false);
  assert.equal(candidate.decision.executionLeaseId, null);
  assert.equal(candidate.decision.executionLeaseExpiresAt, null);
  assert.equal(candidate.decision.deploymentAuthorized, false);
  assert.equal(candidate.truth.bfcReconciledWithLatestCore, false);
  assert.equal(candidate.truth.currentPublicRuntimeUsesRegistryV3, false);
  assert.equal(candidate.truth.publicRegistryV3RetirementVerified, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.installedApprovalVerified, false);
  assert.equal(candidate.truth.computerControlVerified, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.acceptedSource.commit, acceptance.walletProtocolSourceCommit);
assert.equal(evidence.acceptedSource.centralAcceptanceScope, "consumer-source-only-no-deploy-lease");
assert.equal(evidence.latestCoreAuthority.commit, "92ae5404da908c0d649a3a62fd51bcc772e14efd");
assert.equal(evidence.latestCoreAuthority.containsProductPlatformStatus, false);
assert.equal(evidence.reconciliationAudit.bfcIsAncestorOfLatestCore, false);
assert.equal(evidence.reconciliationAudit.mergeBase, "cd90b96271b3881bfe6db134aa54c7bb90a29a62");
assert.equal(evidence.reconciliationAudit.walletAuthChangedPathCountBetweenHeads, 143);
assert.equal(evidence.reconciliationAudit.exactReconciledRuntimeCommitProvided, false);
assert.equal(evidence.currentPublicBoundary.sourceCommit, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.currentPublicBoundary.registryV3DeployedPublic, false);
assert.ok(evidence.requiredBeforeLease.requirements.length >= 7);
validateDecision(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-035");
assert.ok(task);
assert.equal(task.status, "BFC_SOURCE_ACCEPTED_RUNTIME_LEASE_RECONCILIATION_BLOCKED");
assert.equal(task.executionLeaseIssued, false);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.decision.runtimeCandidateAccepted = true; },
    (a) => { a.decision.executionLeaseIssued = true; },
    (a) => { a.decision.deploymentAuthorized = true; },
    (a) => { a.truth.bfcReconciledWithLatestCore = true; },
    (a) => { a.truth.productsMigratedV2 = 1; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateDecision(candidate));
  }
  console.log("PASS 5/5 premature bfc lease mutations rejected");
}
console.log("PASS bfc recovery source remains accepted; runtime lease blocked pending exact Core reconciliation");
