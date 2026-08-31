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
assert.deepEqual(
  {
    commit: dex.sourceCommit,
    parent: dex.sourceParent,
    tree: dex.sourceTree,
    branch: dex.remoteBranch,
    readback: dex.changedBlobReadback
  },
  {
    commit: "aa5d4e5b5999a1dee28ce41adcc509abe96f95e9",
    parent: "acee458bdf19bd460d73a20ddfb3ed62cb9da80f",
    tree: "3e5afc0576cb0abb23dd3d614a30da95e589829a",
    branch: "codex/final-dex",
    readback: "8/8"
  }
);
assert.deepEqual(
  {
    commit: quant.sourceCommit,
    parent: quant.sourceParent,
    tree: quant.sourceTree,
    branch: quant.remoteBranch,
    readback: quant.changedBlobReadback
  },
  {
    commit: "f66fd4d14ff047efa6bb7e66fc2e140773826b16",
    parent: "5cd5a9a9efc2883f6e1fab7378bee7e581cf38d6",
    tree: "ab2cb8c7704e680fcf8451f9bd44103aaef163ff",
    branch: "codex/quant-owner-contract-snapshot",
    readback: "8/8"
  }
);
for (const acceptedSource of [dex, quant]) {
  assert.equal(acceptedSource.remoteReadable, true);
  assert.equal(acceptedSource.localAheadCount, 0);
  assert.equal(acceptedSource.centralSourceAccepted, true);
  assert.equal(acceptedSource.migratedV2, false);
}
assert.equal(evidence.websiteTimelineAudit.ownerReportedSourceIsRemoteMain, false);
assert.equal(evidence.websiteTimelineAudit.ownerObservationOverridesCentralP0023, false);
assert.equal(evidence.websiteTimelineAudit.currentPublicReadback.runtimeSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(acceptance.accepted.dexRemoteSourceAccepted, true);
assert.equal(acceptance.accepted.quantRemoteSourceAccepted, true);
validateTruth(acceptance);
const task = queue.tasks.find((entry) => entry.taskId === "P0-029");
assert.ok(task);
assert.equal(task.status, "FINANCIAL_OWNER_SOURCES_ACCEPTED_PRODUCTS_UNMIGRATED");
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
console.log("PASS Exchange/DEX/Quant sources accepted; all migration/public gates remain false");
