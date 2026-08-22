#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const sha256 = (relativePath) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const evidencePath = "release/integration/wallet-product-session-website-readback-20260820T143353Z.json";
const acceptancePath = "release/integration/p0-wallet-connectivity/acceptance/wallet-product-session-website-readback-8155175f-20260820.json";
const evidence = readJson(evidencePath);
const acceptance = readJson(acceptancePath);
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");

assert.equal(acceptance.ownerCommit, "8155175f60320376a37a700ec52000f56fb5cd4a");
assert.equal(acceptance.ownerEvidence.path, evidencePath);
assert.equal(sha256(evidencePath), acceptance.ownerEvidence.sha256);
assert.equal(fs.statSync(path.join(root, evidencePath)).size, acceptance.ownerEvidence.bytes);
assert.equal(evidence.readOnly, true);
assert.equal(evidence.websiteSourceWasModified, false);
assert.equal(evidence.docsMatchAcrossOfficialOrigins, true);
assert.equal(evidence.docsSha256MatchesAcceptedEvidence, false);
assert.equal(evidence.runtimeRecordMatchesAcceptedEvidence, true);
assert.equal(evidence.runtimeSourceCommit, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(new Set(evidence.officialOrigins.map((entry) => entry.docs.sha256)).size, 1);
assert.equal(new Set(evidence.officialOrigins.map((entry) => entry.runtimeRecord.sha256)).size, 1);
for (const entry of evidence.officialOrigins) {
  assert.equal(entry.docs.status, 200);
  assert.equal(entry.docs.bytes, 4748);
  assert.equal(entry.runtimeRecord.status, 200);
  assert.equal(entry.runtimeRecord.bytes, 1900);
}
assert.equal(acceptance.truth.productsMigrated, 0);
assert.equal(acceptance.truth.integratedCentral, false);
assert.equal(acceptance.truth.aggregatePublic, false);
const task = queue.tasks.find((entry) => entry.taskId === "P0-017");
assert.ok(task);
assert.equal(task.status, "ACCEPTED_READ_ONLY_DRIFT_EVIDENCE");
assert.equal(task.ownerCommit, acceptance.ownerCommit);
assert.equal(task.productsMigrated, 0);
console.log("PASS 8155175f Website readback: docs drift recorded without attribution; immutable runtime record remains exact and product/client/aggregate gates remain false");
