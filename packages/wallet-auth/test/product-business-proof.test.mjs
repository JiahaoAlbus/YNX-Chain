import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {RecoverableProductSessionClient} from '../src/product-session-recovery.js';
import {ProductSessionAuthority,signProductSessionApproval} from '../src/product-session-v2.js';
import {createProductSessionReturnURL} from '../src/product-session-router.js';
import {createProductSessionProofV2,verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {httpBodyDigest} from '../src/session-proof.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url))),secret='1'.padStart(64,'0'),device=Buffer.alloc(32,7);
const at=new Date('2026-10-02T00:00:00.000Z'),scopes=['mail:account','mail:recover'];
async function fixture(options={}){
 const productId=options.productId??'mail', granted=options.scopes??registry.products.find(p=>p.productId===productId).scopes;
 let now=at,token=0;const values=new Map(),server=new ProductSessionAuthority(registry);
 const storage={securityLevel:'os-protected',get:async k=>values.get(k)??null,set:async(k,v)=>values.set(k,v),remove:async k=>values.delete(k)};
 const gateway={currentTime:async()=>now,walletInstalled:async()=>false,schemeRegistered:async()=>false,challenge:async r=>server.issueChallenge({request:r.request,approval:r.approval,challenge:'c'.repeat(43)},now),complete:async r=>server.complete({request:r.request,approval:r.approval,completion:r.completion},now),introspect:async({sessionBinding})=>{const s=server.snapshot().sessions.find(v=>v.sessionBinding===sessionBinding);return server.introspect(sessionBinding,{...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,s[k]])),requiredScopes:s.scopes},now)},revoke:async({sessionBinding})=>({revoked:server.revokeSession(sessionBinding)})};
 const config={registry,productId,platform:options.platform??'web',storage,gateway,device:{id:'a'.repeat(43),key:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),...(options.sign?{sign:options.sign}:{secret:device.toString('base64url')}),scopes:granted,purpose:'Mail business QA'},tokenFactory:()=>String(++token).padStart(43,'a'),clock:()=>now};
 const client=new RecoverableProductSessionClient(config);const pending=await client.beginExplicit();const url=createProductSessionReturnURL(registry,pending.request,{result:'approved',approval:signProductSessionApproval(registry,pending.request,{accountSecret:secret,scopes:granted,expiresAt:pending.request.expiresAt},now)},now);await client.handleReturn(url);
 return {client,storage,values,config,setNow:n=>now=n};
}

test('actual Mail approval signs separate canonical business and introspection proofs with exact method/body',async()=>{
 const f=await fixture(),body='{"subject":"中文😀","txn":"qa-mail-draft"}',path='/v1/drafts';
 const r=await f.client.createBusinessProof({method:'POST',path,body,requiredScopes:['mail:account']});
 assert.equal(r.body,body);assert.notEqual(r.proof.nonce,r.introspection.proof.nonce);
 verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'POST',path,bodyDigest:httpBodyDigest(body)},at);
 assert.throws(()=>verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'PUT',path,bodyDigest:httpBodyDigest(body)},at));
 assert.throws(()=>verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'POST',path,bodyDigest:httpBodyDigest('{}')},at));
 if(process.env.YNX_BUSINESS_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,body,path,at:at.toISOString()}));
});
test('GET signs real empty body, not JSON null or a body forbidden by fetch',async()=>{
 const f=await fixture(),path='/v1/messages';const r=await f.client.createBusinessProof({method:'GET',path,body:'',requiredScopes:['mail:account']});assert.equal(r.body,'');if(process.env.YNX_BUSINESS_GET_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_GET_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,body:'',path,method:'GET',at:at.toISOString()}));verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'GET',path,bodyDigest:httpBodyDigest('')},at);await assert.rejects(f.client.createBusinessProof({method:'GET',path,body:'{}',requiredScopes:['mail:account']}));
});
test('scope substitution and unsafe noncanonical routes fail closed',async()=>{
 const f=await fixture(),base={method:'POST',path:'/v1/drafts',body:'{}',requiredScopes:['mail:account']};
 for(const change of [{requiredScopes:['files:write']},{path:'/v2/product-sessions/revoke'},{path:'/v1/drafts?nonce=1'},{path:'/v1/../drafts'},{path:'/v1/./drafts'},{path:'/v1/bad path'}])await assert.rejects(f.client.createBusinessProof({...base,...change}));
});
test('native Mail uses its distinct original Android tuple, never the web callback',async()=>{
 const f=await fixture({platform:'android'});const r=await f.client.createBusinessProof({method:'DELETE',path:'/v1/drafts/qa',body:'{}',requiredScopes:['mail:account']});assert.equal(f.client.current.session.platform,'android');assert.equal(f.client.current.session.callback,'ynxmail://wallet-auth/callback');if(process.env.YNX_BUSINESS_NATIVE_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_NATIVE_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,body:'{}',path:'/v1/drafts/qa',method:'DELETE',at:at.toISOString()}));verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'DELETE',path:'/v1/drafts/qa',bodyDigest:httpBodyDigest('{}')},at);
});
test('sign-out during business signing prevents both proof delivery and late use',async()=>{
 let entered,release;const gate=new Promise(r=>entered=r);const f=await fixture({sign:async input=>{const bytes=Buffer.from(input.payload,'base64url');if(bytes.toString().includes('/v1/drafts')){entered();await new Promise(r=>release=r)}return Buffer.from(p256.sign(bytes,device,{format:'der'})).toString('base64url')}});const operation=f.client.createBusinessProof({method:'POST',path:'/v1/drafts',body:'{}',requiredScopes:['mail:account']});await gate;const disconnected=f.client.disconnect();release();await assert.rejects(operation);await disconnected;
});
test('original attachment JSON larger than 1MiB is signed without truncation or changing bytes',async()=>{
 const f=await fixture(),body=JSON.stringify({attachment:'a'.repeat(1048577)}),r=await f.client.createBusinessProof({method:'POST',path:'/v1/drafts',body,requiredScopes:['mail:account']});assert.equal(r.body,body);verifyProductSessionProofV2(r.proof,f.client.current.session,{method:'POST',path:'/v1/drafts',bodyDigest:httpBodyDigest(body)},at);
});

