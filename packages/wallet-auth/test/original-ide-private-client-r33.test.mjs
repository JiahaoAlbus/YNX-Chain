import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import * as payload from '../src/original-ide-private-payload.js';
import {canonicalJSON} from '../src/canonical.js';
const selection={expectedRequest:{requestNonce:'PUBLIC_NONCE',consumerManifestDigest:'a'.repeat(64),service:'wallet-product-session-v2',productId:'developer',platform:'macos',gatewayOrigin:'https://wallet-auth.ynxweb4.com',operations:['beginYNX','handleReturn','restore','disconnect']},receiptSelection:{receiptDigest:'b'.repeat(64)},sourceSelection:{PUBLIC:true}};
const requestId='req_PUBLIC_REQUEST_001';
const input=canonicalJSON({requestId,operation:'restore',phase:'time',body:null,proofHeader:null});
const responseRaw=canonicalJSON({status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({ok:true,requestId,schemaVersion:2,result:{PUBLIC:true}})});
const entry='file:///PUBLIC/server.mjs';
function fixture({readyFailure=false,captureFailure=false,terminalFailure=false,closeFailure=false}={}){
 let live=true,captures=0,terminals=0,closed=0,currents=0,failAt=Infinity;
 const parent={},owner={...selection},events=[];
 const native={acquireOriginalIDEAdmissionParentDelivery:()=>parent,captureOriginalIDEPrivateClient(p){assert.equal(p,parent);captures++;if(captureFailure)throw undefined;return owner;},assertOriginalIDEPrivateClientReady(p){assert.equal(p,owner);if(readyFailure)throw false;},captureOriginalNativePrivateServiceBorrow:p=>p,assertOriginalNativePrivateServiceCurrent(p){assert.equal(p,owner);if(!live||++currents===failAt)throw false;},assertOriginalNativePrivateServiceAdmission(p){assert.equal(p,owner);events.push('admit');},captureOriginalIDEPrivateClientResult(p,...args){assert.equal(p,owner);assert.equal(args.length,4);assert.equal(args[3],responseRaw);events.push('result');},assertOriginalNativePrivateServiceTerminal(p){assert.equal(p,owner);terminals++;if(terminalFailure)throw undefined;},retireOriginalNativePrivateService(){events.push('retire');},joinOriginalNativePrivateService(){events.push('join');},closeOriginalNativePrivateService(){closed++;events.push('close');if(closeFailure)throw false;}};
 let source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export ','').replaceAll('import.meta.url','moduleURL').replaceAll("import('./original-ide-private-payload.js')","Promise.resolve(PUBLIC_PAYLOAD)").replaceAll("import('./canonical.js')","Promise.resolve({canonicalJSON:PUBLIC_CANONICAL})").replaceAll("import('./original-wallet-service-admission.js')","Promise.resolve({prepareOriginalWalletServiceAdmission:PUBLIC_PREPARE})");
 const ctx=vm.createContext({URL,fileURLToPath,resolve,dirname,join,process:{argv:['PUBLIC','/PUBLIC/server.mjs']},moduleURL:new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url).href,createRequire:()=>()=>native,originalIDEServiceAdmissionStartupSelection:{PUBLIC:true},PUBLIC_PAYLOAD:payload,PUBLIC_CANONICAL:canonicalJSON,PUBLIC_PREPARE:()=>({assertCurrent(){if(!live)throw false;}}),setTimeout,clearTimeout});
 vm.runInContext(source+'\nthis.api={parent:acquireOriginalIDEAdmissionParentDelivery,acquire:acquireOriginalIDEPrivateServiceChannel,cleanup:getOriginalIDEPrivateServiceChannelCleanup};',ctx);
 return {api:ctx.api,events,invalidate(){live=false;},failNextCurrent(offset=1){failAt=currents+offset;},captures:()=>captures,terminals:()=>terminals,closed:()=>closed};
}
// PUBLIC lexical Native/Source stand-ins only. Actual protocol codec is used.
test('R33 PUBLIC fixed actual JS channel retains same client, full result and independent ACK',async()=>{
 const f=fixture();await f.api.parent(entry);const c=await f.api.acquire(entry);assert.equal(await f.api.acquire(entry),c);assert.equal(f.captures(),1);
 const next=c.framer.nextOutboundFrame(),pending=c.original.dispatch(input),frame=await next;
 assert.equal(payload.parseOriginalIDEPrivatePayload(frame).canonicalInput,input);
 c.framer.acceptInboundFrame(payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw));const result=await pending;
 assert.equal(c.original.selectCurrentOutcome('restore','time',requestId).unknown,true);assert.equal(f.terminals(),0);
 const digest=payload.parseOriginalIDEPrivatePayload(payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw)).responseDigest;
 c.original.acknowledge('restore','time',requestId,digest);const out=c.original.selectCurrentOutcome('restore','time',requestId);assert.equal(out.result,result);assert.equal(out.terminal,true);assert.equal(out.unknown,false);
 const close=c.original.close();assert.equal(close,c.original.close());await close;assert.equal(f.closed(),1);
});
test('R33 PUBLIC partial readiness false preserves cleanup and no second capture',async()=>{
 const f=fixture({readyFailure:true});await f.api.parent(entry);await assert.rejects(f.api.acquire(entry),e=>e===false);const c=f.api.cleanup(entry);assert(c);assert(c.status().firstCausePresent);await assert.rejects(f.api.acquire(entry),e=>e===false);await c.close();assert.equal(f.captures(),1);assert.equal(f.closed(),1);
});
test('R33 PUBLIC capture undefined preserves UNKNOWN cleanup debt',async()=>{
 const f=fixture({captureFailure:true});await f.api.parent(entry);await assert.rejects(f.api.acquire(entry),e=>e===undefined);const c=f.api.cleanup(entry);assert.equal(c.status().unknown,true);await assert.rejects(c.close(),{code:'IDE_PRIVATE_CAPTURE_CUSTODY_UNKNOWN'});assert.equal(c.status().cleanupComplete,false);assert.equal(f.closed(),0);
});
test('R33 PUBLIC waiting writer resolves on current failure rather than orphaning',async()=>{
 const f=fixture();await f.api.parent(entry);const c=await f.api.acquire(entry);const writer=c.framer.nextOutboundFrame();f.failNextCurrent(3);await assert.rejects(c.original.dispatch(input),e=>e===false);assert.equal(await writer,null);await c.original.close();
});
test('R33 PUBLIC terminal undefined retains DATA and UNKNOWN without replay',async()=>{
 const f=fixture({terminalFailure:true});await f.api.parent(entry);const c=await f.api.acquire(entry);const pending=c.original.dispatch(input),frame=await c.framer.nextOutboundFrame();const reply=payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw);c.framer.acceptInboundFrame(reply);const result=await pending;
 assert.throws(()=>c.original.acknowledge('restore','time',requestId,payload.parseOriginalIDEPrivatePayload(reply).responseDigest),e=>e===undefined);const out=c.original.selectCurrentOutcome('restore','time',requestId);assert.equal(out.result,result);assert.equal(out.unknown,true);await assert.rejects(c.original.dispatch(input),e=>e===undefined);assert.equal(f.terminals(),1);await c.original.close();
});
test('R33 PUBLIC source loss and explicit undefined cancellation stop outstanding dispatch',async()=>{
 const f=fixture();await f.api.parent(entry);const c=await f.api.acquire(entry);const pending=c.original.dispatch(input);await c.framer.nextOutboundFrame();c.original.retire(undefined);await assert.rejects(pending,e=>e===undefined);assert.equal(await c.framer.nextOutboundFrame(),null);await c.original.join();await c.original.close();
});
test('R33 actual codec refuses tamper, extra keys, malformed canonical response and oversize',()=>{
 const binding=payload.originalIDEPrivateDeliveryBinding(selection),frame=payload.createOriginalIDEPrivateRequestFrame(binding,input),reply=payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw);
 assert.equal(payload.parseOriginalIDEPrivatePayload(reply).responseRaw,responseRaw);
 for(const raw of ['null',frame+' ',canonicalJSON({...JSON.parse(frame),extra:true}),canonicalJSON({...JSON.parse(frame),requestDigest:'0'.repeat(64)}),canonicalJSON({...JSON.parse(reply),responseRaw:responseRaw+' '})])assert.throws(()=>payload.parseOriginalIDEPrivatePayload(raw));
 assert.throws(()=>payload.parseOriginalIDEPrivateResponse('x'.repeat(65537),requestId));
});

test('R33 PUBLIC cleanup during factory await drains selection before Native close',async()=>{
 const f=fixture();await f.api.parent(entry);const acquire=f.api.acquire(entry);void acquire.catch(()=>{});await Promise.resolve();
 const c=f.api.cleanup(entry);assert(c);const close=c.close();await assert.rejects(acquire);await close;assert.equal(f.captures(),1);assert.equal(f.closed(),1);assert.equal(c.status().cleanupComplete,true);
});
