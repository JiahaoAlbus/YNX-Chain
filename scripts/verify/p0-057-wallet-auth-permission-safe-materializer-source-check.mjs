#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const acceptance = read("release/integration/p0-wallet-connectivity/acceptance/p0-057-wallet-auth-permission-safe-materializer-source-review-20260821.json");
const queue = read("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases = read("release/integration/p0-wallet-connectivity/execution-leases.json");

function validate(value) {
  assert.equal(value.decision, "SOURCE_ARTIFACTS_FROZEN_NO_GO_ATOMIC_NOREPLACE_RACE");
  assert.equal(value.source.commit, "785ed7e8337e46e3286fc3068ef5c68d004e1b6b");
  assert.equal(value.ownerEvidence.commit, "198f326ce9cb4256433374bd8efb0c337359c603");
  assert.equal(value.ownerEvidence.blob, "68afa5b481e84d7f28ef5b9795526f05e62d5d25");
  assert.equal(value.ownerEvidence.sha256, "e23369f7b531850e5c19bacc203fd27daef519aa01684ccbd0be34d696c7e609");
  assert.equal(value.blockingFinding.code, "ATOMIC_NOREPLACE_RACE");
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
const task = queue.tasks.find(item => item.taskId === "P0-057");
assert.equal(queue.tasks.filter(item => item.taskId === "P0-057").length, 1);
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
  console.log("PASS 5/5 P0-057 no-lease and public-promotion mutations rejected");
}
console.log("PASS P0-057 exact source/artifacts frozen NO_GO on reproduced atomic no-replace race");
