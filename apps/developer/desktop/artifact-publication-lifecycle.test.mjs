import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openPublicationObservation} from './artifact-publication-lifecycle.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
const id='11111111-2222-3333-4444-555555555555';
const expected=()=>({binding:{projectId:'PUBLIC-project',version:'0.1.0',contentDigest:'a'.repeat(64),publishPurpose:'PUBLIC-purpose',targetEnvironment:'PUBLIC-env',byteSize:12},manifestSHA256:'b'.repeat(64),approvalSHA256:'c'.repeat(64),publisherId:'PUBLIC-publisher',resourceId:'PUBLIC-resource'});
async function fixture(t,extra={}){const profile=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'ynx-publication-observe-')));await fs.chmod(profile,0o700);t.after(()=>fs.rm(profile,{recursive:true}));const expiresMS=Date.now()+60000,workspace='/PUBLIC/workspace';const state={principal:{account:'PUBLIC-auth-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'1'},project:{projectId:'PUBLIC-project',ownerAccount:'PUBLIC-owner',currentReference:'PUBLIC-project-current',projectRevision:'1',catalogRevision:'1',read:true,publish:true,runtime:false,runtimeOrigin:''},publisher:{account:'PUBLIC-auth-account',projectId:'PUBLIC-project',publisherId:'PUBLIC-publisher',keyRole:'ide-artifact-publisher',publicOriginal:'PUBLIC-original',publicSHA256:'PUBLIC-public-sha',registrationRef:'PUBLIC-registration',revision:'1'},expiresMS};const calls=[];class Client{constructor(options){this.options=options;}submitIDEDeployment(){throw Error('No POST permitted');}}
 const options={context:{profile,id,workspace},publicationProject:{readObservationScope:async()=>structuredClone(state)},endpoint:'https://PUBLIC.invalid',fetch:async()=>{throw Error('fixture must not fetch');},getDeploymentRequestHeaders:async request=>{calls.push(['headers',request]);return{'PUBLIC-proof':'fixture'};},CloudClient:Client,observeIDEDeployment:async(client,input)=>{calls.push(['observe',input]);await client.options.getDeploymentRequestHeaders({method:'GET',path:'/api/v1/PUBLIC',operationRequestId:input.requestId});return{operation:{requestId:input.requestId,state:'unknown'},logs:null};},...extra};return{profile,state,calls,options,flow:await openPublicationObservation(options)};}
test('durable query coordinates survive a new instance and invoke only the supplied original observer',async t=>{const f=await fixture(t);await f.flow.retain(id,expected());const reopened=await openPublicationObservation(f.options),row=await reopened.read(id);assert.equal(row.queryOnly,true);assert.equal(row.replayAllowed,false);assert.equal(f.calls.length,0);const result=await reopened.resume(id);assert.equal(result.operation.state,'unknown');assert.equal(f.calls[0][0],'observe');assert.deepEqual(f.calls[0][1].expected,expected());assert.equal(f.calls[1][0],'headers');await assert.rejects(reopened.retain(id,expected()),{code:'EEXIST'});assert.equal((await reopened.read(id)).expected.manifestSHA256,'b'.repeat(64));});
test('current project generation is rechecked around every original header acquisition',async t=>{let f;f=await fixture(t,{getDeploymentRequestHeaders:async()=>{f.state.principal.sessionGeneration='2';return{'PUBLIC':'not returned'};}});await f.flow.retain(id,expected());await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_RETIRED'});assert.equal(f.calls.filter(call=>call[0]==='observe').length,1);});
test('another account or owner cannot adopt saved publication query coordinates',async t=>{const f=await fixture(t);await f.flow.retain(id,expected());const before=await fs.readFile(join(f.profile,'artifact-publication-queries',id+'.json'));const other=await openPublicationObservation({...f.options,publicationProject:{readObservationScope:async()=>({...structuredClone(f.state),principal:{...f.state.principal,account:'PUBLIC-other'},publisher:{...f.state.publisher,account:'PUBLIC-other'}})}});await assert.rejects(other.read(id),{code:'IDE_PUBLICATION_REFERENCE_INVALID'});assert.deepEqual(await fs.readFile(join(f.profile,'artifact-publication-queries',id+'.json')),before);});
test('project close aborts its observation without cancelling, signing or resubmitting the deployment',async t=>{let entered;const started=new Promise(resolve=>entered=resolve),f=await fixture(t,{observeIDEDeployment:async(_client,input)=>{entered();return new Promise((resolve,reject)=>{input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true});});}});await f.flow.retain(id,expected());const request=f.flow.resume(id);await started;f.flow.close();await assert.rejects(request,{code:'IDE_PUBLICATION_RETIRED'});const reopened=await openPublicationObservation(f.options);assert.equal((await reopened.read(id)).queryOnly,true);assert.equal(f.calls.length,0);});
test('partial original reference remains preserved and cannot become a new deployment attempt',async t=>{const f=await fixture(t);await f.flow.retain(id,expected());const file=join(f.profile,'artifact-publication-queries',id+'.json');await fs.appendFile(file,'{');const before=await fs.readFile(file);await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_REFERENCE_UNKNOWN'});assert.equal(f.calls.length,0);assert.deepEqual(await fs.readFile(file),before);await assert.rejects(f.flow.retain(id,expected()),{code:'EEXIST'});});
test('a real FIFO query coordinate is rejected before any blocking read or Cloud request',async t=>{const f=await fixture(t);const file=join(f.profile,'artifact-publication-queries',id+'.json');execFileSync('/usr/bin/mkfifo',['-m','600',file]);const program=`import{openPublicationObservation}from ${JSON.stringify(new URL('./artifact-publication-lifecycle.mjs',import.meta.url).href)};const [context,state,id]=JSON.parse(process.argv[1]);const flow=await openPublicationObservation({context,publicationProject:{readObservationScope:async()=>state},fetch:async()=>{throw Error('must not fetch');},getDeploymentRequestHeaders:async()=>{throw Error('must not call');},CloudClient:class{},observeIDEDeployment:async()=>{throw Error('must not call');}});try{await flow.read(id);process.exitCode=2;}catch(e){if(e.code!=='IDE_PUBLICATION_REFERENCE_INVALID')throw e;console.log('FIFO_REFUSED');}`;const result=spawnSync(process.execPath,['--input-type=module','-e',program,JSON.stringify([f.options.context,f.state,id])],{encoding:'utf8',timeout:1500});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/FIFO_REFUSED/);assert.equal((await fs.lstat(file)).isFIFO(),true);});


test('already cancelled observation never enters the original SDK and keeps its query coordinate',async t=>{
 const f=await fixture(t);await f.flow.retain(id,expected());const controller=new AbortController(),reason=Error('PUBLIC-user-cancel');controller.abort(reason);
 await assert.rejects(f.flow.resume(id,{signal:controller.signal}),error=>error===reason);
 assert.equal(f.calls.length,0);assert.equal((await f.flow.read(id)).queryOnly,true);
 await f.flow.resume(id);assert.equal(f.calls.filter(call=>call[0]==='observe').length,1);
});
test('cancellation during the last project-current wait does not enter the original SDK',async t=>{
 const f=await fixture(t);await f.flow.retain(id,expected());let entered,release,count=0;
 const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 f.options.publicationProject.readObservationScope=async()=>{if(++count===3){entered();await held;}return structuredClone(f.state);};
 const controller=new AbortController(),reason=Error('PUBLIC-cancel-during-current');
 const pending=f.flow.resume(id,{signal:controller.signal});const rejected=assert.rejects(pending,error=>error===reason);
 await started;controller.abort(reason);release();await rejected;
 assert.equal(f.calls.length,0);assert.equal((await f.flow.read(id)).queryOnly,true);
});
test('a late SDK success cannot replace cancellation or trigger a second deployment',async t=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const f=await fixture(t,{observeIDEDeployment:async()=>{entered();await held;return{operation:{state:'completed'},logs:[]};}});await f.flow.retain(id,expected());
 const controller=new AbortController(),reason=Error('PUBLIC-cancel-before-result');
 const pending=f.flow.resume(id,{signal:controller.signal});const rejected=assert.rejects(pending,error=>error===reason);
 await started;controller.abort(reason);release();await rejected;
 assert.equal((await f.flow.read(id)).queryOnly,true);assert.equal(f.calls.length,0);
});

test('cancel settles the caller while an uncooperative read-only SDK is still pending',async t=>{
 let entered,rejectSDK;const started=new Promise(resolve=>entered=resolve),sdk=new Promise((_resolve,reject)=>rejectSDK=reject);
 const f=await fixture(t,{observeIDEDeployment:()=>{entered();return sdk;}});await f.flow.retain(id,expected());
 const controller=new AbortController(),reason=Error('PUBLIC-query-cancel');let settled=false;
 const pending=f.flow.resume(id,{signal:controller.signal});const rejected=assert.rejects(pending,error=>error===reason).then(()=>{settled=true;});
 await started;controller.abort(reason);await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(settled,true,'cancel must settle without waiting for the SDK response');}
 finally{rejectSDK(Error('PUBLIC-late-sdk-failure'));await rejected;}
 assert.equal((await f.flow.read(id)).queryOnly,true);
});

