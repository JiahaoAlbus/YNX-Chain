// The normal workbench prebuild already runs this file. Keep the actual
// retained reader custody regressions in that same gate.
import '../services/codeoss-service/test/original-project-reader.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,lstat,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,connect} from 'node:net';
import {createOriginalIDEHeldRead} from '../services/codeoss-service/src/original-held-session-read.mjs';
import {createOriginalProjectReader} from '../services/codeoss-service/src/original-project-reader.mjs';
import {createProjectServicesHost} from './project-services-host.mjs';
import channel from '../runtime/ynx-workbench/lib/project-services-channel.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function fixture(t,{cloudCaller=null,contracts=null,reportFailure}={}){
 const root=await mkdtemp(join(tmpdir(),'ynx-project-services-')),workspace=join(root,'workspace'),profile=join(root,'profile');await mkdir(workspace,{mode:0o700});await mkdir(profile,{mode:0o700});
 t.after(()=>rm(root,{recursive:true,force:true}));const context={id:randomUUID(),workspace,profile},inode=(await lstat(workspace)).ino;
 const events=[],selector=Object.freeze({PUBLIC:'actual selector'});
 const calls={acquire:0,close:0,current:0,projects:0,selections:[],proof:0},state={account:'PUBLIC_ACCOUNT',revision:1,gate:null,refuse:false};
 const held=createOriginalIDEHeldRead({originalSDK:{async acquireOriginalIDEHeldSessionRead(){calls.acquire++;return {failed:false,errorPresent:false,cleanupOnly:false,error:null,owner:Object.freeze({async assertCurrent(){calls.current++;if(state.gate){const g=state.gate;state.gate=null;g.enter.resolve();await g.release.promise;}if(state.refuse)throw Object.assign(Error('PUBLIC refused'),{code:'PUBLIC_ROOT_NOT_SUPPLIED'});},createBusinessProof(){calls.proof++;throw Error('project metadata does not mint proofs');},retire(){events.push('held-retire');},status(){return {};},async close(){calls.close++;events.push('held-close');}})};}}});
 const record=()=>({principal:{account:state.account,deviceId:'PUBLIC_DEVICE',sessionRef:'PUBLIC_SESSION',currentRef:'PUBLIC_CURRENT',accountGeneration:1,sessionGeneration:1},project:{projectId:'PUBLIC_CANONICAL',ownerAccount:state.account,currentReference:'PUBLIC_PROJECT_CURRENT',projectRevision:state.revision,catalogRevision:1,read:true,publish:false,runtime:true}});
 const sdk={acquireOriginalIDEWorkspaceProjectSelection(...args){calls.selections.push(args);return selector;},readOriginalIDEWorkspaceProjectSelection(){return {projectId:'PUBLIC_CANONICAL',publisherId:null,projectRevision:state.revision,catalogRevision:1};},closeOriginalIDEWorkspaceProjectSelection(){events.push('selection-close');},acquireOriginalIDEProjectAuthority(){return {};},readOriginalIDECurrentProject(){calls.projects++;return record();},readOriginalIDECurrentServiceRegistration(){return {...record(),service:{registrationId:'PUBLIC_SERVICE'}};},readOriginalIDECurrentPublisher(){throw Error('not requested');},closeOriginalIDEProjectAuthority(){events.push('project-close');}};
 const host=createProjectServicesHost(context,{heldRead:held,projectReader:createOriginalProjectReader({originalSDK:sdk}),cloudCaller,contracts,reportFailure,async assertPathCurrent(){assert.equal((await lstat(workspace)).ino,inode);}});
 t.after(()=>host.close().catch(()=>{}));return {host,context,calls,state,events,selector};
}
test('normal project host is lazy, uses exact OS selection through original reader, and closes one held owner',async t=>{
 const h=await fixture(t);assert.equal(h.calls.acquire,0);const result=await h.host.read('project');assert.equal(result.selection.projectId,'PUBLIC_CANONICAL');
 assert.deepEqual(h.calls.selections[0],[h.context.workspace,h.context.profile,h.context.id]);assert.equal(h.calls.acquire,1);assert.equal(h.calls.proof,0);assert.equal(result.project.project.publish,false);
 await h.host.close();assert.equal(h.calls.close,1);assert.equal(h.host.status().heldRead.closed,true);
});
test('missing Root refuses only protected project action and never produces a proof',async t=>{
 const h=await fixture(t);h.state.refuse=true;await assert.rejects(h.host.read('project'),{code:'PUBLIC_ROOT_NOT_SUPPLIED'});assert.equal(h.calls.proof,0);assert.equal(h.calls.projects,0);await h.host.close();
});
test('cancel during original current discards late result while another project remains usable',async t=>{
 const a=await fixture(t),b=await fixture(t),enter=deferred(),release=deferred();a.state.gate={enter,release};const abort=new AbortController(),pending=a.host.read('project',{},abort.signal);await enter.promise;abort.abort();release.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal((await b.host.read('project')).selection.projectId,'PUBLIC_CANONICAL');assert.equal(b.host.status().retired,false);
});
test('a changed original project during Cloud observation rejects late data and keeps exact request',async t=>{
 let entered=deferred(),release=deferred(),seen;
 const h=await fixture(t,{cloudCaller:{async observe(ctx,input){seen={ctx,input};entered.resolve();await release.promise;return {PUBLIC:'read only'};}}});
 const input={requestId:'req_PUBLIC_original_operation',view:'logs'},pending=h.host.read('cloud-observation',input);await entered.promise;input.requestId='CHANGED';h.state.revision=2;release.resolve();await assert.rejects(pending,{code:'IDE_PROJECT_IDENTITY_CHANGED'});assert.equal(seen.input.requestId,'req_PUBLIC_original_operation');assert.equal(seen.ctx.originalWorkspace.localProjectID,h.context.id);
});
test('V4 held read never becomes Cloud V5 or a guessed endpoint',async t=>{
 const h=await fixture(t);await assert.rejects(h.host.read('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs'}),{code:'IDE_CLOUD_ORIGINAL_V5_READ_SOURCE_NOT_SUPPLIED'});assert.equal(h.calls.proof,0);assert.equal(h.host.status().NativeAdmission,false);
});
test('project exit retires before late acquisition and waits for actual child cleanup',async t=>{
 const h=await fixture(t),enter=deferred(),release=deferred();h.state.gate={enter,release};const pending=h.host.read('project');await enter.promise;const closed=h.host.close();assert.equal(h.calls.close,0);release.resolve();await assert.rejects(pending);assert.equal((await closed).complete,true);assert.equal(h.calls.close,1);assert.throws(()=>h.host.read('project'),{code:'IDE_PROJECT_SERVICES_RETIRED'});
});
async function pipe(t,host){
 const server=createServer(),accepted=deferred();server.on('connection',socket=>accepted.resolve(socket));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const socket=connect(server.address().port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));const remote=await accepted.promise,served=channel.serve(remote,host),client=channel.client(socket);
 t.after(async()=>{client.close();await served.close().catch(()=>{});socket.destroy();remote.destroy();await new Promise(r=>server.close(r));});return {client,served};
}
test('actual inherited-pipe protocol carries original current result and explicit errors',async t=>{
 const h=await fixture(t),p=await pipe(t,h.host);assert.equal((await p.client.request('project',{})).selection.projectId,'PUBLIC_CANONICAL');
 await assert.rejects(p.client.request('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs'}),{code:'IDE_CLOUD_ORIGINAL_V5_READ_SOURCE_NOT_SUPPLIED'});
});
test('pipe cancellation rejects late reply without retiring another request',async t=>{
 const h=await fixture(t),p=await pipe(t,h.host),enter=deferred(),release=deferred();h.state.gate={enter,release};const abort=new AbortController(),pending=p.client.request('project',{},abort.signal);await enter.promise;abort.abort();release.resolve();await assert.rejects(pending,{code:'IDE_PROJECT_REQUEST_CANCELLED'});assert.equal((await p.client.request('project',{})).selection.projectId,'PUBLIC_CANONICAL');
});
test('normal Resource server, frontend command, fd8 and parent close are wired in producer source',async()=>{
 const base=new URL('../',import.meta.url),read=path=>readFile(new URL(path,base),'utf8');
 const [launcher,entry,backend,frontend,packager]=await Promise.all(['desktop/local-workbench.mjs','desktop/code-server.mjs','runtime/ynx-workbench/lib/backend-module.js','runtime/ynx-workbench/lib/frontend-module.js','scripts/package-local-macos.sh'].map(read));
 assert.match(launcher,/createProjectServicesHost\(context/);assert.match(launcher,/projectServicesChannel\.serve\(child\.stdio\[8\]/);assert.match(launcher,/await projectPipe.close\(\);\s*walletAdmission\?\.close/);
 assert.match(entry,/await workbench.finishProjectServicesCleanup\(\);\s*retireWallet\(\)/);assert.match(backend,/\/services\/ynx-project-services/);assert.match(backend,/delete env.YNX_PROJECT_SERVICES_PIPE/);assert.match(frontend,/ynx.project.current/);assert.match(frontend,/rpc.read\(id, 'project'/);assert.match(packager,/cp desktop\/project-services-host.mjs/);
});

test('composed fd8 contract actions use their independent guard without borrowing a held session',async t=>{
 const context={id:'11111111-2222-3333-4444-555555555555',workspace:'/PUBLIC/project',profile:'/PUBLIC/profile'};let calls=0,closes=0,paths=0;
 const contracts={async call(action,body){calls++;assert.equal(action,'inspect');assert.deepEqual(body,{});return{onlineConfigured:false};},async close(){closes++;}};
 const host=createProjectServicesHost(context,{assertPathCurrent:async()=>{paths++;},contracts,heldRead:{assertCurrent(){throw Error('Product Session must not substitute contract guard');},retire(){},async close(){},status(){return{};}},projectReader:{readWorkspace(){throw Error('No Cloud authority borrowed');}}});
 const p=await pipe(t,host);assert.equal((await p.client.request('contract',{action:'inspect',body:{}})).onlineConfigured,false);assert.equal(calls,1);assert.equal(paths,2);
 for(const body of [{action:'connect',body:{projectId:'PUBLIC-forged'}},{action:'read',body:{referenceId:context.id,account:'PUBLIC-forged'}},{action:'deployment-prepare',body:{draftId:context.id},origin:'PUBLIC-forged'}])await assert.rejects(p.client.request('contract',body));
 assert.equal(calls,1);await p.served.close();assert.equal(closes,1);
});
test('composed contract channel retains original UNKNOWN reference and rejects a late result on local cancellation',async t=>{
 const context={id:'11111111-2222-3333-4444-555555555555',workspace:'/PUBLIC/project',profile:'/PUBLIC/profile'},entered=deferred(),release=deferred();let calls=0;
 const host=createProjectServicesHost(context,{assertPathCurrent:async()=>{},contracts:{async call(action){calls++;if(action==='read')throw Object.assign(Error('PUBLIC original UNKNOWN'),{code:'IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED',referenceId:context.id});entered.resolve();await release.promise;return{PUBLIC:'late'};},async close(){}},heldRead:{retire(){},async close(){},status(){return{};}}});
 const p=await pipe(t,host);await assert.rejects(p.client.request('contract',{action:'read',body:{referenceId:context.id}}),e=>e.code==='IDE_CONTRACT_ORIGINAL_QUERY_REQUIRED'&&e.referenceId===context.id);
 const abort=new AbortController(),pending=p.client.request('contract',{action:'inspect',body:{}},abort.signal);await entered.promise;abort.abort();await assert.rejects(pending,{code:'IDE_PROJECT_REQUEST_CANCELLED'});release.resolve();assert.equal(calls,2);
});
test('project retire synchronously closes contract authority and preserves uncertain cleanup cause',async()=>{
 const cause=Error('PUBLIC first contract cleanup failure');let closes=0;
 const host=createProjectServicesHost({id:'PUBLIC-local',workspace:'/PUBLIC/project',profile:'/PUBLIC/profile'},{assertPathCurrent:async()=>{},contracts:{close(){closes++;throw cause;}},heldRead:{retire(){},async close(){},status(){return{};}}});
 host.retire();assert.equal(closes,1);await assert.rejects(host.close(),e=>e===cause);await assert.rejects(host.close(),e=>e===cause);assert.equal(closes,1);
});

test('normal Host retains same opaque selection for its Source and drains it before project/selection/held parent',async t=>{
 const entered=deferred(),release=deferred(),joined=deferred();let h;
 const source={retire(){h.events.push('source-retire');},async join(){h.events.push('source-join');await joined.promise;},close(){h.events.push('source-close');}};
 const acquire=original=>{assert.equal(original,h.selector);return source;};
 h=await fixture(t,{cloudCaller:{async observe(ctx,input,{projectLease}){assert.notEqual(h.selector,ctx.originalProject.selection);assert.equal(await projectLease.retainOriginalChild(acquire),source);entered.resolve();await release.promise;return{queryOnly:true};}}});
 const pending=h.host.read('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs'}),failed=assert.rejects(pending);await entered.promise;
 assert.equal(h.calls.selections.length,1);assert.deepEqual(h.events,[]);const closing=h.host.close();assert.deepEqual(h.events,['source-retire']);assert.equal(h.calls.close,0);
 release.resolve();await failed;await new Promise(r=>setImmediate(r));assert.deepEqual(h.events,['source-retire','source-join']);joined.resolve();await closing;
 assert.deepEqual(h.events,['source-retire','source-join','source-close','project-close','selection-close','held-retire','held-close']);assert.equal(h.calls.proof,0);
});
test('uncertain original Source cleanup keeps selection/project and held parent alive without reacquisition',async t=>{
 let h,closes=0;const source={retire(){},join(){throw false;},close(){closes++;}};
 h=await fixture(t,{cloudCaller:{async observe(ctx,input,{projectLease}){await projectLease.retainOriginalChild(original=>{assert.equal(original,h.selector);return source;});return{queryOnly:true};}}});
 await h.host.read('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'runtime'});await assert.rejects(h.host.close(),e=>e===false);await assert.rejects(h.host.close(),e=>e===false);assert.equal(closes,0);assert.deepEqual(h.events,[]);assert.equal(h.calls.close,0);assert.equal(h.calls.acquire,1);assert.equal(h.calls.selections.length,1);
});
test('same Host project reads reuse live selector while another Host remains independent',async t=>{
 const a=await fixture(t),b=await fixture(t);await a.host.read('project');await a.host.read('project');await b.host.read('project');assert.equal(a.calls.selections.length,1);assert.equal(b.calls.selections.length,1);await a.host.close();assert.equal(b.events.length,0);assert.equal((await b.host.read('project')).selection.projectId,'PUBLIC_CANONICAL');
});

test('Host explicit cleanup continuation releases held parent only after same project Source debt is actually cleared',async t=>{
 let h,ready=false,acquires=0;const acquire=()=>{acquires++;return{retire(){},join(){if(!ready)throw false;},close(){h.events.push('source-close');}};};
 h=await fixture(t,{cloudCaller:{async observe(ctx,input,{projectLease}){await projectLease.retainOriginalChild(acquire);return{queryOnly:true};}}});await h.host.read('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'runtime'});
 const original=h.host.close();await assert.rejects(original,e=>e===false);await assert.rejects(h.host.continueCleanup(),e=>e===false);assert.equal(h.calls.close,0);assert.equal(acquires,1);
 ready=true;assert.deepEqual(await h.host.continueCleanup(),{cleanupComplete:true,firstCausePresent:true,originalOperationRetried:false});assert.deepEqual(h.events,['source-close','project-close','selection-close','held-retire','held-close']);assert.equal(h.host.close(),original);await assert.rejects(original,e=>e===false);assert.equal(acquires,1);assert.throws(()=>h.host.read('project'),{code:'IDE_PROJECT_SERVICES_RETIRED'});
});
test('cleanup continuation never infers independent contract debt resolved from successful workspace drain',async()=>{
 const cause=Error('PUBLIC original contract debt');let heldCloses=0;const host=createProjectServicesHost({id:'PUBLIC',workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile'},{assertPathCurrent:async()=>{},contracts:{close(){throw cause;}},heldRead:{retire(){},async close(){heldCloses++;},status(){return{};}}});await assert.rejects(host.close(),e=>e===cause);await assert.rejects(host.continueCleanup(),e=>e===cause);assert.equal(heldCloses,0);
});

test('Cloud observation rejects frontend authority overrides before any Native selection',async t=>{
 const h=await fixture(t);const base={requestId:'req_PUBLIC_original_operation',view:'logs'};
 for(const key of ['endpoint','account','originalSelector','projectLease','headers','provider','originalProject']){
  assert.throws(()=>h.host.read('cloud-observation',{...base,[key]:'PUBLIC-forged'}),{code:'IDE_PROJECT_SERVICE_REQUEST_INVALID'});
 }
 let getterReads=0;const accessor={...base};Object.defineProperty(accessor,'endpoint',{enumerable:true,get(){getterReads++;throw Error('must not read frontend getter');}});
 assert.throws(()=>h.host.read('cloud-observation',accessor),{code:'IDE_PROJECT_SERVICE_REQUEST_INVALID'});
 assert.equal(getterReads,0);assert.equal(h.calls.acquire,0);assert.equal(h.calls.projects,0);assert.equal(h.calls.selections.length,0);
});
test('Cloud observation protocol rejects forged inputs before client or RPC dispatch',async()=>{
 let requests=0;const rpc=channel.rpc({request(){requests++;return Promise.resolve({queryOnly:true});},close(){}});
 const body={requestId:'req_PUBLIC_original_operation',view:'logs',endpoint:'https://PUBLIC.invalid'};
 await assert.rejects(rpc.read(randomUUID(),'cloud-observation',body));assert.equal(requests,0);
 const cyclic={requestId:'req_PUBLIC_original_operation',view:'logs'};cyclic.sourceOrder=cyclic;
 await assert.rejects(rpc.read(randomUUID(),'cloud-observation',cyclic));assert.equal(requests,0);rpc.close();
});
test('actual fd8 Cloud observation preserves original request DATA without making it authority',async t=>{
 let seen;const h=await fixture(t,{cloudCaller:{async observe(ctx,input,options){seen={ctx,input,options};return {queryOnly:true};}}});
 const p=await pipe(t,h.host),body={requestId:'req_PUBLIC_original_operation',view:'native-invoice-intent',period:'2026-11-07',productId:'PUBLIC-product',sourceOrder:'PUBLIC-original-order'};
 assert.deepEqual(await p.client.request('cloud-observation',body),{queryOnly:true});assert.deepEqual(seen.input,body);
 assert.equal(seen.ctx.originalWorkspace.localProjectID,h.context.id);assert.notEqual(seen.ctx.originalProject.selection,h.selector);
 assert.equal(typeof seen.options.projectLease.retainOriginalChild,'function');assert.equal(h.calls.proof,0);
});

test('Cloud read gives its actual backend caller one frozen original cancellation context',async t=>{
 const captures=[];const h=await fixture(t,{cloudCaller:{async observe(_ctx,_input,options){
  const original=options.originalRequestContext;assert.equal(Object.isFrozen(original),true);assert.deepEqual(Object.keys(original),['signal']);assert.equal(original.signal,options.signal);
  const prepare=ctx=>captures.push(ctx);prepare(original);await Promise.resolve();prepare(original);
  assert.equal(Reflect.set(original,'signal',new AbortController().signal),false);assert.equal(original.signal,options.signal);return {queryOnly:true};
 }}});const p=await pipe(t,h.host);
 assert.deepEqual(await p.client.request('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs'}),{queryOnly:true});assert.equal(captures.length,2);assert.equal(captures[0],captures[1]);assert.equal(h.calls.proof,0);
});
test('cancelling one original Cloud read cannot abort the next read of the same operation',async t=>{
 const entered=deferred(),release=deferred(),contexts=[];let lease;
 const h=await fixture(t,{cloudCaller:{async observe(_ctx,input,options){contexts.push(options.originalRequestContext);if(lease)assert.equal(options.projectLease,lease);else lease=options.projectLease;
  if(input.view==='logs'){entered.resolve();await release.promise;}return {queryOnly:true,view:input.view};
 }}});const p=await pipe(t,h.host),controller=new AbortController();
 const first=p.client.request('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs'},controller.signal),cancelled=assert.rejects(first,{code:'IDE_PROJECT_REQUEST_CANCELLED'});await entered.promise;controller.abort();await cancelled;
 const next=await p.client.request('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'runtime'});assert.equal(next.view,'runtime');assert.notEqual(contexts[0],contexts[1]);assert.equal(contexts[0].signal.aborted,true);assert.equal(contexts[1].signal.aborted,false);release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.proof,0);
});
test('frontend cannot supply the backend original Cloud cancellation context',async t=>{
 const h=await fixture(t);assert.throws(()=>h.host.read('cloud-observation',{requestId:'req_PUBLIC_original_operation',view:'logs',originalRequestContext:{signal:'PUBLIC-forged'}}),{code:'IDE_PROJECT_SERVICE_REQUEST_INVALID'});assert.equal(h.calls.acquire,0);assert.equal(h.calls.selections.length,0);
});

test('original backend failure diagnostics retain only action and code, never project or request DATA',async t=>{
 const events=[],referenceId=randomUUID(),error=Object.assign(Error('PRIVATE_MESSAGE_NOT_FOR_LOGS'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 for(let i=0;i<3;i++)await assert.rejects(h.host.read('contract',{action:'query',body:{referenceId,refresh:true}}),value=>value===error);
 assert.equal(events.length,1);assert.deepEqual(events[0],{service:'contract',operation:'query',code:'IDE_CONTRACT_NOT_SUPPLIED'});
 const text=JSON.stringify(events);for(const privateValue of [referenceId,h.context.id,h.context.workspace,h.context.profile,error.message])assert.ok(!text.includes(privateValue));
 assert.equal(h.calls.acquire,0);assert.equal(h.calls.proof,0);assert.equal(h.host.status().firstCausePresent,true);
});

test('diagnostics do not invoke code accessors or replace falsy causes when their sink fails',async t=>{
 let cause=0,getters=0;const error=Object.defineProperty(Error('PRIVATE'), 'code',{get(){getters++;throw Error('must not read');}});
 const h=await fixture(t,{reportFailure(){throw Error('PUBLIC diagnostic sink failure');},contracts:{async call(){throw cause;},async close(){}}});
 for(const value of [0,error]){cause=value;const actual=await h.host.read('contract',{action:'references',body:{}}).then(()=>assert.fail('must refuse'),error=>error);assert.equal(actual,value);}
 assert.equal(getters,0);assert.equal(h.host.status().firstCausePresent,true);assert.equal(h.calls.acquire,0);
});

test('failure diagnostic volume is bounded without swallowing later original failures',async t=>{
 const events=[];let code;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw Object.assign(Error('PUBLIC'),{code});},async close(){}}});
 for(let i=0;i<36;i++){code='IDE_PUBLIC_FAILURE_'+i;await assert.rejects(h.host.read('contract',{action:'references',body:{}}),{code});}
 assert.equal(events.length,32);assert.equal(h.host.status().firstCausePresent,true);
});

test('relay diagnostics distinguish real failure stages while retaining original cause and cleanup owner',async t=>{
 const events=[],cause=Error('PRIVATE_RAW_CAUSE'),cleanupOwner=Object.freeze({PUBLIC:'original cleanup'});let error;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 for(const stage of ['NATIVE_LOAD','NATIVE_EXPORTS','NATIVE_ACQUIRE','NATIVE_ACQUIRE_EMPTY','SCOPE_INITIAL','CURRENT_INITIAL','SCOPE_RECHECK','CURRENT_LIVE']){
  error=Object.assign(Error('PRIVATE_RAW_TOP'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',relayGuardFailureStage:stage,relayGuardCauseCode:'IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE',cause,cleanupOwner});
  await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error&&actual.cause===cause&&actual.cleanupOwner===cleanupOwner);
 }
 assert.equal(events.length,8);assert.equal(new Set(events.map(event=>event.relayGuardFailureStage)).size,8);
 for(const event of events){assert.equal(event.relayGuardCauseCode,'IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE');assert.deepEqual(Object.keys(event).sort(),['code','operation','relayGuardCauseCode','relayGuardFailureStage','service']);assert.equal(Object.isFrozen(event),true);}
 assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.equal(h.calls.acquire,0);
});

test('relay diagnostic allowlists reject private values, accessors and Proxy reflection',async t=>{
 const events=[];let error,touches=0;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 const base={code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'};
 const accessor=Object.defineProperties({...base},{relayGuardFailureStage:{get(){touches++;return 'NATIVE_LOAD';}},relayGuardCauseCode:{get(){touches++;return 'MODULE_NOT_FOUND';}}});
 const proxy=new Proxy({...base},{getOwnPropertyDescriptor(){touches++;throw Error('must not reflect');}});
 for(const value of [Object.assign({...base},{relayGuardFailureStage:'PRIVATE_STAGE',relayGuardCauseCode:'MODULE_NOT_FOUND'}),accessor,proxy,Object.assign({...base},{relayGuardFailureStage:'NATIVE_LOAD',relayGuardCauseCode:'PRIVATE_CODE'})]){
  error=value;await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error);
 }
 assert.equal(touches,0);assert.equal(events.length,3);
 assert.deepEqual(events[0],{service:'contract',operation:'references',code:base.code});
 assert.deepEqual(events[1],{service:'contract',operation:'references',code:'UNCLASSIFIED'});
 assert.equal(events[2].relayGuardFailureStage,'NATIVE_LOAD');assert.equal(events[2].relayGuardCauseCode,'UNCLASSIFIED');assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('scope phase diagnostics distinguish same-code failures without changing original cleanup custody',async t=>{
 const events=[],cause=Error('PRIVATE_CAUSE'),cleanupOwner=Object.freeze({PUBLIC:'original owner'});let error;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 for(const stage of ['SCOPE_INITIAL','SCOPE_RECHECK'])for(const phase of ['NATIVE_READ','VALIDATE','MATCH_CAPTURE']){
  error=Object.assign(Error('PRIVATE_TOP'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',relayGuardFailureStage:stage,relayGuardCauseCode:'UNCLASSIFIED',relayGuardScopePhase:phase,cause,cleanupOwner});
  for(let i=0;i<2;i++)await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error&&actual.cause===cause&&actual.cleanupOwner===cleanupOwner);
 }
 assert.equal(events.length,6,'different phases survive deduplication; identical failures remain bounded');
 assert.deepEqual(events.map(e=>e.relayGuardScopePhase),['NATIVE_READ','VALIDATE','MATCH_CAPTURE','NATIVE_READ','VALIDATE','MATCH_CAPTURE']);
 assert.ok(events.every(e=>Object.isFrozen(e)));assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.equal(h.calls.acquire,0);
});

test('scope phase diagnostics omit getters, inherited data, proxies and out-of-stage values',async t=>{
 const events=[];let error,touches=0;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 const base={code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',relayGuardFailureStage:'SCOPE_INITIAL',relayGuardCauseCode:'UNCLASSIFIED'};
 const accessor=Object.defineProperty({...base},'relayGuardScopePhase',{get(){touches++;throw Error('PRIVATE_GETTER');}});
 const inherited=Object.assign(Object.create({relayGuardScopePhase:'NATIVE_READ'}),base);
 const proxy=new Proxy({...base,relayGuardScopePhase:'NATIVE_READ'},{getOwnPropertyDescriptor(){touches++;throw Error('PRIVATE_PROXY');}});
 for(const value of [accessor,inherited,proxy,{...base,relayGuardScopePhase:'PRIVATE_VALUE'},{...base,relayGuardFailureStage:'NATIVE_LOAD',relayGuardScopePhase:'NATIVE_READ'}]){
  error=value;await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error);
 }
 assert.equal(touches,0);assert.equal(events.length,3);assert.ok(events.every(e=>!Object.hasOwn(e,'relayGuardScopePhase')));assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('native custody causes retain exactly the supplier fixed codes and keep original failures',async t=>{
 const {readFile}=await import('node:fs/promises');
 const contract=JSON.parse(await readFile(new URL('../test/fixtures/relay-guard-diagnostic-contract.json',import.meta.url),'utf8'));
 assert.equal(contract.nativeCaptureSource.commit,'3c9ead1f8a5920fb2428553dfed4e6943f882968');
 assert.equal(contract.nativeCaptureSource.sha256,'bb68851033b9e39f5561734ba0499c3d600ceee666f29a9607018bd597175da6');
 assert.equal(contract.nativeCaptureCauseAllowlist.length,11);
 const events=[],cause=Error('PRIVATE_NATIVE_CAUSE'),cleanupOwner=Object.freeze({PUBLIC:'original'});let error;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 for(const code of contract.nativeCaptureCauseAllowlist){
  error=Object.assign(Error('PRIVATE_NATIVE_TOP'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',relayGuardFailureStage:'SCOPE_INITIAL',relayGuardScopePhase:'NATIVE_READ',relayGuardCauseCode:code,cause,cleanupOwner});
  await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error&&actual.cause===cause&&actual.cleanupOwner===cleanupOwner);
 }
 assert.deepEqual(events.map(e=>e.relayGuardCauseCode),contract.nativeCaptureCauseAllowlist);
 assert.ok(events.every(e=>e.relayGuardScopePhase==='NATIVE_READ'));assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.equal(h.calls.acquire,0);
});

test('native custody cause lookalikes, accessors and inherited values remain unclassified',async t=>{
 const events=[];let error,touches=0;
 const h=await fixture(t,{reportFailure:event=>events.push(event),contracts:{async call(){throw error;},async close(){}}});
 const base={code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',relayGuardFailureStage:'SCOPE_RECHECK',relayGuardScopePhase:'NATIVE_READ'};
 const accessor=Object.defineProperty({...base},'relayGuardCauseCode',{get(){touches++;throw Error('PRIVATE');}});
 const inherited=Object.assign(Object.create({relayGuardCauseCode:'AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED'}),base);
 for(const value of [accessor,inherited,...['AUTH_IDENTITY_PRIVATE_SECRET','AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED_EXTRA','AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED\nPRIVATE'].map(relayGuardCauseCode=>({...base,relayGuardCauseCode}))]){
  error=value;await assert.rejects(h.host.read('contract',{action:'references',body:{}}),actual=>actual===error);
 }
 assert.equal(touches,0);assert.equal(events.length,1);assert.equal(events[0].relayGuardCauseCode,'UNCLASSIFIED');assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
