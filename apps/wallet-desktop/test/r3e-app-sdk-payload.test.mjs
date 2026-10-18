import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {types} from 'node:util';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {createOriginalAdmissionBroker,admissionCanonical} from '../src/original-admission-broker.mjs';
import * as parent from '../src/original-admission-parent-source.mjs';
import * as payload from '../../../packages/wallet-auth/src/original-ide-private-payload.js';
import {canonicalJSON} from '../../../packages/wallet-auth/src/canonical.js';
// Same-copy actual App reader/parent and actual frozen SDK handler+codec.
// Only Native/Source/OS resources are explicit PUBLIC instruments, not grants.
const sdkTestURL=new URL('../../../packages/wallet-auth/test/original-auth-identity-private-joint-registration.test.mjs',import.meta.url);
const sdkTest=readFileSync(sdkTestURL,'utf8');
const fixtureSource=sdkTest.slice(sdkTest.indexOf('function fixture('),sdkTest.indexOf("test('R11 PUBLIC"));
const makeSDK=vm.runInNewContext(fixtureSource+'\nfixture;',{text:readFileSync(new URL('../../../packages/wallet-auth/src/original-auth-identity-private-joint-registration.js',import.meta.url),'utf8'),assert,vm,types,readFileSync,URL,PUBLIC_PAYLOAD:payload,PUBLIC_CANONICAL:canonicalJSON});
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
async function setup({dispatch,terminal=()=>undefined}={}){
 const h='a'.repeat(64),nonce='a'.repeat(43),r={version:1,purpose:'wallet-product-session-v2-service-admission/v1',service:'wallet-product-session-v2',productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:h,consumerManifestDigest:h,gatewayManifestDigest:h,instanceId:'PUBLIC_INSTANCE',currentReference:h,operations:['beginYNX','handleReturn','restore','disconnect'],requestNonce:nonce,requestedAtMs:900,expiresAtMs:2500};
 const selection={sourceSelection:{rootPath:'/PUBLIC/root',rootDigest:h,rolePath:'/PUBLIC/role',roleDigest:h},receiptSelection:{receiptPath:'/PUBLIC/receipts/'+nonce+'.admission.json',receiptDigest:h},receiptDirectory:'/PUBLIC/receipts',expectedRequest:r},publication={account:'PUBLIC_ACCOUNT',sequence:1,expiresAtMs:2000,selection};
 const id='req_PUBLIC_COMPOSED_001',input=canonicalJSON({operation:'restore',phase:'time',requestId:id,body:null,proofHeader:null}),response={status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':id},body:canonicalJSON({ok:true,requestId:id,schemaVersion:2,result:{PUBLIC:true}})};
 const events=[];let dispatches=0,terminals=0;
 const sdk=makeSDK({typedNative:true,payloadSelection:selection,payloadDispatch:raw=>{assert.equal(raw,input);dispatches++;return dispatch?dispatch(response):response;},hostNative:{
  reserveOriginalIDEParentIntent:()=>({PUBLIC:true}),readOriginalIDEParentIntent:()=>({pending:true,descriptor:41,currentReference:h,requestNonce:nonce}),assertOriginalIDEParentIntentCurrent(){},beginOriginalIDEParentPrelude:()=>Promise.resolve(),takeOriginalIDEParentSenderDescriptor:()=>42,
  readOriginalIDEParentInstalledFrame:()=>Buffer.from(admissionCanonical({type:'installed',selection,sequence:1,expiresAtMs:2000})+'\n'),assertOriginalIDEParentAcknowledgement(){events.push('installed-ack');},
  assertOriginalNativePrivateServiceTerminal(){terminals++;events.push('parent-terminal');return terminal();},retireOriginalIDEParentIntent(){events.push('retire');},joinOriginalIDEParentIntent(){events.push('join');return Promise.resolve();},closeOriginalIDEParentIntent(){events.push('close');return Promise.resolve();}
 }});sdk.api.initializeIDE(sdk.vault);const sdkRef=await sdk.api.acquireIDE(sdk.vault,sdk.guard),host=sdk.api.reserveIDE(sdkRef);
 const executor={executable:'/PUBLIC/NO_OS_EXECUTION',args:[],applicationId:r.applicationId,consumerManifestDigest:h,instanceId:r.instanceId,currentReference:h,expiresAtMs:2000},check=()=>undefined;
 parent.bindOriginalAdmissionParentSelection(check,{vault:sdk.vault,raw:{expiresAtMs:2500,expectedRequest:r},executor,assertCurrent:check,originalConfiguration:{reserveParentHost:()=>host}});
 const ref=parent.acquireOriginalAdmissionParentSource(check,executor,JSON.stringify,()=>1000,check);parent.enterOriginalAdmissionParentLaunch(ref,()=>({PUBLIC_child:true}));await parent.waitOriginalAdmissionParentPrelude(ref);
 const stream=new EventEmitter(),writes=[];stream.write=(raw,done)=>{writes.push(raw);done();};stream.destroy=()=>{if(stream.destroyed)return;stream.destroyed=true;queueMicrotask(()=>{stream.closed=true;stream.emit('close');});};parent.takeOriginalAdmissionParentStream(ref,()=>stream,()=>{});
 const broker=createOriginalAdmissionBroker({stream,assertChannelCurrent:()=>parent.assertOriginalAdmissionParentCurrent(ref),readInstalledFrame:()=>parent.readOriginalAdmissionParentInstalledFrame(ref),acknowledge:raw=>parent.acknowledgeOriginalAdmissionParentFrame(ref,raw),handlePrivateServicePayload:raw=>parent.handleOriginalAdmissionParentPayload(ref,raw),now:()=>1000,schedule:()=>({}),unschedule(){}});parent.attachOriginalAdmissionParentChannel(ref,broker);
 const ready=broker.deliver(publication);stream.emit('data',admissionCanonical({type:'ack',requestNonce:nonce,receiptDigest:h,sequence:1,consumerManifestDigest:h})+'\n');await ready;
 return {broker,stream,writes,events,host,ref,response,dispatches:()=>dispatches,terminals:()=>terminals,frame:payload.createOriginalIDEPrivateRequestFrame(payload.originalIDEPrivateDeliveryBinding(selection),input),async close(){await parent.closeOriginalAdmissionParentSource(ref);await broker.joinEntered();}};
}
test('R3e actual App and SDK parent return exact full response only after independent parent terminal',async()=>{
 const f=await setup();f.stream.emit('data',f.frame+'\n');await flush();await f.broker.joinEntered();assert.equal(f.writes.length,2);
 const result=payload.parseOriginalIDEPrivatePayload(f.writes[1].slice(0,-1));assert.equal(result.responseRaw,canonicalJSON(f.response));assert.equal(f.terminals(),1);assert.equal(f.dispatches(),1);assert.deepEqual(f.events.slice(0,2),['installed-ack','parent-terminal']);await f.close();
});
test('R3e App cancellation drains actual SDK pending result before parent close, with no late write or terminal',async()=>{
 let resolve,entered;const started=new Promise(r=>entered=r),work=new Promise(r=>resolve=r);const f=await setup({dispatch(){entered();return work;}});f.stream.emit('data',f.frame+'\n');await started;
 const close=f.close();await flush();assert.equal(f.events.includes('join'),false);resolve(f.response);await close;assert.equal(f.writes.length,1);assert.equal(f.terminals(),0);assert.equal(f.dispatches(),1);assert.equal(f.host.outcome().unknown,true);assert.deepEqual(f.events.slice(-3),['retire','join','close']);
});
test('R3e actual SDK falsy terminal refusal reaches App unchanged and cannot replay',async()=>{
 const f=await setup({terminal(){throw undefined;}});f.stream.emit('data',f.frame+'\n');await flush();await f.broker.joinEntered();assert.equal(f.writes.length,1);assert.equal(f.stream.destroyed,true);assert.equal(f.dispatches(),1);assert.equal(f.terminals(),1);assert.equal(f.host.outcome().firstCausePresent,true);assert.equal(f.host.outcome().firstCause,undefined);assert.equal(f.host.outcome().unknown,true);await f.close();
 parent.selectOriginalAdmissionParentOutcome(f.ref,s=>{assert.equal(s.firstCausePresent,true);assert.equal(s.firstCause,undefined);});
});
