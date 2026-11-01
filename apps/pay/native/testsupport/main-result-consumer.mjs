// New real normal Go private service + original Wallet Main product wrapper.
// Source/account guards and response loss are PUBLIC test controls only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readNativePayFailureCause} from '../r6/pay-business-client.mjs';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeInvoiceClient} from '../r6/merchant-invoice-approval.mjs';
const wrapper=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(wrapper)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(wrapper).href);
const original=JSON.parse(fs.readFileSync(process.env.PAY_MAIN_RESULT_REQUEST,'utf8')),scenario=process.env.PAY_MAIN_RESULT_SCENARIO,calls=[];
let lose=scenario==='create-loss',reviews=0;
const pay=createPrivateNativeInvoiceClient({origin:process.env.PAY_MAIN_RESULT_ORIGIN,async requestPrivate(r){
 r.assertCurrent();calls.push({method:r.method,path:r.path,body:r.body?Buffer.from(r.body).toString():null});
 const response=await fetch(r.origin+r.path,{method:r.method,body:r.body,headers:r.body?{'Content-Type':'application/json'}:{},redirect:'manual'}),body=new Uint8Array(await response.arrayBuffer());
 if(lose){lose=false;assert.equal(response.status,202);throw Object.assign(Error('PRIVATE_REPLY_DIAGNOSTIC_NOT_UI'),{code:'PUBLIC_REPLY_LOST_AFTER_ORIGINAL_PERSIST'});}
 return{method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),body};
}});
const main={pendingRequests:()=>[]},entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:original.merchant,revision:1,focused:true})});
const loan={pay,current(){},retire(){},async join(){},async close(){},readOriginalInvoiceIntent(ref,current){current();assert.deepEqual(ref,{productId:original.productId,sourceOrder:original.sourceOrder});return original;}};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
// This is the precise Main-boot selection supplied to P01; it adds no IPC
// action or approval. The existing Main guard/publishReview path still runs.
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:original.merchant,assert(){}}),publishReview(){reviews++;throw Error('No approval expected');}});
try{
 let result;
 if(scenario==='create-loss'){
  result=await service.invoke({action:'create-intent',productId:original.productId,sourceOrder:original.sourceOrder});
  assert.equal(result.ok,false);assert.equal(result.outcome,'UNKNOWN');assert.equal(result.recoveryOnly,true);assert.equal(result.code,'PUBLIC_REPLY_LOST_AFTER_ORIGINAL_PERSIST');assert.equal(readNativePayFailureCause(result).cause.message,'PRIVATE_REPLY_DIAGNOSTIC_NOT_UI');
  assert.deepEqual(result.recoveryActions,[{action:'lookup-intent',productId:original.productId,sourceOrder:original.sourceOrder}]);assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/v5/pay/invoice-intents');assert.deepEqual(JSON.parse(calls[0].body),original);
 }else if(scenario==='cold-lookup'){
  const recovery=JSON.parse(process.env.PAY_MAIN_RESULT_RECOVERY);result=await service.invoke(recovery);
  assert.equal(result.ok,true);assert.equal(result.queryOnly,true);assert.equal(result.intent.state,'PREPARED');assert.equal(result.intent.intentId,result.intent.originalOperation);assert.equal(result.intent.termsNativeHash,'');
  const read=await service.invoke({action:'intent',intentId:result.intent.intentId});assert.equal(read.ok,true);assert.equal(read.intent.intentId,result.intent.intentId);
  assert.deepEqual(calls.map(c=>[c.method,c.path]),[['POST','/v5/pay/invoice-intents/lookup'],['GET','/v5/pay/invoice-intents/'+result.intent.intentId]]);assert.deepEqual(JSON.parse(calls[0].body),original);
 }else{
  result=await service.invoke(JSON.parse(process.env.PAY_MAIN_RESULT_RECOVERY));assert.equal(result.ok,false);assert.equal(result.code,'NATIVE_PAY_AUTHORITY_UNAVAILABLE');assert.equal(result.httpStatus,503);assert.equal(readNativePayFailureCause(result).cause.status,503);assert.equal(result.canRetry,false);assert.equal(calls.length,1);
 }
 assert.equal(reviews,0);assert.equal(result.clientIndependentFinality,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REPLY|termsMember|termsEnvelope|signingMessage|domainData/);
 service.assertSafeToClose();
 console.log(JSON.stringify({scenario,result,calls:calls.map(({method,path})=>({method,path})),originalMainProductWrapper:true,SourceAdmission:false,reviews,CoreMoneyPOST:0}));
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
