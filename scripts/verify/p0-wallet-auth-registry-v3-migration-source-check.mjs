#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/registry-v3-state-migration-0a852480-20260821.json");
const migration = readJson("release/integration/p0-wallet-connectivity/evidence/registry-v3-state-migration-0a852480-20260821.json");
const preflight = readJson("release/integration/p0-wallet-connectivity/evidence/registry-v3-preflight-failure-890ef0f8-20260821.json");
const failedLease = readJson("release/integration/p0-wallet-connectivity/execution/wallet-auth-retired-client-registry-v3-lease-20260821.json");
const leases = readJson("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const truth = (candidate) => {
  assert.equal(candidate.migrationExecuted, false);
  assert.equal(candidate.candidateDeployedPublic, false);
  assert.equal(candidate.publicRegistryV3RetirementVerified, false);
  assert.equal(candidate.productsMigratedV2, 0);
  assert.equal(candidate.installedClientVerified, false);
  assert.equal(candidate.integratedCentral, false);
  assert.equal(candidate.aggregateDeployedPublic, false);
  assert.equal(candidate.productionSigned, false);
  assert.equal(candidate.storeReleased, false);
};

assert.equal(acceptance.source.commit, migration.remote.commit);
assert.equal(acceptance.source.parent, migration.remote.parent);
assert.equal(acceptance.source.tree, migration.remote.tree);
assert.equal(acceptance.source.walletAuthTree, migration.remote.walletAuthTree);
assert.equal(acceptance.source.evidenceBlob, migration.ownerEvidence.blob);
assert.equal(acceptance.source.evidenceSha256, migration.ownerEvidence.sha256);
assert.equal(acceptance.registryDigests.candidateArtifactSha256, migration.digestCorrection.newArtifactSha256);
assert.equal(acceptance.registryDigests.candidateStateBindingSha256, migration.digestCorrection.newStateBindingSha256);
assert.equal(acceptance.registryDigests.previousArtifactSha256, migration.digestCorrection.oldArtifactSha256);
assert.equal(acceptance.registryDigests.previousStateBindingSha256, migration.digestCorrection.oldStateBindingSha256);
assert.notEqual(acceptance.registryDigests.candidateArtifactSha256, acceptance.registryDigests.candidateStateBindingSha256);
assert.notEqual(acceptance.registryDigests.previousArtifactSha256, acceptance.registryDigests.previousStateBindingSha256);
assert.equal(migration.digestCorrection.correctVersionExpectation, acceptance.registryDigests.candidateStateBindingSha256);
assert.notEqual(migration.digestCorrection.correctVersionExpectation, acceptance.registryDigests.candidateArtifactSha256);
assert.equal(preflight.remote.commit, acceptance.failedLease.ownerEvidenceCommit);
assert.equal(preflight.preflight.registryArtifactSha256, acceptance.registryDigests.candidateArtifactSha256);
assert.equal(preflight.preflight.registryStateBindingSha256, acceptance.registryDigests.candidateStateBindingSha256);
assert.equal(preflight.transaction.backupCreated, false);
assert.equal(preflight.transaction.serviceStopped, false);
assert.equal(preflight.transaction.productionStateMutated, false);
assert.equal(failedLease.status, "INVALIDATED_FAILED_PREFLIGHT");
assert.equal(failedLease.executionState.deploymentStarted, false);
assert.equal(failedLease.executionState.leaseConsumed, true);
assert.equal(leases.heavy.status, "RELEASED_FAILED_PREFLIGHT");
assert.equal(leases.heavy.owner, null);
const task = queue.tasks.find((item) => item.taskId === "P0-040");
assert.ok(task);
assert.equal(task.status, "MIGRATION_SOURCE_ACCEPTED_DUAL_HASH_NO_LEASE");
assert.equal(task.executionLeaseIssued, false);
assert.equal(task.executionLeaseId, null);
assert.equal(task.productsMigrated, 0);
truth(acceptance.truth);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (t) => { t.migrationExecuted = true; },
    (t) => { t.candidateDeployedPublic = true; },
    (t) => { t.productsMigratedV2 = 1; },
    (t) => { t.integratedCentral = true; },
    (t) => { t.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance.truth);
    mutate(candidate);
    assert.throws(() => truth(candidate));
  }
  assert.throws(() => assert.equal(acceptance.registryDigests.candidateArtifactSha256, acceptance.registryDigests.candidateStateBindingSha256));
  assert.throws(() => assert.equal(acceptance.registryDigests.previousArtifactSha256, acceptance.registryDigests.previousStateBindingSha256));
  console.log("PASS 7/7 Registry v3 truth and digest-conflation mutations rejected");
}

console.log("PASS Registry v3 migration source and dual-hash contract accepted; failed lease remains invalid and no new lease exists");