for(const [name,mutate]of Object.entries({account:s=>{s.principal.account='PUBLIC-other';s.publisher.account='PUBLIC-other';},session:s=>{s.principal.sessionGeneration='9';},project:s=>{s.project.projectRevision='9';},publisher:s=>{s.publisher.registrationRef='PUBLIC-new-registration';},read:s=>{s.project.read=false;}}))test('original '+name+' change prevents query before any SDK entry',async t=>{
 const f=await fixture(t);await f.flow.retain(id,expected());mutate(f.state);
 await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_RETIRED'});assert.equal(f.calls.length,0);
});
test('journal requires canonical project and independently selected publisher, not local directory identity',async t=>{
 const f=await fixture(t);
 for(const value of [{...expected(),binding:{...expected().binding,projectId:id}},{...expected(),publisherId:'PUBLIC-other-publisher'}])await assert.rejects(f.flow.retain(id,value),{code:'IDE_PUBLICATION_REFERENCE_INVALID'});
 assert.equal(await f.flow.read(id),null);assert.equal(f.calls.length,0);
 await f.flow.retain(id,expected());assert.equal((await f.flow.read(id)).expected.binding.projectId,f.state.project.projectId);
});
test('new valid session can query an original durable coordinate after reopen without POST or adoption of another account',async t=>{
 const f=await fixture(t);await f.flow.retain(id,expected());f.flow.close();f.state.principal.sessionRef='PUBLIC-new-session';f.state.principal.currentRef='PUBLIC-new-current';f.state.principal.sessionGeneration='2';
 const reopened=await openPublicationObservation(f.options);await reopened.resume(id);
 assert.equal(f.calls.filter(call=>call[0]==='observe').length,1);assert.equal(f.calls.filter(call=>call[0]==='headers').length,1);reopened.close();
});
test('local context switch during current lookup cannot carry query custody into another workspace',async t=>{
 const f=await fixture(t);await f.flow.retain(id,expected());f.options.context.workspace='/PUBLIC/different';
 await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_RETIRED'});assert.equal(f.calls.length,0);
});
test('legacy project-shaped objects cannot supply original Native publication scope',async t=>{
 const f=await fixture(t);await assert.rejects(openPublicationObservation({...f.options,publicationProject:undefined,admittedProject:{assertCurrent:async()=>({owner:'PUBLIC-legacy',account:'PUBLIC-auth-account',generation:1,localProjectId:'PUBLIC-project'})}}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 assert.equal(f.calls.length,0);
});

test('original workspace consumer feeds canonical Native scope into the durable observer without AI identity mapping',async t=>{
 const f=await fixture(t);f.flow.close();const {captureOriginalWorkspacePublicationProject}=await import('./original-publication-project.mjs');
 const nativeCalls=[],selector={},authority={},expiresMS=f.state.expiresMS;
 const principal=()=>({...f.state.principal,expiresMS}),project=()=>({...f.state.project,expiresMS});
 const api={
  acquireOriginalIDEWorkspaceProjectSelection(...args){nativeCalls.push('select');assert.deepEqual(args,[f.options.context.workspace,f.options.context.profile,id]);return selector;},
  readOriginalIDEWorkspaceProjectSelection(ref){assert.equal(ref,selector);return{projectId:f.state.project.projectId,publisherId:f.state.publisher.publisherId,projectRevision:'1',catalogRevision:'1',expiresMS};},
  closeOriginalIDEWorkspaceProjectSelection(ref){assert.equal(ref,selector);nativeCalls.push('close-selector');},
  acquireOriginalIDEProjectAuthority(){nativeCalls.push('authority');return authority;},
  readOriginalIDECurrentProject(ref,projectID){assert.equal(ref,authority);assert.equal(projectID,f.state.project.projectId);nativeCalls.push('current-project');return{principal:principal(),project:project(),expiresMS};},
  readOriginalIDECurrentPublisher(ref,projectID,publisherID){assert.equal(ref,authority);assert.equal(projectID,f.state.project.projectId);assert.equal(publisherID,f.state.publisher.publisherId);nativeCalls.push('current-publisher');return{principal:principal(),project:project(),publisher:{...f.state.publisher,expiresMS,revoked:false},publisherOriginal:new Uint8Array([1,2,3]),expiresMS};},
  closeOriginalIDEProjectAuthority(ref){assert.equal(ref,authority);nativeCalls.push('close-authority');},
 };
 const publicationProject=captureOriginalWorkspacePublicationProject({context:f.options.context,api,assertLocalCurrent:async()=>{}});
 const flow=await openPublicationObservation({...f.options,publicationProject});
 try{
  await flow.retain(id,expected());await flow.resume(id);
  assert.equal(f.calls.filter(call=>call[0]==='observe').length,1);
  assert.equal(nativeCalls.filter(call=>call==='select').length,1);assert.equal(nativeCalls.filter(call=>call==='authority').length,1);
  f.state.publisher.registrationRef='PUBLIC-replaced';await assert.rejects(flow.resume(id),{code:'IDE_PUBLICATION_PROJECT_RETIRED'});
  assert.equal(f.calls.filter(call=>call[0]==='observe').length,1,'changed original registration cannot enter a second SDK read');
 }finally{flow.close();publicationProject.close();}
 assert.equal(nativeCalls.filter(call=>call==='close-selector').length,1);assert.equal(nativeCalls.filter(call=>call==='close-authority').length,1);
});

test('cancellation during proof acquisition cannot issue a later status GET',async t=>{
 let entered,release,finished;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r),done=new Promise(r=>finished=r),fetches=[];
 const f=await fixture(t,{getDeploymentRequestHeaders:async()=>{entered();await hold;return{'PUBLIC-proof':'late'};},observeIDEDeployment:async(client)=>{try{await client.options.getDeploymentRequestHeaders({method:'GET',path:'/PUBLIC/status'});fetches.push('status');return{};}finally{finished();}}});
 await f.flow.retain(id,expected());const controller=new AbortController(),reason=Error('PUBLIC-cancel-proof');
 const pending=f.flow.resume(id,{signal:controller.signal}),rejected=assert.rejects(pending,e=>e===reason);
 await started;controller.abort(reason);await rejected;release();await done;assert.deepEqual(fetches,[]);
});
test('cancellation after status fences a late SDK log-header request before headers or GET',async t=>{
 let entered,release,finished;const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r),done=new Promise(r=>finished=r),fetches=[],headers=[];
 const f=await fixture(t,{getDeploymentRequestHeaders:async request=>{headers.push(request.path);return{'PUBLIC-proof':'fixture'};},observeIDEDeployment:async(client)=>{try{await client.options.getDeploymentRequestHeaders({method:'GET',path:'/PUBLIC/status'});fetches.push('status');entered();await hold;await client.options.getDeploymentRequestHeaders({method:'GET',path:'/PUBLIC/log'});fetches.push('log');return{};}finally{finished();}}});
 await f.flow.retain(id,expected());const controller=new AbortController(),reason=Error('PUBLIC-cancel-before-log');
 const pending=f.flow.resume(id,{signal:controller.signal}),rejected=assert.rejects(pending,e=>e===reason);
 await started;controller.abort(reason);await rejected;release();await done;
 assert.deepEqual(fetches,['status']);assert.deepEqual(headers,['/PUBLIC/status']);
});

