#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const lease=read("release/integration/p0-wallet-connectivity/execution/p0-051-pay-source-build-install-lease-20260821.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");

assert.equal(leases.heavy.owner,"financial-apps");
assert.equal(leases.heavy.taskId,"P0-051");
assert.equal(leases.heavy.status,"ACTIVE_BOUNDED_SOURCE_BUILD_INSTALL");
assert.equal(lease.status,"ACTIVE_BOUNDED_PAY_SOURCE_BUILD_INSTALL");
assert.equal(lease.singleUse,true);
assert.equal(lease.startingCommit,"a153ef9014e421c70ece70cdbffd8fe5ee3094b9");
assert.equal(lease.truthAtGrant.cleanWorktree,true);
assert.equal(lease.truthAtGrant.deployedPublic,false);
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-051").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-051").executionLeaseIssued,true);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-004").status,"PAY_HEAVY_ACTIVE");
const payLock=locks.locks.find(item=>item.taskId==="P0-051");
assert.equal(payLock.path,"apps/pay/**");
assert.equal(payLock.owner,"financial-apps");
assert.equal(payLock.status,"ACTIVE");
assert.equal(payLock.checkpointCommit,lease.startingCommit);
const prior=queue.tasks.find(item=>item.taskId==="P0-050");
assert.equal(prior.status,"CONSUMED_RELEASED_FAILED_CLOSED_INVALID_MIGRATION");
assert.equal(prior.p0050LeaseReusable,false);
const writable=locks.locks.filter(item=>item.status==="ACTIVE" && item.taskId!=="P0-000");
assert.equal(writable.filter(item=>item.path==="apps/pay/**").length,1);

console.log("PASS P0-051 grants one bounded Pay source/build/install lease from clean a153ef90; P0-050 remains nonreusable");
