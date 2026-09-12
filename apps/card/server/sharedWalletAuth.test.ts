import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWalletAuthority,CARD_SESSION_AUTHORITY} from './sharedWalletAuth.ts';
import {withCardApplicationVerifier} from './walletApproval.ts';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {unavailableCore,type AuthenticationRequest} from './contracts.ts';

// Wallet-owner public fixture only. Transport below models authority responses;
// it does not claim a live session or perform Wallet device signing/verification.
const readBytes=readFileSync('server/test-fixtures/card-native-read-public-fixture.json');
const writeBytes=readFileSync('server/test-fixtures/card-native-application-write-public-fixture.json');
const read=JSON.parse(readBytes.toString()),write=JSON.parse(writeBytes.toString());
const request:AuthenticationRequest={proofHeader:read.proofHeader,platform:'android',operation:'read',method:'GET',path:'/api/card/v1/state',requiredScopes:['account:read']};
const writeRequest:AuthenticationRequest={proofHeader:write.proofHeader,platform:'android',operation:'write',method:'POST',path:'/api/card/v1/applications',requiredScopes:['card:application:write']};
function canonicalFixture(value:any):string{
  return JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.keys(child).sort().map(key=>[key,child[key]])):child);
}
function harness(options:{mutate?:(session:any)=>any;failure?:boolean;after?:()=>void}={}){
  const calls:{url:string;input:RequestInit}[]=[],used=new Set<string>();let now=new Date(read.authorityTime);
  const transport:typeof fetch=async(url,input={})=>{
    calls.push({url:String(url),input});if(options.failure)throw Error('Synthetic transport interruption');
    const headers=new Headers(input.headers),requestId=headers.get('x-request-id'),proof=headers.get('x-ynx-product-session-proof-v2')!;
    const responseHeaders={'content-type':'application/json','cache-control':'no-store','x-request-id':requestId!};
    if(used.has(proof))return new Response(canonicalFixture({error:{code:'REPLAY',message:'Synthetic authority replay rejection'},ok:false,requestId,schemaVersion:2}),{status:409,headers:responseHeaders});
    assert.ok([read.proofHeader,write.proofHeader].includes(proof),'Only the declared public fixture proof is accepted by this synthetic authority');used.add(proof);
    let session=structuredClone(read.activeSession);if(options.mutate)session=options.mutate(session);options.after?.();
    return new Response(canonicalFixture({ok:true,requestId,result:{active:true,session},schemaVersion:2}),{headers:responseHeaders});
  };
  return {authority:createWalletAuthority({fetch:transport,clock:()=>now}),calls,setTime:(value:Date)=>{now=value}};
}
test('exact unchanged Wallet fixture and server artifact hashes remain bound',()=>{
  assert.equal(read.syntheticOnly,true);assert.equal(write.syntheticOnly,true);
  assert.equal(createHash('sha256').update(readBytes).digest('hex'),'02bf3fd878d1a48457e22bfd985b11d39c10ebde6a0daa69e43ffabc02364e63');
  assert.equal(createHash('sha256').update(writeBytes).digest('hex'),'f939b85fa1fa4b0d2718df027c091e058279378fe1200b9b538f4c493f8ab3c8');
  assert.equal(createHash('sha256').update(readFileSync('server/vendor/wallet-session-6f332753/product-session-server.mjs')).digest('hex'),'a7107b35fc4ea27e0aad4a67f8cabc388d2551e9cc09970ca90a573b7042a520');
});
test('Card consumes the shared live-introspection interface at one fixed URL and maps only its returned principal',async()=>{
  const f=harness(),principal=await f.authority.authenticate(request);
  assert.equal(principal.owner,read.activeSession.account);assert.equal(principal.chainId,'ynx_6423-1');assert.deepEqual(principal.scopes,read.activeSession.scopes);
  assert.equal(f.calls.length,1);const call=f.calls[0]!;assert.equal(call.url,CARD_SESSION_AUTHORITY+'/v2/product-sessions/introspect');
  assert.equal(call.input.method,'POST');assert.equal(call.input.body,read.body);assert.equal(call.input.redirect,'error');assert.equal(call.input.credentials,'omit');
  const headers=new Headers(call.input.headers);assert.equal(headers.get('cookie'),null);assert.equal(headers.get('authorization'),null);
});
test('replay rejection propagates and no cached principal bypasses the authority',async()=>{
  const f=harness();await f.authority.authenticate(request);
  await assert.rejects(()=>f.authority.authenticate(request),{code:'REPLAY',status:401});assert.equal(f.calls.length,2);
  assert.notEqual(new Headers(f.calls[0]!.input.headers).get('x-request-id'),new Headers(f.calls[1]!.input.headers).get('x-request-id'));
});
test('wrong platform, missing web Origin, foreign Origin and missing native platform fail before introspection',async()=>{
  const f=harness();for(const patch of [{platform:'ios'},{platform:'web'},{origin:'https://evil.example'},{platform:undefined}]){
    await assert.rejects(()=>f.authority.authenticate({...request,...patch} as AuthenticationRequest));
  }assert.equal(f.calls.length,0);
});
test('route-required scope cannot be replaced by a caller claim or a differently scoped proof',async()=>{
  const f=harness();
  await assert.rejects(()=>f.authority.authenticate({...request,requiredScopes:['card:application:write']}),{code:'CARD_ROUTE_SCOPE_MISMATCH'});
  await assert.rejects(()=>f.authority.authenticate({...request,proofHeader:write.proofHeader}),{code:'HTTP_BINDING_MISMATCH'});
  await assert.rejects(()=>f.authority.authenticate({...writeRequest,proofHeader:read.proofHeader}),{code:'HTTP_BINDING_MISMATCH'});
  assert.equal(f.calls.length,0);
});
test('missing or malformed proof is an authentication error, not a claimed authority outage',async()=>{
  const f=harness();for(const proofHeader of ['', 'not-json'])await assert.rejects(()=>f.authority.authenticate({...request,proofHeader}),{code:'INVALID_PROOF_HEADER',status:401});
  assert.equal(f.calls.length,0);
});
for(const field of ['account','deviceId','platform','callback','chainId','scopes'])test(`changed authority ${field} cannot authenticate a Card user`,async()=>{
  const f=harness({mutate:session=>({...session,[field]:field==='scopes'?['account:read']:field==='platform'?'ios':field==='chainId'?'wrong-chain':'wrong-binding'})});
  await assert.rejects(()=>f.authority.authenticate(writeRequest));assert.equal(f.calls.length,1);
});
test('expired proof and expiry during response fail without local success',async()=>{
  const before=harness();before.setTime(new Date('2026-09-12T00:01:01.000Z'));
  await assert.rejects(()=>before.authority.authenticate(request),{code:'SESSION_EXPIRED'});assert.equal(before.calls.length,0);
  const during=harness({after:()=>during.setTime(new Date('2026-09-12T00:01:01.000Z'))});
  await assert.rejects(()=>during.authority.authenticate(request),{code:'SESSION_EXPIRED'});assert.equal(during.calls.length,1);
});
test('authority network failure is private degradation without retry or Standard Wallet mutation',async()=>{
  const standard={status:'CONNECTED',account:'public-test-account',chainId:'0x1917'};
  const f=harness({failure:true});await assert.rejects(()=>f.authority.authenticate(request),{code:'PRIVATE_SERVICE_DEGRADED',status:503});
  assert.equal(f.calls.length,1);assert.equal(standard.status,'CONNECTED');
});
test('shared Session authentication plus actual local HTTP/SQLite creates only a durable DRAFT, never a card',async t=>{
  const f=harness(),clock=()=>new Date(read.authorityTime),wallet=withCardApplicationVerifier(f.authority,clock);
  const store=new CardStore(':memory:',Buffer.alloc(32,6));
  const service=new CardService({store,wallet,core:unavailableCore,clock});
  const server=createCardServer({service,wallet,sourceCommit:'a'.repeat(40),configurationReady:false});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close()});
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test port');
  const origin='http://127.0.0.1:'+address.port;
  const initial=await fetch(origin+'/api/card/v1/state',{headers:{'X-YNX-Card-Platform':'android','X-YNX-Product-Session-Proof-V2':read.proofHeader}});
  assert.equal(initial.status,200);const empty:any=await initial.json();assert.deepEqual(empty.data.cards,[]);
  const response=await fetch(origin+'/api/card/v1/applications',{method:'POST',headers:{'Content-Type':'application/json','X-YNX-Card-Platform':'android','X-YNX-Product-Session-Proof-V2':write.proofHeader,'Idempotency-Key':'sdk-public-fixture-draft'},body:JSON.stringify({nickname:'Test application',useCase:'Synthetic integration only',limitWei:'10',riskAccepted:true,termsVersion:'card-testnet-v1'})});
  assert.equal(response.status,200);const result:any=await response.json();assert.equal(result.sessionOwner,read.activeSession.account);assert.equal(result.data.status,'DRAFT');assert.equal(result.data.cardId,undefined);
  const principal={owner:read.activeSession.account,chainId:'ynx_6423-1' as const,expiresAt:read.activeSession.expiresAt,scopes:read.activeSession.scopes};
  const app=service.requestApproval(principal,result.data.id,'fixture-approval-request');
  await assert.rejects(()=>service.submitApplication(principal,app.id,write.proof,'fixture-not-business-approval'),{code:'INVALID_CARD_APPROVAL'});
  const state=service.getState(principal);assert.equal(state.applications[0]!.status,'DEGRADED');assert.deepEqual(state.cards,[]);assert.deepEqual(state.intents,[]);
});
