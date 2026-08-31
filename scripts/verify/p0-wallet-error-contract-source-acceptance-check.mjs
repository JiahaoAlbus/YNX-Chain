#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = readJson("release/integration/p0-wallet-connectivity/acceptance/wallet-error-contract-24cc3218-20260820.json");
const queue = readJson("release/integration/p0-wallet-connectivity/integration-queue.json");
assert.equal(acceptance.ownerCommit, "24cc3218c2cdc00c50dc3caa563652083afbd861");
assert.equal(acceptance.decision, "ACCEPTED_SOURCE_ONLY_CONSUMER_CONTRACT");
assert.equal(acceptance.runtimeReview.gatewayDaemonOrHandlerChanged, false);
assert.equal(acceptance.runtimeReview.httpResponsePathUsesContractAtThisCommit, false);
assert.equal(acceptance.runtimeReview.consumerOnly, true);
assert.equal(acceptance.runtimeReview.executionLeaseIssued, false);
assert.deepEqual(acceptance.routing.targets, ["developer-sdk", "wallet-platform", "product-owners"]);
assert.equal(acceptance.truth.currentPublicRuntimeSource, "6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(acceptance.truth.deployedPublic, false);
assert.equal(acceptance.truth.publicErrorContractVerified, false);
assert.equal(acceptance.truth.productsMigrated, 0);
assert.equal(acceptance.truth.integratedCentral, false);
assert.equal(acceptance.truth.aggregatePublic, false);
const task = queue.tasks.find((entry) => entry.taskId === "P0-019");
assert.ok(task);
assert.equal(task.status, "SOURCE_ACCEPTED_CONSUMER_ROUTING_REQUIRED");
assert.equal(task.executionLeaseIssued, false);
assert.equal(task.productsMigrated, 0);
console.log("PASS 24cc3218 error contract: source-only consumer API accepted; no runtime lease, public deployment or product migration promoted");
