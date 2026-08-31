#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
assert.equal(leases.heavy.owner,null);
assert.equal(leases.light.owner,"integration");
assert.equal(leases.light.taskId,"P0-068");
assert.equal(locks.locks.find(x=>x.taskId==="P0-068").status,"ACTIVE_LIGHT_SOURCE_ONLY");
assert.equal(queue.tasks.find(x=>x.taskId==="P0-068").status,"ACTIVE_BOUNDED_AI_SOURCE_ONLY");
assert.equal(queue.tasks.find(x=>x.taskId==="P0-067").sourceAccepted,false);
console.log("PASS P0-068 is the sole bounded Light slice and P0-067 remains NO_GO");
