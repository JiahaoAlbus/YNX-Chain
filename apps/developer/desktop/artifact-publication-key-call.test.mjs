import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOriginalPublicationArtifact} from './artifact-publication-client.mjs';
import {bindOriginalPublicationProject} from './original-publication-project.mjs';
async function fixture(options={}){
 const calls=[],ref={},partial={retire(){calls.push('retire');if(options.retireError)throw options.retireError;},join(){calls.push('join');},close(){calls.push('key-close');},assertReady(){calls.push('ready');},invoke(){calls.push('invoke');}};
 let current=async()=>({projectId:'PUBLIC-original-project'}),manifest;
 const local={binding:{localProjectId:'PUBLIC-local',version:'1.0',contentDigest:'a'.repeat(64),publishPurpose:'PUBLIC-purpose',targetEnvironment:'PUBLIC-test',byteSize:3},assertCurrent:async()=>{},artifactBytes:()=>Uint8Array.of(1,2,3)};
 const selection=await bindOriginalPublicationProject({selection:local,project:{assertCurrent:()=>current()}});
 const api={encodeIDEArtifactManifestData:v=>Buffer.from(JSON.stringify(v)),captureOriginalIDEPublicationArtifact(raw){manifest=raw;return ref;},readOriginalIDEPublicationArtifactManifest:r=>{assert.equal(r,ref);return manifest;},closeOriginalIDEPublicationArtifact:r=>{assert.equal(r,ref);calls.push('artifact-close');return true;},acquireOriginalIDEProtectedPublicationKeyCall(entry,raw,r){calls.push('construct');assert.equal(entry,'file:///PUBLIC/server.mjs');assert.equal(raw,manifest);assert.equal(r,ref);return options.construct?options.construct(partial):partial;}};
 const owner=await captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 return {owner,partial,calls,setCurrent(fn){current=fn;}};
}
test('explicit composed project request retains the SAME partial without readiness, invoke or signing',async()=>{
 const f=await fixture();assert.deepEqual(f.calls,[]);
 assert.equal(await f.owner.acquireProtectedKeyCall(),f.partial);assert.deepEqual(f.calls,['construct']);
 assert.equal(f.owner.status().keyCallSelected,true);assert.equal(f.owner.signingApproved,false);
 await assert.rejects(f.owner.acquireProtectedKeyCall(),{code:'IDE_ARTIFACT_KEY_CALL_ALREADY_SELECTED'});
 assert.equal(f.owner.close(),true);assert.equal(f.owner.close(),true);
 assert.deepEqual(f.calls,['construct','retire','join','key-close','artifact-close']);
});
test('current failure prevents constructor and retains exact first cause',async()=>{
 const f=await fixture(),cause=Error('PUBLIC revoked');f.setCurrent(async()=>{throw cause;});
 await assert.rejects(f.owner.acquireProtectedKeyCall(),error=>error===cause);await assert.rejects(f.owner.acquireProtectedKeyCall(),error=>error===cause);
 assert.deepEqual(f.calls,[]);assert.equal(f.owner.close(),true);
});
test('close during current await cancels the request before constructing',async()=>{
 const f=await fixture();let release;f.setCurrent(()=>new Promise(resolve=>{release=()=>resolve({projectId:'PUBLIC-original-project'});}));
 const task=f.owner.acquireProtectedKeyCall();for(let i=0;!release&&i<20;i++)await Promise.resolve();if(!release){await task;assert.fail("current was not entered");}assert.equal(f.owner.close(),true);release();
 await assert.rejects(task,{code:'IDE_ARTIFACT_ORIGINAL_CAPTURE_RETIRED'});assert.deepEqual(f.calls,['artifact-close']);
});
test('concurrent selection cannot call the constructor twice',async()=>{
 const f=await fixture();let release;f.setCurrent(()=>release?Promise.resolve({projectId:'PUBLIC-original-project'}):new Promise(resolve=>{release=()=>resolve({projectId:'PUBLIC-original-project'});}));
 const first=f.owner.acquireProtectedKeyCall();for(let i=0;!release&&i<20;i++)await Promise.resolve();if(!release){await first;assert.fail("current was not entered");}
 await assert.rejects(f.owner.acquireProtectedKeyCall(),{code:'IDE_ARTIFACT_KEY_CALL_ALREADY_SELECTED'});release();assert.equal(await first,f.partial);f.owner.close();
 assert.equal(f.calls.filter(x=>x==='construct').length,1);
});
test('constructor falsy failure stays selected and is never retried',async()=>{
 const f=await fixture({construct(){throw undefined;}});
 for(let i=0;i<2;i++){let caught=false;try{await f.owner.acquireProtectedKeyCall();}catch(e){caught=true;assert.equal(e,undefined);}assert.equal(caught,true);}
 assert.equal(f.calls.filter(x=>x==='construct').length,1);assert.equal(f.owner.status().firstCausePresent,true);f.owner.close();
});
test('constructor reentrant close retains the returned partial for later cleanup',async()=>{
 let owner,closeError;const f=await fixture({construct(partial){try{owner.close();}catch(e){closeError=e;}return partial;}});owner=f.owner;
 await assert.rejects(owner.acquireProtectedKeyCall(),{code:'IDE_ARTIFACT_ORIGINAL_CAPTURE_RETIRED'});
 assert.equal(closeError?.code,'IDE_ARTIFACT_KEY_CALL_CLEANUP_PENDING');assert.deepEqual(f.calls,['construct']);
 assert.equal(owner.close(),true);assert.deepEqual(f.calls,['construct','retire','join','key-close','artifact-close']);
});
test('unknown Native retirement stops artifact disposal and never repeats cleanup',async()=>{
 const cause=Error('PUBLIC retirement UNKNOWN'),f=await fixture({retireError:cause});await f.owner.acquireProtectedKeyCall();
 for(let i=0;i<2;i++)assert.throws(()=>f.owner.close(),error=>error===cause);
 assert.deepEqual(f.calls,['construct','retire']);assert.equal(f.owner.status().cleanupComplete,false);
});
