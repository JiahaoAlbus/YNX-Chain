#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const evidence=read("release/integration/p0-wallet-connectivity/evidence/video-standard-wallet-source-1d4532ff-20260821.json");
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/video-standard-wallet-source-1d4532ff-20260821.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");

assert.equal(evidence.releaseTruthCommit,acceptance.sourceCommit);
assert.equal(evidence.acceptedSdk.browserModulesByteExact,true);
assert.equal(evidence.truth.standardWalletSourceImplemented,true);
for(const key of ["actualProviderApprovalVisible","productSessionV2","installedClientVerified","currentCandidateDeployedPublic","publicVerified","computerControlVerified"])assert.equal(evidence.truth[key],false,key);
assert.equal(evidence.truth.productsMigrated,0);
assert.equal(acceptance.status,"STANDARD_WALLET_SOURCE_ACCEPTED_VISIBLE_AND_PRODUCT_SESSION_E2E_BLOCKED");
const task=queue.tasks.find(item=>item.taskId==="P0-047");
assert.equal(task.checkpointCommit,acceptance.sourceCommit);
assert.equal(task.status,acceptance.status);
assert.equal(task.productsMigrated,0);
const lock=locks.locks.find(item=>item.taskId==="P0-047");
assert.equal(lock.status,"CHECKPOINT_REACHED");
assert.equal(lock.checkpointCommit,acceptance.sourceCommit);
console.log("PASS Video Standard Wallet source checkpoint; visible, Product Session v2, installed, public and Computer Control gates remain false");
