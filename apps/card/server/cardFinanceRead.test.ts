import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage} from 'node:http';
import {CardStore} from './storage.ts';
import {CardProviderRegistry} from './providerRegistry.ts';
import {CardFinanceRead,CARD_FINANCE_READ_ROUTE} from './cardFinanceRead.ts';
import type {CardProviderLifecycle} from './providerLifecycle.ts';
import type {Principal} from './contracts.ts';

const owner='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',at=new Date('2026-09-25T12:00:00Z'),secret='isolated-card-finance-read-test-key-32-characters';
const principal:Principal={owner,chainId:'0x1917',scopes:['account:read','card:finance:share'],expiresAt:'2026-09-25T13:00:00Z'};
function request(nonce='a'.repeat(32),account=owner,when=at.toISOString()):IncomingMessage{
  const names=['X-YNX-Read-Consumer','X-YNX-Read-Account','X-YNX-Read-Timestamp','X-YNX-Read-Nonce','X-YNX-Read-Signature'];
  const signature=createHmac('sha256',secret).update(['YNX_READ_INTEGRATION_V1','finance','card','GET',CARD_FINANCE_READ_ROUTE,account,when,nonce].join('\n')).digest('hex');
  const values=['finance',account,when,nonce,signature],headers=Object.fromEntries(names.map((name,index)=>[name.toLowerCase(),values[index]]));
  return {method:'GET',url:CARD_FINANCE_READ_ROUTE,headers,rawHeaders:names.flatMap((name,index)=>[name,values[index]!])} as unknown as IncomingMessage;
}
test('Finance HMAC needs owner consent, durable nonce and exact Card source record',t=>{
  const dir=mkdtempSync(join(tmpdir(),'card-finance-read-')),path=join(dir,'state.sqlite'),key=Buffer.alloc(32,31);t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=new CardStore(path,key),registry=new CardProviderRegistry(store);registry.plan(principal,{productCardId:'card-a',provider:'immersve',programId:'program-a',environment:'TEST'},at.toISOString());
  const lifecycle={recordedHistory(){return []}} as unknown as CardProviderLifecycle;
  let producer=new CardFinanceRead(store,registry,lifecycle,secret,()=>at);
  assert.throws(()=>producer.read(request()),/FINANCE_READ_CONSENT_REQUIRED/);
  assert.throws(()=>producer.grant({...principal,scopes:['account:read']},['card.provider-activity.read'],'2026-09-26T12:00:00Z'),/CARD_PERMISSION_DENIED/);
  producer.grant(principal,['card.provider-activity.read','card.provider-transactions.read'],'2026-09-26T12:00:00Z');
  const response=producer.read(request('b'.repeat(32)));assert.equal(response.sourceId,'card');assert.equal(response.authorizedAccount,owner);assert.equal(response.payload.cards[0]?.programId,'program-a');assert.equal(response.payload.spendableBalance,null);
  assert.throws(()=>producer.read(request('b'.repeat(32))),/FINANCE_READ_REPLAYED/);
  store.close();store=new CardStore(path,key);registry=new CardProviderRegistry(store);producer=new CardFinanceRead(store,registry,lifecycle,secret,()=>at);
  assert.throws(()=>producer.read(request('b'.repeat(32))),/FINANCE_READ_REPLAYED/);
  assert.throws(()=>producer.read(request('c'.repeat(32),owner,'2026-09-25T11:59:00.000Z')),/FINANCE_READ_CREDENTIAL_EXPIRED/);
  assert.throws(()=>producer.read(request('c'.repeat(32),'0x'+'b'.repeat(40))),/FINANCE_READ_CONSENT_REQUIRED/);
  producer.revoke(principal);assert.throws(()=>producer.read(request('d'.repeat(32))),/FINANCE_READ_CONSENT_REQUIRED/);store.close();
});
