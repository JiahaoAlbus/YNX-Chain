#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/retired-client-core-runtime-deb2cefb-lease-20260821.json");
const sourceAcceptance = readJson(acceptance.sourceAcceptancePath);
const evidence = readJson("release/integration/p0-wallet-connectivity/evidence/retired-client-core-runtime-deb2cefb-20260821.json");
const lease = readJson("release/integration/p0-wallet-connectivity/execution/wallet-auth-retired-client-registry-v3-lease-20260821.json");
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases = readJson("release/integration/p0-wallet-connectivity/execution-leases.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.candidateDeployedPublic, false);
  assert.equal(candidate.publicRegistryV3RetirementVerified, false);
  assert.equal(candidate.shopWebPreservedPublic, false);
  assert.equal(candidate.installedClientVerified, false);
  assert.equal(candidate.productRuntimeMigrations, 0);
  assert.equal(candidate.integratedCentral, false);
  assert.equal(candidate.aggregatePublic, false);
  assert.equal(candidate.productionSigned, false);
  assert.equal(candidate.storeReleased, false);
};

assert.equal(acceptance.source.commit, lease.source.candidateRuntimeCommit);
assert.equal(acceptance.source.tree, lease.source.candidateTree);
assert.equal(acceptance.source.walletAuthTree, lease.source.candidateWalletAuthTree);
assert.equal(acceptance.source.registryBlob, lease.registry.blob);
assert.equal(acceptance.source.registrySha256, lease.registry.sha256);
assert.equal(sourceAcceptance.taskId, "P0-038");
assert.equal(sourceAcceptance.sourceCommit, lease.source.candidateRuntimeCommit);
assert.equal(sourceAcceptance.executionLeaseIssued, false);
assert.equal(evidence.ownerSource.commit, lease.source.candidateRuntimeCommit);
assert.equal(evidence.ownerSource.versionReportsRegistrySchemaVersion, 3);
assert.equal(evidence.artifactIdentity.sourceArchiveSha256, lease.source.sourceArchiveSha256);
assert.equal(evidence.artifactIdentity.inventorySha256, lease.source.sourceInventorySha256);
assert.equal(evidence.artifactIdentity.packageLockSha256, lease.source.packageLockSha256);
assert.equal(lease.status, "INVALIDATED_FAILED_PREFLIGHT");
assert.equal(lease.singleUse, true);
assert.equal(lease.reusable, false);
assert.equal(lease.authorization.executionAuthorized, false);
assert.equal(lease.authorization.caddyChangeAllowed, false);
assert.equal(lease.authorization.baseSystemdUnitChangeAllowed, false);
assert.equal(lease.authorization.readWritePathsExpansionAllowed, false);
assert.equal(lease.stateIsolation.oldRegistryDigestMigrationRequired, true);
assert.equal(lease.stateIsolation.sharedProductionStateMutationDuringDrillAllowed, false);
assert.equal(lease.rollbackDrill.requiredBeforeFinalActivation, true);
assert.equal(lease.publicAcceptance.versionRegistrySchemaVersion, 3);
assert.deepEqual(lease.publicAcceptance.actionsExact, ["open-replacement", "return-to-product"]);
assert.equal(lease.executionState.deploymentStarted, false);
assert.equal(lease.executionState.leaseConsumed, true);
assert.equal(lease.issuanceBlocker.productionMutation, false);
assert.equal(lease.issuanceBlocker.blockers.length, 5);
validateTruth(lease.truth);

const task = queue.tasks.find((item) => item.taskId === "P0-039");
assert.ok(task);
assert.equal(task.status, "LEASE_INVALIDATED_FAILED_CLOSED_PREFLIGHT");
assert.equal(task.executionLeaseIssued, false);
assert.equal(task.executionLeaseId, lease.leaseId);
assert.equal(task.leaseCandidateId, lease.leaseCandidateId);
assert.equal(task.productsMigrated, 0);
assert.equal(leases.heavy.taskId, "P0-039");
assert.equal(leases.heavy.owner, null);
assert.equal(leases.heavy.status, "RELEASED_FAILED_PREFLIGHT");
assert.equal(leases.epoch, 13);
assert.ok(leases.queue.includes("wallet-auth-core:registry-v3@failed-preflight-890ef0f8"));

if (process.argv.includes("--self-test")) {
  const mutations = [
    (t) => { t.candidateDeployedPublic = true; },
    (t) => { t.publicRegistryV3RetirementVerified = true; },
    (t) => { t.productRuntimeMigrations = 1; },
    (t) => { t.integratedCentral = true; },
    (t) => { t.aggregatePublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(lease.truth);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 retired-client public-truth mutations rejected");
}

console.log("PASS Registry v3 lease invalidated after read-only failed preflight; Heavy released and public truth remains false");
