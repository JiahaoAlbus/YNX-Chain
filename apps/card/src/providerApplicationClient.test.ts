import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD_BUSINESS_ORIGIN} from './cardBusinessClient';
import {CardProviderClient,CardProviderClientError} from './providerApplicationClient';

const source='a'.repeat(40),owner='0x'+'b'.repeat(40);
const identity=()=>({owner,sessionBinding:'binding-a',expiresAt:'2099-01-01T00:00:00.000Z'});
const envelope=(data:unknown,extra:Record<string,unknown>={})=>Response.json({schemaVersion:2,sourceCommit:source,sessionOwner:owner,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,data,...extra});
test('provider application client uses only fixed same-origin v2, fresh proof and exact read/write scopes',async()=>{
  const calls:{url:string;init:RequestInit}[]=[],scopes:string[][]=[];let proofs=0;
  const client=new CardProviderClient({expectedSourceCommit:source,identity,createIntrospectionProof:async scope=>{scopes.push([...scope]);return {proofHeader:'proof-'+(++proofs)}},fetch:async(url,init)=>{calls.push({url:String(url),init:init??{}});return envelope([])}});
  await client.listApplications();await client.createDraft({provider:'immersve'},'draft-1');
  assert.deepEqual(calls.map(call=>call.url),[CARD_BUSINESS_ORIGIN+'/api/card/v2/provider-applications',CARD_BUSINESS_ORIGIN+'/api/card/v2/provider-applications']);
  assert.deepEqual(scopes,[['account:read'],['card:application:write']]);assert.deepEqual(calls.map(call=>new Headers(call.init.headers).get('X-YNX-Product-Session-Proof-V2')),['proof-1','proof-2']);
  assert.equal(new Headers(calls[1]!.init.headers).get('Idempotency-Key'),'draft-1');assert.equal(calls[1]!.init.credentials,'omit');assert.equal(calls[1]!.init.redirect,'error');
  assert.equal(new Headers(calls[0]!.init.headers).has('X-YNX-App-Session'),false);
});
test('missing session and invalid resource fail before proof or network; no automatic mutation retry',async()=>{
  let proofs=0,calls=0;const options={expectedSourceCommit:source,identity:()=>null,createIntrospectionProof:async()=>{proofs++;return {proofHeader:'x'}},fetch:async()=>{calls++;return envelope({})}};
  const client=new CardProviderClient(options);await assert.rejects(client.listApplications(),/PRIVATE_SESSION_REQUIRED/);assert.throws(()=>client.getApplication('../foreign'),/INVALID_CARD_RESOURCE/);assert.equal(proofs,0);assert.equal(calls,0);
  const connected=new CardProviderClient({...options,identity,fetch:async()=>{calls++;throw Error('offline')}});await assert.rejects(connected.createDraft({},'draft-1'),/CARD_API_UNAVAILABLE/);assert.equal(calls,1);
});
test('wrong source/owner, HTML fallback, sensitive card fields and hostile hosted URL fail closed',async()=>{
  for(const result of [envelope({}, {sourceCommit:'c'.repeat(40)}),envelope({}, {sessionOwner:'0x'+'d'.repeat(40)}),envelope({pan:'4111111111111111'}),new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}})]){
    const client=new CardProviderClient({expectedSourceCommit:source,identity,createIntrospectionProof:async()=>({proofHeader:'x'}),fetch:async()=>result.clone()});await assert.rejects(client.listApplications(),/INVALID_CARD_API_RESPONSE|SENSITIVE_CARD_DATA_REJECTED/);
  }
  const hosted=new CardProviderClient({expectedSourceCommit:source,identity,createIntrospectionProof:async()=>({proofHeader:'x'}),allowedHostedOrigins:['https://verify.test.immersve.com'],fetch:async()=>envelope({application:{status:'KYC_PENDING'},hostedUrl:'https://evil.example/kyc'})});
  await assert.rejects(hosted.beginHostedKyc('application-a','start-a'),error=>error instanceof CardProviderClientError&&error.code==='HOSTED_KYC_RESPONSE_UNTRUSTED');
});
