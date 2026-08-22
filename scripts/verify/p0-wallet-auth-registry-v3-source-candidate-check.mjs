#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const acceptance=read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-registry-v3-source-candidate-5d94dcd0-20260821.json");
const evidence=read(acceptance.sourceEvidence.path);
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");

const validateTruth=candidate=>{
  for(const key of ["executionLeaseIssued","sshUsed","deploymentAttempted","productionMutation","candidateDeployedPublic","publicRegistryV3","shopAndroidRetired410Public","shopWebPreservedOnRegistryV3Public","computerControlVerified","integratedCentral","aggregateDeployedPublic"]) assert.equal(candidate.truth[key],false,key);
  assert.equal(candidate.truth.productsMigratedV2,0,"productsMigratedV2");
};

assert.equal(acceptance.decision,"SOURCE_BLOCKERS_CLOSED_NO_EXECUTION_LEASE");
assert.deepEqual(
  {commit:evidence.source.commit,parent:evidence.source.parent,tree:evidence.source.tree,walletAuthTree:evidence.source.walletAuthTree,readback:evidence.source.changedBlobReadback},
  {commit:"5d94dcd0b25595df478ffe45a84cc346306ad4d4",parent:"890ef0f8b31ba467c5a347b83b0ec8bdca5497cf",tree:"b908a8054a2d321f75855f8030114cf9f1cba9ff",walletAuthTree:"3d638e6bf36a96bd5b861ef423cf51fbd394c2ba",readback:"11/11"}
);
assert.equal(evidence.ownerEvidence.commit,"0f8cb1da72742cb988d72868f5b2acc4ff34a93a");
assert.equal(evidence.ownerEvidence.blob,"d7ebb75923ca20d73d8c3003ec3fd8ec7ff47632");
assert.equal(evidence.ownerEvidence.contentSha256,"f85a5329019430f35ed1030be68b33e9193359eca34213d0273d2c1476069b5d");
assert.equal(evidence.closedBlockers.length,5);
assert.equal(evidence.registry.artifactSha256,"810c58777a62a798e286d2d30e0430334b88603653f672821642e80e3553c46c");
assert.equal(evidence.registry.stateBindingSha256,"f300fb098c832161aaeb2bcf62b61a7b5b674ea0b443ebd9ca0189592e0b10d7");
assert.deepEqual(evidence.tests,{focusedPassed:10,focusedFailed:0,walletAuthPassed:347,walletAuthFailed:0,packageBytes:179690,packageEntries:98,packageSha256:"5c4713c50fe7cbcbca6dad673a689960c53822c68910db9701a3376d8269c126",repeatPackageSha256Matched:true});
validateTruth(acceptance);
const task=queue.tasks.find(item=>item.taskId==="P0-041");
assert.equal(task.status,"SOURCE_BLOCKERS_CLOSED_NO_EXECUTION_LEASE");
assert.equal(task.executionLeaseIssued,false);

if(process.argv.includes("--self-test")){
  const mutations=[
    c=>{c.truth.executionLeaseIssued=true;},
    c=>{c.truth.deploymentAttempted=true;},
    c=>{c.truth.candidateDeployedPublic=true;},
    c=>{c.truth.productsMigratedV2=1;},
    c=>{c.truth.aggregateDeployedPublic=true;}
  ];
  for(const mutate of mutations){const candidate=structuredClone(acceptance);mutate(candidate);assert.throws(()=>validateTruth(candidate));}
  console.log("PASS 5/5 Registry v3 source-candidate promotion mutations rejected");
}
console.log("PASS Registry v3 source blockers closed; no lease, deployment or public promotion");
