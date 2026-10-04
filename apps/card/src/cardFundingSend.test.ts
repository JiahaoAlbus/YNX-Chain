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
  assert.deepEqual(f.calls,['eth_accounts','eth_chainId','eth_accounts','eth_chainId','eth_sendTransaction']);
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

test('late wallet hash recovers the original UNKNOWN without rebroadcast or credit',async()=>{
 const f=fixture();let resolve!:(value:unknown)=>void;const recovered:unknown[]=[];
 const wallet={async request({method}:{method:string}){f.calls.push(method);if(method==='eth_accounts')return [intent.sender];if(method==='eth_chainId')return '0x1917';assert.equal(method,'eth_sendTransaction');return new Promise(done=>{resolve=done})}};
 await assert.rejects(sendExactCardFunding({...f.input,wallet,timeoutMs:1,onRecoveryRecord:record=>recovered.push(record)}),/OUTCOME_UNKNOWN/);
 assert.equal(JSON.parse(f.raw!).status,'UNKNOWN');
 resolve(hash.toUpperCase().replace('0X','0x'));await new Promise(setImmediate);
 assert.equal(JSON.parse(f.raw!).status,'RETURNED');assert.equal(JSON.parse(f.raw!).txHash,hash);
 assert.equal(f.calls.filter(method=>method==='eth_sendTransaction').length,1);
 assert.equal(recovered.length,1);assert.equal('balance' in JSON.parse(f.raw!),false);
 await assert.rejects(sendExactCardFunding({...f.input,wallet}),/ALREADY_ATTEMPTED/);
});

test('late result never overwrites changed recovery and does not update a departed identity',async()=>{
 for(const altered of [false,true]){
  const f=fixture();let resolve!:(value:unknown)=>void,current=true,callbacks=0;
  const wallet={async request({method}:{method:string}){if(method==='eth_accounts')return [intent.sender];if(method==='eth_chainId')return '0x1917';return new Promise(done=>{resolve=done})}};
  await assert.rejects(sendExactCardFunding({...f.input,wallet,timeoutMs:1,isCurrent:()=>current,onRecoveryRecord:()=>{callbacks++}}),/OUTCOME_UNKNOWN/);
  const original=f.raw!;current=false;
  if(altered)await f.storage.write('preserved-other-recovery');
  resolve(hash);await new Promise(setImmediate);
  assert.equal(callbacks,0);
  if(altered)assert.equal(f.raw,'preserved-other-recovery');
  else{assert.equal(JSON.parse(f.raw!).status,'RETURNED');assert.equal(JSON.parse(f.raw!).sessionBinding,context.sessionBinding);assert.notEqual(f.raw,original)}
 }
});

test('malformed late return and unconfirmed recovery keep the original attempt non-retryable',async()=>{
 for(const invalid of [null,'0x1234',{},'untrusted']){
  const f=fixture();let resolve!:(value:unknown)=>void;
  const wallet={async request({method}:{method:string}){if(method==='eth_accounts')return [intent.sender];if(method==='eth_chainId')return '0x1917';return new Promise(done=>{resolve=done})}};
  await assert.rejects(sendExactCardFunding({...f.input,wallet,timeoutMs:1}),/OUTCOME_UNKNOWN/);
  resolve(invalid);await new Promise(setImmediate);
  assert.equal(JSON.parse(f.raw!).status,'UNKNOWN');
 }
});

test('recovery parser rejects extra sensitive fields, oversize and invalid container without writing',async()=>{
 const f=fixture();await sendExactCardFunding(f.input);const record=JSON.parse(f.raw!);
 for(const raw of [JSON.stringify({...record,privateKey:'must-not-be-accepted'}),' '.repeat(65_537),'[]','null'])assert.throws(()=>parseFundingSendRecord(raw,intent,context),/RECOVERY_REQUIRED/);
 assert.equal(parseFundingSendRecord(f.raw!,intent,context).txHash,hash);
});

test('fresh provider account and network checks block a changed selection before send',async()=>{
 for(const mode of ['account','chain','source'] as const){
  const f=fixture();let accountReads=0,current=true,sends=0;
  const wallet={async request({method}:{method:string}){
   if(method==='eth_accounts'){accountReads++;if(mode==='source'&&accountReads===2)current=false;return mode==='account'&&accountReads===2?['0x'+'3'.repeat(40),intent.sender]:[intent.sender]}
   if(method==='eth_chainId')return mode==='chain'&&accountReads===2?'0x1':'0x1917';
   sends++;return hash;
  }};
  await assert.rejects(sendExactCardFunding({...f.input,wallet,isCurrent:()=>current}),/OUTCOME_UNKNOWN/);
  assert.equal(sends,0);assert.equal(JSON.parse(f.raw!).status,'UNKNOWN');
 }
});

test('late hash stays on original intent but never updates a changed account or network',async()=>{
 for(const mode of ['account','chain','expired'] as const){
  const f=fixture();let resolve!:(value:unknown)=>void,changed=false,callbacks=0,time=now;
  const wallet={async request({method}:{method:string}){
   if(method==='eth_accounts')return changed&&mode==='account'?['0x'+'3'.repeat(40)]:[intent.sender];
   if(method==='eth_chainId')return changed&&mode==='chain'?'0x1':'0x1917';
   return new Promise(done=>{resolve=done});
  }};
  await assert.rejects(sendExactCardFunding({...f.input,wallet,timeoutMs:1,now:()=>time,onRecoveryRecord:()=>{callbacks++}}),/OUTCOME_UNKNOWN/);
  changed=true;if(mode==='expired')time=Date.parse(intent.expiresAt);
  resolve(hash);await new Promise(setImmediate);
  assert.equal(callbacks,0);const record=JSON.parse(f.raw!);
  assert.equal(record.status,'RETURNED');assert.equal(record.intentId,intent.id);assert.equal(record.sender,intent.sender);assert.equal(record.txHash,hash);
  assert.equal('credited' in record,false);
 }
});

test('slow readonly recheck cannot start a new transaction after the attempt already timed out',async()=>{
 const f=fixture();let accountReads=0,sends=0,release!:(value:unknown)=>void;
 const wallet={async request({method}:{method:string}){
  if(method==='eth_accounts'){accountReads++;return accountReads===2?new Promise(done=>{release=done}):[intent.sender]}
  if(method==='eth_chainId')return '0x1917';
  sends++;return hash;
 }};
 await assert.rejects(sendExactCardFunding({...f.input,wallet,timeoutMs:1}),/OUTCOME_UNKNOWN/);
 release([intent.sender]);await new Promise(setImmediate);
 assert.equal(sends,0);assert.equal(JSON.parse(f.raw!).status,'UNKNOWN');
});
