import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {prepareOriginalCardRuntime} from './protectedStartup.ts';
import {CardError,CHAIN,type Principal,type WalletAuthority,type CoreAuthority} from './contracts.ts';
const owner='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40),recipient='0x'+'c'.repeat(40),tx='0x'+'1'.repeat(64),block='0x'+'2'.repeat(64);
const time='2026-10-04T00:00:00.000Z';
const principal=(address=owner):Principal=>({owner:address,chainId:CHAIN,expiresAt:'2026-10-05T00:00:00.000Z',scopes:['account:read','card:application:write','card:controls:write','card:topup:write','card:simulation:write']});
const details={nickname:'DISPOSABLE TEST FIXTURE',useCase:'SIMULATED merchant lifecycle only',limitWei:'10000000000000000000',riskAccepted:true,termsVersion:'card-testnet-v1'};
function fixture(t:{after:(fn:()=>void)=>void},{revokeApproval=false,revokeCore=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'card-protected-business-')),path=join(dir,'test.sqlite'),key=new Uint8Array(32).fill(41);let current=true;
 const guard=()=>{if(!current)throw new CardError('CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE',503)};
 const software:WalletAuthority={async authenticate(){return principal()},async approve(p,c){if(revokeApproval)current=false;return {approved:true,approvalId:'SOFTWARE-FIXTURE-NOT-A-REAL-APPROVAL',challengeId:c.id,owner:p.owner,payloadHash:c.payloadHash,expiresAt:'2026-10-04T00:04:00.000Z'}}};
 const runtime=prepareOriginalCardRuntime(true,guard),wallet=runtime.bindWallet(software);
 const core:CoreAuthority={async verify(i,h){if(revokeCore)current=false;return {chainId:CHAIN,txHash:h,from:i.sender,to:i.recipient,amountWei:i.amountWei,blockHash:block,blockNumber:'0x1',confirmations:2,blockTime:i.createdAt}}};
 let store=new CardStore(path,key,runtime.assertCurrent);
 const make=()=>new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>new Date(time)});let service=make();
 t.after(()=>{store.close();key.fill(0);rmSync(dir,{recursive:true,force:true})});
 return {get service(){return service},setCurrent(value:boolean){current=value},reopen(){store.close();store=new CardStore(path,key,runtime.assertCurrent);service=make();return service}};
}
async function apply(f:ReturnType<typeof fixture>){const p=principal(),app=f.service.createApplication(p,details,'create-original');f.service.requestApproval(p,app.id,'approval-original');return {app,p,result:await f.service.submitApplication(p,app.id,{softwareFixture:true},'submit-original')}}
test('protected product composition retains original TEST registration, funding, controls and owner-isolated cold records',async t=>{
 const f=fixture(t),{p,result}=await apply(f),card=result.card!;assert.equal(card.balance.availableWei,'0');
 const intent=f.service.createTopupIntent(p,card.id,{amountWei:'1000000000000000000'},'intent-original');await f.service.confirmTopup(p,intent.id,tx,'credit-original');
 const authorization=f.service.authorize(p,card.id,{amountWei:'100000000000000000',simulation:true,merchant:{id:'fixture-merchant',name:'SIMULATED MERCHANT',mcc:'5812',country:'YN',channel:'online',recurring:false}},'authorization-original');assert.equal(authorization.status,'APPROVED');
 f.service.changeCard(p,card.id,'freeze','freeze-original');
 const before=f.service.statement(p,card.id);assert.equal(before.card.balance.fundedWei,'1000000000000000000');assert.equal(before.card.balance.pendingWei,'100000000000000000');
 f.setCurrent(false);assert.throws(()=>f.service.changeCard(p,card.id,'unfreeze','unfreeze-original'),/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE/);
 f.setCurrent(true);const recovered=f.reopen();assert.deepEqual(recovered.statement(p,card.id),before);assert.equal(recovered.getState(principal(other)).cards.length,0);assert.throws(()=>recovered.statement(principal(other),card.id),/NOT_FOUND/);
});
test('source refusal after asynchronous receipt verification cannot credit ledger or consume pending intent',async t=>{
 const f=fixture(t,{revokeCore:true}),{p,result}=await apply(f),card=result.card!,intent=f.service.createTopupIntent(p,card.id,{amountWei:'1000000000000000000'},'intent-original');
 await assert.rejects(f.service.confirmTopup(p,intent.id,tx,'credit-original'),/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE/);
 f.setCurrent(true);const recovered=f.reopen();assert.equal(recovered.statement(p,card.id).card.balance.fundedWei,'0');assert.equal(recovered.getState(p).intents.find(i=>i.id===intent.id)?.status,'pending');
});
test('source refusal after asynchronous approval cannot create a TEST card',async t=>{
 const f=fixture(t,{revokeApproval:true}),p=principal(),app=f.service.createApplication(p,details,'create-original');f.service.requestApproval(p,app.id,'approval-original');
 await assert.rejects(f.service.submitApplication(p,app.id,{softwareFixture:true},'submit-original'),/CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE/);
 f.setCurrent(true);const recovered=f.reopen();assert.equal(recovered.getState(p).cards.length,0);assert.equal(recovered.getState(p).applications[0]?.id,app.id);
});
