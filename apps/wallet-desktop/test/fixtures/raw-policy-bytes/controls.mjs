import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{captureAuthorizationHTTPOriginal,encodeObservedPolicyOriginal}from'./src/operator-policy-original.mjs';
import{openNormalOperatorSource,NORMAL_OPERATOR}from'./src/operator-query.mjs';
import{inspectOperatorProjection}from'./src/operator-projection.mjs';import{encodeOperatorPolicyPacket}from'./src/operator-packet.mjs';
import{TransactionPolicyResourceKernel,isOriginalWalletTransactionPolicy}from'./src/transaction-resource.mjs';
const raw=JSON.parse(readFileSync(new URL('./fixture.json',import.meta.url))).accountBefore,now=Date.parse('2026-10-25T15:00:00.000Z');
const request={networkId:raw.networkId,nativeChainId:'6423',owner:raw.owner,operation:'typed-action',at:new Date(now).toISOString()};
const policy=JSON.stringify(raw.policy).replace('{','{ '),response=JSON.stringify({...raw,policy:null}).replace('"policy":null','"policy":'+policy)+'\n';
const source=read=>({readOriginal:read,recheck:read,retire(){},async join(){},async close(){}});
const packet=(text=policy)=>encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(raw,raw.owner),now,now+30000,text);
function fixture(body=response){const state={paths:[],body};globalThis[Symbol.for('auth.rawpolicy.fixture')]=state;return state;}
test('new raw span preserves exact inner bytes, escaped braces, unicode and no wrapper LF; duplicate keys fail closed',()=>{
 const text=' {"note":"\\\"policy\\\": {not a span}","policy":{ "key":"☃\\\"}\\\\","list":[1,{"x":true}]}}\n';
 const captured=captureAuthorizationHTTPOriginal(text);assert.equal(captured.policyText,'{ "key":"☃\\\"}\\\\","list":[1,{"x":true}]}');assert.equal(captured.body.policy.key,'☃"}\\');
 for(const wrong of ['{"policy":{},"policy":{}}','{"policy":{},"po\\u006cicy":{}}','{"policy":{"x":1,"x":1}}','{"policy":{}} false','[]'])assert.throws(()=>captureAuthorizationHTTPOriginal(wrong),{code:'AUTH_POLICY_ORIGINAL_JSON'});
 assert.equal(captureAuthorizationHTTPOriginal('{"enabled":false,"policy":null}\n').policyText,null);
});
test('actual normal HTTP-read pipeline captures ONE account response nested policy without another request',async()=>{
 const state=fixture(),s=openNormalOperatorSource('transaction',()=>now);const encoded=await s.readOriginal(request),v=JSON.parse(encoded);
 assert.equal(v.version,'YNX-WALLET-TRANSACTION-POLICY/v3');assert.deepEqual(Buffer.from(v.originalPolicy.utf8,'base64url'),Buffer.from(policy));assert.equal(v.originalPolicy.sha256,createHash('sha256').update(policy).digest('hex'));
 assert.deepEqual(state.paths,['/status','/blocks/0','/accounts/'+raw.owner+'/authorization','/status']);
 assert.equal(v.originalPolicy.executionHeight,raw.executionHeight);assert.equal(v.originalPolicy.ledgerNonce,raw.ledgerNonce);assert.equal(v.originalPolicy.activeRevision,'1');
 s.retire();await s.join();await s.close();
});
test('actual normal source/resource getter returns detached exact bytes with pre/post current and immutable original H/nonce/revision',async()=>{
 fixture();const resource=new TransactionPolicyResourceKernel(request,openNormalOperatorSource('transaction',()=>now),()=>now);await resource.initialize();
 const original=resource.readOriginal();assert.equal(isOriginalWalletTransactionPolicy(resource),false);assert.equal(original.authorization.executionHeight,raw.executionHeight);
 const first=resource.copyOriginalPolicyBytes();assert.deepEqual(Buffer.from(first),Buffer.from(policy));first.fill(0);assert.deepEqual(Buffer.from(resource.copyOriginalPolicyBytes()),Buffer.from(policy));
 assert.equal(original.originalPolicy.executionHeight,original.authorization.executionHeight);assert.equal(original.originalPolicy.ledgerNonce,original.authorization.ledgerNonce);assert.equal(original.originalPolicy.activeRevision,original.authorization.activeRevision);
 await resource.recheck();assert.deepEqual(Buffer.from(resource.copyOriginalPolicyBytes()),Buffer.from(policy));await resource.close();
});
test('absent raw policy never reconstructed from a legacy/v2 flat view, while read-only product view stays usable',async()=>{
 const resource=new TransactionPolicyResourceKernel(request,source(async()=>packet(null)),()=>now);await resource.initialize();assert.equal(resource.readOriginal().authorization.enabled,true);
 assert.throws(()=>resource.copyOriginalPolicyBytes(),{code:'AUTH_TX_POLICY_ORIGINAL_POLICY_REQUIRED'});assert.equal(resource.readOriginal().authorization.owner,raw.owner);assert.equal(resource.outcome().unknown,false);await resource.close();
});
test('raw payload H/nonce/revision/hash/base64 tampering is refused, preserving failed raw and first cause',async()=>{
 for(const [key,value]of [['executionHeight','4'],['ledgerNonce','2'],['activeRevision','2'],['sha256','0'.repeat(64)],['utf8','AA=']]){
  const v=JSON.parse(packet());v.originalPolicy[key]=value;const encoded=JSON.stringify(v),r=new TransactionPolicyResourceKernel(request,source(async()=>encoded),()=>now);
  await assert.rejects(r.initialize(),{code:'AUTH_POLICY_ORIGINAL_JSON'});assert.equal(r.outcome().capturedRaw,encoded);assert.equal(r.outcome().unknown,true);await r.close();
 }
});
test('byte-only policy drift cannot hide behind identical flattened authorization during recheck',async()=>{
 const first=packet(),next=packet(policy.replace('{ ','{  '));let n=0;const r=new TransactionPolicyResourceKernel(request,source(async()=>++n===1?first:next),()=>now);await r.initialize();
 await assert.rejects(r.recheck(),{code:'AUTH_TX_POLICY_ORIGINAL_CHANGED'});assert.equal(r.outcome().capturedRaw,first);assert.equal(r.outcome().lastRecheckRaw,next);assert.equal(r.outcome().unknown,true);await r.close();
});
test('original policy getter fences expiry AFTER public copy and retains UNKNOWN instead of releasing stale bytes',async()=>{
 let clock=now,calls=0,advanceAt=Infinity;const r=new TransactionPolicyResourceKernel(request,source(async()=>packet()),()=>{calls++;if(calls===advanceAt)clock=now+30000;return clock;});await r.initialize();advanceAt=calls+2;
 assert.throws(()=>r.copyOriginalPolicyBytes(),{code:'AUTH_TX_POLICY_EXPIRED'});assert.equal(r.outcome().unknown,true);await r.close();
});
test('raw original recheck will not silently advance the reviewed execution H',async()=>{
 const first=packet(),v=JSON.parse(first);v.authorization.executionHeight='4';v.observation.committedHeight='3';v.originalPolicy.executionHeight='4';let n=0;
 const r=new TransactionPolicyResourceKernel(request,source(async()=>++n===1?first:JSON.stringify(v)),()=>now);await r.initialize();await assert.rejects(r.recheck());assert.equal(r.outcome().unknown,true);await r.close();
});
test('generic raw scanner bytes are not a Source brand or a policy authority and old flat provider emits no invented raw field',()=>{
 const c=captureAuthorizationHTTPOriginal(response);assert.deepEqual(Buffer.from(c.policyText),Buffer.from(policy));assert.notEqual(c.policyText,JSON.stringify(c.body.policy));
 const v=JSON.parse(packet(null));assert.equal(v.version,'YNX-WALLET-TRANSACTION-POLICY/v2');assert.equal(Object.hasOwn(v,'originalPolicy'),false);
 assert.equal(encodeObservedPolicyOriginal(null,{}),null);assert.equal(NORMAL_OPERATOR.origin,'https://rpc.ynxweb4.com');
});
