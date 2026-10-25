import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {inspectNativeComponentGitSourceClosure,assertNativeComponentGitSourceClosure} from '../scripts/native-component-source-closure.mjs';
const original=process.env.WALLET_SDK46_SOURCE_CLOSURE_ROOT;
const commit='6fc2788243cc4b7637b377d68c434122693fcb8b',recordPath='apps/wallet-desktop/native/original-auth-identity-build.json';
const supplier='/Users/huangjiahao/.codex/worktrees/wallet-auth-wallet-source/YNX Chain',supplierCommit='59a3797ea3421129171565e37870568e424ec085';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:16<<20,stdio:['ignore','pipe','ignore']});
const needed={skip:!original?'requires preserved original6fc record and SDK46/Protocol public source supply':false};
test('original6fc aggregates all15 missing Git inputs, even though all matching disk files exist',needed,()=>{
 const bytes=git(original,'show',commit+':'+recordPath),result=inspectNativeComponentGitSourceClosure(original,commit,bytes);
 assert.deepEqual(result.counts,{node:123,helper:105});assert.equal(result.unique,128);assert.equal(result.complete,false);assert.equal(result.defects.length,15);
 for(const row of result.defects){assert.equal(row.reason,'GIT_SOURCE_MISSING');const raw=fs.readFileSync(path.join(original,row.relative));assert.equal(raw.length,row.bytes);assert.equal(hash(raw),row.sha256);}
 assert.throws(()=>assertNativeComponentGitSourceClosure(original,commit,bytes),e=>e.code==='NATIVE_COMPONENT_GIT_SOURCE_CLOSURE_DIFFERS'&&e.closure.defects.length===15);
 assert.throws(()=>inspectNativeComponentGitSourceClosure(original,commit,Buffer.concat([bytes,Buffer.from('\n')])),/NATIVE_COMPONENT_GIT_RECORD_DIFFERS/);
});
test('all128 exact immutable supplier blobs close Git custody without changing actual record or recompiling Native',needed,async t=>{
 const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-native-Git-closure-')));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const recordBytes=git(original,'show',commit+':'+recordPath),record=JSON.parse(recordBytes),rows=new Map([...record.inputFiles,...record.helperBuild.inputFiles].map(p=>[p.relative,p]));
 const protocol={
  'apps/wallet-desktop/native/ynx_project_control.h':'/Volumes/西部数据/YNX-large-work/protocol/native-control-154a7b211-40059425999/darwin-arm64/ynx_project_control.h',
  'apps/wallet-desktop/native/ynx_artifact_release.h':'/Volumes/西部数据/YNX-large-work/protocol/native-tx-74457f76d/darwin-arm64/ynx_artifact_release.h',
  'apps/wallet-desktop/native/libynx_artifact_release.a':'/Volumes/西部数据/YNX-large-work/protocol/native-tx-74457f76d/darwin-arm64/libynx_artifact_release.a'
 };
 const put=(name,raw)=>{const file=path.join(temporary,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);};
 let auth=0,external=0,existing=0;
 for(const row of rows.values()){
  let raw;try{raw=git(original,'show',commit+':'+row.relative);existing++;}catch{
   if(protocol[row.relative]){raw=fs.readFileSync(protocol[row.relative]);external++;}else{raw=git(supplier,'show',supplierCommit+':'+row.relative);auth++;}
  }
  assert.equal(raw.length,row.bytes);assert.equal(hash(raw),row.sha256);put(row.relative,raw);
 }
 assert.equal(existing,113);assert.equal(auth,12);assert.equal(external,3);put(recordPath,recordBytes);
 const {verifySDK13NativeComponent}=await import(pathToFileURL(path.join(original,'apps/wallet-desktop/scripts/sdk13-native-component.mjs')));
 const component={record,inventoryBytes:git(original,'show',commit+':packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'),moduleBytes:fs.readFileSync(path.join(original,'apps/wallet-desktop/native/original-auth-identity.node')),helperBytes:fs.readFileSync(path.join(original,'apps/wallet-desktop/native/YNXIdentityReceiver'))};
 // Discover the existing strict reader's additional metadata reads, then bind
 // every one to original6fc Git before final verification. Disk is used only
 // for this controlled discovery, never the final Git-only reader callback.
 const required=new Set();verifySDK13NativeComponent(component,name=>{required.add(name);return fs.readFileSync(path.join(original,name));});
 for(const name of required)if(!rows.has(name))put(name,git(original,'show',commit+':'+name));
 git(temporary,'init','-q');git(temporary,'add','--all');
 const freeze=()=>{git(temporary,'-c','user.name=PUBLIC source fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC exact immutable source custody, no compiler');return git(temporary,'rev-parse','HEAD').toString().trim();};
 const frozen=freeze(),complete=assertNativeComponentGitSourceClosure(temporary,frozen,recordBytes);
 assert.equal(complete.complete,true);assert.equal(complete.unique,128);assert.deepEqual(complete.counts,{node:123,helper:105});assert.equal(complete.NativeCompiled,false);
 const finalReadback=verifySDK13NativeComponent(component,name=>git(temporary,'show',frozen+':'+name));
 assert.equal(finalReadback.sourceBytesVerified,true);assert.equal(finalReadback.artifactBytesVerified,true);assert.equal(finalReadback.installed,false);
 const source=record.inputFiles[0].relative;put(source,Buffer.from('PUBLIC changed source'));git(temporary,'add','--',source);const changed=freeze();
 assert.throws(()=>assertNativeComponentGitSourceClosure(temporary,changed,recordBytes),e=>e.closure.defects.length===1&&e.closure.defects[0].reason==='GIT_SOURCE_DIFFERS');
 const bad=structuredClone(record);bad.inputFiles[0].relative='../outside';const badBytes=Buffer.from(JSON.stringify(bad));put(recordPath,badBytes);git(temporary,'add','--',recordPath);const badCommit=freeze();
 assert.throws(()=>inspectNativeComponentGitSourceClosure(temporary,badCommit,badBytes),/NATIVE_COMPONENT_GIT_RECORD_INVALID/);
 assert.deepEqual(git(original,'show',commit+':'+recordPath),recordBytes);
});
