import test from 'node:test';
import assert from 'node:assert/strict';
import type {FundingIntent} from '../server/contracts';
import {sendExactCardFunding,parseFundingSendRecord,type FundingSendStorage} from './cardFundingSend';
const now=Date.parse('2026-10-04T10:00:00.000Z'),hash='0x'+'a'.repeat(64);
const intent:FundingIntent={id:'intent_fixture',cardId:'card_fixture',owner:'0x'+'1'.repeat(40),sender:'0x'+'1'.repeat(40),recipient:'0x'+'2'.repeat(40),amountWei:'1000000000000000001',chainId:'0x1917',minConfirmations:2,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString(),status:'pending'};
const context={owner:intent.owner,sessionBinding:'test-only-binding',expiresAt:new Date(now+3600000).toISOString(),sourceCommit:'a'.repeat(40)};
function fixture({reject=false,unknown=false,silent=false}={}){
  let raw:string|null=null,locked=false;
  const calls:string[]=[],transactions:unknown[]=[];
  const storage:FundingSendStorage={async read(){return raw},async write(value){if(!silent)raw=value},async exclusive(operation){if(locked)throw Error('CARD_FUNDING_BUSY');locked=true;try{return await operation()}finally{locked=false}}};
  const wallet={async request({method,params}:{method:string;params?:unknown}){calls.push(method);if(method==='eth_accounts')return [intent.sender];if(method==='eth_chainId')return '0x1917';assert.equal(method,'eth_sendTransaction');assert.equal(JSON.parse(raw!).status,'PENDING');transactions.push(params);if(reject)throw {code:4001};if(unknown)return null;return hash}};
  return {storage,wallet,calls,transactions,get raw(){return raw},input:{intent,context,wallet,storage,isCurrent:()=>true,now:()=>now}};
}
test('exact new Card intent is durably reserved before wallet send, without creating a balance',async()=>{
  const f=fixture(),result=await sendExactCardFunding(f.input);
  assert.equal(result.txHash,hash);assert.equal(result.status,'RETURNED');
  assert.deepEqual(f.transactions,[[{from:intent.sender,to:intent.recipient,value:'0xde0b6b3a7640001',chainId:'0x1917'}]]);
  assert.deepEqual(f.calls,['eth_accounts','eth_chainId','eth_sendTransaction']);
  assert.equal('balance' in result,false);assert.equal('credited' in result,false);
  assert.deepEqual(parseFundingSendRecord(f.raw!,intent,context),result);
});
test('cold-start returned, rejected and unknown attempts never send automatically again',async()=>{
  for(const mode of [{},{reject:true},{unknown:true}]){
    const f=fixture(mode);try{await sendExactCardFunding(f.input)}catch{}
    await assert.rejects(sendExactCardFunding(f.input),/ALREADY_ATTEMPTED/);assert.equal(f.transactions.length,1);
  }
});
test('storage confirmation, account, chain, expiry and owner fail before sending',async()=>{
  const silent=fixture({silent:true});await assert.rejects(sendExactCardFunding(silent.input),/LOCAL_WRITE_UNCONFIRMED/);assert.equal(silent.transactions.length,0);
  for(const [field,value]of [['owner','another'],['chainId','0x1'],['amountWei','0'],['expiresAt','invalid']] as const){const f=fixture();await assert.rejects(sendExactCardFunding({...f.input,intent:{...intent,[field]:value} as FundingIntent}));assert.equal(f.transactions.length,0)}
  for(const response of [[],['0x'+'3'.repeat(40)]]){const f=fixture();await assert.rejects(sendExactCardFunding({...f.input,wallet:{async request(){return response}}}),/APPROVED_ACCOUNT/);assert.equal(f.transactions.length,0)}
});
test('concurrent clicks reserve only one send and timeout keeps UNKNOWN',async()=>{
  const f=fixture();const results=await Promise.allSettled([sendExactCardFunding(f.input),sendExactCardFunding(f.input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.transactions.length,1);
  const g=fixture();await assert.rejects(sendExactCardFunding({...g.input,timeoutMs:1,wallet:{async request({method}){if(method==='eth_accounts')return [intent.sender];if(method==='eth_chainId')return '0x1917';return new Promise(()=>{})}}}),/OUTCOME_UNKNOWN/);assert.equal(JSON.parse(g.raw!).status,'UNKNOWN');
});
test('source/session changes retain original recovery but do not authorize a resend',async()=>{
  const f=fixture();await sendExactCardFunding(f.input);
  assert.equal(parseFundingSendRecord(f.raw!,intent,{...context,sourceCommit:'b'.repeat(40),sessionBinding:'changed'}).txHash,hash);
  await assert.rejects(sendExactCardFunding({...f.input,isCurrent:()=>false}),/CONTEXT_CHANGED/);
  assert.equal(f.transactions.length,1);
});
