import test from 'node:test';
import assert from 'node:assert/strict';
import {sendExactCardFunding,type FundingSendStorage} from './cardFundingSend';
import type {FundingIntent} from '../server/contracts';

test('provider send must never start after the last current check becomes stale',async()=>{
 const now=Date.parse('2026-10-04T10:00:00.000Z'),owner='0x'+'1'.repeat(40);
 const intent:FundingIntent={id:'synthetic_boundary',cardId:'synthetic_card',owner,sender:owner,recipient:'0x'+'2'.repeat(40),amountWei:'1',chainId:'0x1917',minConfirmations:2,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+60_000).toISOString(),status:'pending'};
 const context={owner,sessionBinding:'synthetic-boundary-only',sourceCommit:'a'.repeat(40),expiresAt:new Date(now+60_000).toISOString()};
 let raw:string|null=null,current=true,scheduled=false;
 const currentAtProviderInvocation:boolean[]=[];
 const storage:FundingSendStorage={read:async()=>raw,write:async value=>{raw=value},exclusive:async operation=>operation()};
 const wallet={async request({method}:{method:string}){
  if(method==='eth_accounts')return [owner];
  if(method==='eth_chainId')return '0x1917';
  assert.equal(method,'eth_sendTransaction');
  currentAtProviderInvocation.push(current);
  return '0x'+'b'.repeat(64);
 }};
 await assert.rejects(sendExactCardFunding({intent,context,storage,wallet,now:()=>now,isCurrent:()=>{
  // Realistic same-turn owner/revocation change after durable reservation.
  // A synchronous request may start while current; a deferred request must
  // revalidate before calling the provider. No network or real account used.
  if(!scheduled&&raw&&JSON.parse(raw).status==='PENDING'){
   scheduled=true;queueMicrotask(()=>{current=false});
  }
  return current;
 }}),/CONTEXT_CHANGED|OUTCOME_UNKNOWN/);
 assert.equal(scheduled,true);
 assert.deepEqual(currentAtProviderInvocation.filter(value=>!value),[],'a stale authorization reached the transaction provider');
 assert.equal('balance' in JSON.parse(raw!),false);
 assert.equal('credited' in JSON.parse(raw!),false);
});
