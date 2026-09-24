import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {ImmersveSandbox} from './immersveSandbox.ts';

const ownerA='0x'+'a'.repeat(40),ownerB='0x'+'b'.repeat(40);
const config={enabled:true,partnerAccountId:'partner-1',listenerId:'listener-1',apiKey:'fixture-key',apiSecret:'fixture-secret'};
function fixture(t:any,transport:typeof fetch,enabled=true){const dir=mkdtempSync(join(tmpdir(),'card-immersve-')),store=new CardStore(join(dir,'card.sqlite'),Buffer.alloc(32,17));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return new ImmersveSandbox({store,config:{...config,enabled},transport})}
test('fixed Test host, account-bound reads and no sensitive card fields',async t=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const transport=(async(url:string|URL|Request,init:RequestInit={})=>{calls.push({url:String(url),init});const path=String(url);return Response.json(path.includes('funding-sources')?{items:[{id:'source-1',accountId:'account-a',fundingChannelId:'channel-1'}]}:{accountId:'account-a',cardId:'card-1',status:'ACTIVE',pan:'4111111111111111',cvv:'123'})}) as typeof fetch;
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
  adapter.bindCardholder(ownerA,'account-a');assert.equal(adapter.doctor().enabled,false);assert.equal(adapter.doctor().providerWritesEnabled,false);
  await assert.rejects(adapter.listFundingSources(ownerA),/DISABLED/);
  for(const action of [()=>adapter.createCard(),()=>adapter.createFundingSource(),()=>adapter.executeSimulatorDeposit()])assert.throws(action,/WRITE_NOT_AUTHORIZED/);
  assert.throws(()=>ImmersveSandbox.fromEnvironment(store,{IMMERSVE_SANDBOX_ORIGIN:'https://api.immersve.com'}),/TEST_ORIGIN_REQUIRED/);assert.equal(calls,0);
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
