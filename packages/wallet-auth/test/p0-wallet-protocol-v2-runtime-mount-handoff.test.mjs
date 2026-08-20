import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const handoff = JSON.parse(readFileSync(resolve(packageRoot, "integration/p0-wallet-protocol-v2-runtime-mount-handoff-20260820.json"), "utf8"));

test("v2 runtime mount handoff withdraws the unmounted source and preserves every public gate", () => {
  assert.equal(handoff.status, "CANDIDATE_PENDING_INTEGRATION_ACCEPTANCE_AND_NEW_EXECUTION_LEASE");
  assert.notEqual(handoff.supersedesCandidate.sourceCommit, handoff.candidate.sourceCommit);
  assert.equal(handoff.runtimeBoundary.v1AdministrationPreserved, true);
  assert.deepEqual(handoff.runtimeBoundary.v2RoutesMounted, ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke", "/v2/product-sessions/devices/revoke"]);
  assert.equal(handoff.runtimeBoundary.defaultOrImplicitRemoteActivation, false);
  assert.equal(handoff.lease.prior49eLeaseReusable, false);
  assert.equal(handoff.publicReadback.candidateObservedPublic, false);
  assert.equal(handoff.truth.productRuntimeMigrations, 0);
  assert.equal(handoff.truth.pushedRemote, true);
  for (const field of ["deployedPublic", "publicV2LifecycleVerified", "installedClientVerified", "enhancedSdkAccepted", "integratedCentral", "aggregatePublicReady", "productionSigned", "storeReleased"]) assert.equal(handoff.truth[field], false, `${field} cannot be promoted without direct evidence`);
});
