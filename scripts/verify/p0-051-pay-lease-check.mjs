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
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/p0-051-pay-source-checkpoint-release-20260821.json");

assert.equal(leases.heavy.owner,null);
assert.equal(leases.heavy.taskId,"P0-054");
assert.equal(leases.heavy.status,"CONSUMED_RELEASED_FAILED_CLOSED_INSTALL_PERMISSION");
assert.equal(lease.status,"RELEASED_CHECKPOINT");
assert.equal(lease.singleUse,true);
assert.equal(lease.reusable,false);
assert.equal(lease.startingCommit,"a153ef9014e421c70ece70cdbffd8fe5ee3094b9");
assert.equal(lease.checkpointCommit,"851dc5b834e0d824f4891dc6e572da1e8d71ca75");
assert.equal(lease.checkpointTree,"93896134aa235e462a8dc37ddf03cc3a01ae055a");
assert.equal(lease.truthAtGrant.cleanWorktree,true);
assert.equal(lease.truthAtGrant.deployedPublic,false);
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-051").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-051").status,"RELEASED_CHECKPOINT");
assert.equal(queue.tasks.find(item=>item.taskId==="P0-051").executionLeaseIssued,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-004").status,"PAY_CHECKPOINT_REACHED");
const payLock=locks.locks.find(item=>item.taskId==="P0-051");
assert.equal(payLock.path,"apps/pay/**");
assert.equal(payLock.owner,"financial-apps");
assert.equal(payLock.status,"RELEASED_CHECKPOINT");
assert.equal(payLock.checkpointCommit,lease.checkpointCommit);
assert.equal(payLock.releasedAt,lease.releasedAt);
assert.equal(acceptance.decision,"RELEASED_CHECKPOINT");
assert.equal(acceptance.ownerCommit,lease.checkpointCommit);
assert.equal(acceptance.ownerTree,lease.checkpointTree);
assert.equal(acceptance.releasedAt,lease.releasedAt);
for(const key of ["installed","coldStartVerified","productSessionMigratedV2","deployedPublic","publicVerified","computerControlVerified"]) assert.equal(acceptance.truth[key],false);
const prior=queue.tasks.find(item=>item.taskId==="P0-050");
assert.equal(prior.status,"CONSUMED_RELEASED_FAILED_CLOSED_INVALID_MIGRATION");
assert.equal(prior.p0050LeaseReusable,false);
const writable=locks.locks.filter(item=>item.status==="ACTIVE" && item.taskId!=="P0-000");
assert.equal(writable.filter(item=>item.path==="apps/pay/**").length,0);

console.log("PASS P0-051 remains released at exact Pay source-only checkpoint 851dc5b8 after P0-054 fail-closed release");
