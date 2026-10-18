import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {RecoverableProductSessionClient} from '../src/product-session-recovery.js';
import {ProductSessionAuthority,signProductSessionApproval} from '../src/product-session-v2.js';
import {createProductSessionReturnURL} from '../src/product-session-router.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),secret='1'.padStart(64,'0'),device=Buffer.alloc(32,7);
const at=new Date('2026-10-02T00:00:00.000Z');
function fixture(seconds,previous){
 let now=at,token=0;const values=previous??new Map(),server=new ProductSessionAuthority(registry);
 const storage={securityLevel:'os-protected',get:async k=>values.get(k)??null,set:async(k,v)=>{values.set(k,v)},remove:async k=>{values.delete(k)}};
 const gateway={currentTime:async()=>now,walletInstalled:async()=>false,schemeRegistered:async()=>false,challenge:async r=>server.issueChallenge({request:r.request,approval:r.approval,challenge:'c'.repeat(43)},now),complete:async r=>server.complete({request:r.request,approval:r.approval,completion:r.completion},now),introspect:async({sessionBinding})=>{const s=server.snapshot().sessions.find(v=>v.sessionBinding===sessionBinding);return server.introspect(sessionBinding,{...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:s.scopes},now)},revoke:async({sessionBinding})=>({revoked:server.revokeSession(sessionBinding)})};
 const config={registry,productId:'finance',platform:'android',storage,gateway,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),secret:device.toString('base64url'),scopes:['finance.profile.write'],purpose:'Explicit finite Finance access'},tokenFactory:()=>String(++token).padStart(43,'a'),clock:()=>now,...(seconds===undefined?{}:{finiteServiceSeconds:seconds})};
 const client=new RecoverableProductSessionClient(config);const returned=r=>createProductSessionReturnURL(registry,r,{result:'approved',approval:signProductSessionApproval(registry,r,{accountSecret:secret,scopes:r.scopes,expiresAt:r.expiresAt,...(r.serviceConsent?{approvedServiceConsent:r.serviceConsent}:{})},now)},now);
 return {client,config,values,server,returned,setNow:value=>{now=value}};
}
test('finite client explicit request produces signed two-hour service; cold restore preserves old and finite deadlines',async()=>{
 for(const seconds of [undefined,7200]){const f=fixture(seconds),pending=await f.client.beginExplicit();assert.equal(pending.status,'connecting');assert.equal(pending.request.expiresAt,'2026-10-02T00:05:00.000Z');const connected=await f.client.handleReturn(f.returned(pending.request));assert.equal(connected.status,'connected');const expected=seconds===undefined?'2026-10-02T00:04:00.000Z':'2026-10-02T02:00:00.000Z';assert.equal(connected.session.expiresAt,expected);
 // Upgrading client options never upgrades a previously signed legacy grant.
 const cold=new RecoverableProductSessionClient({...f.config,finiteServiceSeconds:7200});assert.equal((await cold.restore()).session.expiresAt,expected);
 f.setNow(new Date('2026-10-02T00:10:00.000Z'));assert.equal((await cold.restore()).status,seconds===undefined?'retry-required':'connected');}
});
test('finite client cannot silently begin, widen product, duration or request expiry',async()=>{
 const f=fixture(7200);assert.equal((await f.client.begin({walletInstalled:false,schemeRegistered:false},true)).status,'retry-required');assert.equal(f.values.size,0);
 for(const n of [undefined,299,7201,NaN])if(n!==undefined)assert.throws(()=>fixture(n),e=>e.code==='INVALID_SERVICE_CONSENT_TIME');
 const other=new RecoverableProductSessionClient({...f.config,productId:'pay'});await assert.rejects(other.beginExplicit());assert.equal(f.values.size,0);
 const pending=await f.client.beginExplicit(),url=f.returned(pending.request);f.setNow(new Date(pending.request.expiresAt));assert.equal((await f.client.handleReturn(url)).status,'retry-required');assert.equal(f.server.snapshot().sessions.length,0);
});
test('logout/cancelled explicit finite request never completes a late approval',async()=>{
 const f=fixture(7200),pending=await f.client.beginExplicit(),url=f.returned(pending.request);await f.client.disconnect();const result=await f.client.handleReturn(url);assert.notEqual(result.status,'connected');assert.equal(f.server.snapshot().sessions.length,0);
});
test('account selection cannot discard an already-entered device signer before protected completion exists',async()=>{
 const f=fixture(7200);let entered,release,calls=0;const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const {secret:ignored,...deviceConfig}=f.config.device;
 const client=new RecoverableProductSessionClient({...f.config,device:{...deviceConfig,async sign(input){if(input.purpose==='challenge'){calls++;entered();await gate;}return Buffer.from(p256.sign(Buffer.from(input.payload,'base64url'),device,{format:'der'})).toString('base64url');}}});
 const pending=await client.beginExplicit(),operation=client.handleReturn(f.returned(pending.request));
 try{
  await ready;assert.equal(f.values.has(client.storageKey+':completion'),false);const before=new Map(f.values),next=await client.beginExplicit();
  assert.equal(next.status,'retry-required');assert.equal(next.outcomeUnknown,true);assert.deepEqual(f.values,before);assert.equal(calls,1);
 }finally{release();await operation;}
 assert.equal(f.server.snapshot().sessions.length,0);assert.equal((await client.beginExplicit()).status,'retry-required');assert.equal(calls,1);
});
test('confirmed connection cleanup still permits a new explicit account-selection request',async()=>{
 const f=fixture(7200),pending=await f.client.beginExplicit();assert.equal((await f.client.handleReturn(f.returned(pending.request))).status,'connected');
 assert.equal(f.values.has(f.client.storageKey+':completion'),false);const next=await f.client.beginExplicit();assert.equal(next.status,'connecting');assert.notEqual(next.request.state,pending.request.state);assert.equal(f.server.snapshot().sessions.length,1);
});
