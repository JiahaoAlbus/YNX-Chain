import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {createOriginalPrivateReferenceCarrier} from '../src/original-wallet-service-private-reference.js';
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
function fixture({readyFailure=false,captureFailure=false,terminalFailure=false,closeFailure=false,readProof=null,onResult=null}={}){
 let live=true,captures=0,terminals=0,reads=0,closed=0,currents=0,failAt=Infinity,monotonic=0;
 const parent={},owner={...selection,association:{account:'PUBLIC_ACCOUNT'}},events=[];
 const native={acquireOriginalIDEAdmissionParentDelivery:()=>parent,captureOriginalIDEPrivateClient(p){assert.equal(p,parent);captures++;if(captureFailure)throw undefined;return owner;},assertOriginalIDEPrivateClientReady(p){assert.equal(p,owner);if(readyFailure)throw false;},captureOriginalNativePrivateServiceBorrow:p=>p,assertOriginalNativePrivateServiceCurrent(p){assert.equal(p,owner);if(!live||++currents===failAt)throw false;},assertOriginalNativePrivateServiceAdmission(p){assert.equal(p,owner);events.push('admit');},captureOriginalIDEPrivateClientResult(p,...args){assert.equal(p,owner);assert.equal(args.length,4);assert.equal(args[3],responseRaw);events.push('result');onResult?.();},assertOriginalNativePrivateServiceTerminal(p){assert.equal(p,owner);terminals++;if(terminalFailure)throw undefined;},retireOriginalNativePrivateService(){events.push('retire');},joinOriginalNativePrivateService(){events.push('join');},closeOriginalNativePrivateService(){closed++;events.push('close');if(closeFailure)throw false;}};
 let source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replaceAll('export ','').replaceAll('import.meta.url','moduleURL').replaceAll("import('./original-ide-private-payload.js')","Promise.resolve(PUBLIC_PAYLOAD)").replaceAll("import('./canonical.js')","Promise.resolve({canonicalJSON:PUBLIC_CANONICAL})").replaceAll("import('./original-wallet-service-admission.js')","Promise.resolve({prepareOriginalWalletServiceAdmission:PUBLIC_PREPARE})");
 if(readProof)native.readOriginalNativePrivateServiceTerminalResult=(p,...args)=>{assert.equal(p,owner);assert.deepEqual(args,['handleReturn','effect',requestId]);reads++;return readProof();};
 const ctx=vm.createContext({types,performance:{now:()=>monotonic},URL,fileURLToPath,resolve,dirname,join,process:{argv:['PUBLIC','/PUBLIC/server.mjs']},moduleURL:new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url).href,createRequire:()=>()=>native,originalIDEServiceAdmissionStartupSelection:{PUBLIC:true},PUBLIC_PAYLOAD:payload,PUBLIC_CANONICAL:canonicalJSON,PUBLIC_PREPARE:()=>({assertCurrent(){if(!live)throw false;}}),setTimeout,clearTimeout});
 vm.runInContext(source+'\nthis.api={parent:acquireOriginalIDEAdmissionParentDelivery,acquire:acquireOriginalIDEPrivateServiceChannel,cleanup:getOriginalIDEPrivateServiceChannelCleanup};',ctx);
 return {api:ctx.api,events,invalidate(){live=false;},failNextCurrent(offset=1){failAt=currents+offset;},captures:()=>captures,terminals:()=>terminals,closed:()=>closed,reads:()=>reads,advance(ms){monotonic+=ms;}};
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

