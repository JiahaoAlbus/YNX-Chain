#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/p0-015-bounded-replication-release-20260821.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");

const task=queue.tasks.find(item=>item.taskId==="P0-015");
const lock=locks.locks.find(item=>item.taskId==="P0-015");
assert.equal(acceptance.decision,"RELEASED_CHECKPOINT");
assert.equal(task.status,"RELEASED_CHECKPOINT");
assert.equal(lock.status,"RELEASED_CHECKPOINT");
assert.equal(task.commit,acceptance.checkpoint.commit);
assert.equal(lock.checkpointCommit,acceptance.checkpoint.commit);
assert.equal(task.releasedAt,acceptance.releasedAt);
assert.equal(lock.releasedAt,acceptance.releasedAt);
assert.notEqual(leases.heavy.taskId,"P0-015");
assert.equal(acceptance.acceptedEvidence.fourNodesSameBuild,true);
assert.equal(acceptance.acceptedEvidence.fourNodesSameFixedHeightHash,true);
assert.equal(acceptance.acceptedEvidence.allFollowerLagBlocks,0);
assert.equal(acceptance.acceptedEvidence.allConsecutiveReplicationFailures,0);
assert.equal(acceptance.truth.walletAuthExecutionLeaseIssued,false);
assert.equal(acceptance.truth.p0039LeaseReusable,false);
assert.equal(acceptance.truth.publicDomainVerified,false);
assert.equal(acceptance.truth.computerControlVerified,false);

console.log("PASS P0-015 released at exact four-node rollout and soak checkpoint; no Wallet/Auth lease was issued");
