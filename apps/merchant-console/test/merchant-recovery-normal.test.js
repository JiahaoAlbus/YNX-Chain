import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMutationRecovery} from '../src/mutation-recovery.js';
import {createRequestContext,merchantFailureMessage} from '../src/request-context.js';

globalThis.YNX_PAY_API_URL='https://commerce-qa.invalid';
const {PayAPI}=await import('../src/api.js?original-recovery-normal');
const subject={account:'ynx1'+'q'.repeat(38),merchantId:'mrc_original'};
const body={description:'Original invoice',amount:8,expiresInMinutes:30};

test('normal merchant entry preserves lost original through missing authority and current, then reads the same invoice',async()=>{
 const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 const recovery=createMutationRecovery({storage,withLock:async(_,work)=>work(),digest:text=>createHash('sha256').update(text).digest('hex'),newKey:()=> 'original-invoice-intent'});
 const current=createRequestContext(()=>subject.account+'|'+subject.merchantId),api=new PayAPI('controlled-session',current,async(_,options)=>options);
 const before=globalThis.fetch;let created=0,readbacks=0,originalWire;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/v1/merchant/invoices')){created++;originalWire=JSON.parse(options.body);throw Error('original response lost');}
  assert.ok(url.endsWith('/v1/merchant/mutations/lookup'));
  const lookup=JSON.parse(options.body);assert.deepEqual(JSON.parse(lookup.originalBody),originalWire);
  readbacks++;
  if(readbacks===1)return new Response(JSON.stringify({error:'ORIGINAL_AUTHORITY_REQUIRED',code:'ORIGINAL_AUTHORITY_REQUIRED'}),{status:503});
  if(readbacks===2)return new Response(JSON.stringify({error:'INVALID_SESSION',code:'INVALID_SESSION'}),{status:403});
  return new Response(JSON.stringify({...subject,method:'POST',path:'/v1/merchant/invoices',idempotencyKey:originalWire.idempotencyKey,result:{id:'invoice-original',merchantId:subject.merchantId}}));
 };
 const execute=()=>recovery.execute(subject,'invoice-form',body,current.capture(),(value,mark)=>api.invoice(value,mark),value=>api.lookupMutation(subject,'POST','/v1/merchant/invoices',value));
 try{
  await assert.rejects(execute(),/original response lost/);
  const original=await recovery.pending(subject,'invoice-form');assert.equal(original.key,'original-invoice-intent');
  await assert.rejects(execute(),error=>error.code==='ORIGINAL_AUTHORITY_REQUIRED'&&/authorization is unavailable/.test(merchantFailureMessage(error)));
  assert.deepEqual(await recovery.pending(subject,'invoice-form'),original);
  await assert.rejects(execute(),error=>error.code==='INVALID_SESSION'&&/current merchant session/.test(merchantFailureMessage(error)));
  assert.deepEqual(await recovery.pending(subject,'invoice-form'),original);
  const result=await execute();assert.equal(result.id,'invoice-original');assert.equal(result.merchantId,subject.merchantId);
  assert.equal(await recovery.pending(subject,'invoice-form'),null);
  assert.equal(created,1);assert.equal(readbacks,3);
 }finally{globalThis.fetch=before}
});
