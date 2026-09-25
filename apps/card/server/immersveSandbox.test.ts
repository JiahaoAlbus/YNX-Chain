import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {ImmersveSandbox,type ImmersveSandboxConfig} from './immersveSandbox.ts';

const ownerA='0x'+'a'.repeat(40),ownerB='0x'+'b'.repeat(40);
const config={enabled:true,partnerAccountId:'partner-1',listenerId:'listener-1',apiKey:'fixture-key',apiSecret:'fixture-secret'};
function fixture(t:any,transport:typeof fetch,enabled=true,extra:Partial<ImmersveSandboxConfig>={}){const dir=mkdtempSync(join(tmpdir(),'card-immersve-')),store=new CardStore(join(dir,'card.sqlite'),Buffer.alloc(32,17));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return new ImmersveSandbox({store,config:{...config,enabled,...extra},transport})}
const gate=()=>({ticket:'QA-OPERATOR-20260925',qaAccountId:'account-a',expiresAt:new Date(Date.now()+60000).toISOString(),maxDepositMinorUnits:'1000000',maxProviderCalls:1});
test('fixed Test host, account-bound reads and no sensitive card fields',async t=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const transport=(async(url:string|URL|Request,init:RequestInit={})=>{calls.push({url:String(url),init});const path=String(url);return Response.json(path.includes('funding-sources')?{items:[{id:'source-1',accountId:'account-a',fundingChannelId:'channel-1'}]}:{accountId:'account-a',cardId:'card-1',status:'ACTIVE',pan:'SYNTHETIC_PAN_MUST_NOT_LEAK',cvv:'123'})}) as typeof fetch;
  const adapter=fixture(t,transport);adapter.bindCardholder(ownerA,'account-a');adapter.bindResource(ownerA,'cardId','card-1');
  assert.deepEqual(await adapter.listFundingSources(ownerA),[{id:'source-1',accountId:'account-a',fundingChannelId:'channel-1'}]);
  const card=await adapter.getBoundCard(ownerA);assert.equal(card.spendable,false);assert.equal(JSON.stringify(card).includes('4111'),false);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.startsWith('https://test.immersve.com/api/')));assert.equal((calls[0]!.init.headers as Record<string,string>)['x-account-id'],'account-a');
  assert.throws(()=>adapter.bindCardholder(ownerA,'account-b'),/BINDING_CONFLICT/);
  assert.throws(()=>adapter.bindCardholder(ownerB,'account-a'),/TRANSACTION_ALREADY_CLAIMED/);
  await assert.rejects(adapter.listFundingSources(ownerB),/ACCOUNT_UNBOUND/);
});
test('disabled-by-default config, forbidden origin and all provider writes fail before transport',async t=>{
  let calls=0;const transport=(async()=>{calls++;return Response.json({})}) as typeof fetch;
  const dir=mkdtempSync(join(tmpdir(),'card-immersve-env-')),store=new CardStore(join(dir,'card.sqlite'),Buffer.alloc(32,18));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const adapter=ImmersveSandbox.fromEnvironment(store,{IMMERSVE_SANDBOX_PARTNER_ACCOUNT_ID:'partner-1',IMMERSVE_SANDBOX_LISTENER_ID:'listener-1'},transport);
  adapter.bindCardholder(ownerA,'account-a');adapter.bindResource(ownerA,'fundingSourceId','source-a');assert.equal(adapter.doctor().enabled,false);assert.equal(adapter.doctor().providerWritesEnabled,false);
  await assert.rejects(adapter.listFundingSources(ownerA),/DISABLED/);
  for(const action of [()=>adapter.createCard(),()=>adapter.createFundingSource()])assert.throws(action,/WRITE_NOT_AUTHORIZED/);
  await assert.rejects(adapter.executeSimulatorDeposit(ownerA,'operation-a',{amount:'1',fundingSourceId:'source-a'}),/WRITE_GATE_CLOSED/);
  assert.throws(()=>ImmersveSandbox.fromEnvironment(store,{IMMERSVE_SANDBOX_ORIGIN:'https://api.immersve.com'}),/TEST_ORIGIN_REQUIRED/);assert.equal(calls,0);
});
test('official Test deposit body is capped, claimed once, owner-bound and never credited',async t=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const transport=(async(url:string|URL|Request,init:RequestInit={})=>{calls.push({url:String(url),init});return Response.json({id:'interaction-a',accountId:'account-a',fundingSourceId:'source-a',type:'Deposit',status:'Confirmed',amount:'500000',token:'USDC'})}) as typeof fetch;
  const adapter=fixture(t,transport,true,{writeEnabled:true,operatorGate:gate()});adapter.bindCardholder(ownerA,'account-a');adapter.bindResource(ownerA,'fundingSourceId','source-a');
  adapter.bindCardholder(ownerB,'account-b');adapter.bindResource(ownerB,'fundingSourceId','source-b');
  assert.deepEqual(adapter.planSimulatorDeposit(ownerA,{amount:'500000',fundingSourceId:'source-a'}),{amount:'500000',fundingSourceId:'source-a'});
  const results=await Promise.all([adapter.executeSimulatorDeposit(ownerA,'operation-a',{amount:'500000',fundingSourceId:'source-a'}),adapter.executeSimulatorDeposit(ownerA,'operation-a',{amount:'500000',fundingSourceId:'source-a'})]);
  assert.equal(calls.length,1);assert.equal(calls[0]!.url,'https://test.immersve.com/api/simulator/execute-deposit');
  assert.equal(calls[0]!.init.method,'POST');assert.equal(calls[0]!.init.redirect,'error');assert.deepEqual(JSON.parse(String(calls[0]!.init.body)),{amount:'500000',fundingSourceId:'source-a'});
  const headers=calls[0]!.init.headers as Record<string,string>;assert.equal(headers['x-account-id'],'account-a');assert.equal(headers['x-api-key'],'fixture-key');assert.equal(headers['x-api-secret'],'fixture-secret');
  assert.equal(results[0]!.ledgerCredited,false);assert.equal(adapter.getDepositOperation(ownerA,'operation-a')?.status,'PROVIDER_RESPONSE_RECORDED');
  assert.equal(adapter.getDepositOperation(ownerA,'operation-a')?.providerInteractionId,'interaction-a');
  await assert.rejects(adapter.executeSimulatorDeposit(ownerA,'operation-a',{amount:'500001',fundingSourceId:'source-a'}),/OPERATION_CONFLICT/);
  await assert.rejects(adapter.executeSimulatorDeposit(ownerA,'operation-b',{amount:'1',fundingSourceId:'source-a'}),/PROVIDER_CALL_CAP/);
  await assert.rejects(adapter.executeSimulatorDeposit(ownerB,'operation-c',{amount:'1',fundingSourceId:'source-b'}),/WRITE_GATE_CLOSED/);
  await assert.rejects(adapter.executeSimulatorDeposit(ownerA,'operation-d',{amount:'1000001',fundingSourceId:'source-a'}),/VIRTUAL_AMOUNT_CAP/);
  assert.equal(calls.length,1);
});
test('unknown timeout, restart and provider 403 never trigger a second attempt or inferred credit',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'card-immersve-unknown-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,21);t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let calls=0,mode:'timeout'|'forbidden'|'read'='timeout';
  const transport=(async(url:string|URL|Request,init:RequestInit={})=>{calls++;if(init.method==='GET'){assert.ok(String(url).includes('/api/funding-sources/source-a/interactions?limit=100&type=Deposit'));return Response.json({items:[{id:'unattributed',accountId:'account-a',fundingSourceId:'source-a',type:'Deposit',amount:'500000',status:'Confirmed',token:'USDC'}],pageInfo:{nextCursor:'page-2'}})}if(mode==='timeout')throw Error('synthetic timeout');return Response.json({errorCode:'FORBIDDEN'},{status:403})}) as typeof fetch;
  const writeGate={...gate(),maxProviderCalls:2};const firstStore=new CardStore(path,key);const first=new ImmersveSandbox({store:firstStore,config:{...config,writeEnabled:true,operatorGate:writeGate},transport});first.bindCardholder(ownerA,'account-a');first.bindResource(ownerA,'fundingSourceId','source-a');
  const unknown=await first.executeSimulatorDeposit(ownerA,'unknown-a',{amount:'500000',fundingSourceId:'source-a'});assert.equal(unknown.status,'UNKNOWN');assert.equal(unknown.outcome,'TRANSPORT_UNKNOWN');assert.equal(calls,1);firstStore.close();
  const secondStore=new CardStore(path,key);try{const second=new ImmersveSandbox({store:secondStore,config:{...config,writeEnabled:true,operatorGate:writeGate},transport});mode='forbidden';const repeated=await second.executeSimulatorDeposit(ownerA,'unknown-a',{amount:'500000',fundingSourceId:'source-a'});assert.equal(repeated.status,'UNKNOWN');assert.equal(calls,1);
    const rejected=await second.executeSimulatorDeposit(ownerA,'unknown-b',{amount:'1',fundingSourceId:'source-a'});assert.equal(rejected.status,'UNKNOWN');assert.equal(rejected.outcome,'PROVIDER_NON_200');assert.equal(calls,2);
    mode='read';const page=await second.listDepositInteractions(ownerA);assert.equal(page.nextCursor,'page-2');assert.equal(page.items[0]?.attribution,'UNVERIFIED');assert.equal(page.ledgerCredited,false);assert.equal(second.getDepositOperation(ownerA,'unknown-a')?.status,'UNKNOWN');
  }finally{secondStore.close()}
});
test('no credentials, missing QA authority and absent resource fail before provider POST',async t=>{
  let calls=0;const transport=(async()=>{calls++;throw Error('must not call provider')}) as typeof fetch;
  const noCredentials=fixture(t,transport,true,{apiSecret:'',writeEnabled:true,operatorGate:gate()});noCredentials.bindCardholder(ownerA,'account-a');noCredentials.bindResource(ownerA,'fundingSourceId','source-a');
  await assert.rejects(noCredentials.executeSimulatorDeposit(ownerA,'operation-a',{amount:'1',fundingSourceId:'source-a'}),/WRITE_GATE_CLOSED/);
  await assert.rejects(noCredentials.executeSimulatorDeposit(ownerA,'operation-a',{amount:'1',fundingSourceId:'other'}),/FUNDING_SOURCE_UNBOUND/);
  assert.equal(calls,0);
});
test('signed webhook is owner-isolated, durable, idempotent and never credits YNXT',async t=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk=publicKey.export({format:'jwk'});const transport=(async(url:string|URL|Request)=>{assert.equal(String(url),'https://test.immersve.com/.well-known/jwks.json');return Response.json({keys:[{...jwk,kid:'key-1',alg:'RS256'}]})}) as typeof fetch;
  const adapter=fixture(t,transport);adapter.bindCardholder(ownerA,'account-a');adapter.bindCardholder(ownerB,'account-b');
  const envelope={messageId:'message-1',topic:'card-updated',listenerId:'listener-1',listenerAccountId:'partner-1',deliveryAttempt:1,createdAt:'2026-09-25T00:00:00Z',sentAt:'2026-09-25T00:00:01Z',keyId:'key-1',issuer:'test.immersve.com',payload:{accountId:'account-a',pan:'not-stored'}};
  const raw=Buffer.from(JSON.stringify(envelope));const headers={'x-delivery-id':'message-1:1','x-key-id':'key-1','x-signature':sign('RSA-SHA256',Buffer.concat([Buffer.from('message-1:1:key-1:'),raw]),privateKey).toString('base64')};
  assert.deepEqual(await adapter.acceptWebhook(ownerA,'card-updated',headers,raw),{duplicate:false,messageId:'message-1',ledgerCredited:false});
  assert.equal((await adapter.acceptWebhook(ownerA,'card-updated',headers,raw)).duplicate,true);
  const retryRaw=Buffer.from(JSON.stringify({...envelope,deliveryAttempt:2,sentAt:'2026-09-25T00:05:00Z'}));
  const retryHeaders={'x-delivery-id':'message-1:2','x-key-id':'key-1','x-signature':sign('RSA-SHA256',Buffer.concat([Buffer.from('message-1:2:key-1:'),retryRaw]),privateKey).toString('base64')};
  assert.equal((await adapter.acceptWebhook(ownerA,'card-updated',retryHeaders,retryRaw)).duplicate,true);
  const tamperedRaw=Buffer.from(JSON.stringify({...envelope,deliveryAttempt:3,payload:{accountId:'account-a',status:'tampered'}}));
  const tamperedHeaders={'x-delivery-id':'message-1:3','x-key-id':'key-1','x-signature':sign('RSA-SHA256',Buffer.concat([Buffer.from('message-1:3:key-1:'),tamperedRaw]),privateKey).toString('base64')};
  await assert.rejects(adapter.acceptWebhook(ownerA,'card-updated',tamperedHeaders,tamperedRaw),/REPLAY_CONFLICT/);
  assert.equal(adapter.eventJournal(ownerA).length,1);assert.equal(JSON.stringify(adapter.eventJournal(ownerA)).includes('not-stored'),false);
  await assert.rejects(adapter.acceptWebhook(ownerB,'card-updated',headers,raw),/BINDING_MISMATCH/);
  await assert.rejects(adapter.acceptWebhook(ownerA,'card-updated',{...headers,'x-signature':'AAAA'},raw),/INVALID_SIGNATURE/);
  await assert.rejects(adapter.acceptWebhook(ownerA,'wrong-topic',headers,raw),/BINDING_MISMATCH/);
});
test('provider metadata and message-id journal survive a cold database reopen',t=>{
  const dir=mkdtempSync(join(tmpdir(),'card-immersve-restart-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,19);
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const firstStore=new CardStore(path,key),first=new ImmersveSandbox({store:firstStore,config});
  first.bindCardholder(ownerA,'account-a');first.bindResource(ownerA,'fundingSourceId','source-a');
  firstStore.transaction('immersve-sandbox:'+ownerA,()=>({events:{} as Record<string,unknown>}),state=>{state.events['message-a']={messageId:'message-a',topic:'card-updated',contentHash:'fixture-digest',createdAt:'2026-09-25T00:00:00Z',receivedAt:'2026-09-25T00:00:01Z'};return null});
  firstStore.close();
  const recoveredStore=new CardStore(path,key);try{const recovered=new ImmersveSandbox({store:recoveredStore,config});assert.equal(recovered.eventJournal(ownerA).length,1);assert.deepEqual(recovered.bindCardholder(ownerA,'account-a'),{accountId:'account-a',fundingSourceId:'source-a'});assert.equal(recovered.eventJournal(ownerB).length,0)}finally{recoveredStore.close()}
});
