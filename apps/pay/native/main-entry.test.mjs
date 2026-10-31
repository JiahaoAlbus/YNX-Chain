import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePayMainEntry} from './main-entry.mjs';
import {createPrivateNativeInvoiceClient} from './merchant-invoice-approval.mjs';
test('normal Main boot entry is closed without Source; renderer cannot compose or approve',async()=>{
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({})});
 assert.equal(entry.status().available,false);
 for(const action of ['approve','submit','compose'])await assert.rejects(entry.invoke({action}),{code:'NATIVE_PAY_MAIN_INPUT_INVALID'});
 await assert.rejects(entry.invoke({action:'invoice',merchant:'m',invoiceId:'i'}),{code:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE'});
});
test('normal Main entry reads original Pay and invalidates late account/source responses',async()=>{
 let account='0x'+'1'.repeat(40),resolve,live=true;const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account,revision:1,focused:true,locked:false,changing:false})});
 entry.compose({current(){if(!live)throw Object.assign(Error(),{code:'SOURCE_RETIRED'})},pay:{readInvoice:()=>new Promise(r=>resolve=r)}});
 const pending=entry.invoke({action:'invoice',merchant:account,invoiceId:'invoice-100'});account='0x'+'2'.repeat(40);resolve({paidAtoms:'100'});
 await assert.rejects(pending,{code:'NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE'});
 live=false;await assert.rejects(entry.invoke({action:'invoice',merchant:account,invoiceId:'invoice-100'}),{code:'SOURCE_RETIRED'});
 assert.throws(()=>entry.compose({}),{code:'NATIVE_PAY_MAIN_ALREADY_COMPOSED'});
});
test('normal Main input rejects accessors and extra caller authority without invoking them',async()=>{
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({})});let invoked=0;
 const request={merchant:'m',invoiceId:'i'};Object.defineProperty(request,'action',{enumerable:true,get(){invoked++;return 'invoice'}});
 await assert.rejects(entry.invoke(request),{code:'NATIVE_PAY_MAIN_INPUT_INVALID'});
 await assert.rejects(entry.invoke({action:'invoice',merchant:'m',invoiceId:'i',approved:true}),{code:'NATIVE_PAY_MAIN_INPUT_INVALID'});assert.equal(invoked,0);
});
test('normal dispatcher packets keep actual Pay path/status/body even after late lock; no retry',async()=>{
 const merchant='0x'+'1'.repeat(40),id='invoice-100',intent='npi_'+'1'.repeat(48),calls=[];let live=true;
 const bytes=Buffer.from('{"error":"actual refusal"}');
 const pay=createPrivateNativeInvoiceClient({origin:'https://pay.example',async requestPrivate(request){
  request.assertCurrent();calls.push(request);live=false;return {method:request.method,requestPath:request.path,status:422,contentType:'application/json',cacheControl:'no-store',body:bytes};
 }});
 const current=()=>{if(!live)throw Error('LOCKED')};
 const packet=await pay.submitSettlementPacket(merchant,id,Uint8Array.of(1,2),current);
 assert.equal(packet.status,422);assert.equal(packet.requestPath,`/v5/pay/invoices/${merchant}/${id}/settlements`);assert.equal(calls.length,1);assert.equal(packet.cacheControl,'no-store');
 assert.deepEqual(JSON.parse(Buffer.from(calls[0].body).toString()),{member:'AQI='});bytes.fill(0);assert.equal(Buffer.from(packet.body).toString(),'{"error":"actual refusal"}');
 await assert.rejects(pay.submitRefundPacket(merchant,id,Uint8Array.of(1),current),/LOCKED/);assert.equal(calls.length,1);
 live=true;await pay.submitMerchantMemberPacket(intent,Uint8Array.of(1),current);assert.equal(calls[1].path,`/v5/pay/invoice-intents/${intent}/merchant-member`);
});
