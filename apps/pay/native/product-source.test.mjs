import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openNativePayProductSource,composeNativePayProductSource} from './product-source.mjs';
import {createNativePayMainEntry} from './main-entry.mjs';
import {createPrivateNativeInvoiceClient} from './merchant-invoice-approval.mjs';

// PUBLIC recognition/Source transport boundary; never genuine Native admission.
const merchant='0x'+'1'.repeat(40),id='npi_'+'a'.repeat(48);
const request=()=>({productId:'shop.order',storeId:'store-original',sourceOrder:'order-original',merchant,recipient:merchant,genesis:'7'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{schema:'ynx.shop.order.invoice/v1',order:{id:'order-original'},approvedNativePrice:{PriceApprovalRef:'original-approval'}}});
const view=r=>({intentId:id,originalOperation:id,request:r,merchant,state:'PREPARED',phase:'merchant_approval_required',terms:{recipient:merchant,amountAtoms:r.amountAtoms,assetId:'YNXT',unitVersion:'1'}});
function fixture({read=async()=>request(),transport}={}){
 let live=true;const calls=[],lifecycle=[];
 const pay=createPrivateNativeInvoiceClient({origin:'https://public-pay.example',async requestPrivate(r){r.assertCurrent();calls.push(r);if(transport)return transport(r);
  return{method:r.method,requestPath:r.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(view(JSON.parse(Buffer.from(r.body).toString()))))};}});
 const loan=Object.freeze({current(){if(!live)throw Object.assign(Error(),{code:'PUBLIC_PRODUCT_REVOKED'});},pay,readOriginalShopNativeInvoiceRequestDATA(order,current){current();assert.equal(order,'order-original');return read(order,current);},retire(){live=false;lifecycle.push('retire');},async join(){lifecycle.push('join');},async close(){lifecycle.push('close');}});
 return {calls,lifecycle,loan,revoke(){live=false;},factories:{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:value=>value===loan}};
}
test('normal startup composes original Shop request; lost create cold lookup never recreates/reprices',async()=>{
 const saved=request(),bodies=[];let creates=0,reads=0;
 const make=()=>fixture({read:async()=>{reads++;return saved;},transport(r){bodies.push(r.body);if(r.path.endsWith('/invoice-intents')){creates++;throw Object.assign(Error(),{code:'PUBLIC_LOST_RESPONSE'});}return{method:r.method,requestPath:r.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify(view(JSON.parse(Buffer.from(r.body).toString()))))};}});
 const entry=()=>createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true})});
 const a=make(),first=entry(),s1=await composeNativePayProductSource(first,a.factories);
 await assert.rejects(first.invoke({action:'create-intent',productId:'shop.order',sourceOrder:'order-original'}),{code:'PUBLIC_LOST_RESPONSE'});
 s1.retire();await s1.join();await s1.close();s1.assertSafeToClose();
 const b=make(),cold=entry(),s2=await composeNativePayProductSource(cold,b.factories);
 const result=await cold.invoke({action:'lookup-intent',productId:'shop.order',sourceOrder:'order-original'});
 assert.equal(result.queryOnly,true);assert.equal(creates,1);assert.equal(reads,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal(saved.amountAtoms,'100');
 assert.equal(s2.pay.submitSettlementPacket,undefined);assert.equal(s2.pay.submitRefundPacket,undefined);
 s2.retire();await s2.join();await s2.close();
});
test('current reaches actual private read; late invalidation and wrong Shop original cannot escape',async()=>{
 let finish,mainLive=true;const f=fixture({read:()=>new Promise(resolve=>finish=resolve)}),source=await openNativePayProductSource(f.factories);
 const pending=source.readOriginalInvoiceIntent({productId:'shop.order',sourceOrder:'order-original'},()=>{if(!mainLive)throw Error('MAIN_RETIRED');});
 mainLive=false;finish(request());await assert.rejects(pending,/MAIN_RETIRED/);assert.equal(f.calls.length,0);
 const wrong=fixture({read:async()=>({...request(),sourceOrder:'other-order'})}),s2=await openNativePayProductSource(wrong.factories);
 await assert.rejects(s2.readOriginalInvoiceIntent({productId:'shop.order',sourceOrder:'order-original'},()=>{}),{code:'NATIVE_PAY_PRODUCT_REFERENCE_CHANGED'});
 for(const s of [source,s2]){s.retire();await s.join();await s.close();}
});
test('held normal source is joined before close, revocation stops reads and preserves owner debt',async()=>{
 let release,joined=false;const f=fixture({read:()=>new Promise(resolve=>release=resolve)}),source=await openNativePayProductSource(f.factories);
 const read=source.readOriginalInvoiceIntent({productId:'shop.order',sourceOrder:'order-original'},()=>{});source.retire();
 const joining=source.join().then(()=>{joined=true;});assert.throws(()=>source.close(),{code:'NATIVE_PAY_PRODUCT_CHILDREN_RETAINED'});await Promise.resolve();assert.equal(joined,false);
 release(request());await assert.rejects(read,{code:'NATIVE_PAY_PRODUCT_SOURCE_UNAVAILABLE'});await joining;await source.close();source.assertSafeToClose();assert.deepEqual(f.lifecycle,['retire','join','close']);
});
test('original terms fallback keeps historical bytes; no remote payer context is invented',async()=>{
 const terms=Buffer.from('PUBLIC retained canonical action DATA'),termsHash=createHash('sha256').update(terms).digest('hex');
 const f=fixture({transport(r){assert.equal(r.method,'GET');return{method:r.method,requestPath:r.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify({merchant,invoiceId:'original',termsNativeHash:'0x'+'2'.repeat(64),settlementNativeHash:'',termsMessage:terms.toString('base64'),termsHash}))};}}),source=await openNativePayProductSource(f.factories);
 const ref={merchant,invoiceId:'original',termsNativeHash:'0x'+'2'.repeat(64),settlementNativeHash:'',kind:'invoice_settle'};
 const original=await source.readInvoiceOriginals(ref,()=>{});assert.deepEqual(Buffer.from(original.termsMessage),terms);assert.equal(original.settlement,null);
 await assert.rejects(source.readInvoiceOriginals({...ref,kind:'invoice_refund'},()=>{}),{code:'NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE'});
 let live=false;await assert.rejects(source.pay.readInvoice(merchant,'original',()=>{if(!live)throw Error('MAIN_LOCKED');}),/MAIN_LOCKED/);assert.equal(f.calls.length,2);
 source.retire();await source.join();await source.close();
});
test('startup error partial retains original owner and falsy cause; UNKNOWN close is never repeated',async()=>{
 let closes=0;const loan={pay:{},current(){},retire(){},async join(){},async close(){closes++;throw false;}};
 let failure;try{await openNativePayProductSource({acquireOriginalProductSource:async()=>{throw {partial:loan,cause:'PUBLIC'};},isOriginalProductSource:v=>v===loan});}catch(cause){failure=cause;}
 assert.ok(failure.partial);assert.equal(failure.cause.partial,loan);const source=failure.partial;source.retire();await source.join();
 for(let i=0;i<2;i++)await assert.rejects(source.close(),cause=>cause===false);assert.equal(closes,1);assert.throws(()=>source.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED'});
 let empty;try{await openNativePayProductSource({acquireOriginalProductSource:async()=>{throw false;},isOriginalProductSource:()=>false});}catch(cause){empty=cause;}assert.equal(empty.cause,false);empty.partial.retire();await empty.partial.join();await empty.partial.close();
});
test('foreign partial is retained without calling its methods or proxy traps',async()=>{
 let calls=0;const foreign={pay:{},current(){calls++;},retire(){calls++;},join(){calls++;},close(){calls++;}};
 let caught;try{await openNativePayProductSource({acquireOriginalProductSource:async()=>{throw {partial:foreign};},isOriginalProductSource:()=>false});}catch(error){caught=error;}
 const source=caught.partial;assert.throws(()=>source.retire(),{code:'NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED'});
 await assert.rejects(source.join(),{code:'NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED'});assert.throws(()=>source.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED'});assert.equal(calls,0);
 const proxy=new Proxy({},{getOwnPropertyDescriptor(){calls++;throw Error('TRAP');}});
 try{await openNativePayProductSource({acquireOriginalProductSource:async()=>{throw proxy;},isOriginalProductSource:()=>false});}catch(error){assert.equal(error.cause,proxy);error.partial.retire();await error.partial.join();await error.partial.close();}
 assert.equal(calls,0);
});
test('missing product getter blocks only original-intent reads; actual Source503 is preserved',async()=>{
 let denied=false,calls=0;const pay=createPrivateNativeInvoiceClient({origin:'https://public-pay.example',async requestPrivate(r){r.assertCurrent();calls++;return{method:r.method,requestPath:r.path,status:denied?503:200,contentType:'application/json',body:Buffer.from(JSON.stringify(denied?{code:'NATIVE_PAY_AUTHORITY_UNAVAILABLE',error:'PUBLIC missing Source'}:{merchant,invoiceId:'original'}))};}});
 const loan={pay,current(){},retire(){},async join(){},async close(){}};
 const source=await openNativePayProductSource({acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
 await assert.rejects(source.readOriginalInvoiceIntent({productId:'shop.order',sourceOrder:'order-original'},()=>{}),{code:'NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE'});
 assert.equal((await source.pay.readInvoice(merchant,'original',()=>{})).invoiceId,'original');
 denied=true;await assert.rejects(source.pay.readInvoice(merchant,'original',()=>{}),{code:'NATIVE_PAY_AUTHORITY_UNAVAILABLE',status:503,method:'GET',requestPath:`/v5/pay/invoices/${merchant}/original`});assert.equal(calls,2);
 source.retire();await source.join();await source.close();
});
test('actual preparation transport receives both fences before its write and observes retirement cancellation',async()=>{
 let release,signal,writes=0,live=true;
 const pay=createPrivateNativeInvoiceClient({origin:'https://public-pay.example',async requestPrivate(r){
  signal=r.assertCurrent.signal;await new Promise(resolve=>release=resolve);r.assertCurrent();writes++;
  return{method:r.method,requestPath:r.path,status:200,contentType:'application/json',body:Buffer.from('{}')};
 }});
 const loan={pay,current(){},retire(){},async join(){},async close(){}},source=await openNativePayProductSource({acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
 const pending=source.pay.reviewRefund(merchant,'original','refund-original','3',()=>{if(!live)throw Error('MAIN_LOCKED_BEFORE_WRITE');});
 assert.equal(signal.aborted,false);live=false;release();await assert.rejects(pending,/MAIN_LOCKED_BEFORE_WRITE/);assert.equal(writes,0);
 live=true;const retired=source.pay.reviewRefund(merchant,'original','refund-original','3',()=>{});source.retire();assert.equal(signal.aborted,true);release();await assert.rejects(retired,{code:'NATIVE_PAY_PRODUCT_SOURCE_UNAVAILABLE'});
 await source.join();await source.close();assert.equal(writes,0);
});
