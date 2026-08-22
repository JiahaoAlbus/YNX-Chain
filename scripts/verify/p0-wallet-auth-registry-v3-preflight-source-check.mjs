#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/registry-v3-preflight-source-5d94dcd0-20260821.json");
const evidence = readJson("release/integration/p0-wallet-connectivity/evidence/registry-v3-preflight-source-review-5d94dcd0-20260821.json");
const campaign = readJson("release/integration/p0-wallet-connectivity/active-campaign.json");
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases = readJson("release/integration/p0-wallet-connectivity/execution-leases.json");

assert.equal(acceptance.sourceCommit, evidence.source.commit);
assert.equal(acceptance.sourceTree, evidence.source.tree);
assert.equal(acceptance.walletAuthTree, evidence.source.walletAuthTree);
assert.equal(acceptance.status, "SOURCE_ACCEPTED_EXECUTION_LEASE_BLOCKED");
assert.equal(evidence.independentReview.focusedTests.passed, 10);
assert.equal(evidence.independentReview.focusedTests.failed, 0);
assert.equal(evidence.independentReview.fullWalletAuthTests.passed, 345);
assert.equal(evidence.independentReview.fullWalletAuthTests.failed, 2);
assert.equal(evidence.independentReview.fullWalletAuthTests.reproducibleFromExactSource, false);
assert.equal(evidence.independentReview.package.repeatSha256Matched, true);
assert.equal(evidence.independentReview.package.sha256, "5c4713c50fe7cbcbca6dad673a689960c53822c68910db9701a3376d8269c126");
assert.equal(evidence.decision.sourceAccepted, true);
assert.equal(evidence.decision.executionLeaseIssued, false);
assert.equal(acceptance.executionLeaseIssued, false);
assert.equal(acceptance.executionLeaseId, null);
assert.equal(acceptance.productionMutationAuthorized, false);
assert.equal(acceptance.deployedPublic, false);
assert.equal(acceptance.publicVerified, false);
assert.equal(acceptance.productsMigrated, 0);
assert.equal(evidence.truthBoundary.currentPublicRuntimeSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(evidence.truthBoundary.registryV3DeployedPublic, false);
assert.equal(evidence.truthBoundary.productionMutation, false);
const task = queue.tasks.find((item) => item.taskId === "P0-044");
assert.ok(task);
assert.equal(task.sourceCommit, acceptance.sourceCommit);
assert.equal(task.status, acceptance.status);
assert.equal(task.executionLeaseIssued, false);
assert.equal(task.productionMutation, false);
assert.equal(task.productsMigrated, 0);
assert.ok(
  campaign.wave.executionScope === acceptance.status ||
  campaign.wave.executionScope === "HERMETIC_SOURCE_AND_PREFLIGHT_ACCEPTED_DEPLOYABLE_ARTIFACT_BLOCKED",
  "campaign must retain the historical source-only blocker or a stricter reviewed successor"
);
assert.equal(campaign.wave.executionLease, "NONE_P0_039_REMAINS_INVALID");
assert.equal(leases.heavy.owner, null);

if (process.argv.includes("--self-test")) {
  for (const [field, value] of [["executionLeaseIssued", true], ["productionMutationAuthorized", true], ["deployedPublic", true], ["publicVerified", true], ["productsMigrated", 1]]) {
    const candidate = structuredClone(acceptance);
    candidate[field] = value;
    assert.throws(() => assert.deepEqual(candidate, acceptance));
  }
  console.log("PASS 5/5 source-only truth mutations rejected");
}

console.log("PASS Registry v3 five-blocker source accepted; clean-clone full-suite and production-bound preflight still block any new execution lease");
