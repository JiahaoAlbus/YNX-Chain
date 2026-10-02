import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {RecoverableProductSessionClient} from '../src/product-session-recovery.js';
import {ProductSessionAuthority,signProductSessionApproval} from '../src/product-session-v2.js';
import {createProductSessionReturnURL} from '../src/product-session-router.js';
import {verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {httpBodyDigest} from '../src/session-proof.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),secret='1'.padStart(64,'0'),device=Buffer.alloc(32,7);
const at=new Date('2026-10-02T00:00:00.000Z'),scopes=['social.contacts','social.feed','social.messaging','social.profile'];
async function fixture(options={}){
 const granted=options.scopes??scopes;
 let now=at,token=0;const values=new Map(),server=new ProductSessionAuthority(registry);
 const storage={securityLevel:'os-protected',get:async k=>values.get(k)??null,set:async(k,v)=>values.set(k,v),remove:async k=>values.delete(k)};
 const gateway={currentTime:async()=>now,walletInstalled:async()=>false,schemeRegistered:async()=>false,challenge:async r=>server.issueChallenge({request:r.request,approval:r.approval,challenge:'c'.repeat(43)},now),complete:async r=>server.complete({request:r.request,approval:r.approval,completion:r.completion},now),introspect:async({sessionBinding})=>{const s=server.snapshot().sessions.find(v=>v.sessionBinding===sessionBinding);return server.introspect(sessionBinding,{...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:s.scopes},now)},revoke:async({sessionBinding})=>({revoked:server.revokeSession(sessionBinding)})};
 const config={registry,productId:'social',platform:'web',storage,gateway,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),...(options.sign?{sign:options.sign}:{secret:device.toString('base64url')}),scopes:granted,purpose:'Social audience'},tokenFactory:()=>String(++token).padStart(43,'a'),clock:()=>now};
 const client=new RecoverableProductSessionClient(config);const pending=await client.beginExplicit();const url=createProductSessionReturnURL(registry,pending.request,{result:'approved',approval:signProductSessionApproval(registry,pending.request,{accountSecret:secret,scopes:granted,expiresAt:pending.request.expiresAt},now)},now);await client.handleReturn(url);
 return {client,storage,values,config,setNow:n=>now=n};
}
test('two distinct proofs bind immutable Social action bytes and live granted scopes; Go fixture uses actual JS signature',async()=>{
 const f=await fixture(),body='{"kind":"contacts","txn":"qa-transaction"}',path='/social/v3/matrix/audience/resolve';
 const result=await f.client.createSocialAudienceProof({path,body}),session=f.client.current.session;
 assert.equal(result.body,body);assert.notEqual(result.proof.nonce,result.introspection.proof.nonce);
 verifyProductSessionProofV2(result.proof,session,{method:'POST',path,bodyDigest:httpBodyDigest(body)},at);
 verifyProductSessionProofV2(result.introspection.proof,session,{method:'POST',path:'/v2/product-sessions/introspect',bodyDigest:httpBodyDigest(result.introspection.body)},at);
 assert.throws(()=>verifyProductSessionProofV2(result.proof,session,{method:'POST',path,bodyDigest:httpBodyDigest('{"kind":"private"}')},at));
 if(process.env.YNX_ACTION_FIXTURE_OUT)writeFileSync(process.env.YNX_ACTION_FIXTURE_OUT,JSON.stringify({session,header:result.proofHeader,body,path,at:at.toISOString()}));
});
test('unknown paths, noncanonical bytes, missing feed scope and expired session cannot sign a business body',async()=>{
 const f=await fixture();for(const input of [{path:'/social/v3/feed',body:'{}'},{path:'/social/v3/matrix/audience/resolve',body:'{ "kind": "contacts" }'},{path:'/social/v3/matrix/audience/resolve',body:'[]'}])await assert.rejects(f.client.createSocialAudienceProof(input));
 f.setNow(new Date(f.client.current.session.expiresAt));await assert.rejects(f.client.createSocialAudienceProof({path:'/social/v3/matrix/audience/resolve',body:'{}'}),e=>e.code==='SESSION_EXPIRED');
});
test('sign-out while authority time awaits prevents both proof release and late business use',async()=>{
 const f=await fixture();let release,entered;const gate=new Promise(r=>entered=r);f.config.gateway.currentTime=()=>{entered();return new Promise(r=>release=r)};
 const operation=f.client.createSocialAudienceProof({path:'/social/v3/matrix/audience/authorize',body:'{"txn":"qa"}'});await gate;f.config.gateway.currentTime=async()=>at;
 const disconnected=f.client.disconnect();release(at);await assert.rejects(operation);await disconnected;
 await assert.rejects(f.client.createSocialAudienceProof({path:'/social/v3/matrix/audience/authorize',body:'{"txn":"qa"}'}));
});

test('a legacy messaging approval cannot sign feed audience actions',async()=>{
 const f=await fixture({scopes:['social.contacts','social.messaging','social.profile']});
 await assert.rejects(f.client.createSocialAudienceProof({path:'/social/v3/matrix/audience/resolve',body:'{}'}),e=>e.code==='SCOPE_WIDENING');
});
test('stored grant change after action signing blocks delivery of both proofs',async()=>{
 let signing,release;const entered=new Promise(r=>signing=r);
 const f=await fixture({sign:async input=>{const bytes=Buffer.from(input.payload,'base64url');if(bytes.toString().includes('/social/v3/matrix/audience/')){signing();await new Promise(r=>release=r);}return Buffer.from(p256.sign(bytes,device,{format:'der'})).toString('base64url');}});
 const pending=f.client.createSocialAudienceProof({path:'/social/v3/matrix/audience/authorize',body:'{"txn":"qa"}'});await entered;
 f.values.delete(f.client.storageKey);release();await assert.rejects(pending,e=>e.code==='SESSION_INACTIVE');
});
