#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/financial-adapter-source-audit-78f41349-20260821.json");
const evidence = readJson(acceptance.sourceEvidence.path);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth = (candidate) => {
  assert.equal(candidate.truth.exchangeMigratedV2, false);
  assert.equal(candidate.truth.dexMigratedV2, false);
  assert.equal(candidate.truth.quantMigratedV2, false);
  assert.equal(candidate.truth.productsMigratedV2, 0);
  assert.equal(candidate.truth.installedApprovalVerified, false);
  assert.equal(candidate.truth.publicProductLifecycleVerified, false);
  assert.equal(candidate.truth.deployedPublic, false);
  assert.equal(candidate.truth.integratedCentral, false);
  assert.equal(candidate.truth.aggregateDeployedPublic, false);
  assert.equal(candidate.truth.productionSigned, false);
  assert.equal(candidate.truth.storeReleased, false);
};

assert.equal(evidence.walletProtocolCheckpoint.commit, acceptance.walletProtocolCheckpointCommit);
assert.equal(evidence.walletProtocolCheckpoint.remoteReadable, true);
const exchange = evidence.products.find((item) => item.productId === "exchange");
const dex = evidence.products.find((item) => item.productId === "dex");
const quant = evidence.products.find((item) => item.productId === "quant");
assert.equal(exchange.remoteReadable, true);
assert.equal(exchange.centralSourceAccepted, true);
assert.equal(exchange.rootFactoryConsumed, true);
assert.equal(exchange.migratedV2, false);
for (const pending of [dex, quant]) {
  assert.equal(pending.remoteReadable, false);
  assert.equal(pending.localAheadCount, 1);
  assert.equal(pending.centralSourceAccepted, false);
  assert.equal(pending.migratedV2, false);
}
assert.equal(evidence.websiteTimelineAudit.ownerReportedSourceIsRemoteMain, false);
assert.equal(evidence.websiteTimelineAudit.ownerObservationOverridesCentralP0023, false);
assert.equal(evidence.websiteTimelineAudit.currentPublicReadback.runtimeSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(acceptance.accepted.dexRemoteSourceAccepted, false);
assert.equal(acceptance.accepted.quantRemoteSourceAccepted, false);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-029");
assert.ok(task);
assert.equal(task.status, "EXCHANGE_SOURCE_ACCEPTED_DEX_QUANT_REMOTE_REQUIRED");
assert.equal(task.productsMigrated, 0);

if (process.argv.includes("--self-test")) {
  const mutations = [
    (a) => { a.truth.exchangeMigratedV2 = true; },
    (a) => { a.truth.dexMigratedV2 = true; },
    (a) => { a.truth.quantMigratedV2 = true; },
    (a) => { a.truth.productsMigratedV2 = 1; },
    (a) => { a.truth.aggregateDeployedPublic = true; }
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(acceptance);
    mutate(candidate);
    assert.throws(() => validateTruth(candidate));
  }
  console.log("PASS 5/5 financial-adapter promotion mutations rejected");
}
console.log("PASS Exchange source accepted; DEX/Quant remain local-only pending and all migration/public gates remain false");
