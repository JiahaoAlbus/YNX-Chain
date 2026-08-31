#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const acceptance = read("release/integration/p0-wallet-connectivity/acceptance/p0-059-wallet-auth-link-publish-source-review-20260821.json");
const queue = read("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases = read("release/integration/p0-wallet-connectivity/execution-leases.json");

function validate(value) {
  assert.equal(value.decision, "SOURCE_ARTIFACTS_FROZEN_NO_GO_TEMP_ENTRY_SWAP_RACE");
  assert.equal(value.source.commit, "082afce922bf7cef90843cfe3f65d6596dc79a57");
  assert.equal(value.ownerEvidence.commit, "7d8afd52c4a426abfcb5fed3b01acdc063955999");
  assert.equal(value.ownerEvidence.blob, "57ff0f73f75d7dc24d94eeb03681766e08d3a114");
  assert.equal(value.ownerEvidence.sha256, "50c32581f1c6f41bf3fdddbf8b4ec7199f302ccae785a9b9250e78d687135777");
  assert.equal(value.tests.concurrentDestinationPreserved, true);
  assert.equal(value.blockingFinding.code, "TEMP_ENTRY_SWAP_PUBLISHES_UNTRUSTED_OUTPUT");
  assert.equal(value.blockingFinding.directReproduction, true);
  assert.equal(value.lease.issued, false);
  assert.equal(value.lease.p0054Reusable, false);
  assert.equal(value.truth.sourceIdentityFrozen, true);
  assert.equal(value.truth.artifactIdentityFrozen, true);
  assert.equal(value.truth.implementationAccepted, false);
  assert.equal(value.truth.executionReady, false);
  assert.equal(value.truth.registryV3Public, false);
  assert.equal(value.truth.productsMigratedV2, 0);
  assert.equal(value.truth.deployedPublic, false);
  assert.equal(value.truth.integratedCentral, false);
}

validate(acceptance);
const task = queue.tasks.find(item => item.taskId === "P0-059");
assert.equal(queue.tasks.filter(item => item.taskId === "P0-059").length, 1);
assert.equal(task.status, acceptance.decision);
assert.equal(task.executionLeaseIssued, false);
assert.equal(task.sourceAccepted, false);
assert.equal(task.deployedPublic, false);
assert.equal(leases.heavy.owner, null);
assert.equal(queue.tasks.find(item => item.taskId === "P0-054").p0054LeaseReusable, false);

if (process.argv.includes("--self-test")) {
  for (const mutate of [
    value => { value.lease.issued = true; },
    value => { value.truth.implementationAccepted = true; },
    value => { value.truth.executionReady = true; },
    value => { value.truth.deployedPublic = true; },
    value => { value.blockingFinding.directReproduction = false; },
  ]) {
    const changed = structuredClone(acceptance);
    mutate(changed);
    assert.throws(() => validate(changed));
  }
  console.log("PASS 5/5 P0-059 no-lease and public-promotion mutations rejected");
}
console.log("PASS P0-059 exact source/artifacts frozen NO_GO on reproduced temp-entry swap publication race");
