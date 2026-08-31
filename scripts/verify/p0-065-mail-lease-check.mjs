#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
assert.equal(leases.heavy.owner,null);
assert.equal(leases.light.owner,null);
assert.equal(leases.light.taskId,"P0-065");
assert.equal(locks.locks.find(x=>x.taskId==="P0-065").path,"{apps/mail/**,internal/mail/**}");
assert.equal(locks.locks.find(x=>x.taskId==="P0-065").status,"CHECKPOINT_REACHED");
assert.equal(locks.locks.find(x=>x.taskId==="P0-065").checkpointCommit,"783f14a55796539702edc2104d0f1ce333c23fc5");
assert.equal(queue.tasks.find(x=>x.taskId==="P0-065").status,"SOURCE_CHECKPOINT_REACHED_LIGHT_RELEASED");
assert.equal(queue.tasks.find(x=>x.taskId==="P0-065").installedClientVerified,false);
assert.equal(queue.tasks.find(x=>x.taskId==="P0-067").sourceAccepted,false);
console.log("PASS P0-065 Mail source checkpoint is released and P0-067 remains NO_GO");
