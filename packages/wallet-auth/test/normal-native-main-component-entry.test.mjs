import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createNormalNativeCompileReuseBinding,verifyNormalNativeCompileReuseBinding} from '../scripts/normal-native-compile-reuse.mjs';
const sourceExecutionHandoff={path:'/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-main711-auth26-component-light-intake-20261024/component-suffix-r2-once/MAIN711_AUTH26_COMPLETE_MATCHING_COMPONENT_HANDOFF.json',bytes:47461,sha256:'5812ebd34aa76e532dd71cc038338fdee449baa61398ce097a247aef2cfb8dcc'};
function fixture(run){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'PUBLIC-main-reuse-entry-')));try{const sourceTuplePath=path.join(root,'26.json'),targetTuplePath=path.join(root,'28.json');fs.writeFileSync(sourceTuplePath,JSON.stringify({version:'1.3.0-pq.3.32-auth.26'}));fs.writeFileSync(targetTuplePath,JSON.stringify({version:'1.3.0-pq.3.32-auth.28'}));run({sourceTuplePath,targetTuplePath,sourceExecutionHandoff},root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
test('shared CREATE entry selects explicit Main26-to28 contract before any legacy record read',()=>fixture(request=>{
 assert.throws(()=>createNormalNativeCompileReuseBinding(request),{code:'MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_REQUIRED'});
 let called=false;Object.defineProperty(request,'targetMainProfileHandoff',{get(){called=true;throw null}});
 assert.throws(()=>createNormalNativeCompileReuseBinding(request),{code:'MAIN_COMPONENT_REUSE_DATA'});assert.equal(called,false);
}));
test('shared VERIFY entry cannot turn a pinned claimed receipt into a Main reuse grant',()=>fixture((request,root)=>{
 const file=path.join(root,'claimed.json'),raw=Buffer.from(JSON.stringify({kind:'YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1',NativeQualified:true}));fs.writeFileSync(file,raw);
 const receipt={path:file,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
 assert.throws(()=>verifyNormalNativeCompileReuseBinding({request,receipt}),{code:'MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_REQUIRED'});
}));
