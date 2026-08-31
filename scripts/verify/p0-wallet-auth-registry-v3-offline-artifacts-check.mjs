#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-registry-v3-offline-artifacts-79a87d87-20260821.json");
const evidence=read(acceptance.sourceEvidence.path);
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");
const validateTruth=candidate=>{
  assert.equal(candidate.truth.p0039LeaseReusable,false);
  assert.equal(candidate.truth.executionLeaseIssued,false);
  assert.equal(candidate.truth.executionLeaseId,null);
  assert.equal(candidate.truth.leaseExpiry,null);
  for(const key of ["sshUsed","deploymentAttempted","productionStateRead","productionMutation","migrationExecuted","rollbackExecuted","candidateDeployedPublic","publicRegistryV3","computerControlVerified","integratedCentral","aggregateDeployedPublic"]) assert.equal(candidate.truth[key],false,key);
  assert.equal(candidate.truth.productsMigratedV2,0);
};

assert.equal(acceptance.decision,"OFFLINE_ARTIFACT_BLOCKER_CLOSED_HEAVY_SLOT_BLOCKED_NO_LEASE");
assert.deepEqual(
  {commit:evidence.ownerEvidence.commit,parent:evidence.ownerEvidence.parent,tree:evidence.ownerEvidence.tree,blob:evidence.ownerEvidence.blob,sha256:evidence.ownerEvidence.contentSha256},
  {commit:"79a87d87cd819672e65dd42546da997d8a80985e",parent:"98150b1fe0a985142c5717dcc478a918e0fe7bf9",tree:"0136f46c12c6bfff4e497250018fd219779ca77e",blob:"9977dfd44bd82aa40063f491c4eaded0afc04e08",sha256:"facbca0ffc1fe502beba079c5433f4d6b8adb2877e50c41e519ace4861e8fbc2"}
);
assert.equal(evidence.artifacts.length,5);
assert.deepEqual(evidence.artifacts.map(item=>item.sha256),[
  "f1916b5ab272cd6c301d949de8123e14d90b7ff6cd4212c77e881acab206862f",
  "f2276b64be3c61568fdd7d61d65cca52d06a4f2f0f4513b5a64e282b87c4e3be",
  "7c57e29b46fcd09dcfc2f5f13e81bb43400947f41113c604220804c20703fd46",
  "e873bc9555b4b1d4067b8899c7aae3cbb36dd2b5b67ae7247665e23874273137",
  "72f65bd1cf1561a641b71ae3d735a32932f17ab1f685c3d7975538547e9368f5"
]);
assert.equal(evidence.sourceBinding.packageLockSha256,"c32e52b9c87743ee5870ec146590f203f0084926dfbf9a66b7edb5a9224ce606");
assert.equal(evidence.sourceBinding.deploymentArchiveContainsTests,false);
assert.equal(evidence.independentVerification.changedBlobsReadback,"7/7");
assert.equal(evidence.independentVerification.loopbackDaemonColdStartPassed,true);
assert.equal(evidence.independentVerification.versionRemoteDeployed,false);
assert.equal(evidence.heavySlotAudit.heavySlotAvailable,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-015")?.status,"RELEASED_CHECKPOINT");
assert.equal(locks.locks.find(item=>item.taskId==="P0-015")?.status,"RELEASED_CHECKPOINT");
const tasks=queue.tasks.filter(item=>item.taskId==="P0-049");
assert.equal(tasks.length,1);
assert.equal(tasks[0].status,"ARTIFACT_ACCEPTED_P0015_RELEASED_FRESH_STATE_REVIEW_REQUIRED");
assert.equal(tasks[0].executionLeaseIssued,false);
validateTruth(acceptance);

if(process.argv.includes("--self-test")){
  const mutations=[
    c=>{c.truth.p0039LeaseReusable=true;},
    c=>{c.truth.executionLeaseIssued=true;},
    c=>{c.truth.productionStateRead=true;},
    c=>{c.truth.productsMigratedV2=1;},
    c=>{c.truth.aggregateDeployedPublic=true;}
  ];
  for(const mutate of mutations){const candidate=structuredClone(acceptance);mutate(candidate);assert.throws(()=>validateTruth(candidate));}
  console.log("PASS 5/5 P0-049 promotion mutations rejected");
}
console.log("PASS P0-049 offline artifacts accepted; P0-015 is released and fresh state review is still required before any new lease");
