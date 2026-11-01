import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopWalletAuthority} from '../src/desktop-wallet-authority.mjs';
import {formatApprovalReview} from '../src/approval-review-display.mjs';
const hash='0x'+'aa'.repeat(32),merchant='0x'+'bb'.repeat(20);
test('actual Main Pay callee requires original Source and never falls back to Core or touches custody',async()=>{
 let core=0,custody=0;
 const unavailable=new Proxy({}, {get(){custody++;throw Error('CUSTODY_MUST_NOT_BE_READ');}});
 const authority=new DesktopWalletAuthority({vault:unavailable,permissions:unavailable,transactionSender:unavailable,pqBroadcastSource:()=>{core++;throw Error('CORE_MUST_NOT_RUN');}});
 for(const ref of [{hash,kind:'invoice_terms',intentId:'npi_'+'ab'.repeat(24)},{hash,kind:'invoice_settle',merchant,invoiceId:'original'},{hash,kind:'invoice_refund',merchant,invoiceId:'original'}]){
  await assert.rejects(authority.requestPQPayBroadcast(ref),e=>e.data?.code==='PQ_PAY_BROADCAST_SOURCE_NOT_SUPPLIED');
 }
 assert.equal(core,0);assert.equal(custody,0);assert.equal(authority.pending.size,0);
});
test('actual Main reference rejects extra authority/URL fields, getters and proxies without evaluating them',async()=>{
 const authority=new DesktopWalletAuthority({});let reads=0;
 const valid={hash,kind:'invoice_terms',intentId:'npi_'+'ab'.repeat(24)};
 for(const ref of [{...valid,approved:true},{...valid,url:'https://attacker.invalid'},{...valid,originalHash:hash},{...valid,amount:'1'},Object.defineProperty({...valid},'hash',{get(){reads++;return hash;},enumerable:true}),new Proxy(valid,{get(){reads++;return hash;}})]){
  await assert.rejects(authority.requestPQPayBroadcast(ref),e=>e.data?.code==='PQ_PAY_REFERENCE_INVALID');
 }
 assert.equal(reads,0);
});
test('same broadcast review displays actual Pay route and original invoice reference',()=>{
 const view=formatApprovalReview({title:'Submit invoice',payTarget:{version:1,service:'pay',kind:'invoice_terms',intentId:'npi_original',merchant,invoiceId:'original',requestPath:'/v5/pay/invoice-intents/npi_original/merchant-member'}});
 assert.match(view,/Submission destination/);assert.match(view,/\/v5\/pay\/invoice-intents\/npi_original\/merchant-member/);
});
