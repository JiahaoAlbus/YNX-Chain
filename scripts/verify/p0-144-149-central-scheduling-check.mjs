import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const root = "release/integration/p0-wallet-connectivity";
const active = read(`${root}/active-campaign.json`);
const leases = read(`${root}/execution-leases.json`);
const locks = read(`${root}/path-locks.json`).locks;
const tasks = read(`${root}/integration-queue.json`).tasks;
const task = (id) => tasks.find((entry) => entry.taskId === id);

assert.equal(active.heavy.taskId, "P0-145");
assert.equal(active.heavy.owner, null);
assert.equal(active.heavy.status, "CONSUMED_RELEASED_DEPLOYMENT_REJECTED");
assert.equal(active.heavy.productionMutationAllowed, false);
assert.equal(leases.heavy.leaseId, "P0-WALLET-CONNECTIVITY-2026-08-explorer-monitor-artifact-rollback-20260821T171613Z");
assert.equal(leases.heavy.owner, null);
assert.equal(active.light.taskId, "P0-148");
assert.equal(active.light.owner, "integration:/root");
assert.equal(active.light.status, "ACTIVE_SOURCE_ONLY");
assert.equal(active.light.productionMutationAllowed, false);
assert.equal(leases.light.leaseId, "P0-WALLET-CONNECTIVITY-2026-08-creator-studio-source-20260821T180934Z");
assert.equal(leases.light.owner, "integration:/root");
assert.equal(leases.light.executionScope, "CREATOR_STUDIO_FABLE5_GAP_AUDIT_AND_SOURCE_REPAIR_NO_PRODUCTION");

assert.equal(task("P0-144").transactionHash, "0xb15d2de15bdf899f7dab05d108385bb3bece5db0a104a5c46f6dfd60f3c4b1e9");
assert.equal(task("P0-144").computerControlVerified, false);
assert.equal(task("P0-145").publicConnectivityJson, false);
assert.equal(task("P0-145").productionMutationAllowed, false);
assert.equal(task("P0-145").reviewDecision, "REJECT_DEPLOYMENT_READINESS");
assert.equal(task("P0-146").productionMutationAllowed, false);
assert.equal(task("P0-146").publicDeployed, false);
assert.equal(task("P0-146").reviewDecision, "ACCEPT_SOURCE_BUILD_ONLY");
assert.equal(task("P0-147").blocker, "NO_AUTHORITATIVE_DATA_FABRIC_PUBLIC_ENDPOINT_OR_RUNTIME_MAPPING");
assert.equal(task("P0-148").owner, "integration:/root");
assert.equal(task("P0-148").status, "IN_PROGRESS_SOURCE_ONLY");
assert.equal(task("P0-148").productionMutationAllowed, false);
assert.equal(task("P0-149").status, "WAITING_EXTERNAL_CONNECTOR_QUEUED_AFTER_NATIVE_REGISTRATION");
assert.equal(task("P0-149").productsConnected, "0/12");
assert.equal(task("P0-149").productsMigratedV2, "0/12");

for (const id of ["P0-145", "P0-146", "P0-147", "P0-148", "P0-149"]) {
  assert.ok(locks.some((entry) => entry.taskId === id), `missing path lock ${id}`);
}

assert.equal(locks.find((entry) => entry.taskId === "P0-148").status, "ACTIVE_SOURCE_ONLY");

console.log("P0-144..149 central scheduling gate passed");
