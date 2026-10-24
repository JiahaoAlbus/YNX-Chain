import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {capturePublicationArtifact} from './artifact-publication-client.mjs';
import * as publicationClient from './artifact-publication-client.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
const program="import {createServer} from 'node:http';\ncreateServer((req,res)=>res.end('YNX project\\n')).listen(Number(process.env.PORT),'0.0.0.0');\n";
async function fixture(t){
 const workspace=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'ynx-publication-file-')));t.after(()=>fs.rm(workspace,{recursive:true}));const artifactPath=join(workspace,'server.mjs');await fs.writeFile(artifactPath,program);
 const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-ref',localProjectId:'PUBLIC-canonical-project',workspace,launch:'PUBLIC-launch',sessionId:'PUBLIC-session',expiresAt:Date.now()+60000};
 const options={context:{workspace},localProjectSnapshot:{assertCurrent:async()=>({...state})},artifactPath,version:'0.1.0',publishPurpose:'PUBLIC-purpose-data',targetEnvironment:'PUBLIC-environment-data'};
 return {workspace,artifactPath,state,options};
}
// Controlled canonical manifest DATA for byte/custody tests only. The fixed
// value is not derived from a local UUID and is never a project authorization.
function canonicalDATAFixture(local){
 const {localProjectId,...data}=local.binding;const binding=Object.freeze({...data,projectId:'PUBLIC-original-project-DATA'});
 return {binding,assertCurrent:()=>local.assertCurrent(),artifactBytes:()=>local.artifactBytes(),async encodeManifest(encoder){await local.assertCurrent();return encoder(binding);}};
}
test('local project UUID is not a canonical publication ID and cannot create a signing manifest',async t=>{
 const f=await fixture(t),selected=await capturePublicationArtifact(f.options);let encoded=0;
 assert.equal(Object.hasOwn(selected.binding,'projectId'),false);assert.equal(selected.binding.localProjectId,f.state.localProjectId);
 await assert.rejects(selected.encodeManifest(()=>{encoded++;return '{}';}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(encoded,0);
});
test('publication key selection is unavailable without the original project supplier even for valid DATA',async()=>{
 let constructed=0,manifest;const binding={projectId:'PUBLIC-canonical-DATA-only'};
 const selection={binding,assertCurrent:async()=>binding,artifactBytes:()=>new Uint8Array(32),encodeManifest:async encoder=>encoder(binding)};
 const api={encodeIDEArtifactManifestData:input=>Buffer.from(JSON.stringify(input)),captureOriginalIDEPublicationArtifact(raw){manifest=raw;return {};},readOriginalIDEPublicationArtifactManifest:()=>manifest,closeOriginalIDEPublicationArtifact:()=>true,acquireOriginalIDEProtectedPublicationKeyCall(){constructed++;return {};}};
 const owner=await publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 await assert.rejects(owner.acquireProtectedKeyCall(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(constructed,0);owner.close();
});
test('real Node project bytes retain only local project DATA, size and digest without granting approval',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);assert.equal(draft.binding.localProjectId,f.state.localProjectId);assert.equal(draft.binding.byteSize,Buffer.byteLength(program));assert.equal(draft.binding.contentDigest,createHash('sha256').update(program).digest('hex'));assert.equal(draft.authority,'artifact-data-only');assert.equal(draft.signingApproved,false);assert.equal(draft.deploymentApproved,false);
 const copy=draft.artifactBytes();copy.fill(0);assert.equal(Buffer.from(draft.artifactBytes()).toString(),program);await draft.assertCurrent();
 await assert.rejects(draft.encodeManifest(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 // This fixture exercises DATA byte matching, not the original Auth codec or a signature.
 let encodes=0;await assert.rejects(draft.encodeManifest(()=>{encodes++;return '{}';}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(encodes,0);
});
test('Native DATA custody does not turn an unspecified project into a protected request',async t=>{
 const f=await fixture(t),selection=canonicalDATAFixture(await capturePublicationArtifact(f.options)),ref={},calls=[];
 let manifest,automatic=0;
 const partial={descriptor:-1,assertCurrent(){automatic++;},invoke(){automatic++;},close(){automatic++;}};
 const api={encodeIDEArtifactManifestData:input=>Buffer.from(JSON.stringify(input)),
  captureOriginalIDEPublicationArtifact(raw,bytes){manifest=raw;assert.equal(Buffer.from(bytes).toString(),program);calls.push('capture');return ref;},
  readOriginalIDEPublicationArtifactManifest(value){assert.equal(value,ref);calls.push('read');return manifest;},
  closeOriginalIDEPublicationArtifact(value){assert.equal(value,ref);calls.push('close');return true;},
  acquireOriginalIDEProtectedPublicationKeyCall(entry,raw,value){assert.equal(entry,'file:///PUBLIC/server.mjs');assert.equal(raw,manifest);assert.equal(value,ref);calls.push('construct');return partial;}};
 assert.equal(typeof publicationClient.captureOriginalPublicationArtifact,'function');
 const owner=await publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 assert.deepEqual(calls,['capture']);await owner.assertCurrent();
 for(let i=0;i<2;i++)await assert.rejects(owner.acquireProtectedKeyCall(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 assert.equal(calls.filter(v=>v==='construct').length,0);assert.equal(automatic,0);
 assert.equal(owner.close(),true);assert.equal(owner.close(),true);assert.equal(calls.filter(v=>v==='close').length,1);assert.equal(automatic,0);
});
test('Native DATA validation and falsy cleanup failures retain exact causes without recapture or close retry',async t=>{
 const f=await fixture(t),selection=canonicalDATAFixture(await capturePublicationArtifact(f.options)),ref={};let captures=0,closes=0;
 const api={encodeIDEArtifactManifestData:input=>Buffer.from(JSON.stringify(input)),captureOriginalIDEPublicationArtifact(){captures++;return ref;},readOriginalIDEPublicationArtifactManifest(){return 'wrong original manifest';},closeOriginalIDEPublicationArtifact(){closes++;throw false;},acquireOriginalIDEProtectedPublicationKeyCall(){throw Error('must not construct');}};
 const owner=await publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 await assert.rejects(owner.assertCurrent(),{code:'IDE_ARTIFACT_ORIGINAL_CAPTURE_INVALID'});
 await assert.rejects(owner.acquireProtectedKeyCall(),{code:'IDE_ARTIFACT_ORIGINAL_CAPTURE_INVALID'});
 for(let i=0;i<2;i++){let entered=false;try{owner.close();}catch(cause){entered=true;assert.equal(cause,false);}assert.equal(entered,true);}
 assert.equal(captures,1);assert.equal(closes,1);assert.equal(owner.status().cleanupComplete,false);
});
test('falsy original capture failure is sticky and cannot construct or recapture',async t=>{
 const f=await fixture(t),selection=canonicalDATAFixture(await capturePublicationArtifact(f.options));let captures=0;
 const api={encodeIDEArtifactManifestData:input=>Buffer.from(JSON.stringify(input)),captureOriginalIDEPublicationArtifact(){captures++;throw undefined;},readOriginalIDEPublicationArtifactManifest(){throw Error('must not read');},closeOriginalIDEPublicationArtifact(){throw Error('no reference exists');},acquireOriginalIDEProtectedPublicationKeyCall(){throw Error('must not construct');}};
 const owner=await publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 for(const select of [()=>owner.assertCurrent(),()=>owner.acquireProtectedKeyCall()]){let caught=false;try{await select();}catch(cause){caught=true;assert.equal(cause,undefined);}assert.equal(caught,true);}
 assert.equal(captures,1);assert.equal(owner.status().firstCausePresent,true);assert.equal(owner.close(),true);
});
test('an older SDK missing any required publication callee stays unavailable before DATA capture',async t=>{
 const f=await fixture(t),selection=canonicalDATAFixture(await capturePublicationArtifact(f.options));let captured=0;
 const api={encodeIDEArtifactManifestData:()=>{captured++;},captureOriginalIDEPublicationArtifact:()=>{captured++;},readOriginalIDEPublicationArtifactManifest(){},closeOriginalIDEPublicationArtifact(){}};
 await assert.rejects(publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api}),{code:'IDE_ARTIFACT_ORIGINAL_CAPTURE_UNAVAILABLE'});assert.equal(captured,0);
});
test('artifact edits before protected construction require a new review and never select the original request',async t=>{
 const f=await fixture(t),selection=canonicalDATAFixture(await capturePublicationArtifact(f.options));let manifest,constructs=0,closes=0;
 const api={encodeIDEArtifactManifestData:input=>Buffer.from(JSON.stringify(input)),captureOriginalIDEPublicationArtifact(raw){manifest=raw;return {};},readOriginalIDEPublicationArtifactManifest(){return manifest;},closeOriginalIDEPublicationArtifact(){closes++;return true;},acquireOriginalIDEProtectedPublicationKeyCall(){constructs++;return null;}};
 const owner=await publicationClient.captureOriginalPublicationArtifact({selection,actualEntryURL:'file:///PUBLIC/server.mjs',api});
 await fs.writeFile(f.artifactPath,program.replace('YNX project','NEW project'));
 await assert.rejects(owner.assertCurrent(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});await assert.rejects(owner.acquireProtectedKeyCall(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});assert.equal(constructs,0);assert.equal(owner.close(),true);assert.equal(closes,1);
});
test('same-size source change requires a fresh approval and preserves selected user bytes',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);const changed=program.replace('YNX project','NEW project');assert.equal(changed.length,program.length);await fs.writeFile(f.artifactPath,changed);await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});await assert.rejects(draft.encodeManifest(JSON.stringify),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});assert.equal(await fs.readFile(f.artifactPath,'utf8'),changed);
});
test('replacement inode, symlink and hardlink do not inherit a prior file review',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);await fs.rename(f.artifactPath,join(f.workspace,'retained.mjs'));await fs.writeFile(f.artifactPath,program);await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'});await fs.unlink(f.artifactPath);await fs.symlink(join(f.workspace,'retained.mjs'),f.artifactPath);await assert.rejects(capturePublicationArtifact(f.options));await fs.unlink(f.artifactPath);await fs.link(join(f.workspace,'retained.mjs'),f.artifactPath);await assert.rejects(capturePublicationArtifact(f.options),{code:'IDE_ARTIFACT_FILE_INVALID'});
});
test('project generation change and outside-project selection never produce a manifest',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);f.state.generation++;await assert.rejects(draft.assertCurrent(),{code:'IDE_ARTIFACT_PROJECT_RETIRED'});await assert.rejects(capturePublicationArtifact({...f.options,artifactPath:join(f.workspace,'..','outside.mjs')}),{code:'IDE_ARTIFACT_OUTSIDE_PROJECT'});
});
test('noncanonical workspace is rejected before walking parents',async t=>{
 const f=await fixture(t);await assert.rejects(capturePublicationArtifact({...f.options,context:{workspace:f.workspace+'/'}}),{code:'IDE_ARTIFACT_SELECTION_INVALID'});
});
test('manifest codec cannot substitute project, digest, purpose or extra trusted-key fields',async t=>{
 const f=await fixture(t),draft=await capturePublicationArtifact(f.options);for(const change of [{projectId:'PUBLIC-other'},{contentDigest:'0'.repeat(64)},{publishPurpose:'PUBLIC-other'},{trustedKey:'PUBLIC-not-trust'}])await assert.rejects(draft.encodeManifest(binding=>JSON.stringify({...binding,...change})),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
});
test('a real FIFO selected as an artifact cannot block normal project publication review',async t=>{
 const f=await fixture(t);await fs.unlink(f.artifactPath);execFileSync('/usr/bin/mkfifo',['-m','600',f.artifactPath]);
 const data={context:f.options.context,artifactPath:f.artifactPath,version:f.options.version,publishPurpose:f.options.publishPurpose,targetEnvironment:f.options.targetEnvironment};
 const program=`import {capturePublicationArtifact} from ${JSON.stringify(new URL('./artifact-publication-client.mjs',import.meta.url).href)};const input=JSON.parse(process.argv[1]),state=JSON.parse(process.argv[2]);try{await capturePublicationArtifact({...input,localProjectSnapshot:{assertCurrent:async()=>state}});process.exitCode=2;}catch(e){if(e.code!=='IDE_ARTIFACT_FILE_INVALID')throw e;console.log('FIFO_REFUSED');}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program,JSON.stringify(data),JSON.stringify(f.state)],{encoding:'utf8',timeout:1500});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/FIFO_REFUSED/);assert.equal((await fs.lstat(f.artifactPath)).isFIFO(),true);
});