test('exact raw JSON and binary snapshot survive asynchronous signing unchanged',async()=>{
 const f=await fixture();for(const body of ['{ "x":1.5}', '{"x":1,"x":1}', '[]', 'not JSON']){const r=await f.client.createBusinessProof({method:'POST',path:'/v1/drafts',body,requiredScopes:['mail:account']});assert.equal(r.body,body);assert.equal(r.proof.bodyDigest,httpBodyDigest(body));}
 const body=Uint8Array.of(0,255,13,10,128),original=Uint8Array.from(body);const pending=f.client.createBusinessProof({method:'POST',path:'/v1/drafts',body,requiredScopes:['mail:account']});body.fill(1);const r=await pending;assert.deepEqual(r.body,original);assert.equal(r.proof.bodyDigest,httpBodyDigest(original));
 if(process.env.YNX_BUSINESS_BINARY_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_BINARY_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,bodyBase64:Buffer.from(original).toString('base64'),path:'/v1/drafts',method:'POST',at:at.toISOString()}));
});
test('multipart commitment signs final wire digest and bounded length, not delivery',async()=>{
 const f=await fixture(),wire='--qa\r\nContent-Disposition: form-data; name="file"\r\n\r\nactual bytes\r\n--qa--\r\n',bodyDigest=httpBodyDigest(wire),base={method:'POST',path:'/v1/drafts',bodyDigest,bodyBytes:Buffer.byteLength(wire),requiredScopes:['mail:account']};
 const r=await f.client.createBusinessProofCommitment(base);assert.equal(r.body,null);assert.equal(r.proof.bodyDigest,bodyDigest);assert.equal(r.commitment.bodyBytes,Buffer.byteLength(wire));
 for(const patch of [{bodyBytes:-1},{bodyBytes:536870913},{bodyBytes:1.5},{bodyDigest:'x'.repeat(64)},{method:'GET'}])await assert.rejects(f.client.createBusinessProofCommitment({...base,...patch}));
 const large=await f.client.createBusinessProofCommitment({...base,bodyBytes:536870912});assert.equal(large.commitment.bodyBytes,536870912);
 if(process.env.YNX_BUSINESS_MULTIPART_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_MULTIPART_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,body:wire,path:base.path,method:'POST',at:at.toISOString()}));
});

test('all 13 explicitly adopted products retain exact private scopes and native tuples',async()=>{
 for(const productId of ['finance','exchange','quant','social','ai','developer','calendar','cloud','docs','mail','shop','video','creator-studio']){
 const product=registry.products.find(p=>p.productId===productId),f=await fixture({productId,scopes:product.scopes});
 const r=await f.client.createBusinessProof({method:'POST',path:'/qa/owned-action',body:'{ "wire": true }',requiredScopes:product.scopes});assert.equal(r.proof.productId,productId);assert.equal(r.proof.origin,product.webOrigin);assert.equal(r.proof.clientId,product.clientId);
 if(product.nativeCallback){const n=await fixture({productId,scopes:product.scopes,platform:'android'}),proof=await n.client.createBusinessProof({method:'GET',path:'/qa/owned-read',body:'',requiredScopes:[product.scopes[0]]});assert.equal(proof.proof.callback,product.nativeCallback);assert.equal(n.client.current.session.platform,'android');}
 }
 const read=await fixture({productId:'cloud',scopes:['files.read']});await assert.rejects(read.client.createBusinessProof({method:'POST',path:'/qa/owned-action',body:'{}',requiredScopes:['files.write']}));
 for(const productId of ['music','merchant-console','seller-console'])await assert.rejects(fixture({productId,scopes:['account:read']}));
});
test('512 MiB actual incremental wire hash produces a small commitment fixture',async()=>{
 const f=await fixture(),chunk=Buffer.alloc(1048576,42),hash=createHash('sha256');for(let i=0;i<512;i++)hash.update(chunk);const bodyDigest=hash.digest('hex'),bodyBytes=536870912,path='/qa/owned-upload';
 const r=await f.client.createBusinessProofCommitment({method:'POST',path,bodyDigest,bodyBytes,requiredScopes:['mail:account']});assert.equal(r.proof.bodyDigest,bodyDigest);
 if(process.env.YNX_BUSINESS_LARGE_FIXTURE_OUT)writeFileSync(process.env.YNX_BUSINESS_LARGE_FIXTURE_OUT,JSON.stringify({session:f.client.current.session,header:r.proofHeader,repeatByte:42,bodyBytes,path,method:'POST',at:at.toISOString()}));
});

test('another client replacing original stored session during signing fences delivery',async()=>{
 let entered,release;const gate=new Promise(r=>entered=r);const f=await fixture({sign:async input=>{const bytes=Buffer.from(input.payload,'base64url');if(bytes.toString().includes('/v1/drafts')){entered();await new Promise(r=>release=r)}return Buffer.from(p256.sign(bytes,device,{format:'der'})).toString('base64url')}});
 const operation=f.client.createBusinessProof({method:'POST',path:'/v1/drafts',body:'{}',requiredScopes:['mail:account']});await gate;await f.storage.set(f.client.storageKey,JSON.stringify({...f.client.current.session,account:'replacement'}));release();await assert.rejects(operation);
});
