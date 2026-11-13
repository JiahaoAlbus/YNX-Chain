// PUBLIC review handoff only. The exact original SDK codec and Main typed
// review producer run; no approve, key, signer or Member submission is exposed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeProductPayClient} from '../r6/merchant-invoice-approval.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8')),{original,stage,origin}=input;
const root=process.env.PAY_CLIENT_MAIN_SOURCE,sdk=path.join(root,'packages/wallet-auth');
const require=createRequire(path.join(root,'apps/wallet-desktop/package.json'));
const nodeExport=v=>typeof v==='string'?v:v&&nodeExport(v.node??v.import??v.default);
const exports=JSON.parse(fs.readFileSync(path.join(sdk,'package.json'))).exports;
const paths=new Map(Object.entries(exports).flatMap(([key,v])=>{const target=nodeExport(v);return target?[['@ynx-chain/wallet-auth'+(key==='.'?'':key.slice(1)),pathToFileURL(path.join(sdk,target)).href]]:[];}));
registerHooks({resolve(specifier,context,next){
 if(paths.has(specifier))return {url:paths.get(specifier),shortCircuit:true};
 try{return next(specifier,context);}catch(error){
  if(error.code!=='ERR_MODULE_NOT_FOUND'||!specifier.startsWith('@noble/'))throw error;
  return next(pathToFileURL(require.resolve(specifier)).href,context);
 }
}});
const {decodePQNativeAction,encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
const {encodePQActionTransportData}=await import('@ynx-chain/wallet-auth/pq-action-transport');
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const caller=await import(pathToFileURL(path.join(root,'apps/wallet-desktop/src/features/pq-transaction/typed-action-caller.mjs')));
const fixture=JSON.parse(fs.readFileSync(process.env.PAY_CLIENT_QA_MANIFEST)),row=fixture.Rows[stage];
const wrapper=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(wrapper)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(wrapper));
const requestedAction=index=>{
 const value=decodePQNativeAction(Buffer.from(fixture.Rows[index].Message,'base64'));
 return index===2&&input.refundRequest?{...value,payload:{...value.payload,refundID:input.refundRequest.refundId,amount:input.refundRequest.amountAtoms}}:value;
};
const action=requestedAction(stage),actor=action.owner,pending=new Map(),calls=[];
const protectedReview=process.env.PAY_PROTECTED_ORDER_REVIEW==='1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const reviewPath=route=>route.endsWith('/merchant-review')||route.endsWith('/review')||route.endsWith('/refund-review');
let control='normal';
function prior(view){const p=view.policy,active=p.records.filter(r=>BigInt(r.activeFrom)<=BigInt(view.executionHeight)).at(-1);return {owner:view.owner,executionHeight:view.executionHeight,ledgerNonce:view.ledgerNonce,algorithmVersion:active?.algorithmVersion??'legacy',enabled:view.enabled,records:p.records,policyVersion:p.version,networkId:view.networkId,enableAt:p.enableAt,...(active?{activeRevision:active.revision}:{}),...(p.version==='YNX-ACCOUNT-POLICY/v2'?{revocations:p.revocations}:{})};}
function prepare(index,invoiceOriginals=null){
 const r=fixture.Rows[index],a=requestedAction(index),snapshot=parsePQAccountAuthorization(prior(r.PriorAuthorization),{owner:a.owner,chainId:a.chainId,nativeChainId:a.nativeChainId});
 const review=caller.preparePQTypedActionReview(snapshot,a,{operationId:`PUBLIC-original-order-${index}`,account:a.owner,networkId:a.chainId,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},invoiceOriginals);
 const expected=index===2&&input.refundRequest?encodePQNativeAction(a):Buffer.from(r.Message,'base64');
 assert.deepEqual(Buffer.from(encodePQNativeAction(review.action)),Buffer.from(expected));return {review,snapshot};
}
const pay=createPrivateNativeProductPayClient({origin,async requestPrivate(r){
 r.assertCurrent();assert.ok(r.method==='GET'||r.path==='/v5/pay/invoice-intents/lookup'||r.path.endsWith('/merchant-review')||r.path.endsWith('/review')||r.path.endsWith('/refund-review'));
 calls.push({method:r.method,path:r.path});
 const response=await fetch(origin+r.path,{method:r.method,body:r.body,headers:{'X-PUBLIC-QA-Actor':actor,...(r.body?{'Content-Type':'application/json'}:{})},redirect:'manual'});
 let body=Buffer.from(await response.arrayBuffer());
 if(control==='lost'&&reviewPath(r.path))throw Object.assign(Error('PUBLIC original review response lost'),{code:'PUBLIC_ORIGINAL_REVIEW_LOST'});
 if(control==='already-entered'&&r.method==='GET'&&r.path.endsWith('/'+input.invoiceId)){
  const value=JSON.parse(body);
  value.operations[saved.typed.memberHash]={status:'submitted'};
  body=Buffer.from(JSON.stringify(value));
 }
 if(control==='mismatch'&&response.ok&&(reviewPath(r.path)||stage===0&&r.path.endsWith('/'+input.intentId))){
  const value=JSON.parse(body);
  const changed=stage===0?{...action,payload:{...action.payload,sessionID:'foreign-session',amount:'99'}}:
   stage===1?{...action,owner:'0x'+'f'.repeat(40)}:{...action,payload:{...action.payload,amount:'1'}};
  const message=Buffer.from(encodePQNativeAction(changed));
  if(reviewPath(r.path)){
   value.message=message.toString('base64');value.owner=changed.owner;
   if(stage===0)value.intent.signingMessageHash=digest(message);
  }else value.signingMessageHash=digest(message);
  body=Buffer.from(JSON.stringify(value));
 }
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),body};
}});
let reviews=0,rejects=0,published=0,broadcastReviews=0,saved;
const main={pendingRequests:()=>[...pending.values()],reject(id){assert.equal(pending.delete(id),true);rejects++;},vault:{async status(){return {initialized:true,account:actor};}},transactionSender:{submissions:{intentStore:{async readPQOriginals(){return saved?[saved]:[];},async unresolvedPreparation(){return false;}}}},async requestPQTypedAction(input){
 assert.equal(input.kind,action.kind);assert.deepEqual(input.payload,action.payload);
 const {review}=prepare(stage,input.invoiceOriginals??null),invoice=caller.readPQTypedActionInvoiceReviewData(review);
 if(stage===2){assert.equal(invoice.refundID,action.payload.refundID);assert.equal(invoice.invoiceID,action.payload.invoiceID);assert.equal(invoice.amount.atoms,action.payload.amount);}
 const request={id:`PUBLIC-order-review-${stage}`,method:'ynx_signPQNativeAction',review:{account:actor,typedReview:review,invoice}};
 pending.set(request.id,request);reviews++;return {status:'approval-required',request};
},async requestPQPayBroadcast(reference){
 const isTerms=stage===0,merchant=original.merchant,invoiceId=input.invoiceId;
 assert.deepEqual(reference,isTerms?{hash:saved.hash,kind:action.kind,intentId:input.intentId}:{hash:saved.hash,kind:action.kind,merchant,invoiceId});
 const requestPath=isTerms?`/v5/pay/invoice-intents/${input.intentId}/merchant-member`:
  `/v5/pay/invoices/${merchant}/${invoiceId}/${stage===1?'settlements':'refunds'}`;
 const payTarget={version:1,service:'pay',kind:action.kind,intentId:isTerms?input.intentId:null,merchant,invoiceId,requestPath};
 if(control==='mismatch-target')payTarget.requestPath+='/other';
 const request={id:`PUBLIC-order-broadcast-${stage}`,method:'ynx_broadcastPQNativeAction',review:{account:actor,hash:saved.hash,memberHash:saved.typed.memberHash,operationId:saved.operationId,typedAction:action,payTarget}};
 pending.set(request.id,request);broadcastReviews++;return {status:'approval-required',request};
}};
const entry=createNativePayMainEntry({getMain:()=>main,getContext:()=>({account:actor,revision:1,focused:true})});
const loan={pay,current(){},retire(){},async join(){},async close(){},readOriginalShopNativeInvoiceRequestDATA(order,current){current();assert.equal(order,original.sourceOrder);return original;},readInvoiceOriginals(reference,current){
 current();assert.equal(reference.invoiceId,input.invoiceId);
 let settlement=null;
 if(stage===2){const termsMessage=Buffer.from(fixture.Rows[0].Message,'base64'),{review,snapshot}=prepare(1,{termsMessage,settlement:null});settlement={review,member:Buffer.from(fixture.Rows[1].Wire,'base64'),original:{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:{account:review.action.owner,networkId:review.action.chainId}}};}
 return {termsMessage:Buffer.from(fixture.Rows[0].Message,'base64'),settlement};
}};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:async()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:actor,assert(){}}),publishReview(request){assert.equal(pending.get(request.id),request);published++;}});
try{
 const protectedRead={requiresOriginalHolder:true,request:{action:'order-invoice',productId:original.productId,sourceOrder:original.sourceOrder}};
 const inputDATA={action:['order-terms-review','order-pay-review','order-refund-review'][stage],productId:original.productId,sourceOrder:original.sourceOrder,...(stage===2?{refundId:action.payload.refundID,amountAtoms:action.payload.amount}:{})};
 const invoke=()=>protectedReview?service.invokeOriginalOrderResult(inputDATA,input.intentId,()=>{}):service.invoke(inputDATA);
 if(protectedReview){
  control='mismatch';
  const rejected=await invoke();
  assert.equal(rejected.code,stage===0?'NATIVE_INVOICE_REVIEW_BINDING':'NATIVE_PAY_ACTION_BILL_MISMATCH');
  assert.equal(rejected.walletRequest,undefined);assert.equal(reviews,0);assert.equal(published,0);
  assert.deepEqual(rejected.recoveryActions,[protectedRead]);
  control='lost';
  const lost=await invoke();
  assert.equal(lost.code,'PUBLIC_ORIGINAL_REVIEW_LOST');assert.equal(lost.canRetry,false);
  assert.equal(lost.walletRequest,undefined);assert.equal(reviews,0);assert.equal(published,0);
  assert.deepEqual(lost.recoveryActions,rejected.recoveryActions);
  control='normal';
  const before=calls.length,recovered=await service.invokeOriginalOrderResult(lost.recoveryActions[0].request,input.intentId,()=>{});
  assert.equal(recovered.ok,true);assert.equal(recovered.intent.originalOperation,input.intentId);
  assert.deepEqual(calls.slice(before),[{method:'GET',path:'/v5/pay/invoice-intents/'+input.intentId},...(stage===0?[]:[{method:'GET',path:'/v5/pay/invoices/'+original.merchant+'/'+input.invoiceId}])]);
 }
 const result=await invoke();
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.approvalRequired,true);assert.equal(result.walletRequest.id,`PUBLIC-order-review-${stage}`);assert.equal(result.reference.invoiceId,input.invoiceId);assert.equal(result.reference.intentId,input.intentId);assert.equal(result.canRetry,false);assert.equal(reviews,1);assert.equal(published,1);
 const typedReview=pending.get(result.walletRequest.id).review.typedReview;
 service.cancel();assert.equal(rejects,1);assert.equal(pending.size,0);service.cancel();assert.equal(rejects,1);
 if(protectedReview&&!input.refundRequest){
  // These already existing test Members exercise only the selection of a
  // second review, after the controlled first review was deliberately cancelled.
  const member=Buffer.from(row.Wire,'base64'),wire=Buffer.from(encodePQActionTransportData({member,originals:[]}));
  saved={kind:'pq-typed-action',account:actor,hash:'0x'+digest(wire),wire:wire.toString('base64url'),operationId:typedReview.operationId,
   typed:{review:typedReview,memberHash:'0x'+digest(member)}};
  const broadcast=()=>service.invokeOriginalOrderResult({action:'order-broadcast-review',productId:original.productId,sourceOrder:original.sourceOrder,kind:action.kind,originalHash:saved.hash},input.intentId,()=>{});
  if(stage!==0){
   control='already-entered';
   const entered=await broadcast();
   assert.equal(entered.code,'NATIVE_PAY_ORIGINAL_RECONCILE_REQUIRED');
   assert.equal(broadcastReviews,0);
   assert.deepEqual(entered.recoveryActions,[protectedRead]);
  }
  control='mismatch-target';
  const rejected=await broadcast();
  assert.equal(rejected.code,'NATIVE_PAY_MAIN_BROADCAST_REVIEW_CHANGED');assert.equal(rejected.walletRequest,undefined);
  assert.equal(published,1);assert.equal(rejects,2);assert.equal(pending.size,0);
  control='normal';
  const accepted=await broadcast();assert.equal(accepted.ok,true,JSON.stringify(accepted));
  assert.equal(accepted.walletRequest.id,`PUBLIC-order-broadcast-${stage}`);assert.equal(accepted.reference.intentId,input.intentId);
  service.cancel();assert.equal(broadcastReviews,2);assert.equal(published,2);assert.equal(rejects,3);assert.equal(pending.size,0);
 }
 service.assertSafeToClose();
 console.log(JSON.stringify({stage,kind:action.kind,...(stage===2?{refundId:action.payload.refundID,amountAtoms:action.payload.amount}:{}),protectedReview,mismatchRefused:protectedReview,lostReplyExactGET:protectedReview,normalMainWrapper:true,originalMainTypedProducer:true,originalSDK:true,originalOrder:original.sourceOrder,intentId:input.intentId,calls,published,rejects,broadcastReviews,approve:0,signing:0,effectPOST:0,SourceAdmission:false}));
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
