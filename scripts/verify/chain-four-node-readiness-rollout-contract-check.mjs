#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractPath = path.join(root, "release/integration/chain-four-node-readiness-global-rollback-contract-20260831.json");

function validate(contract) {
  assert.equal(contract.schemaVersion, "ynx-chain-four-node-readiness-global-rollback-contract/v1");
  assert.equal(contract.scope, "chain-only");
  assert.match(contract.candidate.commit, /^[0-9a-f]{40}$/);
  assert.match(contract.candidate.tree, /^[0-9a-f]{40}$/);
  assert.equal(contract.candidate.artifactFrozen, false);
  assert.match(contract.acceptedZeroWriteInspector.commit, /^[0-9a-f]{40}$/);
  assert.match(contract.acceptedZeroWriteInspector.sha256, /^[0-9a-f]{64}$/);
  assert.equal(contract.acceptedZeroWriteInspector.trailingByteRegression.bytes, 3);
  assert.equal(contract.acceptedZeroWriteInspector.trailingByteRegression.base64, "eAoK");
  assert.equal(contract.acceptedZeroWriteInspector.trailingByteRegression.sha256, "d1329c6d1284e888680db5b03619fc08bdf1ee0b172c946ca6d1f18f5ea40d61");

  const roles = contract.targets.map(({ role }) => role);
  assert.deepEqual(roles, ["singapore", "silicon-valley", "seoul", "primary"]);
  assert.equal(new Set(contract.targets.map(({ host }) => host)).size, 4);
  assert.equal(new Set(contract.targets.map(({ identityReference }) => identityReference)).size, 4);
  for (const target of contract.targets) {
    assert.match(target.host, /^\d{1,3}(?:\.\d{1,3}){3}$/);
    assert.match(target.identityReference, /^[A-Z][A-Z0-9_]+$/);
  }

  assert.equal(contract.initialStatePolicy.crossNodeEqualityRequiredBeforeWrite, false);
  assert.equal(contract.initialStatePolicy.perNodeExactBindingRequired, true);
  assert.deepEqual(contract.initialStatePolicy.requiredFileFacts, ["currentBinary", "currentManifest", "rollbackBinary", "rollbackManifest"]);
  assert.deepEqual(contract.initialStatePolicy.requiredLoopbackProbes, ["health", "status", "nodeIdentity", "peerSync"]);
  assert.equal(contract.existingExecutorAudit.path, "scripts/ops/deploy-bounded-replication-recovery.sh");
  assert.match(contract.existingExecutorAudit.blob, /^[0-9a-f]{40}$/);
  assert.match(contract.existingExecutorAudit.sha256, /^[0-9a-f]{64}$/);
  assert.equal(contract.existingExecutorAudit.eligibleForCandidateDeployment, false);
  assert.equal(contract.existingExecutorAudit.reuseAllowed, false);
  assert.equal(contract.existingExecutorAudit.failClosedFindings.length, 5);
  assert.deepEqual(contract.rollout.order, roles);
  assert.equal(contract.rollout.parallelNodeMutation, false);
  assert.equal(contract.rollout.attemptLimitPerNode, 1);
  assert.equal(contract.rollout.nodeFailure.completionAllowed, false);
  assert.equal(contract.rollout.nodeFailure.rollbackFailedNode, true);
  assert.equal(contract.rollout.nodeFailure.rollbackPreviouslyPromotedNodesInReverseOrder, true);
  assert.equal(contract.rollout.nodeFailure.continueForwardAfterFailure, false);
  assert.equal(contract.rollout.globalSuccess.requiresAllFourNodes, true);
  assert.equal(contract.rollout.globalSuccess.requiresReadyValidatorCount, 4);
  assert.equal(contract.rollout.globalSuccess.partialPromotionCountsAsCompletion, false);
  assert.equal(contract.rollback.historicalBackupMayReplaceFreshBackup, false);
  assert.equal(contract.rollback.cleanupDuringRollback, false);
  assert.equal(contract.rollback.completionAfterRollback, false);
  assert.ok(contract.forbiddenMutations.includes("transactions"));
  assert.ok(contract.forbiddenMutations.includes("validator identity or key changes"));
  assert.equal(contract.truth.sourceContractPrepared, true);
  for (const key of ["fourNodeInspectionExecuted", "candidateArtifactFrozen", "literalExecutorFrozen", "deploymentLeaseIssued", "deploymentExecuted", "allFourNodesPromoted", "globalReadinessProved"]) {
    assert.equal(contract.truth[key], false, `${key} must remain false`);
  }
  assert.equal(contract.singleExecutableBlocker, "CHAIN_FOUR_NODE_ZERO_WRITE_INSPECTION_AND_PER_NODE_CURRENT_ROLLBACK_TUPLES_REQUIRED_BEFORE_LITERAL_EXECUTOR_FREEZE");
}

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
validate(contract);

for (const mutate of [
  (copy) => { copy.targets.pop(); },
  (copy) => { copy.existingExecutorAudit.reuseAllowed = true; },
  (copy) => { copy.rollout.parallelNodeMutation = true; },
  (copy) => { copy.rollout.nodeFailure.continueForwardAfterFailure = true; },
  (copy) => { copy.rollout.nodeFailure.rollbackPreviouslyPromotedNodesInReverseOrder = false; },
  (copy) => { copy.rollout.globalSuccess.partialPromotionCountsAsCompletion = true; },
  (copy) => { copy.rollback.historicalBackupMayReplaceFreshBackup = true; },
  (copy) => { copy.truth.deploymentExecuted = true; },
]) {
  const copy = structuredClone(contract);
  mutate(copy);
  assert.throws(() => validate(copy));
}

console.log("chain four-node readiness rollout contract check passed");
