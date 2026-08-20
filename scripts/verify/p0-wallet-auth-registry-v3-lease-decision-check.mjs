#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-registry-v3-lease-decision-20260821.json");
const evidence=read(acceptance.sourceEvidence.path);
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const validateTruth=candidate=>{
  assert.equal(candidate.truth.p0039LeaseReusable,false);
  assert.equal(candidate.truth.executionLeaseIssued,false);
  assert.equal(candidate.truth.executionLeaseId,null);
  assert.equal(candidate.truth.leaseExpiry,null);
  for(const key of ["sshUsed","deploymentAttempted","productionMutation","migrationExecuted","rollbackExecuted","candidateDeployedPublic","publicRegistryV3","computerControlVerified","integratedCentral","aggregateDeployedPublic"]) assert.equal(candidate.truth[key],false,key);
  assert.equal(candidate.truth.productsMigratedV2,0);
};

assert.equal(acceptance.decision,"NO_GO_DEPLOYABLE_ARTIFACT_AND_HEAVY_SLOT_BLOCKED");
assert.equal(evidence.authoritativeParent.commit,"f32df414a75fc2c179add368f53b4085b44fad9c");
assert.equal(evidence.acceptedSuccessor.taskId,"P0-046");
assert.equal(evidence.acceptedSuccessor.sourceCommit,"a960d1007e7952c2af591d39e3673f1d9fe50e62");
assert.equal(evidence.acceptedSuccessor.evidenceCommit,"98150b1fe0a985142c5717dcc478a918e0fe7bf9");
for(const value of [evidence.artifactBlocker.deployableSourceArchiveFrozen,evidence.artifactBlocker.deployableSourceInventoryFrozen,evidence.artifactBlocker.offlineDependencyRuntimeArchiveFrozen,evidence.artifactBlocker.offlineDependencySbomFrozen,evidence.artifactBlocker.copiedRuntimeExtractionLayoutVerified]) assert.equal(value,false);
assert.equal(evidence.heavySlotBlocker.taskId,"P0-015");
assert.equal(evidence.heavySlotBlocker.heavySlotAvailable,false);
assert.equal(evidence.heavySlotBlocker.explicitReleaseObserved,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-015")?.status,"ACTIVE_PROTECTED_SEQUENTIAL_FOLLOWER_DEPLOYMENT");
assert.equal(locks.locks.find(item=>item.taskId==="P0-015")?.status,"ACTIVE_PROTECTED_SEQUENTIAL_FOLLOWER_DEPLOYMENT");
const tasks=queue.tasks.filter(item=>item.taskId==="P0-048");
assert.equal(tasks.length,1);
assert.equal(tasks[0].status,"NO_GO_DEPLOYABLE_ARTIFACT_AND_HEAVY_SLOT_BLOCKED");
assert.equal(tasks[0].executionLeaseIssued,false);
validateTruth(acceptance);

if(process.argv.includes("--self-test")){
  const mutations=[
    c=>{c.truth.p0039LeaseReusable=true;},
    c=>{c.truth.executionLeaseIssued=true;},
    c=>{c.truth.migrationExecuted=true;},
    c=>{c.truth.productsMigratedV2=1;},
    c=>{c.truth.aggregateDeployedPublic=true;}
  ];
  for(const mutate of mutations){const candidate=structuredClone(acceptance);mutate(candidate);assert.throws(()=>validateTruth(candidate));}
  console.log("PASS 5/5 P0-048 promotion mutations rejected");
}
console.log("PASS P0-048 no-GO: deployable artifacts are absent and P0-015 still occupies the protected Heavy slot");
