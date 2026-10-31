import {createHash} from 'node:crypto';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const messageOf=(review,encode)=>Buffer.from(encode(review.action));

/** Main-process adapter only: the original Main object, original protected
 * journal and private Pay client are supplied by normal composition. It never
 * imports keys, approves a pending review, substitutes a signer or broadcasts.
 * The existing Main user approval/custody/ecdf Native path signs and retains
 * its complete Member. Source and separate broadcast consent remain mandatory
 * when that original Member is submitted to Pay.RegisterTerms. */
export function createNativeInvoiceMerchantApproval({main,pay}){
 const journal=main?.transactionSender?.submissions?.intentStore;
 if(typeof main?.requestPQTypedAction!=='function'||typeof main?.reject!=='function'||typeof journal?.readPQOriginals!=='function'||typeof journal?.unresolvedPreparation!=='function'||typeof pay?.merchantTermsReview!=='function'||typeof pay?.readInvoiceIntent!=='function')fail('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
 async function retained(view,current,encode){
  current();const originals=await journal.readPQOriginals(view.merchant,current);current();
  return originals.filter(row=>row.kind==='pq-typed-action'&&row.account===view.merchant&&row.typed?.review?.action?.kind==='invoice_terms'&&digest(messageOf(row.typed.review,encode))===view.signingMessageHash);
 }
 return Object.freeze({
  async requestMerchantTerms(intentId,current){
   if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
   current();const reviewed=await pay.merchantTermsReview(intentId);current();
   const bytes=Buffer.from(reviewed.message,'base64'),view=reviewed.intent;
   if(bytes.toString('base64')!==reviewed.message||digest(bytes)!==view.signingMessageHash)fail('NATIVE_INVOICE_REVIEW_BINDING');
   const {decodePQNativeAction,encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
   const action=decodePQNativeAction(bytes);
   if(action.kind!=='invoice_terms'||action.owner!==view.merchant||action.chainId!==view.request.genesis||action.nativeChainId!==view.request.nativeChainId||action.fee!=='1')fail('NATIVE_INVOICE_REVIEW_BINDING');
   if((await retained(view,current,encodePQNativeAction)).length||await journal.unresolvedPreparation(view.merchant))fail('NATIVE_INVOICE_ORIGINAL_RECONCILE_REQUIRED');current();
   const pending=await main.requestPQTypedAction({kind:action.kind,fee:action.fee,payload:action.payload});
   // Main independently chooses its own current account/network/nonce. A drift
   // cannot silently alter the original Pay intent or be approved by this adapter.
   try{
    current();if(pending?.status!=='approval-required'||pending.request?.method!=='ynx_signPQNativeAction'||!messageOf(pending.request.review.typedReview,encodePQNativeAction).equals(bytes))fail('NATIVE_INVOICE_MAIN_REVIEW_CHANGED');
   }catch(error){if(pending?.request?.id)main.reject(pending.request.id);throw error;}
   return pending; // The existing Main UI/Auth approval path owns this review.
  },
  async readOriginalMerchantMember(intentId,originalHash,current){
   if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
   current();const view=await pay.readInvoiceIntent(intentId);current();
   const {encodePQNativeAction}=await import('@ynx-chain/wallet-auth/pq-native-action');
   const {decodePQActionTransportData}=await import('@ynx-chain/wallet-auth/pq-action-transport');
   const originals=await retained(view,current,encodePQNativeAction),saved=originals.find(row=>row.hash===originalHash);
   if(!saved||originals.length!==1)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_REQUIRED');
   const envelope=Buffer.from(saved.wire,'base64url');
   if(envelope.toString('base64url')!==saved.wire||'0x'+digest(envelope)!==saved.hash)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_BINDING');
   const decoded=decodePQActionTransportData(envelope),member=Buffer.from(decoded.member);
   if(decoded.originals.length||'0x'+digest(member)!==saved.typed.memberHash)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_BINDING');
   current();return Object.freeze({intentId,sourceOrder:view.request.sourceOrder,operationId:saved.operationId,member:member.toString('base64'),nativeHash:saved.typed.memberHash,abciHash:saved.hash,signingMessageHash:view.signingMessageHash,signingOnly:true,broadcastApprovalRequired:true,consensusFinality:false});
  }
 });
}

/** Fixed-origin private JSON adapter for Main's existing qualified service
 * transport. requestPrivate is the original authenticated LINK/Source request
 * callee, not fetch. It must not redirect or retry a dispatched POST and returns
 * the same original {method,requestPath,status,contentType,body} observation.
 * This callee neither invents a session nor adds a service identity/header. */
export function createPrivateNativeInvoiceClient({origin,requestPrivate}){
 const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||typeof requestPrivate!=='function')fail('NATIVE_INVOICE_PRIVATE_TRANSPORT_UNAVAILABLE');
 const id=value=>{if(typeof value!=='string'||!/^npi_[0-9a-f]{48}$/.test(value))fail('NATIVE_INVOICE_ORIGINAL_ID_REQUIRED');return value};
 async function call(method,path,input){
  const body=input===undefined?undefined:Buffer.from(JSON.stringify(input));
  if(body&&body.length>2*1024*1024)fail('NATIVE_INVOICE_REQUEST_BOUNDS');
  const result=await requestPrivate(Object.freeze({origin,method,path,body,contentType:input===undefined?undefined:'application/json'}));
  if(result?.method!==method||result?.requestPath!==path||!Number.isInteger(result?.status)||result.status<200||result.status>=300||!/^application\/json(?:;|$)/i.test(result?.contentType??''))fail('NATIVE_INVOICE_PRIVATE_RESPONSE_UNAVAILABLE');
  if(!(result.body instanceof Uint8Array)||result.body.length>2*1024*1024)fail('NATIVE_INVOICE_RESPONSE_BOUNDS');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(result.body),value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))fail('NATIVE_INVOICE_PRIVATE_RESPONSE_INVALID');
  return value;
 }
 return Object.freeze({
  async merchantTermsReview(intentId){const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/merchant-review`,{});if(value.intent?.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;},
  async readInvoiceIntent(intentId){const value=await call('GET',`/v5/pay/invoice-intents/${id(intentId)}`);if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;},
  async submitMerchantMember(intentId,member){
   if(!(member instanceof Uint8Array)||!member.length||member.length>98304)fail('NATIVE_INVOICE_MEMBER_BOUNDS');
   const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/merchant-member`,{member:Buffer.from(member).toString('base64')});if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;
  },
  async reconcileInvoiceIntent(intentId){const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/reconcile`,{});if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;}
 });
}
