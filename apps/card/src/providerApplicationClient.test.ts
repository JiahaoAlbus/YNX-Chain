import test from 'node:test';
import assert from 'node:assert/strict';
import {CARD_BUSINESS_ORIGIN} from './cardBusinessClient';
import {CardProviderClient,CardProviderClientError} from './providerApplicationClient';

const source='a'.repeat(40),owner='0x'+'b'.repeat(40);
const identity=()=>({owner,sessionBinding:'binding-a',expiresAt:'2099-01-01T00:00:00.000Z'});
const envelope=(data:unknown,extra:Record<string,unknown>={})=>Response.json({schemaVersion:2,sourceCommit:source,sessionOwner:owner,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,data,...extra});
test('account change while the response body arrives never publishes old account records',async()=>{
  let current:ReturnType<typeof identity>|null=identity(),release!:()=>void;
  const bodyReady=new Promise<void>(resolve=>release=resolve);
  let started!:()=>void;const parsing=new Promise<void>(resolve=>started=resolve);
  const response=envelope({privateRecord:'old-owner-record'});
  response.json=async()=>{started();await bodyReady;return {schemaVersion:2,sourceCommit:source,sessionOwner:owner,environment:'YNX_TESTNET_CARD_PAYMENT_SIMULATION',productionRealPayments:false,data:{privateRecord:'old-owner-record'}}};
  const client=new CardProviderClient({expectedSourceCommit:source,identity:()=>current,createIntrospectionProof:async()=>({proofHeader:'fresh'}),fetch:async()=>response});
  const read=client.listApplications();await parsing;current=null;release();
  await assert.rejects(read,/CARD_CONTEXT_CHANGED/);
});
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
test('provider lifecycle and Finance consent use exact v2 routes and separate fresh scopes',async()=>{
  const calls:{url:string;init:RequestInit}[]=[],scopes:string[][]=[];
  const client=new CardProviderClient({expectedSourceCommit:source,identity,createIntrospectionProof:async required=>{scopes.push([...required]);return {proofHeader:'fresh-'+scopes.length}},fetch:async(url,init)=>{calls.push({url:String(url),init:init??{}});return envelope({})}});
  await client.programs();await client.prepareApproval('application-a',{platform:'web',fundingSourceId:'source-a',idempotencyKey:'create-a'},'prepare-a');await client.acceptApproval('application-a','https://card.ynxweb4.com/wallet-auth/callback?cardApplicationApprovalResult=fixture','result-a');await client.submit('application-a','create-a');await client.status('application-a');await client.funding('application-a');await client.history('application-a','page-two');await client.control('application-a','freeze','freeze-a');await client.financeConsent();await client.grantFinanceConsent(['card.provider-transactions.read'],'2099-01-01T00:00:00Z','grant-a');await client.revokeFinanceConsent('revoke-a');
  assert.deepEqual(scopes,[['account:read'],['card:application:write'],['card:application:write'],['card:application:write'],['account:read'],['account:read'],['account:read'],['card:controls:write'],['account:read'],['card:finance:share'],['card:finance:share']]);
  assert.equal(calls[6]?.url,CARD_BUSINESS_ORIGIN+'/api/card/v2/provider-applications/application-a/history?cursor=page-two');
  assert.equal(calls[7]?.url,CARD_BUSINESS_ORIGIN+'/api/card/v2/provider-applications/application-a/freeze');
  assert.equal(calls[9]?.url,CARD_BUSINESS_ORIGIN+'/api/card/v2/finance-consent');
  assert.equal(calls[10]?.url,CARD_BUSINESS_ORIGIN+'/api/card/v2/finance-consent/revoke');
  assert.deepEqual(calls.map(call=>new Headers(call.init.headers).get('X-YNX-Product-Session-Proof-V2')),scopes.map((_,i)=>'fresh-'+(i+1)));
  assert.throws(()=>client.history('application-a','bad&cursor=another'),/INVALID_PROVIDER_HISTORY_CURSOR/);
});
