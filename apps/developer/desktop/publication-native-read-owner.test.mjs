import test from 'node:test';import assert from 'node:assert/strict';
import {capturePublicationReadOwner} from './publication-native-read-owner.mjs';
import {serviceReadURLs,createPinnedServiceReadFetch} from './publication-pinned-read-fetch.mjs';
const id='11111111-2222-4333-8444-555555555555',other='22222222-3333-4444-8555-666666666666';
const AUTH='https://wallet-auth.ynxweb4.com/v2/product-sessions/time';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function fixture(extra={}){
 const counts={project:0,ports:0,load:0,proof:0,network:[],sign:0,get:0,close:[]},context={id:other,profile:'/PUBLIC/profile',workspace:'/PUBLIC/workspace'};
 const source={principal:{account:'PUBLIC-account',deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'1',sessionGeneration:'2'},project:{projectId:'PUBLIC-project',ownerAccount:'PUBLIC-owner',currentReference:'PUBLIC-ref',projectRevision:'1',catalogRevision:'2',runtimeOrigin:'PUBLIC-runtime',read:true,publish:true,runtime:true},serviceRegistration:{apiEndpoint:'https://PUBLIC.invalid/api/v1',tlsSPKISHA256:'a'.repeat(64),scopes:['account:read']},expiresMS:2000};
 const native={requestId:id,source:structuredClone(source),device:{id:'PUBLIC-device',key:'PUBLIC-key',scopes:['account:read'],purpose:'PUBLIC-read'}};
 let config,observationOptions;
 const port={context:async()=>native,get:async()=>{counts.get++;return'PUBLIC-protected-raw';},sign:async()=>{counts.sign++;return'PUBLIC-signature';},authorizeNetwork:async url=>{counts.network.push(url);if(extra.networkFailure)throw extra.networkFailure;},close:async()=>{counts.close.push('ports');if(extra.cleanupFailure)throw false;}};
 const deps={registry:{PUBLIC:true},createReadClient:async c=>{config=c;return{capabilities:{kind:'existing-native-business-read',identityGrant:false,nativeAdmission:false,connected:false,newSession:false},createBusinessProof:async input=>{counts.proof++;assert.equal(input.method,'GET');assert.equal(input.body,'');return{proofHeader:'PUBLIC-proof'};},close:()=>counts.close.push('client')};},createFetch:options=>async url=>{await options.assertCurrent();await options.assertNetworkApproved(url);return{PUBLIC:true};},openObservation:async options=>{observationOptions=options;return{resume:async requestId=>({requestId,queryOnly:true}),close:()=>counts.close.push('observation')};},CloudClient:class{},observeIDEDeployment:async()=>{}};
 const owner=capturePublicationReadOwner({context,now:()=>1000,control:{open:rid=>{assert.equal(rid,id);counts.ports++;return port;}},openProject:async()=>{counts.project++;return{readObservationServiceRegistration:async()=>source,close:()=>counts.close.push('project')};},load:async()=>{counts.load++;return deps;},...extra.options});
 return{owner,source,native,counts,port,deps,context,get config(){return config;},get observationOptions(){return observationOptions;}};
}
test('constructor and idle close do not acquire, restore, sign, access storage or network',async()=>{
 const f=fixture();assert.equal(f.counts.project,0);await f.owner.close();assert.equal(f.counts.project,0);assert.deepEqual(f.counts.close,[]);
});
test('normal composition uses matching PUBLIC scope/port controls without invoking login',async()=>{
 const f=fixture();assert.deepEqual(await f.owner.resume(id),{requestId:id,queryOnly:true});assert.equal(f.counts.proof,0);assert.deepEqual(f.counts.network,[]);
 assert.equal(f.config.platform,'macos');assert.equal(f.config.productId,'developer');assert.equal(f.config.storage.securityLevel,'os-protected');
 assert.equal(await f.config.storage.get('PUBLIC-key'),'PUBLIC-protected-raw');assert.equal(await f.config.device.sign({PUBLIC:true}),'PUBLIC-signature');
 await assert.rejects(f.config.storage.set('key','value'));await assert.rejects(f.config.storage.remove('key'));
 const url=serviceReadURLs(f.source.serviceRegistration,id)[0];
 const headers=await f.observationOptions.getDeploymentRequestHeaders({method:'GET',operationRequestId:id,url,path:new URL(url).pathname});
 assert.deepEqual(headers,{'x-ynx-product-session-proof-v2':'PUBLIC-proof'});assert.deepEqual(f.counts.network,[AUTH]);assert.equal(f.counts.proof,1);
 await f.observationOptions.fetch(url);assert.equal(f.counts.network[1],url);await f.owner.close();assert.deepEqual(f.counts.close,['client','observation','ports','project']);
});
test('mismatched project/session never creates a read client or signs',async()=>{
 const f=fixture();f.native.source.principal.sessionRef='PUBLIC-foreign';
 await assert.rejects(f.owner.resume(id),{code:'IDE_NATIVE_SERVICE_SCOPE_MISMATCH'});assert.equal(f.counts.load,0);assert.equal(f.counts.proof,0);await f.owner.close();assert.deepEqual(f.counts.close,['ports','project']);
});
test('missing/rejected actual network permission stops before authority time/proof',async()=>{
 const denied=Error('PUBLIC native network review denied'),f=fixture({networkFailure:denied});await f.owner.resume(id);const url=serviceReadURLs(f.source.serviceRegistration,id)[0];
 await assert.rejects(f.observationOptions.getDeploymentRequestHeaders({method:'GET',operationRequestId:id,url,path:new URL(url).pathname}),e=>e===denied);
 assert.equal(f.counts.proof,0);await f.owner.close();
});
test('foreign route, POST and other operation ID cannot request time or proof',async()=>{
 const f=fixture();await f.owner.resume(id);const url=serviceReadURLs(f.source.serviceRegistration,id)[0],body={method:'GET',operationRequestId:id,url,path:new URL(url).pathname};
 for(const request of [{...body,method:'POST'},{...body,operationRequestId:other},{...body,url:'https://foreign.invalid/api/v1/ide/deployments/'+id}]){
  await assert.rejects(f.observationOptions.getDeploymentRequestHeaders(request),{code:'IDE_READ_ONLY'});
 }
 assert.deepEqual(f.counts.network,[]);assert.equal(f.counts.proof,0);await f.owner.close();
});
test('source changes after protected port access cannot release its value',async()=>{
 const f=fixture();await f.owner.resume(id);
 f.port.get=async()=>{f.native.source.project.projectRevision='3';return'PUBLIC-must-not-release';};
 await assert.rejects(f.config.storage.get('PUBLIC-key'),{code:'IDE_NATIVE_SERVICE_SCOPE_MISMATCH'});await f.owner.close();
});
test('close adopts a late project and independently cleans all owners once',async()=>{
 const held=deferred(),entered=deferred(),closed=[];const f=fixture({options:{openProject:()=>{entered.resolve();return held.promise;}}});
 const reading=f.owner.resume(id),rejected=assert.rejects(reading,{code:'IDE_PUBLICATION_RETIRED'});await entered.promise;const closing=f.owner.close();
 held.resolve({close:()=>closed.push('project')});await rejected;await closing;await f.owner.close();assert.deepEqual(closed,['project']);assert.equal(f.counts.ports,0);
});
test('falsy native cleanup failure does not skip original project cleanup or replay',async()=>{
 const f=fixture({cleanupFailure:true});await f.owner.resume(id);await assert.rejects(f.owner.close(),e=>e===false);await assert.rejects(f.owner.close(),e=>e===false);
 assert.deepEqual(f.counts.close,['client','observation','ports','project']);await assert.rejects(f.owner.resume(id));
});
test('pinned network transport rejects unrelated routes and write bodies before permission or IO',async()=>{
 let entered=0;const service={apiEndpoint:'https://PUBLIC.invalid/api/v1',tlsSPKISHA256:'a'.repeat(64)};
 const fetch=createPinnedServiceReadFetch({service,requestId:id,assertCurrent:async()=>{entered++;},assertNetworkApproved:async()=>{entered++;}});
 await assert.rejects(fetch('https://foreign.invalid',{}));
 await assert.rejects(fetch(serviceReadURLs(service,id)[0],{method:'POST',body:'x'}));
 await assert.rejects(fetch(serviceReadURLs(service,id)[0],{method:'GET',headers:{Authorization:'PUBLIC-forbidden'}}));
 assert.equal(entered,0);
});

