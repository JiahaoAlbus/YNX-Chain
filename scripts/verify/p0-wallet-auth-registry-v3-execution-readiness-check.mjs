#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-registry-v3-execution-readiness-5b96628a-20260821.json");
const evidence=read(acceptance.sourceEvidence.path);
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const validateTruth=candidate=>{
  assert.equal(candidate.truth.p0039LeaseReusable,false);
  assert.equal(candidate.truth.executionLeaseIssued,false);
  assert.equal(candidate.truth.executionLeaseId,null);
  for(const key of ["sshUsed","deploymentAttempted","productionMutation","candidateDeployedPublic","publicRegistryV3","computerControlVerified","integratedCentral","aggregateDeployedPublic"]) assert.equal(candidate.truth[key],false,key);
  assert.equal(candidate.truth.productsMigratedV2,0);
};

assert.equal(acceptance.decision,"SOURCE_ACCEPTED_EXECUTION_LEASE_BLOCKED");
assert.deepEqual(
  {commit:evidence.ownerCheckpoint.commit,parent:evidence.ownerCheckpoint.parent,tree:evidence.ownerCheckpoint.tree,blob:evidence.ownerCheckpoint.blob},
  {commit:"5b96628a7ae48a257c8236a5391347a7ea9bf8dc",parent:"e5a6615e6367bfd8f3f226216dbeeb0cc77c09fb",tree:"20af1bc075e1edbce4d46495eb96cb0a97fcf0ec",blob:"f79e33a23d4caa89eebaaf11c1367eb6df565aee"}
);
assert.equal(evidence.ownerCheckpoint.contentSha256,"bbae91c630fab3d9ca968dc068d333c551bcedde0e73466c0041ab50a470ad9b");
assert.equal(evidence.p0041Binding.centralCommit,"645eb41e6b4db3f0ce813231541e475071b389f6");
assert.deepEqual(evidence.hermeticVerification,{focusedPassed:10,focusedFailed:0,cleanClonePassed:345,cleanCloneFailed:2,ownerClaimHermetic:false});
assert.equal(evidence.blockingRequirements.length,4);
assert.equal(evidence.truth.publicRuntimeSource,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
validateTruth(acceptance);
const task=queue.tasks.find(item=>item.taskId==="P0-042");
assert.equal(task.status,"SOURCE_ACCEPTED_EXECUTION_LEASE_BLOCKED");
assert.equal(task.executionLeaseIssued,false);

if(process.argv.includes("--self-test")){
  const mutations=[
    c=>{c.truth.p0039LeaseReusable=true;},
    c=>{c.truth.executionLeaseIssued=true;},
    c=>{c.truth.deploymentAttempted=true;},
    c=>{c.truth.productsMigratedV2=1;},
    c=>{c.truth.aggregateDeployedPublic=true;}
  ];
  for(const mutate of mutations){const candidate=structuredClone(acceptance);mutate(candidate);assert.throws(()=>validateTruth(candidate));}
  console.log("PASS 5/5 Registry v3 execution-readiness promotion mutations rejected");
}
console.log("PASS Registry v3 execution readiness blocked; P0-039 remains nonreusable and no lease exists");
