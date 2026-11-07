// PUBLIC review handoff only. The exact original SDK codec and Main typed
// review producer run; no approve, key, signer or Member submission is exposed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
import {createPrivateNativeProductPayClient} from '../r6/merchant-invoice-approval.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8')),{original,stage,origin}=input;
const root=process.env.PAY_CLIENT_MAIN_SOURCE,sdk=path.join(root,'packages/wallet-auth');
const nodeExport=v=>typeof v==='string'?v:v&&nodeExport(v.node??v.import??v.default);
const exports=JSON.parse(fs.readFileSync(path.join(sdk,'package.json'))).exports;
const paths=new Map(Object.entries(exports).flatMap(([key,v])=>{const target=nodeExport(v);return target?[['@ynx-chain/wallet-auth'+(key==='.'?'':key.slice(1)),pathToFileURL(path.join(sdk,target)).href]]:[];}));
registerHooks({resolve(specifier,context,next){if(paths.has(specifier))return {url:paths.get(specifier),shortCircuit:true};return next(specifier,context);}});
const {decodePQNativeAction,encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
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
 return {method:r.method,requestPath:r.path,status:response.status,contentType:response.headers.get('content-type'),body:new Uint8Array(await response.arrayBuffer())};
}});
let reviews=0,rejects=0,published=0;
const main={pendingRequests:()=>[...pending.values()],reject(id){assert.equal(pending.delete(id),true);rejects++;},vault:{async status(){return {initialized:true,account:actor};}},transactionSender:{submissions:{intentStore:{async readPQOriginals(){return [];},async unresolvedPreparation(){return false;}}}},async requestPQTypedAction(input){
 assert.equal(input.kind,action.kind);assert.deepEqual(input.payload,action.payload);
 const {review}=prepare(stage,input.invoiceOriginals??null),invoice=caller.readPQTypedActionInvoiceReviewData(review);
 if(stage===2){assert.equal(invoice.refundID,action.payload.refundID);assert.equal(invoice.invoiceID,action.payload.invoiceID);assert.equal(invoice.amount.atoms,action.payload.amount);}
 const request={id:`PUBLIC-order-review-${stage}`,method:'ynx_signPQNativeAction',review:{account:actor,typedReview:review,invoice}};
 pending.set(request.id,request);reviews++;return {status:'approval-required',request};
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
 const result=await service.invoke({action:['order-terms-review','order-pay-review','order-refund-review'][stage],productId:original.productId,sourceOrder:original.sourceOrder,...(stage===2?{refundId:action.payload.refundID,amountAtoms:action.payload.amount}:{})});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.approvalRequired,true);assert.equal(result.walletRequest.id,`PUBLIC-order-review-${stage}`);assert.equal(result.reference.invoiceId,input.invoiceId);assert.equal(result.reference.intentId,input.intentId);assert.equal(result.canRetry,false);assert.equal(reviews,1);assert.equal(published,1);
 service.cancel();assert.equal(rejects,1);assert.equal(pending.size,0);service.cancel();assert.equal(rejects,1);service.assertSafeToClose();
 console.log(JSON.stringify({stage,kind:action.kind,...(stage===2?{refundId:action.payload.refundID,amountAtoms:action.payload.amount}:{}),normalMainWrapper:true,originalMainTypedProducer:true,originalSDK:true,originalOrder:original.sourceOrder,intentId:input.intentId,calls,published,rejects,approve:0,signing:0,effectPOST:0,SourceAdmission:false}));
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();}
