#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-legacy-6cf-migration-remediation-source-20260821.json");
const evidence=read(acceptance.sourceEvidence.path);
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const validate=c=>{
  assert.equal(c.decision,"SOURCE_AND_OFFLINE_ARTIFACTS_ACCEPTED_FRESH_PRODUCTION_READ_REQUIRED_NO_LEASE");
  assert.equal(c.executionLeaseIssued,false); assert.equal(c.executionLeaseId,null);
  assert.equal(c.p0039LeaseReusable,false); assert.equal(c.p0050LeaseReusable,false);
  assert.equal(c.productsMigratedV2,0); assert.equal(c.registryV3Public,false);
  assert.equal(c.deployedPublic,false); assert.equal(c.computerControlVerified,false); assert.equal(c.integratedCentral,false);
};
validate(acceptance);
assert.equal(acceptance.taskId,"P0-053");
assert.equal(evidence.ownerSource.commit,"ff395e3d1d7c012784e81eb02c3ae8782fbf1298");
assert.equal(evidence.ownerSource.evidenceCommit,"bbaa11f3f3217bafd7492d2e19b2646753204788");
assert.equal(evidence.ownerSource.evidenceBlob,"c782de72596ae2196489cb95ae7ba433c105daf9");
assert.equal(evidence.ownerSource.evidenceSha256,"efba8348c5410fca6cd9e6d8f7feb2548f0a3ea4ba5932ca61d0235e5432c4db");
assert.equal(evidence.repairBoundary.acceptsOnlyCompleteBytesEqualCanonicalJson,true);
assert.equal(evidence.repairBoundary.trimmingOrNormalizationAllowed,false);
assert.equal(evidence.independentVerification.focusedTests,"5/5");
assert.equal(evidence.independentVerification.fullWalletAuthTests,"348/348");
assert.equal(evidence.independentVerification.repeatPackSha256,"f9e1e6ef072e4c15716617d992a5c47ee79c139fbdeff79fc28cd7d42e52e944");
assert.equal(evidence.heavySlot.taskId,"P0-051"); assert.equal(evidence.heavySlot.available,true);
assert.equal(leases.heavy.taskId,"P0-054"); assert.equal(leases.heavy.owner,null); assert.equal(leases.heavy.status,"CONSUMED_RELEASED_FAILED_CLOSED_INSTALL_PERMISSION");
assert.equal(evidence.concurrentLightSlice.taskId,"P0-052"); assert.equal(evidence.concurrentLightSlice.preserved,true);
for(const key of ["executionLeaseIssued","productionStateReadAfterP0050","sshUsed","deploymentAttempted","migrationExecuted","rollbackExecuted","candidateActivated"]) assert.equal(evidence.truth[key],false);
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-053").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-053")?.executionLeaseIssued,false);
if(process.argv.includes("--self-test")){
  const mutations=[c=>{c.executionLeaseIssued=true;},c=>{c.executionLeaseId="P0-050";},c=>{c.p0050LeaseReusable=true;},c=>{c.productsMigratedV2=1;},c=>{c.deployedPublic=true;}];
  for(const mutate of mutations){const candidate=structuredClone(acceptance);mutate(candidate);assert.throws(()=>validate(candidate));}
  console.log("PASS 5/5 P0-053 lease/public promotion mutations rejected");
}
console.log("PASS P0-053 source remains accepted; P0-054 was isolated, consumed and released without public promotion");
