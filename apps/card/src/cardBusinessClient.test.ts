import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD_BUSINESS_ORIGIN,CardBusinessClient,CardBusinessError,type CardPrivateIdentity} from './cardBusinessClient';

const source='a'.repeat(40),owner='0x'+'b'.repeat(40),other='0x'+'c'.repeat(40),now='2026-09-12T00:00:00.000Z';
const details={nickname:'Test application',useCase:'Testnet simulation only',limitWei:'10000000000000000000',riskAccepted:true,termsVersion:'card-testnet-v1'};
const draft={id:'application_fixture',owner,status:'DRAFT',details,createdAt:now,updatedAt:now};
const empty={environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,asset:'YNXT_TESTNET',applications:[],cards:[],intents:[]};
function response(data:unknown,extra:Record<string,unknown>={}){return Response.json({schemaVersion:1,sourceCommit:source,sessionOwner:owner,environment:empty.environment,productionRealPayments:false,data,...extra});}
function fixture(handler:(url:string,init:RequestInit)=>Promise<Response>=async()=>response(empty)){
  let identity:CardPrivateIdentity|null={owner,sessionBinding:'fixture-session-binding',expiresAt:'2099-01-01T00:00:00.000Z'};
  const scopes:readonly string[][]=[] as string[][],requests:{url:string;init:RequestInit}[]=[];let proofs=0;
  const capabilities={expectedSourceCommit:source,identity:()=>identity,createIntrospectionProof:async(required:readonly string[])=>{(scopes as string[][]).push([...required]);proofs++;return {proofHeader:`fixture_proof_${proofs}`};},fetch:async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{const request={url:String(url),init:init??{}};requests.push(request);return handler(request.url,request.init);}};
  return {client:new CardBusinessClient(capabilities),capabilities,scopes,requests,setIdentity(value:CardPrivateIdentity|null){identity=value},get proofs(){return proofs}};
}

test('constructing a Card client does not contact a wallet or service',()=>{
  const f=fixture();assert.equal(f.proofs,0);assert.equal(f.requests.length,0);
  assert.throws(()=>new CardBusinessClient({...f.capabilities,expectedSourceCommit:'unbound'}),/SOURCE_NOT_CONFIGURED/);
});

test('Card state uses fixed same-origin API, exact V2 proof and read scope',async()=>{
  const f=fixture();assert.deepEqual(await f.client.state(),empty);
  assert.deepEqual(f.scopes,[['account:read']]);
  const sent=f.requests[0]!;assert.equal(sent.url,CARD_BUSINESS_ORIGIN+'/api/card/v1/state');
  assert.equal(sent.init.redirect,'error');assert.equal(sent.init.credentials,'omit');
  const headers=new Headers(sent.init.headers);assert.equal(headers.get('X-YNX-Product-Session-Proof-V2'),'fixture_proof_1');
  for(const name of ['Authorization','X-YNX-App-Session','X-YNX-Product-Session-Proof'])assert.equal(headers.has(name),false);
});

test('network retry creates a new proof but retains the explicit business idempotency key',async()=>{
  let attempts=0;const f=fixture(async()=>{if(++attempts===1)throw Error('fixture network outage');return response(draft);});
  await assert.rejects(f.client.createApplication(details,'application-key'),/CARD_API_UNAVAILABLE/);
  assert.equal(f.requests.length,1,'no automatic mutation retry');
  assert.equal((await f.client.createApplication(details,'application-key')).id,draft.id);
  assert.deepEqual(f.scopes,[['card:application:write'],['card:application:write']]);
  assert.deepEqual(f.requests.map(sent=>new Headers(sent.init.headers).get('Idempotency-Key')),['application-key','application-key']);
  assert.deepEqual(f.requests.map(sent=>new Headers(sent.init.headers).get('X-YNX-Product-Session-Proof-V2')),['fixture_proof_1','fixture_proof_2']);
});

test('missing identity, invalid resource and missing mutation key fail before proof minting',async()=>{
  const f=fixture();f.setIdentity(null);
  await assert.rejects(f.client.state(),/PRIVATE_SESSION_REQUIRED/);
  assert.throws(()=>f.client.requestApproval('../foreign','key'),/INVALID_CARD_RESOURCE/);
  await assert.rejects(f.client.createApplication(details,''),/IDEMPOTENCY_KEY_REQUIRED/);
  assert.equal(f.proofs,0);assert.equal(f.requests.length,0);
});

test('account change during proof creation cannot send an old-owner request',async()=>{
  let finish:(value:{proofHeader:string})=>void=()=>{};
  const proof=new Promise<{proofHeader:string}>(resolve=>{finish=resolve}),f=fixture();
  const client=new CardBusinessClient({...f.capabilities,createIntrospectionProof:()=>proof});
  const pending=client.state();f.setIdentity({owner:other,sessionBinding:'other-binding',expiresAt:'2099-01-01T00:00:00.000Z'});finish({proofHeader:'fixture_proof'});
  await assert.rejects(pending,/CARD_CONTEXT_CHANGED/);assert.equal(f.requests.length,0);
});

