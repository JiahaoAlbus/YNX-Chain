#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const lease=read("release/integration/p0-wallet-connectivity/execution/p0-054-wallet-auth-registry-v3-ff395-lease-20260821.json");
const fresh=read(lease.freshProduction.evidence);
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const validate=c=>{assert.equal(c.status,"ACTIVE_SINGLE_USE_ROLLBACK_FIRST");assert.equal(c.singleUse,true);assert.equal(c.reusable,false);assert.equal(c.failurePolicy.autoRollback,true);assert.equal(c.failurePolicy.noRetry,true);for(const v of Object.values(c.truth)) assert.ok(v===false||v===0);};
validate(lease);
assert.equal(lease.source.commit,"ff395e3d1d7c012784e81eb02c3ae8782fbf1298");
assert.equal(lease.source.evidenceCommit,"bbaa11f3f3217bafd7492d2e19b2646753204788");
assert.equal(lease.freshProduction.sourceCommit,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(lease.freshProduction.stateSha256,"343f4cbbce0aed1e3cc5894156c4480e69dfc4775e0b347c63d555bd51790d23");
assert.equal(fresh.ssh.hostKeyMatched,true);assert.equal(fresh.ssh.readOnly,true);assert.equal(fresh.production.service,"ynx-wallet-gateway.service");assert.equal(fresh.production.nRestarts,0);
assert.equal(leases.heavy.taskId,"P0-054");assert.equal(leases.heavy.owner,"wallet-auth-core");assert.equal(leases.heavy.status,"ACTIVE_SINGLE_USE_ROLLBACK_FIRST");
assert.equal(queue.tasks.filter(x=>x.taskId==="P0-054").length,1);assert.equal(queue.tasks.find(x=>x.taskId==="P0-054").executionLeaseIssued,true);
assert.equal(queue.tasks.find(x=>x.taskId==="P0-050").p0050LeaseReusable,false);
if(process.argv.includes("--self-test")){for(const mutate of [c=>c.reusable=true,c=>c.failurePolicy.autoRollback=false,c=>c.truth.deployedPublic=true,c=>c.truth.productsMigratedV2=1,c=>c.singleUse=false]){const c=structuredClone(lease);mutate(c);assert.throws(()=>validate(c));}console.log("PASS 5/5 P0-054 lease safety mutations rejected");}
console.log("PASS P0-054 is a wholly new single-use rollback-first ff395 lease bound to fresh public 6cf and state 343f4cbb");
