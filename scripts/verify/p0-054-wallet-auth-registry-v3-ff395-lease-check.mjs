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
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/p0-054-wallet-auth-failed-closed-install-permission-release-20260821.json");
const validate=c=>{assert.equal(c.status,"CONSUMED_RELEASED_FAILED_CLOSED_INSTALL_PERMISSION");assert.equal(c.singleUse,true);assert.equal(c.reusable,false);assert.equal(c.failurePolicy.autoRollback,true);assert.equal(c.failurePolicy.noRetry,true);assert.equal(c.truth.registryV3Public,false);assert.equal(c.truth.productsMigratedV2,0);assert.equal(c.truth.computerControlVerified,false);assert.equal(c.truth.deployedPublic,false);};
validate(lease);
assert.equal(lease.source.commit,"ff395e3d1d7c012784e81eb02c3ae8782fbf1298");
assert.equal(lease.source.evidenceCommit,"bbaa11f3f3217bafd7492d2e19b2646753204788");
assert.equal(lease.freshProduction.sourceCommit,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(lease.freshProduction.stateSha256,"343f4cbbce0aed1e3cc5894156c4480e69dfc4775e0b347c63d555bd51790d23");
assert.equal(fresh.ssh.hostKeyMatched,true);assert.equal(fresh.ssh.readOnly,true);assert.equal(fresh.production.service,"ynx-wallet-gateway.service");assert.equal(fresh.production.nRestarts,0);
assert.equal(lease.result.failureCode,"INSTALL_PERMISSION_DENIED");assert.equal(lease.result.migrationSucceeded,true);assert.equal(lease.result.candidateStarted,false);assert.equal(lease.result.rollbackRestored6cf,true);
assert.equal(leases.heavy.taskId,"P0-054");assert.equal(leases.heavy.owner,null);assert.equal(leases.heavy.status,"CONSUMED_RELEASED_FAILED_CLOSED_INSTALL_PERMISSION");
assert.equal(queue.tasks.filter(x=>x.taskId==="P0-054").length,1);assert.equal(queue.tasks.find(x=>x.taskId==="P0-054").executionLeaseIssued,false);assert.equal(queue.tasks.find(x=>x.taskId==="P0-054").p0054LeaseReusable,false);
assert.equal(acceptance.rollback.publicSource,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");assert.equal(acceptance.ownerEvidence.pending,false);assert.equal(acceptance.ownerEvidence.commit,"c569da458265a5684555d5e902dc650942a7f632");assert.equal(acceptance.ownerEvidence.sha256,"1823393cb9e61de7b7271851d262b8e578708caa98ca59e6f1b02f9a5db436db");
assert.equal(queue.tasks.find(x=>x.taskId==="P0-050").p0050LeaseReusable,false);
if(process.argv.includes("--self-test")){for(const mutate of [c=>c.reusable=true,c=>c.failurePolicy.autoRollback=false,c=>c.truth.deployedPublic=true,c=>c.truth.productsMigratedV2=1,c=>c.singleUse=false]){const c=structuredClone(lease);mutate(c);assert.throws(()=>validate(c));}console.log("PASS 5/5 P0-054 lease safety mutations rejected");}
console.log("PASS P0-054 consumed once, failed closed on install permission, restored exact 6cf and released Heavy");
