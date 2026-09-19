import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const handoff = JSON.parse(readFileSync(resolve(packageRoot, "integration/p0-wallet-protocol-router-recovery-handoff-20260820.json"), "utf8"));

test("router/recovery handoff requests a new exact lease without inflating public truth", () => {
  assert.equal(handoff.status, "INTEGRATION_ACCEPTANCE_AND_NEW_EXECUTION_LEASE_REQUESTED");
  assert.match(handoff.candidate.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(handoff.candidate.walletAuthTree, /^[a-f0-9]{40}$/);
  assert.equal(handoff.lease.priorLeaseTarget, handoff.publicRuntime.observedSourceCommit);
  assert.notEqual(handoff.lease.priorLeaseTarget, handoff.candidate.sourceCommit);
  assert.equal(handoff.lease.priorLeaseReusableForCandidate, false);
  assert.equal(handoff.lease.newExactExecutionLeaseIssued, false);
  assert.equal(handoff.verification.productRuntimeMigrations, 0);
  for (const field of ["acceptedByIntegration", "deployedPublic", "installedClientVerified", "productMigrationVerified", "enhancedSdkAccepted", "integratedCentral", "aggregatePublicReady", "productionSigned", "storeReleased"]) {
    assert.equal(handoff.truth[field], false, `${field} must remain false without direct evidence`);
  }
});
