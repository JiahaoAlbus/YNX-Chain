#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const acceptance = read("release/integration/p0-wallet-connectivity/acceptance/calendar-standard-wallet-source-8ff6eb24-20260821.json");
const evidence = read("release/integration/p0-wallet-connectivity/evidence/calendar-standard-wallet-source-8ff6eb24-20260821.json");
const queue = read("release/integration/p0-wallet-connectivity/integration-queue.json");

assert.equal(acceptance.sourceCommit, evidence.source.commit);
assert.equal(evidence.source.remoteReadbackExact, true);
assert.equal(evidence.source.worktreeClean, true);
assert.equal(evidence.sdk.verifiedModuleCount, 4);
assert.equal(evidence.tests.calendar, "17/17");
assert.equal(evidence.tests.browserConsoleErrors, 0);
assert.equal(evidence.browserReadback.guestTrialEntered, true);
assert.equal(evidence.browserReadback.guestCreateEnabled, true);
assert.equal(evidence.browserReadback.actualProviderApproval, false);
assert.equal(evidence.truth.standardWalletSourceImplemented, true);
assert.equal(evidence.truth.standardWalletConnectedVisible, false);
assert.equal(evidence.truth.productSessionV2, false);
assert.equal(evidence.truth.installedApprovalVerified, false);
assert.equal(evidence.truth.deployedPublic, false);
assert.equal(evidence.truth.publicVerified, false);
assert.equal(evidence.truth.computerControlVerified, false);
assert.equal(evidence.truth.productsMigrated, 0);
const ids = queue.tasks.map((task) => task.taskId);
assert.equal(new Set(ids).size, ids.length, "integration queue task IDs must be unique");
const task = queue.tasks.find((item) => item.taskId === "P0-045");
assert.ok(task);
assert.equal(task.checkpointCommit, acceptance.sourceCommit);
assert.equal(task.standardWalletSourceImplemented, true);
assert.equal(task.standardWalletConnectedVisible, false);
assert.equal(task.productSessionV2, false);
assert.equal(task.deployedPublic, false);
assert.equal(task.productsMigrated, 0);

console.log("PASS Calendar accepted Standard Wallet source and no-Wallet/guest Browser flow; provider approval, Product Session v2, installed, public and ComputerControl gates remain false");