test('session rotation during a response cannot publish old private account state',async()=>{
  let finish:(response:Response)=>void=()=>{},started:()=>void=()=>{};
  const pendingResponse=new Promise<Response>(resolve=>{finish=resolve}),fetchStarted=new Promise<void>(resolve=>{started=resolve});
  const f=fixture(async()=>{started();return pendingResponse;});
  const pending=f.client.state();await fetchStarted;
  f.setIdentity({owner,sessionBinding:'rotated-binding',expiresAt:'2099-01-01T00:00:00.000Z'});finish(response(empty));
  await assert.rejects(pending,/CARD_CONTEXT_CHANGED/);
});

test('explicit invalidation aborts a pending API call without changing the Standard Wallet',async()=>{
  let started:()=>void=()=>{};const fetchStarted=new Promise<void>(resolve=>{started=resolve});
  const standard={address:owner,chainId:'0x1917',connected:true};
  const f=fixture(async()=>{started();return new Promise<Response>(()=>{});});
  const pending=f.client.state();await fetchStarted;f.client.invalidate();
  await assert.rejects(pending,/CARD_CONTEXT_CHANGED/);
  assert.deepEqual(standard,{address:owner,chainId:'0x1917',connected:true});
});

test('stalled SDK proof creation has a bounded timeout and never contacts Card',async()=>{
  const f=fixture(),client=new CardBusinessClient({...f.capabilities,timeoutMs:5,createIntrospectionProof:()=>new Promise(()=>{})});
  await assert.rejects(client.state(),error=>error instanceof CardBusinessError&&error.code==='PRIVATE_SESSION_PROOF_TIMEOUT'&&error.layer==='product-session');
  assert.equal(f.requests.length,0);
});

test('unbound source, foreign session and non-Testnet envelopes are rejected',async()=>{
  for(const extra of [{sourceCommit:'d'.repeat(40)},{sessionOwner:other},{productionRealPayments:true},{environment:'mainnet'},{schemaVersion:2}]){
    await assert.rejects(fixture(async()=>response(empty,extra)).client.state(),/INVALID_CARD_API_RESPONSE/);
  }
});

test('HTML fallback, sensitive fields and unvalidated ACTIVE state never become Card data',async()=>{
  await assert.rejects(fixture(async()=>new Response('<html>Static fallback</html>',{headers:{'Content-Type':'text/html'}})).client.state(),/INVALID_CARD_API_RESPONSE/);
  await assert.rejects(fixture(async()=>response({...empty,pan:'forbidden-fixture'})).client.state(),/SENSITIVE_CARD_DATA_REJECTED/);
  await assert.rejects(fixture(async()=>response({...empty,applications:[{...draft,status:'ACTIVE',cardId:'card_fixture'}]})).client.state(),/INVALID_CARD_API_RESPONSE/);
});

test('Card API error codes remain separate and remote human text is never surfaced',async()=>{
  const f=fixture(async()=>Response.json({error:{code:'CARD_AUTH_EXPIRED',message:'UNTRUSTED_REMOTE_MESSAGE'}},{status:401}));
  await assert.rejects(f.client.state(),error=>error instanceof CardBusinessError&&error.layer==='product-session'&&error.code==='CARD_AUTH_EXPIRED'&&!error.message.includes('UNTRUSTED'));
});

test('pending funding response cannot be presented as a credited balance',async()=>{
  const intent={id:'intent_fixture',cardId:'card_fixture',owner,sender:owner,recipient:other,chainId:'0x1917',amountWei:'100',minConfirmations:2,createdAt:now,expiresAt:'2099-01-01T00:00:00.000Z',status:'pending'};
  const f=fixture(async()=>response(intent));
  assert.equal((await f.client.createTopupIntent('card_fixture','100','intent-key')).status,'pending');
  assert.deepEqual(f.scopes,[['card:topup:write']]);
  await assert.rejects(fixture(async()=>response({intent,card:{}})).client.confirmTopup(intent.id,'0x'+'1'.repeat(64),'confirm-key'),/INVALID_CARD_API_RESPONSE/);
});

test('accepted Wallet expiry and rejection codes survive private proof failures',async()=>{
  for(const [code,expected]of [['PRODUCT_SESSION_EXPIRED','PRODUCT_SESSION_EXPIRED'],[4001,'USER_REJECTED']] as const){
    const f=fixture(),client=new CardBusinessClient({...f.capabilities,createIntrospectionProof:async()=>{throw {code,message:'UNTRUSTED_PRIVATE_TEXT'};}});
    await assert.rejects(client.state(),error=>error instanceof CardBusinessError&&error.code===expected&&error.layer==='product-session'&&!error.message.includes('UNTRUSTED'));
    assert.equal(f.requests.length,0);
  }
});
