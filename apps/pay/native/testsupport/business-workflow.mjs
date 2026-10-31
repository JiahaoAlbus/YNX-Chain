// Explicit public-account/approval-handoff QA fixture. No Native keys, real
// consent, production Source, deployment or installed Wallet is exercised.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createPrivateNativeInvoiceClient} from '../merchant-invoice-approval.mjs';
import {NativePayBusinessClient,nativePaySummary} from '../pay-business-client.mjs';
const root=process.env.PAY_CLIENT_MAIN_SOURCE,fixture=JSON.parse(fs.readFileSync(process.env.PAY_CLIENT_QA_MANIFEST));
assert.ok(path.isAbsolute(root??''),'exact original Main source required');
const sdkRoot=path.join(root,'packages/wallet-auth');
const sdkExports=JSON.parse(fs.readFileSync(path.join(sdkRoot,'package.json'))).exports;
const nodeExport=value=>typeof value==='string'?value:value&&nodeExport(value.node??value.import??value.default);
const sdkPaths=new Map(Object.entries(sdkExports).flatMap(([key,value])=>{const target=nodeExport(value);return typeof target==='string'?[['@ynx-chain/wallet-auth'+(key==='.'?'':key.slice(1)),pathToFileURL(path.join(sdkRoot,target)).href]]:[];}));
registerHooks({resolve(specifier,context,next){if(specifier==='@ynx-chain/wallet-auth'||specifier.startsWith('@ynx-chain/wallet-auth/'))return {url:sdkPaths.get(specifier)??(()=>{throw Error('SDK exact exported namespace unavailable: '+specifier)})(),shortCircuit:true};return next(specifier,context);}});
const {parsePQAccountAuthorization}=await import('@ynx-chain/wallet-auth/pq-wallet-policy');
const caller=await import(pathToFileURL(path.join(root,'apps/wallet-desktop/src/features/pq-transaction/typed-action-caller.mjs')));
const {createPQTypedOriginalFromMember}=await import(pathToFileURL(path.join(root,'apps/wallet-desktop/src/wallet-pq-typed-original.mjs')));
const {decodePQNativeAction,encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
let actor=fixture.Merchant,stage=0,live=true,reviewCount=0,sendCount=0;
const current=()=>{if(!live)throw Object.assign(Error('QA Source retired'),{code:'QA_SOURCE_RETIRED'});};
const records=[],snapshots=[],pending=new Map();
function priorPolicy(view){
 // Public DATA projection of the actual pre-action query, never a trusted
 // Source grant. Preserve its exact execution height/ledger nonce; no rewind.
 const p=view.policy,active=p.records.filter(r=>BigInt(r.activeFrom)<=BigInt(view.executionHeight)).at(-1);
 return {owner:view.owner,executionHeight:view.executionHeight,ledgerNonce:view.ledgerNonce,algorithmVersion:active?.algorithmVersion??'legacy',enabled:view.enabled,records:p.records,policyVersion:p.version,networkId:view.networkId,enableAt:p.enableAt,...(active?{activeRevision:active.revision}:{}),...(p.version==='YNX-ACCOUNT-POLICY/v2'?{revocations:p.revocations}:{})};
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function requestPrivate({origin,method,path:route,body,contentType}){return new Promise((resolve,reject)=>{
 const request=http.request(origin+route,{method,headers:{'X-PUBLIC-QA-Actor':actor,...(contentType?{'Content-Type':contentType}:{})}},response=>{const chunks=[];response.on('data',b=>chunks.push(b));response.on('end',()=>resolve({method,requestPath:route,status:response.statusCode,contentType:response.headers['content-type'],body:Buffer.concat(chunks)}));});request.on('error',reject);request.end(body);
});}
const pay=createPrivateNativeInvoiceClient({origin:process.env.PAY_CLIENT_QA_ORIGIN,requestPrivate});
const main={vault:{async status(){return {initialized:true,account:actor}}},reject(id){pending.delete(id)},transactionSender:{submissions:{intentStore:{async readPQOriginals(account){current();return records.filter(r=>r.account===account)},async unresolvedPreparation(){return false}}}},async requestPQTypedAction(input){
 const row=fixture.Rows[stage],action=decodePQNativeAction(Buffer.from(row.Message,'base64'));
 assert.equal(actor,action.owner);assert.deepEqual(input.payload,action.payload);
 const snapshot=parsePQAccountAuthorization(priorPolicy(row.PriorAuthorization),{owner:actor,chainId:action.chainId,nativeChainId:action.nativeChainId});
 const at=new Date().toISOString(),review=caller.preparePQTypedActionReview(snapshot,{...action,kind:input.kind,fee:input.fee,payload:input.payload},{operationId:`PUBLIC-QA-${stage}`,account:actor,networkId:action.chainId,createdAt:at,expiresAt:new Date(Date.now()+60000).toISOString()},input.invoiceOriginals??null);
 assert.equal(sha(encodePQNativeAction(review.action)),sha(Buffer.from(row.Message,'base64')));
 const invoice=caller.readPQTypedActionInvoiceReviewData(review);assert.equal(invoice.fee.atoms,'1');
 const request={id:`PUBLIC-QA-${stage}`,method:'ynx_signPQNativeAction',review:{typedReview:review,invoice}};
 pending.set(request.id,{review,snapshot});reviewCount++;return {status:'approval-required',request};
}};
const runtime={pay,main,current,async readInvoiceOriginals({kind},fence){fence();let settlement=null;
 if(kind==='invoice_refund'){const saved=records.find(r=>r.typed.review.action.kind==='invoice_settle');assert.ok(saved);settlement={review:saved.typed.review,member:Buffer.from(fixture.Rows[1].Wire,'base64'),original:{reviewSnapshot:snapshots[1],signingSnapshot:snapshots[1],selectedBinding:{account:saved.account,networkId:saved.typed.networkId}}};}
 return {termsMessage:Buffer.from(fixture.Rows[0].Message,'base64'),settlement};
},async withSubmissionApproval(reference,send){current();sendCount++;return send();}};
function fixtureReturnMember(request){
 // This deliberately models ONLY a public Member return. It never calls Main
 // approve, a signer or a Native borrow. Actual Core AND signatures are reused.
 const {review,snapshot}=pending.get(request.id),member=Buffer.from(fixture.Rows[stage].Wire,'base64');
 const record=createPQTypedOriginalFromMember(member,{review,reviewSnapshot:priorPolicy(fixture.Rows[stage].PriorAuthorization),signingSnapshot:priorPolicy(fixture.Rows[stage].PriorAuthorization)});
 records.push(record);snapshots[stage]=snapshot;pending.delete(request.id);return record;
}
const intentId=process.env.PAY_CLIENT_QA_INTENT,merchant=fixture.Merchant,id=fixture.Terms.InvoiceID;
let client=new NativePayBusinessClient(runtime);
assert.equal((await client.openIntent(intentId)).intent.state,'PREPARED');
let review=await client.reviewMerchantTerms(intentId);assert.equal(review.approvalRequired,true);
let original=fixtureReturnMember(review.walletRequest);await client.submitMerchantTerms(intentId,original.hash);
assert.equal((await client.recoverIntent(intentId)).intent.state,'ISSUED');
stage=1;actor=fixture.Terms.Payer;
review=await client.reviewPayment(merchant,id);assert.equal(review.walletRequest.review.invoice.amount.atoms,'100');
original=fixtureReturnMember(review.walletRequest);
await assert.rejects(client.submitPayment(merchant,id,original.hash));assert.equal(client.snapshot().recoveryOnly,true);
// Actual original Pay Store is cold-opened, then a new client has no local
// transaction state to replay. Recover only the original Native hash.
await requestPrivate({origin:process.env.PAY_CLIENT_QA_ORIGIN,method:'POST',path:'/PUBLIC-QA-ONLY/cold'});
client=new NativePayBusinessClient(runtime);
let result=await client.recoverInvoice(merchant,id,original.typed.memberHash);assert.equal(result.bill.paidAtoms,'100');assert.equal(sendCount,2);
stage=2;actor=merchant;
review=await client.reviewRefund(merchant,id,'refund-30','30');assert.equal(review.walletRequest.review.invoice.recipient,fixture.Terms.Payer);
original=fixtureReturnMember(review.walletRequest);await client.submitRefund(merchant,id,original.hash);
result=await client.recoverInvoice(merchant,id,original.typed.memberHash);
assert.equal(result.bill.refundedAtoms,'30');assert.equal(result.bill.netPaidAtoms,'70');assert.equal(reviewCount,3);assert.equal(sendCount,3);
assert.equal(result.bill.termsFeeAtoms,'1');assert.equal(result.bill.paymentFeeAtoms,'1');assert.equal(result.bill.refundFeeAtoms,'1');
live=false;await assert.rejects(client.openInvoice(merchant,id));assert.equal(client.snapshot().bill,null);
console.log(JSON.stringify({result:'PASS',normalClient:true,actualPrivateHTTPAndColdStore:true,actualMainReviewCaller:true,soleSDKAndMemberMath:true,termsPaymentRefundReviews:3,originalSubmissions:3,paid:'100',refunded:'30',netPaid:'70',feeEach:'1',unknownColdNoResend:true,realMainApproval:false,realSource:false,productionFunds:false,receipt:nativePaySummary(result)}));
