import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createNormalNativeCompileReuseBinding} from '../scripts/normal-native-compile-reuse.mjs';
// PUBLIC record/readback fixtures only. Deliberately no source/runtime tuple:
// a valid prefix reaches ENOENT, never produces a binding or Native admission.
const phases=['COW_EXACT_SDK23_SOURCE','COW_EXACT_SDK23_RUNTIME','EXACT_ALL_INPUT_PRECHECK','NORMAL_EXPORTED_PLAN_ONLY','NORMAL_NODE13_BUILD','NORMAL_HELPER11_BUILD','NODE_MACHO','NODE_ARCH','NODE_OWN_UNDEFINED','NODE_LIBRARIES','HELPER_MACHO','HELPER_ARCH','HELPER_OWN_UNDEFINED','HELPER_LIBRARIES','ACTUAL_PASSIVE_NODE_NAPI_LOAD','ACTUAL_PASSIVE_ELECTRON_NAPI_LOAD','EXACT_ALL_INPUT_POSTCHECK'];
function fixture(run){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-actual-reuse-PUBLIC-')));
 const ref=p=>{const b=fs.readFileSync(p);return {path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
 const write=(name,value)=>{const p=path.join(root,name);fs.writeFileSync(p,JSON.stringify(value));return ref(p);};
 const record={schema:'YNX_SDK23_R196_ORIGINAL_A_EXECUTED_NATIVE_RECORD_V1',SDKVersion:'1.3.0-pq.3.32-auth.23',sourceCommit:'PUBLIC',NAPI_VERSION:8,headerVersion:'22.13.1',executed:true,actualSteps:phases.map((phase,i)=>({phase,pid:i+100,argv:['/PUBLIC/tool',phase],cwd:root,start:100+i,end:100.5+i,actualExit:0,guard:null}))};
 for(const k of ['NativeQualified','helperExecuted','helperRegistered','installed','GUI','SourceGranted','projectFactoryCalled','getterCalled','accountKeysTouched'])record[k]=false;
 const result={noInflight:true,terms:record.actualSteps,owned:record.actualSteps.map(x=>({pid:x.pid,start:'a'.repeat(32),present:false}))};
 const full={sourceCommit:'PUBLIC',SDKVersion:record.SDKVersion,schema:'SDK23_ORIGINAL_A_BASE_NATIVE_COMPLETE_MATCHING_HANDOFF_V1',noInflight:true,allPhases:record.actualSteps.map(({phase,pid,actualExit,guard})=>({phase,pid,actualExit,guard})),directReferences:[]};
 const final={sourceCommit:'PUBLIC',SDKVersion:record.SDKVersion,schema:'SDK23_CONTENT_EXECUTION_COMPLETE_WITH_MATERIALIZATION_LIMITATION_V1',noInflight:true,strictCOWQualified:false,copyPhysicalFallbackUnknown:true,allPhases:full.allPhases};
 const limitation={schema:'SDK23_MATERIALIZATION_EVIDENCE_LIMITATION_V1',copyPrimitive:{primitiveGuaranteesNoFallback:false,actualCloneUsed:'UNKNOWN',physicalCopyFallbackOccurred:'UNKNOWN'},qualification:{materializationStrictCOWQualification:false}};
 record.sourceRoot=root;
 const rows=Array.from({length:92},(_,i)=>({path:'PUBLIC/input-'+i+'.mjs',bytes:1,sha256:'a'.repeat(64)}));
 const normal={NativeInputs:rows.slice(0,82),HelperInputs:rows.slice(82,87),pureDeploymentInputs:rows.slice(87,91),normalBuildTool:rows[91]};
 const captured=row=>({relative:row.path,path:path.join(root,row.path),bytes:row.bytes,sha256:row.sha256});
 record.inputFiles=normal.NativeInputs.map(captured);record.helperAdditionalInputs=normal.HelperInputs.map(captured);
 record.builder={path:path.join(root,rows[91].path),bytes:rows[91].bytes,sha256:rows[91].sha256};
 record.otherExactInputs=[...normal.pureDeploymentInputs.map(captured),{...record.builder}];
 const evidence={},request={sourceTuplePath:path.join(root,'absent-source-tuple.json'),targetTuplePath:path.join(root,'absent-target-tuple.json')};
 function update(){
  full.directReferences=[];
  for(const step of record.actualSteps){const {end,actualExit,guard,...req}=step;full.directReferences.push(write(step.phase+'.request.json',req),write(step.phase+'.terminal.json',step));}
  record.guard={result:write('BUILD_RESULT.json',result)};full.directReferences.push(record.guard.result);
  record.normalManifest=write('NORMAL_NATIVE_INPUTS.json',normal);
  evidence.actualChildToolArgv=write('ACTUAL_CHILD_TOOL_ARGV.json',[]);full.directReferences.push(evidence.actualChildToolArgv);
  request.executedRecord=write('executed.json',record);evidence.originalExecutedRecord=request.executedRecord;
  full.actualExecutedRecord=request.executedRecord;final.executedRecord=request.executedRecord;limitation.executedRecord=request.executedRecord;
  evidence.originalFullH=write('full.json',full);final.originalFullH=evidence.originalFullH;limitation.originalH=evidence.originalFullH;
  evidence.mandatoryLimitation=write('limitation.json',limitation);final.mandatoryLimitation=evidence.mandatoryLimitation;
  evidence.finalH=write('final.json',final);request.executionEvidence=write('execution-evidence.json',evidence);
 }
 try{update();return run({record,result,full,final,limitation,request,update,call:()=>createNormalNativeCompileReuseBinding(request)});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('PUBLIC actual schema accepts helper business-not-executed boundary then demands real source tuple',()=>fixture(({call})=>assert.throws(call,{code:'ENOENT'})));
test('unknown schema and forged execution/business qualification refuse before tuple access',()=>{
 for(const key of ['schema','executed','helperExecuted','NativeQualified'])fixture(({record,update,call})=>{record[key]=key==='schema'?'UNKNOWN':key==='executed'?false:true;update();assert.throws(call,{code:key==='schema'||key==='executed'?'NATIVE_REUSE_RECORD':'NATIVE_REUSE_ACTUAL_BOUNDARY'});});
});
test('all seventeen actual steps require terminal zero and preserved owned-process emptiness',()=>{
 fixture(({record,update,call})=>{record.actualSteps[5].actualExit=1;update();assert.throws(call,{code:'NATIVE_REUSE_ACTUAL_STEPS'});});
 fixture(({record,update,call})=>{record.actualSteps[5].start=record.actualSteps[4].start;update();assert.throws(call,{code:'NATIVE_REUSE_ACTUAL_STEPS'});});
 fixture(({record,result,update,call})=>{record.actualSteps.pop();result.terms=record.actualSteps;update();assert.throws(call,{code:'NATIVE_REUSE_ACTUAL_STEPS'});});
 fixture(({result,update,call})=>{result.owned[0].present=true;update();assert.throws(call,{code:'NATIVE_REUSE_OWNED'});});
 fixture(({result,update,call})=>{result.owned[0].start='date-like-token';update();assert.throws(call,{code:'NATIVE_REUSE_OWNED'});});
});
test('strict COW limitation cannot be erased or upgraded by a derived evidence map',()=>{
 fixture(({final,update,call})=>{final.strictCOWQualified=true;update();assert.throws(call,{code:'NATIVE_REUSE_MATERIALIZATION'});});
 fixture(({limitation,update,call})=>{limitation.copyPrimitive.physicalCopyFallbackOccurred=false;update();assert.throws(call,{code:'NATIVE_REUSE_MATERIALIZATION'});});
});
test('only the actual final builder ref may omit relative; earlier ninety-one rows remain exact',()=>{
 fixture(({call})=>assert.throws(call,{code:'ENOENT'}));
 fixture(({record,update,call})=>{delete record.otherExactInputs[0].relative;update();assert.throws(call,{code:'NATIVE_REUSE_RECORD_INPUT'});});
 fixture(({record,update,call})=>{record.otherExactInputs[4].sha256='b'.repeat(64);update();assert.throws(call,{code:'NATIVE_REUSE_RECORD_INPUT'});});
 fixture(({record,update,call})=>{record.builder.path=path.join(record.sourceRoot,'PUBLIC/wrong-tool.mjs');record.otherExactInputs[4]={...record.builder};update();assert.throws(call,{code:'NATIVE_REUSE_RECORD_INPUT'});});
 fixture(({record,update,call})=>{record.inputFiles[0].path=record.inputFiles[1].path;update();assert.throws(call,{code:'NATIVE_REUSE_RECORD_INPUT'});});
});
