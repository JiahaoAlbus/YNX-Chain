import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {C5_NATIVE_ROOT,C5_NATIVE_ATTEMPT,NATIVE_CONTINUATION_OVERLAY,assertNativeContinuationCore,nativeContinuationFilePin,verifyNativeContinuationReceipt} from '../scripts/wallet-native-continuation.mjs';
// Public build objects, never account/key material. Their digest is independently
// fixed by the original first-cause handoff, not selected by a receipt.
const rows=[["native-main-0.o",988136,"7f71fc33e9b46080e4210ca0b6818090ec11199924058e68cf6faecc175a5935"],["native-main-1.o",667848,"8603a316bfcd50825282c9eae147664bef69a538dc68f2c0eedd16ff9e5d50a3"],["native-main-10.o",45424,"5b95ffb52de6b2686cbc71c5acc412fbe7699e70fdea7b2a560fb8f0fb8e6bd0"],["native-main-11.o",44416,"0a44f4f7858c696767af0f33df5c0aa2388f6a6b767ecd46a5755f1fe3803716"],["native-main-12.o",24072,"081282c2a3ee991eff505969ee5c72e550f5fa1acc21af75eb9b6a7c577be77e"],["native-main-13.o",73864,"057d5cc55884d4897a02637ed603bc5cce1ca6d4fe607a4ead9382a8568418e5"],["native-main-14.o",45664,"5529efc511e2688a0882aee54ecd957c9c5814392a25b005b8181f5179e4f45a"],["native-main-15.o",195232,"d7df113c686825003781a1e42373da1fd224ca79ac089a5ae6511cfdbc09f4fc"],["native-main-16.o",17544,"ee186f3afe7f5d35062a614592c788ab771dd558c31568563ddc5d6a23874e31"],["native-main-17.o",192240,"5621632d31faac0af1391660f7a6caad33c45b45a09f26648141893cfdf80681"],["native-main-2.o",51496,"1ea255a1a446cc42f58c399493ee8dd13f1be0763348a527437f6ef1a35fc1f1"],["native-main-3.o",40096,"b08f8014432472cc22f4d7f020493dc58e64b9f4881312e820eef2d4c88ac3a5"],["native-main-4.o",63144,"0fe75dcde78149edad92ab7546c670440527843279dc53d75e8d4428eec047d5"],["native-main-5.o",86312,"7739886fa604f0ff9305457f3e5a5523cb63a6192fda72c7e16b23fef89c71a1"],["native-main-6.o",194960,"6ce46fbf5212749162b58bcb23e9edae9ad7c7c72fc724fd93827832499a5034"],["native-main-7.o",52624,"cbda67b5b72321d55c607071fd5365839ff8f013df80a21b7223dc0bec454197"],["native-main-8.o",199144,"de50565a8324be9a959fae3d0510fa434b77037135c708c22c50d802425c5d78"],["native-main-9.o",86416,"b2fa530d1374cf7d5084cc040e041ecd239790b74867f5928327d4e850f8f538"],["native-wipe.o",592,"5654e9bc96c301aa8d5c12b7a3dfee33a1294a7b4a87f13dfaefcab3a18e4c5b"]];
const root=path.join(C5_NATIVE_ROOT,'source'),attempt=path.join(C5_NATIVE_ROOT,'remaining-header-r4-once');
const pin=file=>({path:file,bytes:1,sha256:'a'.repeat(64)});
const objects=()=>rows.map(([name,bytes,sha256])=>({path:path.join(root,'apps/wallet-desktop/native/pq-transaction',name),bytes,sha256}));
const core=()=>({priorPlan:{commands:['original']},currentPlan:{commands:['original']},retainedObjects:objects(),expectedObjects:objects(),originalSource:{commit:C5_NATIVE_ATTEMPT.sourceCommit},currentSource:{commit:C5_NATIVE_ATTEMPT.sourceCommit},environment:{SDKROOT:'fixed'},expectedEnvironment:{SDKROOT:'fixed'}});
function receipt(){
 const commands=Array.from({length:19},(_,i)=>({tool:'/usr/bin/clang++',argv:['original-'+i]}));commands.push({tool:'/usr/bin/xcrun',argv:['swiftc','original-source','-o','original-output']});
 const helper=[{tool:'/usr/bin/clang++',argv:['original-helper']}],temp='/tmp/ynx-c5-owned';
 const original={sameAttemptOnly:true,completedCommands:19,strictToolchainIdentityQualified:false,futureToolchainReuseAuthorized:false,Root:false,Source:false,installed:false,attempt,headers:'/original/headers',source:{root,commit:C5_NATIVE_ATTEMPT.sourceCommit,tree:C5_NATIVE_ATTEMPT.sourceTree,Main:C5_NATIVE_ATTEMPT.Main},handoff:{path:path.join(attempt,C5_NATIVE_ATTEMPT.file),bytes:C5_NATIVE_ATTEMPT.bytes,sha256:C5_NATIVE_ATTEMPT.sha256},objects:objects(),overlay:NATIVE_CONTINUATION_OVERLAY.map(p=>pin(path.join(root,p))),remainingCommands:[commands.at(-1),...helper],probe:{tool:'/usr/bin/xcrun',argv:['swiftc','-driver-print-jobs',...commands.at(-1).argv.slice(1)]},environment:{DEVELOPER_DIR:'/Applications/Xcode.app/Contents/Developer',SDKROOT:'/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk',TMPDIR:temp},temporary:{entry:temp,target:path.join(attempt,'scratch'),device:'1'}};
 return {readbackOnly:false,commandsKind:'executed-normal-build',sourceRoot:root,headerRoot:original.headers,architectures:['arm64'],commands,helperBuild:{commands:helper},buildContinuation:{kind:'YNX_WALLET_NATIVE_SAME_ATTEMPT_CONTINUATION/v1',original,probe:pin(path.join(attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_PROBE.json')),runIntent:pin(path.join(attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_RUN_INTENT.json')),priorPrefixCommands:19,thisInvocationNodeCommands:1,thisInvocationHelperCommands:1,originalPrefixExecutedPreviously:true,strictToolchainIdentityQualified:false,futureToolchainReuseAuthorized:false}};
}
test('exact19 continuation preserves prior prefix without granting future toolchain reuse',()=>{
 const out=assertNativeContinuationCore(core());assert.equal(out.completedCommands,19);assert.equal(out.sameAttemptOnly,true);assert.equal(out.strictToolchainIdentityQualified,false);assert.equal(out.futureToolchainReuseAuthorized,false);
});
test('missing, duplicate, replaced and changed objects refuse continuation',()=>{
 for(const kind of ['missing','duplicate','hash','size','path']){const c=core();if(kind==='missing')c.retainedObjects.pop();if(kind==='duplicate')c.retainedObjects[1]=c.retainedObjects[0];if(kind==='hash')c.retainedObjects[0].sha256='0'.repeat(64);if(kind==='size')c.retainedObjects[0].bytes++;if(kind==='path')c.retainedObjects[0].path+='.other';assert.throws(()=>assertNativeContinuationCore(c));}
});
test('changed source, original command order or environment refuse continuation',()=>{
 for(const key of ['currentPlan','currentSource','environment']){const c=core();c[key]={changed:true};assert.throws(()=>assertNativeContinuationCore(c));}
});
test('canonical continuation DATA preserves exact original pins and command suffix',()=>{
 const r=receipt();assert.deepEqual(verifyNativeContinuationReceipt(r),{sameAttemptOnly:true,completedCommands:19,futureToolchainReuseAuthorized:false});assert.equal(verifyNativeContinuationReceipt({}),undefined);
});
test('canonical continuation refuses forged parent, prefix, metadata, temp, probe or authority',()=>{
 const changes=[r=>r.readbackOnly=true,r=>r.sourceRoot+='/other',r=>r.buildContinuation.original.handoff.sha256='0'.repeat(64),r=>r.buildContinuation.original.objects[0].sha256='0'.repeat(64),r=>r.buildContinuation.original.overlay.pop(),r=>r.buildContinuation.original.remainingCommands.reverse(),r=>r.buildContinuation.original.probe.argv.splice(1,1),r=>r.buildContinuation.original.environment.TMPDIR='/tmp/中文',r=>r.buildContinuation.original.temporary.target='/unrelated',r=>r.buildContinuation.probe.path+='.other',r=>r.buildContinuation.priorPrefixCommands=0,r=>r.buildContinuation.futureToolchainReuseAuthorized=true,r=>r.buildContinuation.original.Source=true];
 for(const change of changes){const r=receipt();change(r);assert.throws(()=>verifyNativeContinuationReceipt(r));}
});
test('streaming pins hash only an existing stable regular file',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'wallet-continuation-test-'));try{const file=path.join(dir,'public.txt');writeFileSync(file,'abc');assert.deepEqual(nativeContinuationFilePin(file),{path:file,bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'});assert.throws(()=>nativeContinuationFilePin(dir));}finally{rmSync(dir,{recursive:true});}
});

