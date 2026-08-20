#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const lease=read("release/integration/p0-wallet-connectivity/execution/wallet-auth-registry-v3-a960-lease-20260821.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");

assert.equal(leases.heavy.owner,"wallet-auth-core");
assert.equal(leases.heavy.status,"ACTIVE_BOUNDED_SINGLE_USE");
assert.equal(leases.heavy.taskId,"P0-050");
assert.equal(lease.status,"ACTIVE_BOUNDED_SINGLE_USE");
assert.equal(lease.singleUse,true);
assert.equal(lease.invalidatedLeaseReusable,false);
assert.equal(lease.source.commit,"a960d1007e7952c2af591d39e3673f1d9fe50e62");
assert.equal(lease.source.artifactCommit,"79a87d87cd819672e65dd42546da997d8a80985e");
assert.equal(lease.freshReadOnlyPreflight.publicSourceCommit,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(lease.freshReadOnlyPreflight.productSessionStateSha256,"343f4cbbce0aed1e3cc5894156c4480e69dfc4775e0b347c63d555bd51790d23");
assert.equal(lease.freshReadOnlyPreflight.serviceActive,true);
assert.equal(lease.freshReadOnlyPreflight.serviceNRestarts,0);
assert.equal(lease.transaction.rollbackFirst,true);
assert.equal(lease.transaction.networkInstallAllowed,false);
assert.equal(lease.transaction.stateContentMayBeReadOrExported,false);
assert.equal(lease.transaction.caddyChangeAllowed,false);
assert.equal(lease.transaction.baseUnitChangeAllowed,false);
assert.equal(lease.transaction.sharedStateMutationAllowed,false);
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-050").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-050").executionLeaseIssued,true);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-015").status,"RELEASED_CHECKPOINT");
assert.equal(locks.locks.find(item=>item.taskId==="P0-015").status,"RELEASED_CHECKPOINT");

console.log("PASS P0-050 exact a960 single-use lease; P0-015 released, P0-039 nonreusable, rollback-first and no unrelated mutation");
