import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {CHAIN,type Principal,type WalletAuthority,type CoreAuthority} from './contracts.ts';

// Test-only authority seams. No user wallet, signature, RPC or chain transaction.
function fixture(t:TestContext){
  const path=join(mkdtempSync(join(tmpdir(),'card-merchant-controls-fixture-')),'fixture.sqlite');
  const key=randomBytes(32),now=new Date('2026-10-04T00:00:00.000Z');
  const principal:Principal={owner:'0x'+'1'.repeat(40),chainId:CHAIN,expiresAt:'2026-10-05T00:00:00.000Z',scopes:['account:read','card:application:write','card:controls:write','card:topup:write','card:simulation:write']};
  const wallet:WalletAuthority={async authenticate(){return principal},async approve(p,c){return {approved:true,approvalId:'TEST_ONLY_APPROVAL',challengeId:c.id,owner:p.owner,payloadHash:c.payloadHash,expiresAt:c.expiresAt}}};
  const core:CoreAuthority={async verify(intent,hash){return {chainId:CHAIN,txHash:hash,from:intent.sender,to:intent.recipient,amountWei:intent.amountWei,blockNumber:'0x1',blockHash:'0x'+'f'.repeat(64),confirmations:2,blockTime:now.toISOString()}}};
  let store=new CardStore(path,key);
  const create=()=>new CardService({store,wallet,core,fundingAddress:'0x'+'2'.repeat(40),clock:()=>now});
  let service=create();
  t.after(()=>{store.close();key.fill(0)});
  return {principal,get service(){return service},store,reopen(){store.close();store=new CardStore(path,key);service=create()}};
}
const merchant={id:'demo_allowed',name:'SIMULATED merchant',mcc:'5812',country:'YN',channel:'online' as const,recurring:false};
const details={nickname:'TEST fixture',useCase:'Simulated merchant control verification',limitWei:'1000',riskAccepted:true,termsVersion:'card-testnet-v1'};
async function card(f:ReturnType<typeof fixture>){
  const p=f.principal,app=f.service.createApplication(p,details,'app');f.service.requestApproval(p,app.id,'approval');
  const created=(await f.service.submitApplication(p,app.id,{fixture:true},'submit')).card!;
  const intent=f.service.createTopupIntent(p,created.id,{amountWei:'1000'},'intent');
  await f.service.confirmTopup(p,intent.id,'0x'+'a'.repeat(64),'fixture-credit');return created;
}
test('merchant allowlist survives restart, denies foreign merchant, and retries are idempotent',async t=>{
  const f=fixture(t),created=await card(f),p=f.principal;
  const changed=f.service.updateControls(p,created.id,{allowedMerchants:[merchant.id]},'allow');
  f.reopen();assert.deepEqual(f.service.updateControls(p,created.id,{allowedMerchants:[merchant.id]},'allow'),changed);
  const declined=f.service.authorize(p,created.id,{amountWei:'10',simulation:true,merchant:{...merchant,id:'not_allowed'}},'denied');
  assert.equal(declined.reason,'MERCHANT_BLOCKED');assert.equal(declined.remainingWei,'0');
  assert.equal(f.service.authorize(p,created.id,{amountWei:'10',simulation:true,merchant},'approved').status,'APPROVED');
  assert.equal(f.service.reconcile(p,created.id).status,'CONSISTENT');
  assert.equal(f.service.statement(p,created.id).events.filter(e=>e.name==='card.controls.updated').length,1);
});
test('emergency blocking is durable, does not release holds, and never prevents their reversal',async t=>{
  const f=fixture(t),created=await card(f),p=f.principal;
  const hold=f.service.authorize(p,created.id,{amountWei:'20',simulation:true,merchant},'hold');
  f.service.updateControls(p,created.id,{emergencyBlock:true},'emergency');f.reopen();
  const before=f.service.statement(p,created.id).card.balance;
  const decline=f.service.authorize(p,created.id,{amountWei:'10',simulation:true,merchant},'blocked');
  assert.equal(decline.reason,'EMERGENCY_BLOCK');assert.deepEqual(f.service.statement(p,created.id).card.balance,before);
  f.service.settle(p,hold.id,'reverse',{amountWei:'20'},'release');
  f.service.updateControls(p,created.id,{emergencyBlock:false},'clear');
  assert.equal(f.service.authorize(p,created.id,{amountWei:'10',simulation:true,merchant},'after-clear').status,'APPROVED');
  assert.equal(f.service.reconcile(p,created.id).status,'CONSISTENT');
});
test('legacy card controls accept explicit new controls without rewriting unrelated records',async t=>{
  const f=fixture(t),created=await card(f),p=f.principal;
  f.store.transaction(p.owner,()=>({}),raw=>{const s=raw as {cards:Record<string,{controls:Record<string,unknown>}>};delete s.cards[created.id]!.controls.allowedMerchants;delete s.cards[created.id]!.controls.emergencyBlock;return null});
  const next=f.service.updateControls(p,created.id,{allowedMerchants:[merchant.id],emergencyBlock:true},'upgrade');
  assert.deepEqual(next.controls.allowedMerchants,[merchant.id]);assert.equal(next.controls.emergencyBlock,true);
  const before=f.service.statement(p,created.id);
  for(const invalid of [{emergencyBlock:'yes'},{allowedMerchants:['invalid/merchant']},{allowedMerchants:Array(101).fill('demo')},{unknownControl:true}])assert.throws(()=>f.service.updateControls(p,created.id,invalid as any,'invalid-'+JSON.stringify(invalid).length),/INVALID_SPEND_CONTROLS/);
  assert.deepEqual(f.service.statement(p,created.id),before);
});
