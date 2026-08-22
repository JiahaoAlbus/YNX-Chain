import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const blob=p=>{const b=fs.readFileSync(path.join(root,p));return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex");};
const audit=read("release/integration/p0-wallet-connectivity/acceptance/developer-sdk-manifest-delta-20260820.json");
const assignment=read("release/integration/p0-wallet-connectivity/assignments/developer-sdk.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const manifestPath="release/integration/p0-wallet-connectivity/public-endpoint-manifest.json";
const manifest=read(manifestPath);
const assert=(v,m)=>{if(!v)throw new Error(m);};
assert(audit.decision==="SDK_ONLY_CLEAN_REBASE_ACCEPTED_SOURCE_ONLY","decision");
assert(audit.safeCandidate.commit==="24773900321b944444f37c7fcb2ea91b6f928d7e"&&audit.safeCandidate.parent==="0a03050c305eb2f7f0d53513bcf3ea6073ba3371","candidate source");
assert(audit.safeCandidate.changedFiles.length===5&&audit.safeCandidate.changedFiles.every(x=>x.path.startsWith("packages/dapp-connect-sdk/")),"five-path scope");
assert(audit.safeCandidate.verification.testsPassed===12&&audit.safeCandidate.verification.testsFailed===0&&audit.safeCandidate.verification.packageOnlyMigrationFindings===0,"candidate gates");
assert(blob(manifestPath)==="7362ac2f99c34a89ef5db6b0a5ee2b2af8d4b747","manifest blob");
assert(manifest.releaseId==="P0-WALLET-CONNECTIVITY-2026-08-endpoints-2"&&manifest.integrity.status==="BUNDLED_SHA256_ACCEPTED","manifest acceptance");
assert(audit.historicalCentralReconciliation.candidateParentIsAncestor===false&&audit.historicalCentralReconciliation.actualMergeBase==="315897e75c0ffe3e63435fe73cfec42244b851cc","historical base audit");
assert(audit.historicalCentralReconciliation.cherryPickAttempt==="CONFLICT"&&audit.historicalCentralReconciliation.conflicts.length===5&&audit.historicalCentralReconciliation.candidatePostImagesCopied===false,"historical conflict audit");
assert(audit.historicalPrTopology.pr105UnsafeWholeTree===true&&audit.historicalPrTopology.mergeEitherCurrentHead===false,"historical PR topology");
const clean=audit.cleanRebaseAcceptance;
assert(clean.prHead==="e649cd7cddf753d732033e24c9c3b73ecf7b807a"&&clean.manifestCommit==="3437be2f3e4d174cd8a35949e08de673f31942b8","clean source");
assert(clean.manifestParentActual==="a6d69e118c84b7b8df4d38198ae353fec6d2cd38"&&clean.centralMergeParent==="c0a66cb6bfe42d2f1f658ebd93f41eec0f245f2d","clean parents");
assert(clean.sdkTree==="c526fd89d08024cc955a12055b9d5d5643e1cb6f"&&clean.changedPaths===13&&clean.manifestDeltaPaths===5&&clean.appsDeveloperPathsChanged===false,"SDK-only materialization");
assert(clean.testsPassed===12&&clean.testsFailed===0&&clean.compatibilityLabExplicitSkips===10&&clean.simulatedCompatibilityPasses===0&&clean.packageOnlyMigrationFindings===0,"clean gates");
assert(clean.manifestResult==="BUNDLED_SHA256_ACCEPTED","clean manifest");
const validateBoundaries=x=>{
  assert(x.truth.candidateConsumed===true,"source consumed");
  for(const k of ["productMigration","publicSdkReleased","deployedPublic","integratedCentral","remoteManifestReplacementEnabled"])assert(x.truth[k]===false,`truth ${k}`);
  assert(x.cleanRebaseAcceptance.simulatedCompatibilityPasses===0,"no simulated passes");
  assert(x.cleanRebaseAcceptance.appsDeveloperPathsChanged===false,"SDK-only scope");
};
validateBoundaries(audit);
assert(assignment.status==="SDK_ONLY_CLEAN_REBASE_SOURCE_ACCEPTED"&&assignment.manifestCandidate.consumed===true,"assignment");
const task=queue.tasks.find(x=>x.taskId==="P0-003");
assert(task.status==="SDK_ONLY_CLEAN_REBASE_SOURCE_ACCEPTED"&&task.manifestCandidate.consumed===true,"queue");
assert(task.productMigration===false&&task.publicSdkReleased===false&&task.deployedPublic===false,"queue truth");
if(process.argv.includes("--self-test")){
  const mutations=[
    x=>{x.truth.productMigration=true;},
    x=>{x.truth.publicSdkReleased=true;},
    x=>{x.truth.deployedPublic=true;},
    x=>{x.cleanRebaseAcceptance.simulatedCompatibilityPasses=1;},
    x=>{x.cleanRebaseAcceptance.appsDeveloperPathsChanged=true;}
  ];
  for(const mutate of mutations){
    const x=structuredClone(audit); mutate(x);
    let rejected=false;
    try{validateBoundaries(x);}catch{rejected=true;}
    assert(rejected,"mutation rejected");
  }
  console.log("PASS 5/5 Developer SDK promotion/scope mutations rejected");
}
console.log("PASS P0-003 SDK-only clean rebase accepted; product migration and public SDK release remain false");
