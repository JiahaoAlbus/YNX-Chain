import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {p256} from '@noble/curves/nist.js';
import {ProductSessionAuthority, createProductSessionRequest, parseProductSessionRequest, signProductSessionApproval, parseProductSessionApproval, signProductSessionChallenge, productSessionRequestDigest} from '../src/product-session-v2.js';
import {createProductSessionProofV2,verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';

const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const at=new Date('2026-10-02T00:00:00.000Z'), device=Buffer.alloc(32,7), accountSecret='1'.padStart(64,'0');
const base={productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Explicit finite Finance permission',nonce:'b'.repeat(43),state:'c'.repeat(43)};
function request(seconds){return createProductSessionRequest(registry,{...base,...(seconds===undefined?{}:{finiteServiceSeconds:seconds})},at)}
function approve(r){return signProductSessionApproval(registry,r,{accountSecret,scopes:r.scopes,expiresAt:r.expiresAt,...(r.serviceConsent?{approvedServiceConsent:r.serviceConsent}:{})},at)}
function complete(r,a=approve(r)){const server=new ProductSessionAuthority(registry),challenge=server.issueChallenge({request:r,approval:a,challenge:'d'.repeat(43)},at);return {server,challenge,session:server.complete({request:r,approval:a,completion:signProductSessionChallenge(challenge,device.toString('base64url'))},at)}}
function context(s){return {...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:s.scopes}}

test('explicit Finance consent signs service end while legacy and approval deadlines remain short',()=>{
  const legacy=complete(request()), finite=complete(request(7200));
  assert.equal(legacy.session.expiresAt,'2026-10-02T00:04:00.000Z');
  assert.equal(finite.session.expiresAt,'2026-10-02T02:00:00.000Z');
  assert.equal(finite.challenge.expiresAt,'2026-10-02T00:01:00.000Z');
  assert.equal(request(7200).expiresAt,'2026-10-02T00:05:00.000Z');
  assert.equal(finite.server.introspect(finite.session.sessionBinding,context(finite.session),new Date('2026-10-02T01:00:00.000Z')).active,true);
  assert.throws(()=>legacy.server.introspect(legacy.session.sessionBinding,context(legacy.session),new Date('2026-10-02T01:00:00.000Z')),e=>e.code==='SESSION_EXPIRED');
});
test('old signer input cannot implicitly approve finite service; exact displayed consent is mandatory',()=>{
  const r=request(7200);
  assert.throws(()=>signProductSessionApproval(registry,r,{accountSecret,scopes:r.scopes,expiresAt:r.expiresAt},at));
  assert.throws(()=>signProductSessionApproval(registry,r,{accountSecret,scopes:r.scopes,expiresAt:r.expiresAt,approvedServiceConsent:request(3600).serviceConsent},at));
  const a=approve(r),changed=structuredClone(a);changed.serviceConsent.durationSeconds=3600;changed.serviceConsent.expiresAt='2026-10-02T01:00:00.000Z';
  assert.throws(()=>parseProductSessionApproval(registry,r,changed,at));
  assert.notEqual(productSessionRequestDigest(registry,r,at),productSessionRequestDigest(registry,request(3600),at));
});
test('finite policy rejects unknown product, origin, scope, profile and out-of-bound duration',()=>{
  for(const seconds of [299,7201,Infinity,NaN])assert.throws(()=>request(seconds));
  for(const patch of [{origin:'https://exchange.ynxweb4.com'},{productId:'exchange'},{scopes:['finance:unknown']},{serviceConsent:{...request(7200).serviceConsent,profile:'unknown'}}])assert.throws(()=>parseProductSessionRequest(registry,{...request(7200),...patch},at));
});
test('service end does not extend approval-before or completion challenge',()=>{
  const r=request(7200),a=approve(r),server=new ProductSessionAuthority(registry);
  assert.throws(()=>server.issueChallenge({request:r,approval:a,challenge:'d'.repeat(43)},new Date('2026-10-02T00:05:00.000Z')));
  const challenge=server.issueChallenge({request:r,approval:a,challenge:'e'.repeat(43)},at);
  assert.throws(()=>server.complete({request:r,approval:a,completion:signProductSessionChallenge(challenge,device.toString('base64url'))},new Date('2026-10-02T00:01:00.000Z')),e=>e.code==='SESSION_EXPIRED');
});
test('finite session cold recovery retains signed consent, expiry and revocation',()=>{
  const {server,session}=complete(request(7200));
  const cold=new ProductSessionAuthority(registry,JSON.parse(JSON.stringify(server.snapshot())));
  assert.equal(cold.introspect(session.sessionBinding,context(session),new Date('2026-10-02T01:00:00.000Z')).session.serviceConsent.profile,'finance-private-finite-v1');
  assert.throws(()=>cold.introspect(session.sessionBinding,context(session),new Date('2026-10-02T02:00:00.000Z')),e=>e.code==='SESSION_EXPIRED');
  cold.revokeSession(session.sessionBinding);
  assert.throws(()=>new ProductSessionAuthority(registry,cold.snapshot()).introspect(session.sessionBinding,context(session),at));
  const bad=JSON.parse(JSON.stringify(server.snapshot()));bad.sessions[0].expiresAt='2026-10-02T03:00:00.000Z';
  assert.throws(()=>new ProductSessionAuthority(registry,bad));
});
test('finite service preserves short proof and account/device isolation on all registered platforms',()=>{
  for(const platform of ['web','android','ios','linux','macos','windows']){
    const r=createProductSessionRequest(registry,{...base,platform,finiteServiceSeconds:7200},at);
    const {server,session}=complete(r);
    const c=context(session);
    assert.equal(server.introspect(session.sessionBinding,c,at).active,true);
    assert.throws(()=>server.introspect(session.sessionBinding,{...c,account:'ynx1'+'q'.repeat(38)},at));
    assert.throws(()=>server.introspect(session.sessionBinding,{...c,deviceId:'z'.repeat(43)},at));
    const input={method:'GET',path:'/api/overview',bodyDigest:'0'.repeat(64),nonce:'f'.repeat(43),issuedAt:'2026-10-02T01:00:00.000Z',expiresAt:'2026-10-02T01:01:00.000Z'};
    const proof=createProductSessionProofV2(session,input,device.toString('base64url'));
    assert.equal(verifyProductSessionProofV2(proof,session,{method:input.method,path:input.path,bodyDigest:input.bodyDigest},new Date(input.issuedAt)).account,session.account);
    assert.throws(()=>createProductSessionProofV2(session,{...input,expiresAt:'2026-10-02T01:01:01.000Z'},device.toString('base64url')));
    assert.throws(()=>verifyProductSessionProofV2(proof,session,{method:input.method,path:input.path,bodyDigest:input.bodyDigest},new Date(input.expiresAt)));
  }
});
