import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Execute exact SDK source bodies in this JS realm with PUBLIC lexical imports.
// Never load Noble, Native, real platform bridges, a signer or any service.
const read = n => readFileSync(new URL('../src/'+n, import.meta.url),'utf8');
const strip = s => s.replace(/^import .*;\n/gm, '');
const canonical = strip(read('canonical.js'));
const privateBody = strip(read('original-wallet-service-private-client.js'));
const core = canonical + '\nconst PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION=2;\n' + privateBody;
const mod = await import('data:text/javascript;base64,'+Buffer.from(core).toString('base64'));
const {OriginalWalletServicePrivateClient: Client,canonicalJSON: json} = mod;
const id = n => 'req_PUBLIC_request_'+n;
const response = (requestId,result={},status=200) => ({status,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-request-id':requestId},body:json(status<300?{ok:true,requestId,result,schemaVersion:2}:{ok:false,requestId,error:{code:'ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED',message:'PUBLIC refusal'},schemaVersion:2})});
const bridge = dispatch => {globalThis.window={ynxDesktopWallet:{originalServiceDispatch:dispatch}};return new Client({timeoutMs:1000});};
const bodies={beginYNX:{request:{PUBLIC:true},approval:{PUBLIC:true}},handleReturn:{request:{PUBLIC:true},approval:{PUBLIC:true},completion:{PUBLIC:true}},restore:{requiredScopes:['PUBLIC']},disconnect:{}};

test('PUBLIC all four explicit operations and time/effect carry original canonical strings once',async()=>{
 const seen=[];const client=bridge(async raw=>{const input=JSON.parse(raw);seen.push(raw);return response(input.requestId,{PUBLIC:true});});
 for(const op of Object.keys(bodies)){
  await client.request(op,'time',id(op+'_time'),null,null);
  const body=json(bodies[op]);await client.request(op,'effect',id(op+'_effect'),body,['restore','disconnect'].includes(op)?'PUBLIC_PROOF':null);
  assert.equal(JSON.parse(seen.at(-1)).body,body);
 }
 assert.equal(seen.length,8);assert.equal(client.status().unknown,false);assert(seen.every(raw=>json(JSON.parse(raw))===raw));
 await assert.rejects(client.request('disconnect','effect',id('disconnect_effect'),json({}),'PUBLIC_PROOF'),{code:'ORIGINAL_PRIVATE_ALREADY_ENTERED'});
});
test('PUBLIC malformed inputs are rejected before entry and do not grant any fallback',async()=>{
 let calls=0;const client=bridge(async()=>{calls++;});
 for(const args of [['wrong','time',id('a'),null,null],['restore','time',id('b'),'{}',null],['disconnect','effect',id('c'),'{}',null],['beginYNX','effect',id('d'),'{"request":{}, "approval":{}}',null]])await assert.rejects(client.request(...args));
 assert.equal(calls,0);assert.equal(client.status().retained,0);
});
test('PUBLIC incomplete/fullresponse tampering causes retained UNKNOWN and blocks new IDs',async()=>{
 for(const mutation of [r=>({result:r}),r=>({...r,body:r.body+' '}),r=>({...r,headers:{...r.headers,'x-request-id':'req_OTHER_public_request'}}),r=>({...r,body:r.body.replace('"schemaVersion":2','"schemaVersion":1')}),r=>({...r,status:201.5})]){
  let calls=0;const client=bridge(async raw=>{calls++;return mutation(response(JSON.parse(raw).requestId));});
  await assert.rejects(client.request('restore','effect',id('bad'),json(bodies.restore),'PUBLIC_PROOF'),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});
  await assert.rejects(client.request('restore','effect',id('new'),json(bodies.restore),'PUBLIC_PROOF'),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(calls,1);
 }
});
test('PUBLIC abort after entry preserves late original result; recreated factory transport cannot reset UNKNOWN',async()=>{
 let resolve;let entered;const started=new Promise(r=>entered=r);
 const client=bridge(raw=>{entered();return new Promise(r=>resolve=()=>r(response(JSON.parse(raw).requestId)));});
 const controller=new AbortController();const operation=client.request('disconnect','effect',id('late'),'{}','PUBLIC_PROOF',controller.signal);
 await started;controller.abort();await assert.rejects(operation,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});resolve();await new Promise(r=>setImmediate(r));
 const retained=client.selectOutcome('disconnect','effect',id('late'));assert.equal(retained.unknown,true);assert.equal(retained.response.status,200);
 const again=new Client({timeoutMs:1000});await assert.rejects(again.request('disconnect','effect',id('renew'),'{}','PUBLIC_PROOF'),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});
});
test('PUBLIC bridge replacement fences success and pre-aborted call does not enter',async()=>{
 const client=bridge(async raw=>{globalThis.window={ynxDesktopWallet:{originalServiceDispatch:()=>{}}};return response(JSON.parse(raw).requestId);});
 await assert.rejects(client.request('restore','time',id('swap'),null,null),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});
 let count=0;const fresh=bridge(()=>{count++;});const c=new AbortController();c.abort();await assert.rejects(fresh.request('restore','time',id('abort'),null,null,c.signal),{code:'NETWORK_UNAVAILABLE'});assert.equal(count,0);
});
test('PUBLIC full HTTP refusal remains full refusal, never a successful result',async()=>{
 const client=bridge(async raw=>response(JSON.parse(raw).requestId,{},503));const r=await client.request('restore','time',id('refusal'),null,null);assert.equal(r.status,503);assert.equal(JSON.parse(r.body).ok,false);
});
// The original gateway and private class share the actual WeakMap/parser body.
const gatewayBody=strip(read('product-session-gateway-client.js'));
const gatewayModule=await import('data:text/javascript;base64,'+Buffer.from(canonical+'\nconst PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION=2;\nimport { OriginalWalletServicePrivateClient } from '+JSON.stringify('data:text/javascript;base64,'+Buffer.from(core).toString('base64'))+';\nconst parseProductSessionProofV2=x=>x; const encodeBase64url=x=>Buffer.from(x).toString("base64url"); const decodeBase64url=x=>new Uint8Array(Buffer.from(x,"base64url"));\n'+gatewayBody).toString('base64'));
test('PUBLIC same-copy adapter validates all routes/authority time/response; refusal propagates',async()=>{
 const seen=[];globalThis.window={ynxDesktopWallet:{originalServiceDispatch:async raw=>{const x=JSON.parse(raw);seen.push(x);return response(x.requestId,x.phase==='time'?{serverTime:'2026-10-14T00:00:00.000Z'}:{PUBLIC:true});}}};
 const gateway=new gatewayModule.ProductSessionGatewayPrivateAdapter({walletInstalled:()=>true,schemeRegistered:()=>true,timeoutMs:1000});
 assert.equal(gatewayModule.productSessionGatewayAuthority(gateway),'https://wallet-auth.ynxweb4.com');
 assert.throws(()=>gatewayModule.productSessionGatewayAuthority({endpoint:'https://wallet-auth.ynxweb4.com'}));
 for(const operation of Object.keys(bodies))assert.equal((await gateway.currentTimeForOperation(operation,{requestId:id(operation+'_clock')})).toISOString(),'2026-10-14T00:00:00.000Z');
 await gateway.challenge({requestId:id('challenge'),request:{},approval:{}});
 await gateway.complete({requestId:id('complete'),request:{},approval:{},completion:{}});
 await gateway.introspect({requestId:id('introspect'),sessionBinding:'PUBLIC',requiredScopes:['PUBLIC'],proof:{sessionBinding:'PUBLIC'}});
 await gateway.revoke({requestId:id('revoke'),sessionBinding:'PUBLIC',proof:{sessionBinding:'PUBLIC'}});
 assert.deepEqual(seen.map(x=>x.operation),['beginYNX','handleReturn','restore','disconnect','beginYNX','handleReturn','restore','disconnect']);
 await assert.rejects(gateway.currentTime({requestId:id('ambiguous')}),{code:'CLOCK_UNAVAILABLE'});
 globalThis.window={ynxDesktopWallet:{originalServiceDispatch:async raw=>response(JSON.parse(raw).requestId,{},503)}};
 const refusal=new gatewayModule.ProductSessionGatewayPrivateAdapter({walletInstalled:()=>true,schemeRegistered:()=>true,timeoutMs:1000});
 await assert.rejects(refusal.currentTimeForOperation('restore',{requestId:id('not_supplied')}),{code:'ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED'});
});

test('PUBLIC concurrent interrupted request fences another late success',async()=>{
 let late,entered;const started=new Promise(r=>entered=r);let index=0;
 const client=bridge(raw=>{index++;const rid=JSON.parse(raw).requestId;if(index===1){entered();return new Promise(r=>late=()=>r(response(rid)));}throw Error('PUBLIC transport loss');});
 const first=client.request('restore','effect',id('concurrent_first'),json(bodies.restore),'PUBLIC_PROOF');await started;
 await assert.rejects(client.request('restore','effect',id('concurrent_second'),json(bodies.restore),'PUBLIC_PROOF'),{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});
 late();await assert.rejects(first,{code:'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN'});assert.equal(client.selectOutcome('restore','effect',id('concurrent_first')).unknown,true);
});
