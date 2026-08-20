#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const lease=read("release/integration/p0-wallet-connectivity/execution/p0-063-trust-center-source-lease-20260821.json");
assert.equal(leases.heavy.owner,null);
assert.equal(leases.light.owner,"integration");
assert.equal(leases.light.taskId,"P0-063");
assert.equal(lease.status,"ACTIVE_BOUNDED_TRUST_CENTER_SOURCE_ONLY");
const lock=locks.locks.find(item=>item.taskId==="P0-063");
assert.equal(lock.path,"apps/trust-center/**");
assert.equal(lock.status,"ACTIVE_LIGHT_SOURCE_ONLY");
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-063").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-063").publicVerified,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-062").sourceAccepted,false);
console.log("PASS P0-063 is a bounded Trust Center source-only Light slice while Wallet/Auth P0-062 remains NO_GO");
