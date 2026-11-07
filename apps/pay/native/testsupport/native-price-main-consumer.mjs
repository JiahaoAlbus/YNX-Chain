// New Seller-price -> normal Pay -> installed original Main review delta.
// All authority is explicitly PUBLIC test control; no Native grant is created.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import https from 'node:https';
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const read=async()=>{const x=await lines.next();assert.equal(x.done,false);return JSON.parse(x.value);};
const input=await read(),{original,origin,publicAuthorization}=input,root=process.env.PAY_CLIENT_MAIN_SOURCE;
const sdk=path.join(root,'packages/wallet-auth'),nodeExport=v=>typeof v==='string'?v:v&&nodeExport(v.node??v.import??v.default);
const exports=JSON.parse(fs.readFileSync(path.join(sdk,'package.json'))).exports;
const paths=new Map(Object.entries(exports).flatMap(([k,v])=>{const target=nodeExport(v);return target?[['@ynx-chain/wallet-auth'+(k==='.'?'':k.slice(1)),pathToFileURL(path.join(sdk,target)).href]]:[];}));
registerHooks({resolve(s,c,next){return paths.has(s)?{url:paths.get(s),shortCircuit:true}:next(s,c);}});
const runtimeDir=path.join(root,'apps/wallet-desktop/src/native-pay-client');
for(const r of input.payPins){assert.equal(createHash('sha256').update(fs.readFileSync(path.join(runtimeDir,r.name))).digest('hex'),r.sha256);}
const {createNativePayMainEntry}=await import(pathToFileURL(path.join(runtimeDir,'main-entry.mjs')));
const {composeNativePayProductSource}=await import(pathToFileURL(path.join(runtimeDir,'product-source.mjs')));
const {createPrivateNativeProductPayClient}=await import(pathToFileURL(path.join(runtimeDir,'merchant-invoice-approval.mjs')));
const {decodePQNativeAction,encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const typed=await import(pathToFileURL(path.join(root,'apps/wallet-desktop/src/features/pq-transaction/typed-action-caller.mjs')));
const wrapper=path.join(root,'apps/wallet-desktop/src/wallet-native-pay-product.mjs');
assert.equal(createHash('sha256').update(fs.readFileSync(wrapper)).digest('hex'),input.wrapperSHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(wrapper));
const snapshot=parsePQAccountAuthorization(publicAuthorization,{owner:original.merchant,chainId:original.genesis,nativeChainId:original.nativeChainId});
const calls=[],pending=new Map();let live=true,reviews=0,published=0,rejected=0,preparedMessage;
const current=()=>{if(!live)throw Object.assign(Error('PUBLIC original current retired'),{code:'PUBLIC_ORIGINAL_CURRENT_RETIRED'});};
async function exchange(type,reference){process.stdout.write(JSON.stringify({type,reference})+'\n');const v=await read();if(v.error)throw Object.assign(Error(v.error),{code:v.error});return v;}
const pay=createPrivateNativeProductPayClient({origin,async requestPrivate(r){
 r.assertCurrent();assert.ok(r.method==='POST'&&(r.path==='/v5/pay/invoice-intents/lookup'||r.path.endsWith('/merchant-review')));
 calls.push({method:r.method,path:r.path});
 if(r.path.endsWith('/lookup'))assert.deepEqual(JSON.parse(Buffer.from(r.body)),original);
 const response=await new Promise((resolve,reject)=>{
  const request=https.request(origin+r.path,{method:r.method,ca:input.certificate,rejectUnauthorized:true,headers:{'Content-Type':'application/json'}},response=>{const chunks=[];response.on('data',x=>chunks.push(x));response.on('end',()=>resolve({status:response.statusCode,contentType:response.headers['content-type'],body:Buffer.concat(chunks)}));});
  request.on('error',reject);r.assertCurrent();request.end(r.body);
 }),body=response.body;
 if(r.path.endsWith('/merchant-review'))preparedMessage=Buffer.from(JSON.parse(Buffer.from(body)).message,'base64');
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.contentType,body};
}});
const main={pendingRequests:()=>[...pending.values()],reject(id){assert.equal(pending.delete(id),true);rejected++;},vault:{async status(){return {initialized:true,account:original.merchant};}},transactionSender:{submissions:{intentStore:{async readPQOriginals(){return [];},async unresolvedPreparation(){return false;}}}},async requestPQTypedAction(r){
 const action=decodePQNativeAction(preparedMessage);assert.equal(action.kind,'invoice_terms');assert.equal(action.payload.amount,'9');assert.deepEqual(r.payload,action.payload);
 const review=typed.preparePQTypedActionReview(snapshot,{...action,...r},{operationId:'PUBLIC-price-original-terms',account:original.merchant,networkId:original.genesis,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
 assert.deepEqual(Buffer.from(encodePQNativeAction(review.action)),preparedMessage);
 const request={id:'PUBLIC-price-terms',method:'ynx_signPQNativeAction',review:{account:original.merchant,typedReview:review,invoice:typed.readPQTypedActionInvoiceReviewData(review)}};
 reviews++;pending.set(request.id,request);return {status:'approval-required',request};
}};
const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:original.merchant,revision:1,focused:true})});
const loan={pay,current,retire(){},async join(){},async close(){},async readOriginalShopNativeInvoiceRequestDATA(order,fence){fence();assert.equal(order,original.sourceOrder);const v=await exchange('source-read',{productId:'shop.order',sourceOrder:order});if(v.retire)live=false;fence();return v.original;}};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:original.merchant,assert(){current();}}),publishReview(r){assert.equal(pending.get(r.id),r);published++;}});
const ref={productId:original.productId,sourceOrder:original.sourceOrder};
try{
 const first=await service.invoke({action:'order-invoice',...ref});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.intent.state,'PREPARED');assert.equal(first.reference.intentId,input.intentId);assert.equal(first.queryOnly,true);
 const review=await service.invoke({action:'order-terms-review',...ref});assert.equal(review.ok,true,JSON.stringify(review));assert.equal(review.reference.intentId,input.intentId);assert.equal(review.walletRequest.id,'PUBLIC-price-terms');assert.equal(published,1);
 service.cancel();service.cancel();assert.equal(rejected,1);assert.equal(pending.size,0);
 const cold=await exchange('reprice-cold',ref);assert.deepEqual(cold.original,original);assert.equal(cold.nativeAtoms,'9');assert.equal(cold.legacyTotal,25);assert.equal(cold.todayUnitAtoms,'999');
 const recovered=await service.invoke({action:'order-invoice',...ref});assert.equal(recovered.ok,true);assert.equal(recovered.intent.originalOperation,input.intentId);assert.equal(recovered.canRetry,false);
 for(const action of ['order-pay-review','order-refund-review']){const result=await service.invoke({action,...ref,...(action==='order-refund-review'?{refundId:'original-refund',amountAtoms:'1'}:{})});assert.equal(result.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');assert.equal(result.canRetry,false);}
 await exchange('retire-next-source-read',ref);
 // The actual original read finishes, then current retires before lookup.
 const before=calls.length;let failure;try{await service.invoke({action:'order-invoice',...ref});}catch(e){failure=e;}
 assert.equal(failure.code,'PUBLIC_ORIGINAL_CURRENT_RETIRED');assert.equal(calls.length,before);assert.equal(reviews,1);service.assertSafeToClose();
 process.stdout.write(JSON.stringify({type:'done',nativeAtoms:'9',legacyTotal:25,sameIntentId:input.intentId,published,rejected,reviews,lookupRequests:calls.filter(c=>c.path.endsWith('/lookup')).length,signing:0,moneyPOST:0,SourceAdmission:false,installedMainModules:true})+'\n');
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();await lines.return();}
