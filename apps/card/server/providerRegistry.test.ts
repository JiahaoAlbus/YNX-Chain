import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {CardProviderRegistry,type FundingUnit} from './providerRegistry.ts';
import type {Principal} from './contracts.ts';
import type {CardProvider} from './providerRegistry.ts';
import {createCardServer} from './http.ts';
import type {CardService} from './service.ts';
import type {WalletAuthority} from './contracts.ts';

const ownerA:Principal={owner:'0x'+'a'.repeat(40),chainId:'0x1917',scopes:['account:read'],expiresAt:'2026-10-01T00:00:00Z'};
const ownerB:Principal={...ownerA,owner:'0x'+'b'.repeat(40)};
const time='2026-09-25T12:00:00Z';
function fixture(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'card-provider-registry-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,31),store=new CardStore(path,key);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {store,path,key,registry:new CardProviderRegistry(store)}}

test('two isolated fake providers coexist; per-card routing cannot silently switch or erase legacy',t=>{
  const {registry}=fixture(t);
  const old=registry.plan(ownerA,{productCardId:'ynx-card-old',provider:'immersve',programId:'program-a',environment:'TEST'},time);
  const next=registry.plan(ownerA,{productCardId:'ynx-card-new',provider:'lithic',programId:'program-b',environment:'TEST'},time);
  assert.equal(old.productCardId,'ynx-card-old');assert.equal(next.productCardId,'ynx-card-new');
  assert.throws(()=>registry.plan(ownerA,{productCardId:'ynx-card-old',provider:'lithic',programId:'program-b',environment:'TEST'},time),/CARD_PROVIDER_BINDING_IMMUTABLE/);
  registry.recordSandboxReceipt(ownerA,old.productCardId,{externalAccountId:'old-account',externalCardId:'old-external',sourceAsOf:time,evidenceId:'receipt-old'},time);
  registry.recordSandboxReceipt(ownerA,next.productCardId,{externalAccountId:'new-account',externalCardId:'new-external',sourceAsOf:time,evidenceId:'receipt-new'},time);
  registry.markLegacy(ownerA,old.productCardId,time);
  assert.equal(registry.resolve(ownerA,old.productCardId).status,'LEGACY_READ_ONLY');assert.equal(registry.resolve(ownerA,next.productCardId).provider,'lithic');
  assert.equal(registry.overview(ownerA).cards.length,2);assert.equal(registry.overview(ownerA).cards[0]?.spendableBalance,null);
  assert.throws(()=>registry.recordSandboxReceipt(ownerA,old.productCardId,{externalAccountId:'other',externalCardId:'other',sourceAsOf:time,evidenceId:'other'},time),/LEGACY_PROVIDER_WRITE_FORBIDDEN/);
  assert.throws(()=>registry.resolve(ownerB,old.productCardId),/CARD_PROVIDER_BINDING_NOT_FOUND/);
  assert.throws(()=>registry.plan(ownerA,{productCardId:'live',provider:'lithic',programId:'program-b',environment:'LIVE'},time),/LIVE_PROVIDER_BINDING_NOT_AUTHORIZED/);
});

test('external IDs and event IDs are globally claimed, replay-safe, owner-isolated and cold-start durable',t=>{
  const dir=mkdtempSync(join(tmpdir(),'card-provider-recovery-')),path=join(dir,'card.sqlite'),key=Buffer.alloc(32,32);t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const firstStore=new CardStore(path,key),first=new CardProviderRegistry(firstStore);
  first.plan(ownerA,{productCardId:'card-a',provider:'immersve',programId:'program-a',environment:'TEST'},time);
  first.plan(ownerB,{productCardId:'card-b',provider:'immersve',programId:'program-a',environment:'TEST'},time);
  const receipt={externalAccountId:'account-a',externalCardId:'external-card-a',sourceAsOf:time,evidenceId:'receipt-a'};
  assert.equal(first.recordSandboxReceipt(ownerA,'card-a',receipt,time).externalCardId,'external-card-a');
  assert.deepEqual(first.recordSandboxReceipt(ownerA,'card-a',receipt,time),first.resolve(ownerA,'card-a'));
  assert.throws(()=>first.recordSandboxReceipt(ownerB,'card-b',{...receipt,evidenceId:'receipt-b'},time),/TRANSACTION_ALREADY_CLAIMED/);
  const unit:FundingUnit={kind:'PROVIDER_TEST_ASSET',assetId:'USDC',provider:'immersve',environment:'TEST',decimals:6};
  const event={externalEventId:'event-a',type:'FUNDING' as const,status:'PENDING',amount:'500000',unit,occurredAt:time,sourceAsOf:time};
  assert.equal(first.recordEvent(ownerA,'card-a',event,time).sequence,1);assert.equal(first.recordEvent(ownerA,'card-a',event,time).sequence,1);
  assert.throws(()=>first.recordEvent(ownerA,'card-a',{...event,status:'SETTLED'},time),/PROVIDER_EVENT_REPLAY_CONFLICT/);
  assert.equal(first.activity(ownerA,'card-a').items[0]?.spendableBalanceCreated,false);
  assert.equal(first.activity(ownerA,'card-a').items[0]?.unit?.kind,'PROVIDER_TEST_ASSET');
  assert.throws(()=>first.activity(ownerB,'card-a'),/CARD_PROVIDER_BINDING_NOT_FOUND/);
  firstStore.close();const reopenedStore=new CardStore(path,key);try{const reopened=new CardProviderRegistry(reopenedStore);assert.equal(reopened.resolve(ownerA,'card-a').externalCardId,'external-card-a');assert.equal(reopened.activity(ownerA,'card-a').items.length,1);assert.equal(reopened.activity(ownerA,'card-a',1).items.length,0)}finally{reopenedStore.close()}
});

test('no cross-unit balance inference, no unreceipted events, bounded pagination and read-only doctor',t=>{
  const {registry}=fixture(t);registry.plan(ownerA,{productCardId:'card-a',provider:'immersve',programId:'program-a',environment:'TEST'},time);
  assert.throws(()=>registry.recordEvent(ownerA,'card-a',{externalEventId:'e',type:'FUNDING',status:'PENDING',occurredAt:time,sourceAsOf:time},time),/CARD_PROVIDER_RECEIPT_REQUIRED/);
  registry.recordSandboxReceipt(ownerA,'card-a',{externalAccountId:'account-a',externalCardId:'external-a',sourceAsOf:time,evidenceId:'receipt-a'},time);
  const unit:FundingUnit={kind:'CARD_ACCOUNT',provider:'immersve',environment:'TEST',currency:'USD',minorUnitDigits:2};
  registry.recordEvent(ownerA,'card-a',{externalEventId:'e1',type:'AUTHORIZATION',status:'PENDING',amount:'123',unit,occurredAt:time,sourceAsOf:time},time);
  registry.recordEvent(ownerA,'card-a',{externalEventId:'e2',type:'REFUND',status:'PENDING',amount:'12',unit,occurredAt:'2026-09-25T11:00:00Z',sourceAsOf:time},time);
  const page=registry.activity(ownerA,'card-a',0,1);assert.equal(page.items.length,1);assert.equal(page.nextCursor,1);assert.equal(registry.activity(ownerA,'card-a',page.nextCursor!,1).items[0]?.externalEventId,'e2');
  assert.equal(registry.overview(ownerA).assetAggregation,'FORBIDDEN');assert.equal(registry.doctor().providerWritesEnabled,false);
  assert.throws(()=>registry.recordEvent(ownerA,'card-a',{externalEventId:'e3',type:'FUNDING',status:'PENDING',amount:'1',unit:{kind:'PROVIDER_TEST_ASSET',provider:'lithic',environment:'TEST',assetId:'USDC',decimals:6},occurredAt:time,sourceAsOf:time},time),/PROVIDER_EVENT_UNIT_MISMATCH/);
  assert.throws(()=>registry.activity(ownerA,'card-a',0,101),/INVALID_ACTIVITY_PAGE/);
});

test('two fake provider connectors route only their bound cards, preserve legacy reads and redact sensitive output',async t=>{
  const {registry}=fixture(t);for(const [productCardId,selected] of [['old-card','immersve'],['new-card','lithic']] as [string,CardProvider][]){registry.plan(ownerA,{productCardId,provider:selected,programId:'program-'+selected,environment:'TEST'},time);registry.recordSandboxReceipt(ownerA,productCardId,{externalAccountId:'account-'+selected,externalCardId:'external-'+selected,sourceAsOf:time,evidenceId:'reference-'+selected},time)}
  registry.markLegacy(ownerA,'old-card',time);const calls:string[]=[];
  const connectors={immersve:{provider:'immersve',environment:'TEST',async getCardStatus(accountId:string,cardId:string){calls.push('immersve:'+accountId);return {externalCardId:cardId,status:'TEST_ACTIVE',sourceAsOf:time,pan:'4111111111111111'}}},lithic:{provider:'lithic',environment:'TEST',async getCardStatus(accountId:string,cardId:string){calls.push('lithic:'+accountId);return {externalCardId:cardId,status:'TEST_PENDING',sourceAsOf:time,cvv:'123'}}}} as const;
  const old=await registry.readRoutedStatus(ownerA,'old-card',connectors),next=await registry.readRoutedStatus(ownerA,'new-card',connectors);assert.equal(old.provider,'immersve');assert.equal(next.provider,'lithic');assert.deepEqual(calls,['immersve:account-immersve','lithic:account-lithic']);assert.equal(JSON.stringify([old,next]).includes('4111111111111111'),false);assert.equal(JSON.stringify([old,next]).includes('123'),false);
  await assert.rejects(registry.readRoutedStatus(ownerA,'new-card',{immersve:connectors.immersve}),/CARD_PROVIDER_READ_UNAVAILABLE/);
  await assert.rejects(registry.readRoutedStatus(ownerB,'old-card',connectors),/CARD_PROVIDER_BINDING_NOT_FOUND/);
});

test('v2 provider reads use the exact private account scope and source-bound, non-spendable envelope',async t=>{
  const {registry}=fixture(t);registry.plan(ownerA,{productCardId:'card-a',provider:'immersve',programId:'program-a',environment:'TEST'},time);
  const seen:string[]=[];const wallet:WalletAuthority={async authenticate(request){seen.push(request.path+':'+request.requiredScopes.join(','));if(request.proofHeader!=='proof')throw Error('missing proof');return ownerA},async approve(){throw Error('approval not invoked')}};
  const server=createCardServer({service:{} as CardService,wallet,providerRegistry:registry,sourceCommit:'source-fixture',allowedOrigin:'https://card.ynxweb4.com',configurationReady:false});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const address=server.address();if(!address||typeof address==='string')throw Error('no test port');const base='http://127.0.0.1:'+address.port,headers={'X-YNX-Product-Session-Proof-V2':'proof','X-YNX-Card-Platform':'web','Origin':'https://card.ynxweb4.com'};
    const response=await fetch(base+'/api/card/v2/provider-overview',{headers});assert.equal(response.status,200);const value=await response.json() as any;assert.equal(value.schemaVersion,2);assert.equal(value.sourceCommit,'source-fixture');assert.equal(value.sessionOwner,ownerA.owner);assert.equal(value.data.cards[0].spendableBalance,null);
    const page=await fetch(base+'/api/card/v2/cards/card-a/provider-activity?limit=1',{headers});assert.equal(page.status,200);assert.equal(((await page.json()) as any).data.items.length,0);
    const bad=await fetch(base+'/api/card/v2/cards/card-a/provider-activity?cursor=1&cursor=2',{headers});assert.equal(bad.status,400);assert.equal(((await bad.json()) as any).error.code,'INVALID_ACTIVITY_PAGE');
    assert.deepEqual(seen,['/api/card/v2/provider-overview:account:read','/api/card/v2/cards/card-a/provider-activity:account:read','/api/card/v2/cards/card-a/provider-activity:account:read']);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
});
