import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeInvoiceProductIntentData} from './invoice-product-intent.mjs';
import {createPrivateNativeInvoiceClient} from './merchant-invoice-approval.mjs';
import {createNativePayMainEntry} from './main-entry.mjs';

const merchant='0x'+'1'.repeat(40),intentId='npi_'+'1'.repeat(48);
const original=()=>({productId:'shop.order',storeId:'store-original',sourceOrder:'order-original',merchant,recipient:merchant,genesis:'7'.repeat(64),nativeChainId:'6423',assetId:'YNXT',unitVersion:'1',amountAtoms:'100',domainData:{priceApproval:'original-only',items:[{sku:'sku-original',amountAtoms:'100'}]}});
const view=request=>({intentId,originalOperation:intentId,request,merchant,state:'PREPARED',phase:'merchant_approval_required',terms:{recipient:merchant,amountAtoms:'100',assetId:'YNXT',unitVersion:'1'}});
const response=(request,value,status=200)=>({method:request.method,requestPath:request.path,status,contentType:'application/json',body:Buffer.from(JSON.stringify(value))});

test('normal create and cold lookup preserve the original request; response loss never retries create',async()=>{
 const calls=[],saved=original();let live=true;
 const pay=createPrivateNativeInvoiceClient({origin:'https://pay.ynx.test',async requestPrivate(request){request.assertCurrent();calls.push(request);if(request.path==='/v5/pay/invoice-intents')throw Object.assign(Error(),{code:'PUBLIC_RESPONSE_LOST'});return response(request,view(JSON.parse(Buffer.from(request.body).toString())));}});
 const make=()=>{const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,revision:1,focused:true,locked:false,changing:false})});entry.compose({pay,current(){if(!live)throw Object.assign(Error(),{code:'SOURCE_RETIRED'});},readOriginalInvoiceIntent(ref,current){current();assert.deepEqual(ref,{productId:'shop.order',sourceOrder:'order-original'});return saved;}});return entry;};
 await assert.rejects(make().invoke({action:'create-intent',productId:'shop.order',sourceOrder:'order-original'}),{code:'PUBLIC_RESPONSE_LOST'});
 const cold=await make().invoke({action:'lookup-intent',productId:'shop.order',sourceOrder:'order-original'});
 assert.equal(cold.queryOnly,true);assert.equal(cold.intent.originalOperation,intentId);assert.equal(cold.clientIndependentFinality,false);
 assert.deepEqual(calls.map(x=>x.path),['/v5/pay/invoice-intents','/v5/pay/invoice-intents/lookup']);assert.deepEqual(calls[0].body,calls[1].body);
 assert.equal(cold.domainData,undefined);assert.equal(cold.intent.request,undefined);
 live=false;await assert.rejects(make().invoke({action:'lookup-intent',productId:'shop.order',sourceOrder:'order-original'}),{code:'SOURCE_RETIRED'});assert.equal(calls.length,2);
});

test('missing Source reader and renderer price overrides cannot create or query an intent',async()=>{
 let calls=0;const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:merchant,focused:true})});entry.compose({current(){},pay:{createInvoiceIntent(){calls++;}}});
 await assert.rejects(entry.invoke({action:'create-intent',productId:'shop.order',sourceOrder:'order-original'}),{code:'NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE'});
 await assert.rejects(entry.invoke({action:'create-intent',productId:'shop.order',sourceOrder:'order-original',amountAtoms:'1'}),{code:'NATIVE_PAY_MAIN_INPUT_INVALID'});assert.equal(calls,0);
});

test('original DATA copy rejects executable properties and detaches bounded domain data',()=>{
 let effects=0;const value=original();Object.defineProperty(value,'amountAtoms',{enumerable:true,get(){effects++;return '1';}});
 assert.throws(()=>nativeInvoiceProductIntentData(value),{code:'NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'});assert.equal(effects,0);
 assert.throws(()=>nativeInvoiceProductIntentData({...original(),domainData:{toJSON(){effects++;return {};}}}));assert.equal(effects,0);
 assert.throws(()=>nativeInvoiceProductIntentData({...original(),amountAtoms:'18446744073709551616'}));
 assert.throws(()=>nativeInvoiceProductIntentData({...original(),domainData:{raw:'x'.repeat(65536)}}));
 const input=original(),copy=nativeInvoiceProductIntentData(input);input.domainData.items[0].amountAtoms='1';assert.equal(copy.domainData.items[0].amountAtoms,'100');
});

test('actual authority refusal stays distinct from request rejection and cannot become a paid projection',async()=>{
 for(const [status,code] of [[503,'NATIVE_PAY_AUTHORITY_UNAVAILABLE'],[409,'NATIVE_PAY_REQUEST_REJECTED']]){
  let calls=0;const pay=createPrivateNativeInvoiceClient({origin:'https://pay.ynx.test',async requestPrivate(r){calls++;return response(r,{code,error:'unavailable'},status);}});
  await assert.rejects(pay.createInvoiceIntent(original(),()=>{}),error=>error.code===code&&error.status===status&&error.requestPath==='/v5/pay/invoice-intents');assert.equal(calls,1);
 }
 const pay=createPrivateNativeInvoiceClient({origin:'https://pay.ynx.test',async requestPrivate(r){return response(r,view({...original(),amountAtoms:'1'}));}});
 await assert.rejects(pay.lookupInvoiceIntent(original(),()=>{}),{code:'NATIVE_PAY_ORIGINAL_PRODUCT_INTENT_INVALID'});
});