test('cancel closes the original client before waiting for observation drain',{timeout:1000},async()=>{
 const f=fixture(),entered=deferred(),released=deferred(),controller=new AbortController(),reason=Error('PUBLIC cancelled original query');
 const base=f.deps.createReadClient;
 f.deps.createReadClient=async c=>{const client=await base(c);return{...client,close(){f.counts.close.push('client');released.resolve();}};};
 let flight;
 f.deps.openObservation=async()=>({resume(){entered.resolve();flight=released.promise.then(()=>{throw controller.signal.reason;});return flight;},async close(){f.counts.close.push('observation');await flight.catch(()=>{});}});
 const reading=f.owner.resume(id,{signal:controller.signal}),rejected=assert.rejects(reading,e=>e===reason);await entered.promise;controller.abort(reason);
 let timer;const outcome=await Promise.race([released.promise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),100);})]);
 try{assert.equal(outcome,true,'original client must be retired by cancellation before waiting for observation');}finally{clearTimeout(timer);released.resolve();await rejected;await f.owner.close();}
 assert.deepEqual(f.counts.close,['client','observation','ports','project']);
});
test('already cancelled query never acquires the original project',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort(false);
 await assert.rejects(f.owner.resume(id,{signal:controller.signal}),e=>e===false);assert.equal(f.counts.project,0);await f.owner.close();
});
test('cancel during factory acquisition adopts the late client but never starts observation',{timeout:1000},async()=>{
 const f=fixture(),entered=deferred(),release=deferred(),controller=new AbortController(),reason=Error('PUBLIC cancelled pending client');let observations=0;
 const original=f.deps.createReadClient;f.deps.createReadClient=async c=>{const client=await original(c);entered.resolve();await release.promise;return client;};
 f.deps.openObservation=async()=>{observations++;throw Error('PUBLIC must not start');};
 const reading=f.owner.resume(id,{signal:controller.signal}),rejected=assert.rejects(reading,e=>e===reason);await entered.promise;controller.abort(reason);release.resolve();
 await rejected;await f.owner.close();assert.equal(observations,0);assert.deepEqual(f.counts.close,['client','ports','project']);
});

