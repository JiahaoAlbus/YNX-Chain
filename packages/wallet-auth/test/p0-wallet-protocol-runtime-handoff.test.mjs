import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const handoff = JSON.parse(readFileSync(new URL("../integration/p0-wallet-protocol-runtime-handoff.json", import.meta.url), "utf8"));

test("P0 runtime handoff records accepted contract provenance without inflating deployment truth", () => {
  assert.equal(handoff.status, "RUNTIME_CANDIDATE_READY");
  assert.equal(handoff.acceptedContract.sourceCommit, "66003e76e804da16d472255efde50cb879055b96");
  assert.match(handoff.runtimeSourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(handoff.releaseTruth.deployedPublic, false);
  assert.equal(handoff.releaseTruth.gatewayLoadedPublic, false);
  assert.equal(handoff.releaseTruth.integratedCentral, false);
  assert.equal(handoff.releaseTruth.installedClientVerified, false);
});

test("P0 runtime handoff requires explicit registry origins and all downstream owner boundaries", () => {
  assert.equal(handoff.runtime.cors.registrySchema, 4);
  assert.match(handoff.runtime.cors.migration, /webOrigins: \[\]/);
  assert.match(handoff.runtime.cors.nonInference, /No origin is derived/);
  assert.deepEqual(Object.keys(handoff.recipientHandoffs).sort(), ["dataFabric", "developerSdk", "explorerMonitor", "financialApps", "walletPlatform"]);
  assert.match(handoff.recipientHandoffs.walletPlatform.uiBoundary, /no Wallet UI implementation/);
  assert.match(handoff.recipientHandoffs.financialApps.migration, /Do not add per-product/);
});
