import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const evidence = JSON.parse(readFileSync(new URL("../integration/p0-wallet-protocol-public-runtime-evidence-20260820.json", import.meta.url), "utf8"));

test("P0 public runtime evidence binds the accepted source, registry, rollback and exact public lifecycle", () => {
  assert.equal(evidence.status, "PUBLIC_RUNTIME_VERIFIED");
  assert.equal(evidence.authority.runtimeSourceCommit, "49e30d999e9a9cbdd2c565021009f2cab0dc125c");
  assert.equal(evidence.authority.deploymentRegistrySha256, "ae156b317b9a97bfd42397cca634021deefe10ffb009102899e24276d8721e31");
  assert.equal(evidence.rollbackDrill.passed, true);
  assert.equal(evidence.rollbackDrill.restoredSourceCommit, evidence.preflight.priorSourceCommit);
  assert.equal(evidence.publicRuntime.version.sourceCommit, evidence.authority.runtimeSourceCommit);
  assert.equal(evidence.publicRuntime.registeredOriginPreflight.httpStatus, 204);
  assert.equal(evidence.publicRuntime.registeredOriginPreflight.allowCredentialsAbsent, true);
  assert.deepEqual(evidence.publicRuntime.lifecycle.map((item) => item.name), ["complete", "introspect-before-restart", "introspect-after-restart", "replay", "revoke", "post-revoke"]);
  assert.equal(evidence.publicRuntime.lifecycle.every((item) => typeof item.requestId === "string" && item.requestId.length > 20), true);
});

test("P0 runtime publication preserves installed-client, aggregate, signing and store truth boundaries", () => {
  assert.equal(evidence.releaseTruth.deployedPublic, true);
  assert.equal(evidence.releaseTruth.gatewayLoadedPublic, true);
  assert.equal(evidence.releaseTruth.installedClientVerified, false);
  assert.equal(evidence.releaseTruth.standardWalletConnectionClientVerified, false);
  assert.equal(evidence.releaseTruth.integratedCentral, false);
  assert.equal(evidence.releaseTruth.aggregatePublicReady, false);
  assert.equal(evidence.releaseTruth.websitePublished, false);
  assert.equal(evidence.releaseTruth.productionSigned, false);
  assert.equal(evidence.releaseTruth.storeReleased, false);
});
