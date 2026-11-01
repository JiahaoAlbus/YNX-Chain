// PUBLIC test-control transport only. Production uses original qualified
// Source/LINK; this driver grants no Root, Native custody or signing approval.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPrivateNativeInvoiceClient} from '../merchant-invoice-approval.mjs';
import {NativePayBusinessClient} from '../pay-business-client.mjs';
const original=JSON.parse(fs.readFileSync(process.env.PAY_PRODUCT_INTENT_REQUEST,'utf8')),calls=[];
let lose=process.env.PAY_PRODUCT_INTENT_SCENARIO==='create-loss';
const pay=createPrivateNativeInvoiceClient({origin:process.env.PAY_PRODUCT_INTENT_ORIGIN,async requestPrivate(r){
 r.assertCurrent?.();calls.push({method:r.method,path:r.path,body:Buffer.from(r.body??[]).toString()});
 const response=await fetch(r.origin+r.path,{method:r.method,body:r.body,headers:{'Content-Type':'application/json'},redirect:'manual'});
 const body=new Uint8Array(await response.arrayBuffer());
 if(lose){lose=false;throw Object.assign(Error('PUBLIC reply lost after original server read'),{code:'PUBLIC_RESPONSE_LOST'});}
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),body};
}});
const runtime={pay,current(){},readOriginalInvoiceIntent(ref,current){current();assert.equal(ref.productId,original.productId);assert.equal(ref.sourceOrder,original.sourceOrder);return original;}};
if(process.env.PAY_PRODUCT_INTENT_SCENARIO==='denied'){
 const client=new NativePayBusinessClient(runtime);await assert.rejects(client.lookupOriginalInvoiceIntent(original.productId,original.sourceOrder),{code:'NATIVE_PAY_AUTHORITY_UNAVAILABLE',status:503});
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/v5/pay/invoice-intents/lookup');
 console.log(JSON.stringify({actualPrivateRefusal503:true,clientIndependentFinality:false,dispatched:1}));
}else if(process.env.PAY_PRODUCT_INTENT_SCENARIO==='create-loss'){
 const client=new NativePayBusinessClient(runtime);await assert.rejects(client.createInvoiceIntent(original.productId,original.sourceOrder),{code:'PUBLIC_RESPONSE_LOST'});assert.equal(client.snapshot().recoveryOnly,true);
 assert.equal(calls.length,1);console.log(JSON.stringify({createCalls:1,replyLostAfterOriginalPersist:true,clientIndependentFinality:false}));
}else{
 const cold=new NativePayBusinessClient(runtime),state=await cold.lookupOriginalInvoiceIntent(original.productId,original.sourceOrder);
 assert.equal(state.queryOnly,true);assert.equal(state.intent.state,'PREPARED');assert.equal(state.intent.originalOperation,state.intent.intentId);assert.equal(state.clientIndependentFinality,false);
 const read=await cold.openIntent(state.intent.intentId);assert.equal(read.intent.originalOperation,state.intent.intentId);
 assert.deepEqual(calls.map(c=>c.path),['/v5/pay/invoice-intents/lookup','/v5/pay/invoice-intents/'+state.intent.intentId]);assert.deepEqual(JSON.parse(calls[0].body),original);
 console.log(JSON.stringify({createCalls:0,lookupCalls:1,originalReadCalls:1,originalOperation:state.intent.intentId,merchantSigningRequired:true,clientIndependentFinality:false}));
}
