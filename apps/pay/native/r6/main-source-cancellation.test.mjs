import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createNativePayMainEntry} from './main-entry.mjs';
import {composeNativePayProductSource} from './product-source.mjs';

let outer=({entry})=>({invoke:input=>entry.invoke(input),cancel:()=>entry.cancel(),assertSafeToClose(){}});
if(process.env.PAY_MAIN_PRODUCT_MODULE){
 const file=process.env.PAY_MAIN_PRODUCT_MODULE;
 assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
 outer=(await import(pathToFileURL(file).href)).createWalletNativePayProduct;
}
for(const action of ['order-invoice','order-pay-review','order-refund-review'])test(`normal Main cancel aborts the same held ${action} Source read before review`,{timeout:5000},async t=>{
 let entered,remoteClosed,signal,liveRead=0,retired=0,joined=0,closed=0,payCalls=0,mainCalls=0,reads=0;
 const started=new Promise(resolve=>entered=resolve),remoteDone=new Promise(resolve=>remoteClosed=resolve),forbidden=()=>{mainCalls++;throw Error('cancelled read reached review/signing');};
 const server=createServer((request,response)=>{
  reads++;assert.equal(request.method,'GET');assert.equal(request.url,'/v5/shop/source/shop.order/invoice-intents/original-cancel-order');
  response.once('close',remoteClosed);entered(); // deliberately hold original response
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const main={pendingRequests:()=>[],requestPQTypedAction:forbidden,requestPQPayBroadcast:forbidden,reject:forbidden};
 const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:'0x'+'a'.repeat(40),revision:1,focused:true})});
 const loan={current(){},pay:{lookupInvoiceIntent(){payCalls++;throw Error('cancelled source reached Pay');}},
  async readOriginalShopNativeInvoiceRequestDATA(order,current){
   assert.equal(order,'original-cancel-order');signal=current.signal;assert(signal instanceof AbortSignal);liveRead++;
   try{await fetch(origin+'/v5/shop/source/shop.order/invoice-intents/'+order,{signal,redirect:'manual'});throw Error('held read unexpectedly completed');}
   finally{liveRead--;}
  },retire(){retired++;},join(){assert.equal(liveRead,0);joined++;},close(){closed++;}};
 const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:()=>loan,isOriginalProductSource:v=>v===loan});
 const service=outer({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:'0x'+'a'.repeat(40),assert(){}}),publishReview:forbidden});
 const request={action,productId:'shop.order',sourceOrder:'original-cancel-order',...(action==='order-refund-review'?{refundId:'refund-original',amountAtoms:'30'}:{})};
 const pending=service.invoke(request);await started;
 assert.equal(source.status().active,1);service.cancel();
 assert.equal(signal.aborted,true); // must reach the actual held read synchronously
 const result=await pending;
 await remoteDone;
 assert.equal(result.ok,false);assert.equal(result.reference,null);assert.deepEqual(result.recoveryActions,[]);assert.equal(result.walletRequest,undefined);
 assert.equal(payCalls,0);assert.equal(mainCalls,0);assert.equal(reads,1);assert.equal(source.status().active,0);
 service.assertSafeToClose();source.retire();await source.join();await source.close();source.assertSafeToClose();
 assert.deepEqual([retired,joined,closed],[1,1,1]);
 t.diagnostic(JSON.stringify({action,actualInstalledMainWrapper:!!process.env.PAY_MAIN_PRODUCT_MODULE,originalGET:reads,remoteConnectionClosed:true,sourceActive:source.status().active,review:mainCalls,payCalls,SourceAdmission:false}));
});
