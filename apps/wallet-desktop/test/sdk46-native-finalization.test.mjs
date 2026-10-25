import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {verifySDK13NativeComponent,SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST} from '../scripts/sdk13-native-component.mjs';
import {walletNativeSourceProfile,walletPublisherNativeInputs} from '../scripts/wallet-publisher-native-build.mjs';
import {PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
import {pqNativeSupplierInputs} from '../scripts/wallet-pq-native-build.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {assertSDK46FinalizationCore,verifySDK46RecordFinalizationReceipt,SDK46_FINALIZATION_ROOT,SDK46_FINALIZATION_HANDOFF,SDK46_FINALIZATION_OVERLAY} from '../scripts/wallet-native-record-finalization.mjs';
const root=process.env.WALLET_SDK46_FINALIZATION_EVIDENCE;
const needed={skip:!root?'requires original A immutable SDK46 terminal failure evidence':false};
function fixture(){const bytes=readFileSync(root);assert.equal(bytes.length,SDK46_FINALIZATION_HANDOFF.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),SDK46_FINALIZATION_HANDOFF.sha256);const handoff=JSON.parse(bytes),base=SDK46_FINALIZATION_ROOT+'/header-remaining-once/',load=n=>JSON.parse(readFileSync(base+n));return {handoff,node:structuredClone(handoff.normalCommands.node),helper:structuredClone(handoff.normalCommands.helper),repo:SDK46_FINALIZATION_ROOT+'/source',headers:load('ORIGINAL_NORMAL_MATCHED_PQ_NATIVE_COMPONENT.request.json').argv[4],request:load('ORIGINAL_NORMAL_MATCHED_PQ_NATIVE_COMPONENT.request.json'),result:load('BUILD_RESULT.json'),children:load('ACTUAL_CHILD_TOOL_ARGV.json')};}
test('actual terminal63578 metadata permits only final record suffix, no compiler or future reuse',needed,()=>{
 const result=assertSDK46FinalizationCore(fixture());assert.deepEqual(result,{sameAttemptOnly:true,priorNodeCommands:20,priorHelperCommands:1,compilerExecution:false,futureToolchainReuseAuthorized:false,strictToolchainIdentityQualified:false});
});
test('same-attempt core refuses changed commands, missing observations, outputs, source, incomplete or claimed-success attempts',needed,()=>{
 const changes=[f=>f.repo+='/other',f=>f.headers+='/other',f=>f.handoff.sdk='1.3.0-pq.3.32-auth.48',f=>f.handoff.sessionExit=0,f=>f.handoff.actualSummary.noInflight=false,f=>f.handoff.actualSummary.ownedGone--,f=>f.handoff.Source=true,f=>f.node.commands.reverse(),f=>f.helper.commands[0].argv.push('other'),f=>f.children=f.children.filter(r=>r.ppid!==f.request.pid),f=>f.handoff.immutableOutputs[0].original.sha256='0'.repeat(64),f=>f.result.terms[0].actualExit=1,f=>f.result.terms[2].guard='interrupted',f=>f.result.owned[0].present=true];
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>assertSDK46FinalizationCore(f),/FINALIZATION_DIFFERS/);}
});
function receipt(){const f=fixture(),base=assertSDK46FinalizationCore(f);return {readbackOnly:false,commandsKind:'executed-normal-build',sourceRoot:f.repo,headerRoot:f.headers,sourceInventory:{bytes:84691,sha256:'653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e'},architectures:['arm64'],commands:f.node.commands,output:{relative:'apps/wallet-desktop/native/original-auth-identity.node',bytes:f.handoff.module.bytes,sha256:f.handoff.module.sha256},helperBuild:{commands:f.helper.commands,output:{relative:'apps/developer/helper/YNXIdentityReceiver',bytes:f.handoff.helper.bytes,sha256:f.handoff.helper.sha256}},buildFinalization:{...base,kind:'YNX_WALLET_SDK46_SAME_ATTEMPT_FINALIZATION/v1',handoff:SDK46_FINALIZATION_HANDOFF,sourceRoot:f.repo,headerRoot:f.headers,outputs:f.handoff.immutableOutputs.map(p=>p.original),overlay:SDK46_FINALIZATION_OVERLAY.map(p=>({path:f.repo+'/'+p,bytes:1,sha256:'a'.repeat(64)})),originalParentPid:f.request.pid,Root:false,Source:false,installed:false}};}
test('finalization receipt retains actual21 output pins and refuses relabeling, modified objects or dual continuation',needed,()=>{
 assert.deepEqual(verifySDK46RecordFinalizationReceipt(receipt()),{sameAttemptOnly:true,compilerExecution:false,futureToolchainReuseAuthorized:false});
 for(const change of [r=>r.readbackOnly=true,r=>r.buildContinuation={},r=>r.buildFinalization.futureToolchainReuseAuthorized=true,r=>r.buildFinalization.outputs[0].sha256='0'.repeat(64),r=>r.buildFinalization.outputs.pop(),r=>r.buildFinalization.overlay.pop(),r=>r.buildFinalization.handoff={...r.buildFinalization.handoff,sha256:'0'.repeat(64)},r=>r.output.bytes++,r=>r.sourceInventory.bytes++,r=>r.buildFinalization.priorNodeCommands=0]){const r=receipt();change(r);assert.throws(()=>verifySDK46RecordFinalizationReceipt(r),/FINALIZATION_DIFFERS/);}
});
test('normal producer finalization branch bypasses compile loop, retains normal record verification and exclusive writes',()=>{
 const code=readFileSync(new URL('../scripts/build-wallet-native-component.mjs',import.meta.url),'utf8');assert.match(code,/for\(const command of finalized\?\[\]:resumed\?resumed.remainingCommands/);assert.match(code,/if\(finalized\)record.buildFinalization=finalized/);assert(code.indexOf('verifySDK13NativeComponent({record')<code.indexOf('createExclusive(helperAlias'));
 const verifier=readFileSync(new URL('../scripts/canonical-package.mjs',import.meta.url),'utf8');assert.match(verifier,/verifySDK46RecordFinalizationReceipt\(receipt\)/);
});
test('original normal record construction validates actual unchanged Native100 module/helper/source bytes without emitting a record',needed,()=>{
 const f=fixture(),repo=f.repo,regular=p=>readFileSync(p),hash=b=>createHash('sha256').update(b).digest('hex'),pin=(relative,b)=>({relative,bytes:b.length,sha256:hash(b)});
 const inventoryRelative='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',inventoryBytes=regular(path.join(repo,inventoryRelative)),inventory=JSON.parse(inventoryBytes),profile=walletNativeSourceProfile(inventory.version),selectedNative=pqNativeSupplierInputs(inventory.NativeInputs,true),supplier=[...selectedNative,...inventory.HelperInputs],node=f.node,helper=f.helper,headerPins=PINNED_NODE_HEADER_PINS,architectures=['arm64'];
 const scan=plan=>{const stdout=execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'});return {...plan.ownedUndefinedScan,exit:0,stdoutSHA256:hash(Buffer.from(stdout)),ownedUndefined:[]};};
 const moduleBytes=regular(f.handoff.module.path),helperBytes=regular(f.handoff.helper.path);assert.equal(hash(moduleBytes),f.handoff.module.sha256);assert.equal(hash(helperBytes),f.handoff.helper.sha256);
 const union=sdkRuntimeUnionProfile(inventory.version),runtimeUnion={...union,filesVerified:union.files,sourceRoot:repo+'/packages/wallet-auth',NativeAdmission:false,installedImageQualified:false,platformQualified:false,networkActivated:false};
 const code=readFileSync(new URL('../scripts/build-wallet-native-component.mjs',import.meta.url),'utf8'),start=code.indexOf(' const record={schemaVersion:'),end=code.indexOf(' createExclusive(helperAlias,helperBytes');assert(start>0&&end>start);
 let verified=false;const context={repo,headers:f.headers,inventoryRelative,inventoryPin:profile.inventory,inventory,inventoryBytes,profile,selectedNative,supplier,node,helper,headerPins,architectures,moduleBytes,helperBytes,nodeScan:scan(node),helperScan:scan(helper),walletPublisherNativeInputs,SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,pin,regular,path,pqNative:true,runtimeUnion,continuationRecord:null,finalized:null,verifySDK13NativeComponent:(input,read)=>{const actual=verifySDK13NativeComponent({...input,record:structuredClone(input.record)},read);assert.equal(actual.sourceBytesVerified,true);assert.equal(actual.artifactBytesVerified,true);assert.equal(actual.supplierNodeInputCount,100);assert.equal(actual.nativeQualified,false);assert.equal(actual.installed,false);verified=true;}};
 runInNewContext(code.slice(start,end),context);assert(verified);
 // No record/alias writer or compiler is exposed to this VM. The production
 // producer remains the ONLY writer in A's authorized finalize invocation.
});
