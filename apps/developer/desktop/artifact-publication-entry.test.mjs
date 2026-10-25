import test from 'node:test';import assert from 'node:assert/strict';import fs from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{pathToFileURL}from'node:url';import vm from'node:vm';import{createArtifactPublicationHost}from'./artifact-publication-host.mjs';
import {createProjectContractsHost} from './project-contracts-host.mjs';import{duplexPair}from'node:stream';import{createRequire}from'node:module';
const channel=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/project-contracts-channel.js');
async function fixture(t,extra={}){const workspace=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'ynx-publication-entry-')));t.after(()=>fs.rm(workspace,{recursive:true}));const artifact=join(workspace,'server.mjs');await fs.writeFile(artifact,"console.log('PUBLIC project build');\n");const state={owner:'PUBLIC-owner',workspaceOwner:'PUBLIC-owner',account:'PUBLIC-account',generation:1,identityReference:'PUBLIC-ref',localProjectId:'PUBLIC-project',workspace,launch:'PUBLIC-launch',sessionId:'PUBLIC-session',expiresAt:Date.now()+60000};const host=createArtifactPublicationHost({context:{workspace},localProjectSnapshot:{assertCurrent:async()=>({...state})},...extra});return{host,state,artifact,body:{artifactURI:pathToFileURL(artifact).href,version:'0.1.0',publishPurpose:'PUBLIC-purpose',targetEnvironment:'PUBLIC-env'}};}
test('normal publication preview reads actual project artifact and returns DATA without invoking a service',async t=>{let opened=0;const f=await fixture(t,{openObservation:async()=>{opened++;throw Error('must not enter');}});const result=await f.host.preview(f.body);assert.equal(result.binding.localProjectId,'PUBLIC-project');assert.equal(result.binding.byteSize,(await fs.stat(f.artifact)).size);assert.equal(result.signingApproved,false);assert.equal(result.deploymentApproved,false);assert.equal(opened,0);await f.host.close();});
test('missing original observation factory does not invent headers, sign, upload or substitute a service',async t=>{const f=await fixture(t);await assert.rejects(f.host.observe('11111111-2222-3333-4444-555555555555'),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});await f.host.close();await assert.rejects(f.host.preview(f.body),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});});
test('normal observation dispatch keeps original request ID and closes its one retained owner',async t=>{let calls=0,closed=0;const f=await fixture(t,{openObservation:async()=>({resume:async requestId=>{calls++;return{operation:{requestId,state:'unknown'},logs:null};},close:()=>{closed++;}})});const id='11111111-2222-3333-4444-555555555555';assert.equal((await f.host.observe(id)).operation.requestId,id);await f.host.close();await f.host.close();assert.equal(calls,1);assert.equal(closed,1);});
test('normal preview retains Native DATA custody before validation and closes replacements without invoking a key',async t=>{
 let captured=0,closed=0,current=0;
 const f=await fixture(t,{openNativeArtifact:async selected=>{captured++;assert.equal(selected.authority,'artifact-data-only');return{assertCurrent:async()=>{current++;},close:()=>{closed++;return true;},acquireProtectedKeyCall(){throw Error('Preview must not select a protected request');}};}});
 const first=await f.host.preview(f.body);assert.equal(captured,1);assert.equal(current,1);assert.equal(closed,0);assert.deepEqual(Object.keys(first).sort(),['binding','deploymentApproved','draftId','signingApproved']);
 await f.host.preview(f.body);assert.equal(captured,2);assert.equal(closed,1);await f.host.close();await f.host.close();assert.equal(closed,2);
});
test('project close joins a late Native capture and preserves a falsy cleanup failure without retry',async t=>{
 let resolve,entered,closes=0,observerCloses=0;const started=new Promise(r=>entered=r),pending=new Promise(r=>resolve=r);
 const f=await fixture(t,{openNativeArtifact:()=>{entered();return pending;},openObservation:async()=>({resume:async()=>({state:'pending'}),close:async()=>{observerCloses++;}})});
 await f.host.observe('11111111-2222-3333-4444-555555555555');
 const preview=f.host.preview(f.body);const rejected=assert.rejects(preview,{code:'IDE_PUBLICATION_NOT_SUPPLIED'});await started;
 const closing=f.host.close();const failed=assert.rejects(closing,cause=>cause===false);
 resolve({assertCurrent:async()=>{throw Error('Closed project must not validate');},close:()=>{closes++;throw false;}});
 await rejected;await failed;await assert.rejects(f.host.close(),cause=>cause===false);assert.equal(closes,1);assert.equal(observerCloses,1);
});
const source=await fs.readFile(new URL('../runtime/ynx-workbench/lib/artifact-publication-view.js',import.meta.url),'utf8');
class Node{constructor(document,tag){this.ownerDocument=document;this.tag=tag;this.children=[];this.listeners=new Map();}append(...items){this.children.push(...items);}setAttribute(){}addEventListener(event,fn){this.listeners.set(event,fn);}click(){if(!this.disabled)this.listeners.get('click')?.();}}
const document={createElement:tag=>new Node(document,tag)};class Widget{constructor(){this.node=new Node(document,'root');this.title={};this.toDispose=[];}dispose(){for(const d of this.toDispose)d.dispose();}}
const loaded={exports:{}};vm.runInNewContext(source,{module:loaded,require:name=>name==='@theia/core/lib/browser/widgets'?{BaseWidget:Widget}:{CommonMenus:{VIEW_VIEWS:[]}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('actual Widget uses the existing native picker, then explicit preview; opening alone sends nothing',async()=>{const calls=[];let picks=0;const widget=new loaded.exports.ArtifactPublicationWidget({call:async(action,body)=>{calls.push({action,body});return{binding:{contentDigest:'PUBLIC-data'},deploymentApproved:false};}},{ynxDesktopFiles:{open:async input=>{picks++;assert.equal(input.kind,'file');return{uris:['file:///PUBLIC/project/server.mjs']};}}},(_key,text)=>text);assert.equal(calls.length,0);assert.equal(picks,0);widget.buttons.choose.click();await tick();widget.fields.version.value='0.1.0';widget.fields.publishPurpose.value='PUBLIC-purpose';widget.fields.targetEnvironment.value='PUBLIC-env';assert.equal(calls.length,0);widget.buttons.review.click();await tick();assert.equal(calls[0].action,'publication-preview');assert.equal(calls[0].body.artifactURI,'file:///PUBLIC/project/server.mjs');assert.equal(calls[0].body.publishPurpose,'PUBLIC-purpose');assert.match(widget.output.textContent,/deploymentApproved/);widget.dispose();});
test('late native picker result is ignored after the project view is disposed',async()=>{let resolve;const pending=new Promise(r=>resolve=r),widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{throw Error('must not call');}},{ynxDesktopFiles:{open:()=>pending}},(_key,text)=>text);widget.buttons.choose.click();await tick();widget.dispose();resolve({uris:['file:///PUBLIC/late.mjs']});await tick();assert.equal(widget.fields.artifact.value,'');});
test('normal private pipe routes actual artifact preview while rejecting renderer-provided headers or scope',async t=>{const f=await fixture(t),host=createProjectContractsHost({context:{id:'PUBLIC-project'},assertPathCurrent:async()=>{},openPublication:async()=>f.host,openClient:async()=>{throw Error('Wallet network owner must not open');}});const[a,b]=duplexPair(),server=channel.serve(a,host),client=channel.client(b);try{const result=await client.call('publication-preview',f.body);assert.equal(result.binding.localProjectId,'PUBLIC-project');assert.equal(result.deploymentApproved,false);await assert.rejects(client.call('publication-preview',{...f.body,headers:{'PUBLIC':'not admitted'}}));await assert.rejects(client.call('publication-preview',{...f.body,projectId:'PUBLIC-other'}));}finally{client.close();server.close();await host.close();}});

const observationOne='22222222-2222-4222-8222-222222222222',observationTwo='33333333-3333-4333-8333-333333333333';
test('stop status query targets only its UI observation and releases the host for another query',async t=>{
 let started;const entered=new Promise(r=>started=r);let resumes=0;
 const f=await fixture(t,{openObservation:async()=>({resume:async(_id,{signal})=>{resumes++;if(resumes===1){started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return{queryOnly:true};},close(){}})});
 const reading=f.host.observe(observationOne,{observationId:observationOne});const refused=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await entered;
 assert.equal((await f.host.cancelObservation(observationTwo)).cancelled,false);
 assert.equal((await f.host.cancelObservation(observationOne)).cancelled,true);await refused;
 assert.equal((await f.host.observe(observationOne,{observationId:observationTwo})).queryOnly,true);assert.equal(resumes,2);await f.host.close();
});
test('normal private pipe can stop a pending publication query while preserving Wallet and original request ID',async t=>{
 let started;const entered=new Promise(r=>started=r),f=await fixture(t,{openObservation:async()=>({resume:async(requestId,{signal})=>{assert.equal(requestId,observationOne);started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},close(){}})});
 let walletOpens=0;const host=createProjectContractsHost({context:{id:'PUBLIC-project'},assertPathCurrent:async()=>{},openPublication:async()=>f.host,openClient:async()=>{walletOpens++;throw Error('must not acquire Wallet');}});
 const[a,b]=duplexPair(),server=channel.serve(a,host),client=channel.client(b);
 try{const reading=client.call('publication-observe',{requestId:observationOne,observationId:observationTwo});const refused=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await entered;
  assert.equal((await client.call('publication-observe-cancel',{observationId:observationTwo})).cancelled,true);await refused;assert.equal(walletOpens,0);
 }finally{client.close();server.close();await host.close();}
});
test('publication query cancellation uses a closed correlation-only DATA body',()=>{
 assert.equal(channel.valid('publication-observe-cancel',{observationId:observationOne}),true);
 for(const body of [{},{requestId:observationOne},{observationId:observationOne,headers:{}},{observationId:'wrong'}])assert.equal(channel.valid('publication-observe-cancel',body),false);
});
test('actual Widget stop query preserves the request ID and ignores a late successful result',async()=>{
 const calls=[];let finish;
 const widget=new loaded.exports.ArtifactPublicationWidget({call:async(action,body)=>{calls.push({action,body});if(action==='publication-observe')return new Promise(r=>finish=r);return{cancelled:true,queryOnly:true};}},{crypto:{randomUUID:()=>observationTwo}},(_key,text)=>text);
 widget.fields.requestId.value=observationOne;widget.buttons.observe.click();await tick();
 assert.equal(calls[0].action,'publication-observe');assert.equal(calls[0].body.requestId,observationOne);assert.equal(calls[0].body.observationId,observationTwo);assert.equal(Object.keys(calls[0].body).sort().join(), 'observationId,requestId');
 assert.equal(widget.buttons.cancel.disabled,false);widget.buttons.cancel.click();await tick();
 assert.equal(calls[1].action,'publication-observe-cancel');assert.equal(calls[1].body.observationId,observationTwo);assert.equal(Object.keys(calls[1].body).join(),'observationId');
 const cancelled=widget.status.textContent;assert.match(cancelled,/stopped|cancelled/i);assert.equal(widget.buttons.observe.disabled,false);
 finish({state:'PUBLIC-late-success'});await tick();assert.equal(widget.status.textContent,cancelled);assert.ok(!widget.output.textContent?.includes('PUBLIC-late-success'));assert.equal(widget.fields.requestId.value,observationOne);widget.dispose();
});
test('closing the publication view sends one stop for its own in-flight read without redeploying',async()=>{
 const calls=[];let finish;const widget=new loaded.exports.ArtifactPublicationWidget({call:async(action,body)=>{calls.push({action,body});if(action==='publication-observe')return new Promise(r=>finish=r);return{cancelled:true};}},{crypto:{randomUUID:()=>observationTwo}},(_key,text)=>text);
 widget.fields.requestId.value=observationOne;widget.buttons.observe.click();await tick();widget.dispose();await tick();
 assert.equal(calls.length,2);assert.equal(calls[1].action,'publication-observe-cancel');assert.equal(calls[1].body.observationId,observationTwo);finish({state:'PUBLIC-late'});await tick();
});

test('stopping while the original observer factory is pending cannot resume its late owner',async t=>{
 let entered,release,resumes=0,closes=0;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const f=await fixture(t,{openObservation:()=>{entered();return held;}});
 const reading=f.host.observe(observationOne,{observationId:observationTwo}),refused=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await started;
 assert.equal((await f.host.cancelObservation(observationTwo)).cancelled,true);await refused;
 release({resume:async()=>{resumes++;return{};},close(){closes++;}});await tick();assert.equal(resumes,0);
 await f.host.close();assert.equal(closes,1);
});
test('missing native WebCrypto never dispatches a query with an ambiguous cancellation identity',async()=>{
 let calls=0;const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{calls++;return{};}},{},(_key,text)=>text);
 widget.fields.requestId.value=observationOne;widget.buttons.observe.click();await tick();assert.equal(calls,0);assert.equal(widget.buttons.cancel.disabled,true);assert.equal(widget.buttons.observe.disabled,false);widget.dispose();
});

test('normal pipe stop during publication factory import cannot start a late SDK query',async()=>{
 let entered,release,resumes=0,closes=0;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const host=createProjectContractsHost({context:{id:'PUBLIC-project'},assertPathCurrent:async()=>{},openPublication:()=>{entered();return held;}}),[a,b]=duplexPair(),server=channel.serve(a,host),client=channel.client(b);
 try{
  const reading=client.call('publication-observe',{requestId:observationOne,observationId:observationTwo}),refused=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await started;
  const stopped=await client.call('publication-observe-cancel',{observationId:observationTwo});assert.equal(stopped.cancelled,true);
  await refused;release({observe:async()=>{resumes++;return{};},close(){closes++;}});await tick();assert.equal(resumes,0);
 }finally{release({observe:async()=>{resumes++;},close(){closes++;}});client.close();server.close();await host.close();}
 assert.equal(closes,1);
});