test('missing explicit transport refuses before project or filesystem effects',async()=>{
 let reads=0;
 await assert.rejects(openPublicationObservation({context:{profile:'/PUBLIC/absent',id,workspace:'/PUBLIC'},publicationProject:{readObservationScope:async()=>{reads++;}},getDeploymentRequestHeaders:async()=>({}),CloudClient:class{},observeIDEDeployment:async()=>{}}),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});
 assert.equal(reads,0);
});
test('current project change after headers refuses before entering supplied transport',async t=>{
 let fetches=0,f;
 f=await fixture(t,{fetch:async()=>{fetches++;},observeIDEDeployment:async client=>{
  await client.options.getDeploymentRequestHeaders({method:'GET',path:'/PUBLIC/status'});
  f.state.principal.sessionGeneration='2';
  return client.options.fetch('https://PUBLIC.invalid',{method:'GET'});
 }});
 await f.flow.retain(id,expected());await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_RETIRED'});assert.equal(fetches,0);
});
test('cancellation after headers refuses before entering supplied transport',async t=>{
 const controller=new AbortController(),reason=Error('PUBLIC cancel before transport');let fetches=0;
 const f=await fixture(t,{fetch:async()=>{fetches++;},observeIDEDeployment:async client=>{
  await client.options.getDeploymentRequestHeaders({method:'GET',path:'/PUBLIC/status'});
  controller.abort(reason);return client.options.fetch('https://PUBLIC.invalid',{method:'GET'});
 }});
 await f.flow.retain(id,expected());await assert.rejects(f.flow.resume(id,{signal:controller.signal}),e=>e===reason);assert.equal(fetches,0);
});
test('response from supplied transport is rejected after project changes',async t=>{
 let f,fetches=0;
 f=await fixture(t,{fetch:async()=>{fetches++;f.state.project.projectRevision='2';return 'PUBLIC response';},observeIDEDeployment:client=>client.options.fetch('https://PUBLIC.invalid',{method:'GET'})});
 await f.flow.retain(id,expected());await assert.rejects(f.flow.resume(id),{code:'IDE_PUBLICATION_RETIRED'});assert.equal(fetches,1);
});
