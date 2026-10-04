import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {CHAIN,type Principal,type WalletAuthority,type CoreAuthority} from './contracts.ts';
const owner='0x'+'a'.repeat(40),recipient='0x'+'c'.repeat(40),tx='0x'+'1'.repeat(64),time='2026-10-04T00:00:00Z';
const p:Principal={owner,chainId:CHAIN,expiresAt:'2099-01-01T00:00:00Z',scopes:['account:read','card:application:write','card:topup:write','card:controls:write']};
// Explicit software authorities, no wallet request, signature or chain funding.
const wallet:WalletAuthority={async authenticate(){return p},async approve(_,challenge){return {approved:true,approvalId:'software-only',owner,challengeId:challenge.id,payloadHash:challenge.payloadHash,expiresAt:'2099-01-01T00:00:00Z'}}};
const core:CoreAuthority={async verify(intent,hash){return {chainId:CHAIN,txHash:hash,from:intent.sender,to:intent.recipient,amountWei:intent.amountWei,blockNumber:'0x1',blockHash:'0x'+'2'.repeat(64),confirmations:2,blockTime:intent.createdAt}}};
async function fixture(t:any){
 const directory=mkdtempSync(join(tmpdir(),'ynx-card-event-reconciliation-')),key=randomBytes(32),file=join(directory,'card.sqlite');
 let store=new CardStore(file,key),service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>new Date(time)});
 t.after(()=>{store.close();key.fill(0)});
 const app=service.createApplication(p,{nickname:'Software fixture',useCase:'Reconciliation test only',limitWei:'100',riskAccepted:true,termsVersion:'card-testnet-v1'},'draft');
 service.requestApproval(p,app.id,'request');const card=(await service.submitApplication(p,app.id,{softwareOnly:true},'approve')).card!;
 const intent=service.createTopupIntent(p,card.id,{amountWei:'100'},'intent');await service.confirmTopup(p,intent.id,tx,'credit');
 return {card,intent,get service(){return service},corrupt(change:(s:any)=>void){store.transaction(owner,()=>null,(s:any)=>{change(s);return null})},reopen(){store.close();store=new CardStore(file,key);service=new CardService({store,wallet,core,fundingAddress:recipient,clock:()=>new Date(time)})}};
}
test('local event digest survives delivery attempts and cold restart without external promotion',async t=>{
 const f=await fixture(t),before=f.service.reconcile(p,f.card.id);assert.equal(before.status,'CONSISTENT');assert.equal(before.outbox.pending,2);
 await f.service.flushEvents(owner,{publish:async()=>{throw Error('software outage')}});assert.equal(f.service.reconcile(p,f.card.id).outbox.contentDigest,before.outbox.contentDigest);
 await f.service.flushEvents(owner,{publish:async()=>{}});f.reopen();const after=f.service.reconcile(p,f.card.id);
 assert.equal(after.status,'CONSISTENT');assert.equal(after.outbox.contentDigest,before.outbox.contentDigest);assert.equal(after.outbox.pending,0);assert.equal(after.outbox.transportAcknowledged,2);
 assert.equal(after.outbox.externalAcceptanceVerified,false);assert.equal(after.dataFabricReconciled,false);assert.equal(after.chainReverified,false);
 assert.throws(()=>f.service.reconcile({...p,owner:'0x'+'b'.repeat(40)},f.card.id),/NOT_FOUND/);
});
test('reconciliation rejects altered stored chain confirmations and block binding',async t=>{
 const f=await fixture(t);f.corrupt(s=>{s.intents[f.intent.id].receipt.chainId='0x1';s.intents[f.intent.id].receipt.confirmations=0;s.intents[f.intent.id].receipt.blockHash='not-a-block'});f.reopen();
 const report=f.service.reconcile(p,f.card.id);assert.equal(report.status,'INCONSISTENT');assert.ok(report.findings.includes('STORED_RECEIPT_CONFIRMATION_MISMATCH'));assert.ok(report.findings.includes('FUNDING_EVENT_MISMATCH'));
});
test('reconciliation catches duplicate or altered funding events despite unchanged ledger',async t=>{
 const f=await fixture(t);f.corrupt(s=>{const funded=s.events.find((e:any)=>e.name==='card.funded');funded.details.amountWei='200';s.events.push(structuredClone(funded))});
 const report=f.service.reconcile(p,f.card.id);assert.equal(report.balance.availableWei,'100');assert.equal(report.status,'INCONSISTENT');
 for(const reason of ['FUNDING_EVENT_MISMATCH','FUNDING_EVENT_TOTAL_MISMATCH','DUPLICATE_BUSINESS_EVENT'])assert.ok(report.findings.includes(reason));
 assert.equal(report.outbox.externalAcceptanceVerified,false);
});
