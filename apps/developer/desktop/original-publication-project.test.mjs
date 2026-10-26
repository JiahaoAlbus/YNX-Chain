import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOriginalPublicationProject,bindOriginalPublicationProject} from './original-publication-project.mjs';
import * as projectConsumer from './original-publication-project.mjs';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createArtifactPublicationHost} from './artifact-publication-host.mjs';
// Controlled public contract DATA, never live Source or signing permission.
function fixture(){
 let time=1000;const expiresMS=2000,ref={},calls=[];
 const principal={account:'PUBLIC-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'2',expiresMS};
 const project={projectId:'PUBLIC-original-project',ownerAccount:'PUBLIC-owner',runtimeOrigin:'PUBLIC-runtime',currentReference:'PUBLIC-project-current',projectRevision:'3',catalogRevision:'4',read:true,publish:true,runtime:true,expiresMS};
 const publisher={account:'PUBLIC-account',projectId:project.projectId,publisherId:'PUBLIC-publisher',keyRole:'ide-artifact-publisher',publicOriginal:'PUBLIC-original',publicSHA256:'PUBLIC-digest',registrationRef:'PUBLIC-registration',revision:'5',expiresMS,revoked:false};
 const api={acquireOriginalIDEProjectAuthority(){calls.push('acquire');return ref;},readOriginalIDECurrentProject(owner,id){assert.equal(owner,ref);assert.equal(id,project.projectId);calls.push('project');return structuredClone({principal,project,expiresMS});},readOriginalIDECurrentPublisher(owner,id,publisherID){assert.equal(owner,ref);assert.equal(id,project.projectId);assert.equal(publisherID,publisher.publisherId);calls.push('publisher');return structuredClone({principal,project,publisher,publisherOriginal:new Uint8Array([1,2,3]),expiresMS});},closeOriginalIDEProjectAuthority(owner){assert.equal(owner,ref);calls.push('close');}};
 const options={projectID:project.projectId,publisherID:publisher.publisherId,assertLocalCurrent:async()=>{calls.push('local');},api,now:()=>time};
 return {api,options,calls,principal,project,publisher,setTime:value=>{time=value;}};
}
async function exactReject(action,expected){let threw=false;try{await action();}catch(cause){threw=true;assert.equal(cause,expected);}assert.equal(threw,true);}
test('retain original partial before reads; exact argument order and undefined cleanup',async()=>{
 const f=fixture(),owner=captureOriginalPublicationProject(f.options);assert.deepEqual(f.calls,['acquire']);
 assert.deepEqual(await owner.assertCurrent(),{projectId:f.project.projectId,publisherId:f.publisher.publisherId,expiresMS:2000});
 assert.equal(owner.authority,'original-project-data-only');assert.equal(owner.signingApproved,false);
 assert.equal(owner.close(),undefined);assert.equal(owner.close(),undefined);assert.equal(f.calls.filter(x=>x==='close').length,1);
 await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
});
test('actual missing Source cause is retained instead of null or connected',async()=>{
 const f=fixture(),cause=Object.assign(Error('Original Source not supplied'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});
 f.api.acquireOriginalIDEProjectAuthority=()=>{throw cause;};const owner=captureOriginalPublicationProject(f.options);
 await exactReject(()=>owner.assertCurrent(),cause);owner.close();assert.deepEqual(f.calls,[]);
});
test('publish permission does not require runtime or read permission; full R13 public bytes fit',async()=>{
 const f=fixture();f.project.runtime=false;f.project.read=false;f.project.runtimeOrigin='';
 // Actual R171 R13 contains ML-DSA-87's 2592-byte public key plus SLH data
 // and framing. Its base64 field exceeds the short identifier bound.
 f.publisher.publicOriginal=Buffer.alloc(3000,0x51).toString('base64url');
 const owner=captureOriginalPublicationProject(f.options);assert.equal((await owner.assertCurrent()).projectId,f.project.projectId);owner.close();
});
for(const cause of [false,undefined,null])test(`falsy read failure ${String(cause)} stays sticky; partial closes once`,async()=>{
 const f=fixture();f.api.readOriginalIDECurrentProject=()=>{throw cause;};const owner=captureOriginalPublicationProject(f.options);
 await exactReject(()=>owner.assertCurrent(),cause);await exactReject(()=>owner.assertCurrent(),cause);owner.close();assert.equal(f.calls.filter(x=>x==='close').length,1);
});
test('falsy close failure is not retried or reported successful',async()=>{
 const f=fixture();let closes=0;f.api.closeOriginalIDEProjectAuthority=()=>{closes++;throw false;};const owner=captureOriginalPublicationProject(f.options);
 await exactReject(()=>owner.close(),false);await exactReject(()=>owner.close(),false);assert.equal(closes,1);
});
test('cleanup true is refused; SDK18 success is undefined',()=>{
 const f=fixture();f.api.closeOriginalIDEProjectAuthority=()=>true;const owner=captureOriginalPublicationProject(f.options);assert.throws(()=>owner.close(),{code:'IDE_PUBLICATION_PROJECT_UNAVAILABLE'});
});
for(const change of ['session','project','publisher','revoked','permission','expiry'])test(`original ${change} change retires review without reacquire`,async()=>{
 const f=fixture(),owner=captureOriginalPublicationProject(f.options);await owner.assertCurrent();
 if(change==='session')f.principal.sessionGeneration='3';if(change==='project')f.project.projectRevision='6';if(change==='publisher')f.publisher.registrationRef='PUBLIC-replacement';if(change==='revoked')f.publisher.revoked=true;if(change==='permission')f.project.publish=false;if(change==='expiry')f.setTime(2000);
 await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});assert.equal(f.calls.filter(x=>x==='acquire').length,1);owner.close();
});
test('close during local check prevents late Native reads',async()=>{
 const f=fixture();let release;f.options.assertLocalCurrent=()=>new Promise(resolve=>{release=resolve;});const owner=captureOriginalPublicationProject(f.options),pending=owner.assertCurrent();owner.close();release();await assert.rejects(pending,{code:'IDE_PUBLICATION_PROJECT_RETIRED'});assert.deepEqual(f.calls,['acquire','close']);
});
test('expiry during final local check refuses first review',async()=>{
 const f=fixture();let checks=0;f.options.assertLocalCurrent=async()=>{if(++checks===2)f.setTime(2000);};const owner=captureOriginalPublicationProject(f.options);await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();
});
test('manifest takes original returned ID, excludes local UUID and checks both owners',async()=>{
 const f=fixture(),project=captureOriginalPublicationProject(f.options);let checks=0;const local={binding:{localProjectId:'PUBLIC-local-uuid',version:'0.1.0',contentDigest:'PUBLIC-digest',publishPurpose:'preview',targetEnvironment:'testnet',byteSize:3},assertCurrent:async()=>{checks++;},artifactBytes:()=>new Uint8Array([1,2,3])};
 const selection=await bindOriginalPublicationProject({selection:local,project});assert.equal(selection.binding.projectId,f.project.projectId);assert.equal(Object.hasOwn(selection.binding,'localProjectId'),false);assert.equal(JSON.parse(await selection.encodeManifest(data=>JSON.stringify(data))).projectId,f.project.projectId);assert.ok(checks>=3);
 f.publisher.revoked=true;let encodes=0;await assert.rejects(selection.encodeManifest(()=>{encodes++;}),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});assert.equal(encodes,0);project.close();
});
async function hostFixture(t,extra={}){
 const workspace=await fs.mkdtemp('/Volumes/西部数据/YNX-large-work/ide-wallet-contract-consumer-20261024/sdk18-project-reader/project-');t.after(()=>fs.rm(workspace,{recursive:true}));
 const artifact=join(workspace,'server.mjs');await fs.writeFile(artifact,"console.log('PUBLIC build');\n");
 const state={generation:1,localProjectId:'PUBLIC-local-uuid',workspace,launch:'PUBLIC-launch',expiresAt:Date.now()+60000};
 const context={workspace};const host=createArtifactPublicationHost({context,localProjectSnapshot:{assertCurrent:async()=>({...state})},...extra});
 return{host,context,body:{artifactURI:pathToFileURL(artifact).href,version:'0.1.0',publishPurpose:'preview',targetEnvironment:'testnet'}};
}
test('normal host composes real file DATA and original project consumer before Native artifact custody',async t=>{
 const f=fixture();let manifests=0;const p=captureOriginalPublicationProject(f.options);
 const h=await hostFixture(t,{openOriginalProject:async context=>{assert.ok(context.workspace);return p;},openNativeArtifact:async selection=>{
  assert.equal(selection.binding.projectId,f.project.projectId);assert.equal(Object.hasOwn(selection.binding,'localProjectId'),false);
  await selection.encodeManifest(binding=>{manifests++;return JSON.stringify(binding);});
  return{assertCurrent:()=>selection.assertCurrent(),close:()=>true};}});
 const result=await h.host.preview(h.body);assert.equal(result.binding.projectId,f.project.projectId);assert.equal(result.deploymentApproved,false);assert.equal(manifests,1);
 await h.host.close();assert.equal(f.calls.filter(x=>x==='close').length,1);
});
test('normal host keeps exact unavailable Source and retains cleanup without entering artifact factory',async t=>{
 const f=fixture(),cause=Object.assign(Error('Source unavailable'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});let artifacts=0;
 f.api.readOriginalIDECurrentProject=()=>{throw cause;};const p=captureOriginalPublicationProject(f.options);
 const h=await hostFixture(t,{openOriginalProject:async()=>p,openNativeArtifact:async()=>{artifacts++;}});
 await exactReject(()=>h.host.preview(h.body),cause);assert.equal(artifacts,0);await h.host.close();assert.equal(f.calls.filter(x=>x==='close').length,1);
});
test('normal host joins late original acquisition on close and never selects artifact',async t=>{
 const f=fixture(),p=captureOriginalPublicationProject(f.options);let resolve,entered,artifacts=0;const pending=new Promise(r=>resolve=r),started=new Promise(r=>entered=r);
 const h=await hostFixture(t,{openOriginalProject:()=>{entered();return pending;},openNativeArtifact:()=>{artifacts++;}});
 const preview=h.host.preview(h.body),failure=assert.rejects(preview,{code:'IDE_PUBLICATION_NOT_SUPPLIED'});await started;const closing=h.host.close();resolve(p);await failure;await closing;
 assert.equal(artifacts,0);assert.equal(f.calls.filter(x=>x==='close').length,1);assert.equal(f.calls.includes('project'),false);
});
test('normal host independently closes project and observer after falsy artifact cleanup failure',async t=>{
 const f=fixture(),p=captureOriginalPublicationProject(f.options);let observerCloses=0;
 const h=await hostFixture(t,{openOriginalProject:async()=>p,openNativeArtifact:async()=>({assertCurrent:async()=>{},close(){throw false;}}),openObservation:async()=>({resume:async()=>({state:'pending'}),close:async()=>{observerCloses++;}})});
 await h.host.preview(h.body);await h.host.observe('11111111-2222-4333-8444-555555555555');await exactReject(()=>h.host.close(),false);await exactReject(()=>h.host.close(),false);
 assert.equal(f.calls.filter(x=>x==='close').length,1);assert.equal(observerCloses,1);
});
test('closing synchronously after observe prevents a queued service factory from starting',async t=>{
 let factories=0,resumes=0;const h=await hostFixture(t,{openObservation:async()=>{factories++;return{resume:async()=>{resumes++;},close:async()=>{}};}});
 const observing=h.host.observe('11111111-2222-4333-8444-555555555555');const refused=assert.rejects(observing,{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 const closing=h.host.close();await refused;await closing;assert.equal(factories,0);assert.equal(resumes,0);
});
function workspaceFixture(){
 const f=fixture(),selector={},context={workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-local-uuid'};
 const selection={projectId:f.project.projectId,publisherId:f.publisher.publisherId,projectRevision:f.project.projectRevision,catalogRevision:f.project.catalogRevision,expiresMS:2000};
 Object.assign(f.api,{acquireOriginalIDEWorkspaceProjectSelection(...args){assert.deepEqual(args,[context.workspace,context.profile,context.id]);f.calls.push('acquire-selector');return selector;},readOriginalIDEWorkspaceProjectSelection(ref){assert.equal(ref,selector);f.calls.push('read-selector');return structuredClone(selection);},closeOriginalIDEWorkspaceProjectSelection(ref){assert.equal(ref,selector);f.calls.push('close-selector');}});
 return{...f,selection,context,workspaceOptions:{context,api:f.api,now:f.options.now,assertLocalCurrent:f.options.assertLocalCurrent}};
}
test('workspace consumer acquires exact original launch primitives and uses returned canonical IDs',async()=>{
 assert.equal(typeof projectConsumer.captureOriginalWorkspacePublicationProject,'function');
 const f=workspaceFixture(),owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);assert.deepEqual(f.calls,['acquire-selector']);
 assert.deepEqual(await owner.assertCurrent(),{projectId:f.project.projectId,publisherId:f.publisher.publisherId,expiresMS:2000});
 assert.notEqual(f.context.id,f.project.projectId);assert.equal(f.calls.filter(x=>x==='acquire').length,1);assert.equal(owner.close(),undefined);owner.close();
 assert.equal(f.calls.filter(x=>x==='close-selector').length,1);assert.equal(f.calls.filter(x=>x==='close').length,1);
});
test('workspace selector missing publisher never acquires authority or creates a key',async()=>{
 const f=workspaceFixture();f.selection.publisherId=null;const owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PUBLISHER_UNAVAILABLE'});assert.equal(f.calls.includes('acquire'),false);owner.close();assert.equal(f.calls.filter(x=>x==='close-selector').length,1);
});
for(const cause of [false,undefined,null])test(`workspace selector partial keeps ${String(cause)} first cause and independent custody`,async()=>{
 const f=workspaceFixture();f.api.readOriginalIDEWorkspaceProjectSelection=()=>{throw cause;};const owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 await exactReject(()=>owner.assertCurrent(),cause);await exactReject(()=>owner.assertCurrent(),cause);owner.close();owner.close();assert.equal(f.calls.filter(x=>x==='acquire-selector').length,1);assert.equal(f.calls.filter(x=>x==='close-selector').length,1);assert.equal(f.calls.includes('acquire'),false);
});
test('original project revision must equal original workspace selection revision',async()=>{
 const f=workspaceFixture();f.selection.projectRevision='9';const owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();
});
test('mapping change, lifetime renewal or local context switch retires the same owner without reacquiring',async()=>{
 for(const mutation of [f=>{f.selection.catalogRevision='8';},f=>{f.selection.expiresMS=2050;},f=>{f.context.id='PUBLIC-other-local';}]){
  const f=workspaceFixture(),owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);await owner.assertCurrent();mutation(f);await assert.rejects(owner.assertCurrent(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();assert.equal(f.calls.filter(x=>x==='acquire-selector').length,1);
 }
});
test('project cleanup failure does not prevent independent selector cleanup and is not retried',async()=>{
 const f=workspaceFixture();let closes=0;f.api.closeOriginalIDEProjectAuthority=()=>{closes++;throw false;};const owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);await owner.assertCurrent();
 await exactReject(()=>owner.close(),false);await exactReject(()=>owner.close(),false);assert.equal(closes,1);assert.equal(f.calls.filter(x=>x==='close-selector').length,1);
});
test('closing during local await prevents selector reads and keeps original directory cleanup',async()=>{
 const f=workspaceFixture();let release;f.workspaceOptions.assertLocalCurrent=()=>new Promise(resolve=>{release=resolve;});const owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions),pending=owner.assertCurrent();owner.close();release();
 await assert.rejects(pending,{code:'IDE_PUBLICATION_PROJECT_RETIRED'});assert.equal(f.calls.includes('read-selector'),false);assert.equal(f.calls.filter(x=>x==='close-selector').length,1);
});


test('observation reads independently current original principal/project/publisher DATA, not a local UUID grant',async()=>{
 const f=workspaceFixture(),owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 const scope=await owner.readObservationScope();
 assert.equal(scope.principal.account,f.principal.account);assert.equal(scope.principal.sessionGeneration,f.principal.sessionGeneration);
 assert.equal(scope.project.projectId,f.project.projectId);assert.notEqual(scope.project.projectId,f.context.id);
 assert.equal(scope.project.ownerAccount,f.project.ownerAccount);assert.equal(scope.publisher.registrationRef,f.publisher.registrationRef);assert.equal(scope.expiresMS,2000);
 assert.equal(Object.hasOwn(scope,'authorized'),false);assert.equal(Object.hasOwn(scope,'generation'),false);
 assert.ok(Object.isFrozen(scope)&&Object.isFrozen(scope.principal)&&Object.isFrozen(scope.project)&&Object.isFrozen(scope.publisher));
 f.principal.sessionGeneration='9';await assert.rejects(owner.readObservationScope(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
 owner.close();assert.equal(f.calls.filter(x=>x==='acquire').length,1);assert.equal(f.calls.filter(x=>x==='acquire-selector').length,1);
});
test('publish-only permission remains usable for review but cannot authorize observation',async()=>{
 const f=fixture();f.project.read=false;const owner=captureOriginalPublicationProject(f.options);
 assert.equal((await owner.assertCurrent()).projectId,f.project.projectId);
 await assert.rejects(owner.readObservationScope(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 assert.equal((await owner.assertCurrent()).projectId,f.project.projectId);owner.close();
});
test('observation refuses a retired original workspace selection and never reacquires it',async()=>{
 const f=workspaceFixture(),owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 await owner.readObservationScope();f.selection.catalogRevision='9';await assert.rejects(owner.readObservationScope(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
 owner.close();assert.equal(f.calls.filter(x=>x==='acquire-selector').length,1);
});

function serviceFixture(base=fixture()){
 const registration={version:'YNX-IDE-SERVICE-REGISTRATION/v1',registrationId:'PUBLIC-service-registration',revision:'1',currentReference:'PUBLIC-service-current',serviceInstanceId:'PUBLIC-service-instance',projectId:base.project.projectId,account:base.principal.account,apiEndpoint:'https://PUBLIC.invalid/cloud',tlsSPKISHA256:'a'.repeat(64),audience:'PUBLIC-audience',productId:'PUBLIC-product',clientId:'PUBLIC-client',scopes:['PUBLIC:read'],issuedAtMs:500,expiresAtMs:1500,revoked:false};
 let reads=0;const hooks={};
 base.api.readOriginalIDECurrentServiceRegistration=(owner,id)=>{
  assert.equal(id,base.project.projectId);assert.notEqual(id,'PUBLIC-local-uuid');reads++;base.calls.push('service');hooks.read?.(reads);
  return structuredClone({principal:base.principal,project:base.project,serviceRegistration:registration,expiresMS:1400});
 };
 return{...base,registration,hooks,reads:()=>reads};
}
test('fixed Native service DATA uses same original project owner and remains detached with no permission flags',async()=>{
 const f=serviceFixture(),owner=captureOriginalPublicationProject(f.options),service=await owner.readObservationServiceRegistration();
 assert.equal(service.principal.account,f.principal.account);assert.equal(service.project.projectId,f.project.projectId);assert.equal(service.serviceRegistration.registrationId,f.registration.registrationId);assert.equal(service.expiresMS,1400);
 assert.equal(Object.keys(service).sort().join(),'expiresMS,principal,project,serviceRegistration');assert.equal(Object.hasOwn(service,'authorized'),false);assert.equal(Object.hasOwn(service,'operationRequestId'),false);
 assert.ok(Object.isFrozen(service.serviceRegistration)&&Object.isFrozen(service.serviceRegistration.scopes));
 f.registration.scopes[0]='PUBLIC:changed';assert.equal(service.serviceRegistration.scopes[0],'PUBLIC:read');
 await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();assert.equal(f.calls.filter(x=>x==='acquire').length,1);
});
test('missing new service export and read permission cannot become endpoint aliases or retire old project review',async()=>{
 const f=fixture(),owner=captureOriginalPublicationProject(f.options);
 await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal((await owner.assertCurrent()).projectId,f.project.projectId);owner.close();
 const readless=serviceFixture();readless.project.read=false;const other=captureOriginalPublicationProject(readless.options);
 await assert.rejects(other.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(readless.reads(),0);assert.equal((await other.assertCurrent()).projectId,readless.project.projectId);other.close();
});
test('service DATA rejects project/account/revoke/window/scopes/extra drift without another Source acquisition',async()=>{
 for(const change of [f=>f.registration.projectId='PUBLIC-other',f=>f.registration.account='PUBLIC-other',f=>f.registration.revoked=true,f=>f.registration.expiresAtMs=900,f=>f.registration.scopes=[],f=>f.registration.extra='PUBLIC-not-in-schema',f=>f.registration.revision=1]){
  const f=serviceFixture();change(f);const owner=captureOriginalPublicationProject(f.options);
  await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();assert.equal(f.calls.filter(x=>x==='acquire').length,1);
 }
});
test('service DATA changed between original reads or expired during final local fence cannot return',async()=>{
 const f=serviceFixture();f.hooks.read=count=>{if(count===2)f.registration.revision='2';};const owner=captureOriginalPublicationProject(f.options);
 await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});owner.close();
 const expired=serviceFixture(),check=expired.options.assertLocalCurrent;expired.options.assertLocalCurrent=async()=>{await check();if(expired.reads())expired.setTime(1501);};
 const other=captureOriginalPublicationProject(expired.options);await assert.rejects(other.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});other.close();
});
test('Native service failure including falsy causes remains exact and closes same owner once',async()=>{
 for(const cause of [undefined,false,Error('PUBLIC native getter failed')]){
  const f=serviceFixture();f.api.readOriginalIDECurrentServiceRegistration=()=>{throw cause;};const owner=captureOriginalPublicationProject(f.options);
  await exactReject(()=>owner.readObservationServiceRegistration(),cause);await exactReject(()=>owner.readObservationServiceRegistration(),cause);
  owner.close();owner.close();assert.equal(f.calls.filter(x=>x==='close').length,1);
 }
});

test('normal workspace selector delegates fixed service DATA without local UUID or new authority',async()=>{
 const f=serviceFixture(workspaceFixture()),owner=projectConsumer.captureOriginalWorkspacePublicationProject(f.workspaceOptions);
 const data=await owner.readObservationServiceRegistration();
 assert.equal(data.project.projectId,f.project.projectId);assert.notEqual(data.project.projectId,f.context.id);
 assert.equal(data.serviceRegistration.registrationId,f.registration.registrationId);assert.equal(data.expiresMS,1400);
 f.selection.projectRevision='9';await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
 owner.close();assert.equal(f.calls.filter(x=>x==='acquire').length,1);assert.equal(f.calls.filter(x=>x==='acquire-selector').length,1);assert.equal(f.calls.filter(x=>x==='close-selector').length,1);
});
test('closing project during post-read local current fence blocks the second service getter',async()=>{
 const f=serviceFixture();let owner;const check=f.options.assertLocalCurrent;
 f.options.assertLocalCurrent=async()=>{await check();if(f.reads())owner.close();};
 owner=captureOriginalPublicationProject(f.options);await assert.rejects(owner.readObservationServiceRegistration(),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
 assert.equal(f.reads(),1);assert.equal(f.calls.filter(x=>x==='close').length,1);
});