test('normal publication host cancellation drains the actual read owner instead of retaining Running',{timeout:1000},async()=>{
 const {createArtifactPublicationHost}=await import('./artifact-publication-host.mjs');
 const f=fixture(),entered=deferred(),released=deferred();const base=f.deps.createReadClient;
 f.deps.createReadClient=async c=>({...await base(c),close(){f.counts.close.push('client');released.resolve();}});
 let flight;
 f.deps.openObservation=async()=>({resume(_id,{signal}){entered.resolve();flight=released.promise.then(()=>{signal.throwIfAborted();throw Error('PUBLIC stopped request must remain aborted');});return flight;},async close(){f.counts.close.push('observation');await flight.catch(()=>{});}});
 const host=createArtifactPublicationHost({context:f.context,openObservation:()=>f.owner});
 const query=host.observe(id,{observationId:other}),rejected=assert.rejects(query,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await entered.promise;
 assert.deepEqual(await host.cancelObservation(other),{cancelled:true,queryOnly:true,replayAllowed:false});await rejected;await host.close();
 assert.deepEqual(f.counts.close,['client','observation','ports','project']);
});
test('cancellation adopts a late observation and independently retains falsy client cleanup debt',{timeout:1000},async()=>{
 const f=fixture(),entered=deferred(),release=deferred(),controller=new AbortController(),reason=Error('PUBLIC cancellation');let clientClosed=0;
 const base=f.deps.createReadClient;f.deps.createReadClient=async c=>({...await base(c),close(){clientClosed++;f.counts.close.push('client');throw false;}});
 f.deps.openObservation=async()=>{entered.resolve();await release.promise;return{resume(){throw Error('PUBLIC late resume');},close(){f.counts.close.push('observation');}};};
 const query=f.owner.resume(id,{signal:controller.signal}),rejected=assert.rejects(query,e=>e===reason);await entered.promise;controller.abort(reason);release.resolve();await rejected;
 await assert.rejects(f.owner.close(),e=>e===false);await assert.rejects(f.owner.close(),e=>e===false);assert.equal(clientClosed,1);assert.deepEqual(f.counts.close,['client','observation','ports','project']);
});