const r36Input=canonicalJSON(createOriginalPrivateReferenceCarrier('complete',requestId,canonicalJSON({reference:'ynxpsr1_'+'A'.repeat(43),request:{version:'2'},completion:{challenge:{PUBLIC:true},deviceSignature:'PUBLIC_SIGNATURE'}})));
const r36Hash=raw=>createHash('sha256').update(raw).digest('hex');
const r36Proof=()=>({responseRaw,responseDigest:r36Hash(responseRaw),requestDigest:r36Hash(r36Input),associationDigest:r36Hash(canonicalJSON({account:'PUBLIC_ACCOUNT'})),stateBeforeDigest:'1'.repeat(64),stateAfterDigest:'2'.repeat(64),stateFileDigest:'3'.repeat(64),enteredDigest:'4'.repeat(64),recordVersion:3,success:true});
async function r36Entered(options={}){
 const f=fixture({terminalFailure:true,...options});await f.api.parent(entry);const c=await f.api.acquire(entry),pending=c.original.dispatch(r36Input),frame=await c.framer.nextOutboundFrame();
 const reply=payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw);c.framer.acceptInboundFrame(reply);const result=await pending;
 assert.throws(()=>c.original.acknowledge('handleReturn','effect',requestId,payload.parseOriginalIDEPrivatePayload(reply).responseDigest),e=>e===undefined);return {f,c,result};
}
test('R36 PUBLIC R33 client reads existing original terminal DATA once without clearing UNKNOWN or ACK',async()=>{
 const {f,c,result}=await r36Entered({readProof:r36Proof});const data=c.original.readTerminalCustody('handleReturn','effect',requestId);
 assert.equal(data.response.body,result.body);assert.equal(data.proof.recordVersion,3);assert.equal(f.reads(),1);assert.equal(f.terminals(),1);
 const out=c.original.selectCurrentOutcome('handleReturn','effect',requestId);assert.equal(out.result,result);assert.equal(out.terminal,false);assert.equal(out.unknown,true);
 assert.throws(()=>c.original.readTerminalCustody('handleReturn','effect',requestId));assert.equal(f.reads(),1);await assert.rejects(c.original.dispatch(r36Input),e=>e===undefined);await c.original.close();
});
test('R36 PUBLIC read refuses forged original digest, retains original result and first failure',async()=>{
 const {f,c,result}=await r36Entered({readProof:()=>({...r36Proof(),requestDigest:'f'.repeat(64)})});assert.throws(()=>c.original.readTerminalCustody('handleReturn','effect',requestId),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});
 const out=c.original.selectCurrentOutcome('handleReturn','effect',requestId);assert.equal(out.result,result);assert.equal(out.unknown,true);assert.equal(f.reads(),1);assert.throws(()=>c.original.readTerminalCustody('handleReturn','effect',requestId));assert.equal(f.reads(),1);await assert.rejects(c.original.dispatch(r36Input),e=>e===undefined);await c.original.close();
});
test('R36 PUBLIC read without Native getter or wrong original operation remains unavailable',async()=>{
 const {f,c}=await r36Entered();assert.throws(()=>c.original.readTerminalCustody('handleReturn','effect',requestId),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_UNAVAILABLE'});assert.equal(f.reads(),0);assert.equal(c.original.status().unknown,true);await c.original.close();
});
test('R36 PUBLIC Source change after terminal DATA read rejects without a success or second read',async()=>{
 let f;const entered=await r36Entered({readProof:()=>{f.invalidate();return r36Proof();}});f=entered.f;const {c}=entered;
 assert.throws(()=>c.original.readTerminalCustody('handleReturn','effect',requestId),e=>e===false);assert.equal(f.reads(),1);assert.equal(c.original.status().unknown,true);await c.original.close();
});
test('R36 DATA proof rejects account/response mismatch, proxies and hidden/accessor fields',()=>{
 const association={account:'PUBLIC_ACCOUNT'},check=p=>payload.captureOriginalIDEPrivateTerminalCustodyData(p,r36Input,association,responseRaw);
 assert.throws(()=>check({...r36Proof(),associationDigest:'f'.repeat(64)}),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});
 assert.throws(()=>check({...r36Proof(),responseRaw:responseRaw+' '}),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});
 assert.throws(()=>check({...r36Proof(),success:false}),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});
 let touched=false;const accessor=r36Proof();Object.defineProperty(accessor,'responseRaw',{get(){touched=true;throw Error('must not execute');},enumerable:true});assert.throws(()=>check(accessor),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.equal(touched,false);
 const hidden=r36Proof();Object.defineProperty(hidden,'hidden',{value:true});assert.throws(()=>check(hidden),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});
 const proxy=new Proxy(r36Proof(),{get(){touched=true;throw Error('must not execute');},getPrototypeOf(){touched=true;throw Error('must not execute');}});assert.throws(()=>check(proxy),{code:'IDE_PRIVATE_TERMINAL_CUSTODY_INVALID'});assert.equal(touched,false);
});

test('R36 monotonic response deadline refuses overdue I/O before timer callback runs',async()=>{
 const f=fixture();await f.api.parent(entry);const c=await f.api.acquire(entry),pending=c.original.dispatch(input),frame=await c.framer.nextOutboundFrame();f.advance(16000);
 assert.throws(()=>c.framer.acceptInboundFrame(payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw)),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await assert.rejects(pending,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(f.events.includes('result'),false);assert.equal(c.original.status().unknown,true);await c.original.close();
});
test('R36 monotonic queued frame cannot enter transport after deadline with timer delayed',async()=>{
 const f=fixture();await f.api.parent(entry);const c=await f.api.acquire(entry),pending=c.original.dispatch(input);f.advance(16000);
 await assert.rejects(c.framer.nextOutboundFrame(),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await assert.rejects(pending,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(await c.framer.nextOutboundFrame(),null);await c.original.close();
});
test('R36 monotonic Native DATA capture crossing deadline cannot fulfill business result',async()=>{
 let f;f=fixture({onResult:()=>f.advance(16000)});await f.api.parent(entry);const c=await f.api.acquire(entry),pending=c.original.dispatch(input),frame=await c.framer.nextOutboundFrame();
 assert.throws(()=>c.framer.acceptInboundFrame(payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw)),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await assert.rejects(pending,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(f.events.filter(e=>e==='result').length,1);assert.equal(c.original.selectCurrentOutcome('restore','time',requestId).unknown,true);await c.original.close();
});
test('R36 expired original completion may read DATA while business remains UNKNOWN and unrepeatable',async()=>{
 const f=fixture({readProof:r36Proof});await f.api.parent(entry);const c=await f.api.acquire(entry),pending=c.original.dispatch(r36Input),frame=await c.framer.nextOutboundFrame();f.advance(16000);
 assert.throws(()=>c.framer.acceptInboundFrame(payload.createOriginalIDEPrivateResponseFrame(frame,responseRaw)),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await assert.rejects(pending,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});
 const data=c.original.readTerminalCustody('handleReturn','effect',requestId);assert.equal(data.response.body,JSON.parse(responseRaw).body);assert.equal(f.terminals(),0);assert.equal(f.reads(),1);
 assert.equal(c.original.selectCurrentOutcome('handleReturn','effect',requestId).unknown,true);await assert.rejects(c.original.dispatch(r36Input),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});await c.original.close();
});
