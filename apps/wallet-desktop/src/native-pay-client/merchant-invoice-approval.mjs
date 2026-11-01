import {createHash} from 'node:crypto';
import {nativeInvoiceProductIntentData,assertNativeInvoiceIntentView} from './invoice-product-intent.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const messageOf=(review,encode)=>Buffer.from(encode(review.action));
export function rejectNativePayPending(main,id){
 try{return main.reject(id);}catch(error){
  // Actual DesktopWalletAuthority.reject removes the original pending request
  // and then throws this expected provider rejection to its original caller.
  if(error?.code===4001&&error?.data?.code==='USER_REJECTED_REQUEST')return;
  throw error;
 }
}

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
   }catch(error){if(pending?.request?.id)try{rejectNativePayPending(main,pending.request.id);}catch(cleanup){if(error&&typeof error==='object')error.cleanupCause=cleanup;}throw error;}
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
   current();return Object.freeze({intentId,merchant:view.merchant,invoiceId:saved.typed.review.action.payload.invoiceID,sourceOrder:view.request.sourceOrder,owner:view.merchant,operationId:saved.operationId,member:member.toString('base64'),nativeHash:saved.typed.memberHash,abciHash:saved.hash,signingMessageHash:view.signingMessageHash,signingOnly:true,broadcastApprovalRequired:true,consensusFinality:false});
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
 const invoicePath=(merchant,invoiceId)=>{if(!/^0x[0-9a-f]{40}$/.test(merchant??'')||! /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(invoiceId??''))fail('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');return `/v5/pay/invoices/${merchant}/${invoiceId}`;};
 const memberBody=member=>{if(!(member instanceof Uint8Array)||!member.length||member.length>98304)fail('NATIVE_INVOICE_MEMBER_BOUNDS');return Buffer.from(member).toString('base64');};
 const id=value=>{if(typeof value!=='string'||!/^npi_[0-9a-f]{48}$/.test(value))fail('NATIVE_INVOICE_ORIGINAL_ID_REQUIRED');return value};
 async function packet(method,path,input,assertCurrent){
  if(typeof assertCurrent!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
  const body=input===undefined?undefined:Buffer.from(JSON.stringify(input));if(body&&body.length>2*1024*1024)fail('NATIVE_INVOICE_REQUEST_BOUNDS');
  assertCurrent();
  // Sole original Source/LINK transport; it also fences immediately before
  // its actual write. No post-response fence here: original Main must retain
  // the real response before late lock, parse, completion and cleanup.
  const result=await requestPrivate(Object.freeze({origin,method,path,body,contentType:input===undefined?undefined:'application/json',assertCurrent}));
  if(!(result?.body instanceof Uint8Array)||result.body.length>2*1024*1024)fail('NATIVE_INVOICE_RESPONSE_BOUNDS');
  return {method:result.method,requestPath:result.requestPath,status:result.status,contentType:result.contentType,cacheControl:result.cacheControl??'',body:Uint8Array.from(result.body)};
 }
 async function call(method,path,input,current){
  if(current!==undefined&&typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
  const body=input===undefined?undefined:Buffer.from(JSON.stringify(input));
  if(body&&body.length>2*1024*1024)fail('NATIVE_INVOICE_REQUEST_BOUNDS');
  current?.();
  const result=await requestPrivate(Object.freeze({origin,method,path,body,contentType:input===undefined?undefined:'application/json',...(current?{assertCurrent:current}:{})}));
  if(result?.method!==method||result?.requestPath!==path||!Number.isInteger(result?.status)||!/^application\/json(?:;|$)/i.test(result?.contentType??''))fail('NATIVE_INVOICE_PRIVATE_RESPONSE_UNAVAILABLE');
  if(!(result.body instanceof Uint8Array)||result.body.length>2*1024*1024)fail('NATIVE_INVOICE_RESPONSE_BOUNDS');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(result.body),value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))fail('NATIVE_INVOICE_PRIVATE_RESPONSE_INVALID');
  if(result.status<200||result.status>=300){
   const code=[400,409,413,415,503].includes(result.status)&&typeof value.code==='string'&&/^NATIVE_[A-Z0-9_]{1,100}$/.test(value.code)?value.code:'NATIVE_INVOICE_PRIVATE_RESPONSE_UNAVAILABLE';
   throw Object.assign(Error(code),{code,status:result.status,method,requestPath:path});
  }
  return value;
 }
 return Object.freeze({
  async createInvoiceIntent(original,current){
   if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
   const request=nativeInvoiceProductIntentData(original);
   return assertNativeInvoiceIntentView(await call('POST','/v5/pay/invoice-intents',request,current),request);
  },
  async lookupInvoiceIntent(original,current){
   if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
   const request=nativeInvoiceProductIntentData(original);
   return assertNativeInvoiceIntentView(await call('POST','/v5/pay/invoice-intents/lookup',request,current),request);
  },
  // Normal Main dispatcher only, after its genuine separate approval and
  // same-journal durable UNKNOWN. Preserve actual /v5/... HTTP metadata;
  // never relabel this packet as a Core broadcast/finality response.
  submitMerchantMemberPacket:(intentId,member,current)=>packet('POST',`/v5/pay/invoice-intents/${id(intentId)}/merchant-member`,{member:memberBody(member)},current),
  submitSettlementPacket:(merchant,invoiceId,member,current)=>packet('POST',invoicePath(merchant,invoiceId)+'/settlements',{member:memberBody(member)},current),
  submitRefundPacket:(merchant,invoiceId,member,current)=>packet('POST',invoicePath(merchant,invoiceId)+'/refunds',{member:memberBody(member)},current),
  // Original Main UNKNOWN query only. Preserve GET and raw DATA before any
  // late current/parse; these methods cannot create, reconcile or submit.
  readInvoiceIntentPacket:(intentId,current)=>packet('GET',`/v5/pay/invoice-intents/${id(intentId)}`,undefined,current),
  readInvoicePacket:(merchant,invoiceId,current)=>packet('GET',invoicePath(merchant,invoiceId),undefined,current),
  async merchantTermsReview(intentId){const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/merchant-review`,{});if(value.intent?.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;},
  async readInvoiceIntent(intentId){const value=await call('GET',`/v5/pay/invoice-intents/${id(intentId)}`);if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;},
  async submitMerchantMember(intentId,member){
   if(!(member instanceof Uint8Array)||!member.length||member.length>98304)fail('NATIVE_INVOICE_MEMBER_BOUNDS');
   const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/merchant-member`,{member:Buffer.from(member).toString('base64')});if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;
  },
  async reconcileInvoiceIntent(intentId){const value=await call('POST',`/v5/pay/invoice-intents/${id(intentId)}/reconcile`,{});if(value.intentId!==intentId)fail('NATIVE_INVOICE_ORIGINAL_BINDING');return value;},
  async readInvoice(merchant,invoiceId){const value=await call('GET',invoicePath(merchant,invoiceId));if(value.merchant!==merchant||value.invoiceId!==invoiceId)fail('NATIVE_PAY_ACTION_BILL_MISMATCH');return value;},
  async readInvoiceOriginals(reference,current){
   if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
   if(!reference||!['invoice_settle','invoice_refund'].includes(reference.kind))fail('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');
   const value=await call('GET',invoicePath(reference.merchant,reference.invoiceId),undefined,current);current();
   if(value.merchant!==reference.merchant||value.invoiceId!==reference.invoiceId||value.termsNativeHash!==reference.termsNativeHash||value.settlementNativeHash!==reference.settlementNativeHash)fail('NATIVE_PAY_INVOICE_ORIGINALS_MISMATCH');
   if(typeof value.termsMessage!=='string'||value.termsMessage.length>10924)fail('NATIVE_PAY_TERMS_ORIGINAL_UNAVAILABLE');
   const termsMessage=Buffer.from(value.termsMessage,'base64');
   if(!termsMessage.length||termsMessage.length>8192||termsMessage.toString('base64')!==value.termsMessage||digest(termsMessage)!==value.termsHash)fail('NATIVE_PAY_TERMS_ORIGINAL_MISMATCH');
   // The remote payer's original Main review/snapshots are NOT derivable from
   // its Member or today's account. The genuine archive owns that next port.
   if(reference.kind==='invoice_refund')fail('NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE');
   return Object.freeze({termsMessage:Uint8Array.from(termsMessage),settlement:null});
  },
  async readInvoiceEvents(merchant,invoiceId){const value=await call('GET',invoicePath(merchant,invoiceId)+'/events');if(value.merchant!==merchant||value.invoiceId!==invoiceId||!Array.isArray(value.events))fail('NATIVE_PAY_EVENT_REFERENCE_MISMATCH');return value;},
  reviewSettlement:(merchant,invoiceId)=>call('POST',invoicePath(merchant,invoiceId)+'/review',{}),
  reviewRefund:(merchant,invoiceId,refundId,amountAtoms)=>call('POST',invoicePath(merchant,invoiceId)+'/refund-review',{refundId,amountAtoms}),
  submitSettlement:(merchant,invoiceId,member)=>call('POST',invoicePath(merchant,invoiceId)+'/settlements',{member:memberBody(member)}),
  submitRefund:(merchant,invoiceId,member)=>call('POST',invoicePath(merchant,invoiceId)+'/refunds',{member:memberBody(member)}),
  reconcileOperation:(merchant,invoiceId,nativeHash)=>{if(!/^0x[0-9a-f]{64}$/.test(nativeHash??''))fail('NATIVE_PAY_ORIGINAL_HASH_REQUIRED');return call('POST',invoicePath(merchant,invoiceId)+'/operations/'+nativeHash+'/reconcile',{});}

 });
}

/** All three invoice kinds use Main's one original typed-action review and
 * journal. readInvoiceOriginals is the original Main/Source read-only archive
 * port; it supplies retained terms and, for refunds, the payer's original
 * settlement review/Member/public snapshots. Its DATA does not grant consent. */
export function createNativePayActionApproval({main,pay,readInvoiceOriginals}){
 const journal=main?.transactionSender?.submissions?.intentStore;
 if(typeof main?.requestPQTypedAction!=='function'||typeof main?.reject!=='function'||typeof journal?.readPQOriginals!=='function'||typeof journal?.unresolvedPreparation!=='function')fail('NATIVE_INVOICE_MAIN_SOURCE_UNAVAILABLE');
 const sdk=()=>import('@ynx-chain/wallet-auth/pq-native-action');
 async function selected(current){current();if(typeof main.vault?.status!=='function')fail('NATIVE_PAY_SELECTED_ACCOUNT_UNAVAILABLE');const status=await main.vault.status();current();if(!status.initialized||!/^0x[0-9a-f]{40}$/.test(status.account??''))fail('NATIVE_PAY_SELECTED_ACCOUNT_UNAVAILABLE');return status.account;}
 function bind(action,bill,kind,refund){
  if(action.kind!==kind||action.chainId!==bill.genesis||action.nativeChainId!==bill.nativeChainId||action.fee!=='1'||action.payload.invoiceID!==bill.invoiceId)fail('NATIVE_PAY_ACTION_BILL_MISMATCH');
  if(kind==='invoice_settle'&&(action.payload.merchant!==bill.merchant||action.payload.termsHashHex!==bill.termsHash||action.payload.amount!==bill.principalAtoms))fail('NATIVE_PAY_ACTION_BILL_MISMATCH');
  if(kind==='invoice_refund'&&(action.owner!==bill.merchant||action.payload.termsHashHex!==bill.termsHash||'0x'+action.payload.settlementHashHex!==bill.settlementNativeHash||refund&&(action.payload.refundID!==refund.refundId||action.payload.amount!==refund.amountAtoms)))fail('NATIVE_PAY_ACTION_BILL_MISMATCH');
 }
 async function originals(bill,kind,current){
  if(typeof readInvoiceOriginals!=='function')fail('NATIVE_PAY_INVOICE_ORIGINALS_UNAVAILABLE');
  current();const retained=await readInvoiceOriginals(Object.freeze({merchant:bill.merchant,invoiceId:bill.invoiceId,termsNativeHash:bill.termsNativeHash,settlementNativeHash:bill.settlementNativeHash,kind}),current);current();
  if(!(retained?.termsMessage instanceof Uint8Array)||digest(retained.termsMessage)!==bill.termsHash)fail('NATIVE_PAY_TERMS_ORIGINAL_MISMATCH');
  const {decodePQNativeAction}=await sdk(),terms=decodePQNativeAction(retained.termsMessage);
  if(terms.kind!=='invoice_terms'||terms.owner!==bill.merchant||terms.chainId!==bill.genesis||terms.nativeChainId!==bill.nativeChainId||terms.payload.invoiceID!==bill.invoiceId||terms.payload.sessionID!==bill.sessionId||terms.payload.amount!==bill.principalAtoms||terms.payload.assetID!==bill.assetId||terms.payload.unitVersion!==bill.unitVersion)fail('NATIVE_PAY_TERMS_ORIGINAL_MISMATCH');
  if(kind==='invoice_refund'){
   const member=retained.settlement?.member,recorded=bill.operations?.[bill.settlementNativeHash]?.member;
   if(!(member instanceof Uint8Array)||'0x'+digest(member)!==bill.settlementNativeHash||typeof recorded!=='string'||!Buffer.from(member).equals(Buffer.from(recorded,'base64')))fail('NATIVE_PAY_SETTLEMENT_ORIGINAL_UNAVAILABLE');
  }else if(retained.settlement!==null)fail('NATIVE_PAY_INVOICE_ORIGINALS_UNAVAILABLE');
  return retained;
 }
 async function request(kind,merchant,invoiceId,current,refund){
  if(typeof current!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');current();
  const bill=await pay.readInvoice(merchant,invoiceId);current();
  const reviewed=kind==='invoice_settle'?await pay.reviewSettlement(merchant,invoiceId):await pay.reviewRefund(merchant,invoiceId,refund.refundId,refund.amountAtoms);current();
  const bytes=Buffer.from(reviewed.message,'base64'),{decodePQNativeAction,encodePQNativeAction}=await sdk();
  if(bytes.toString('base64')!==reviewed.message)fail('NATIVE_PAY_REVIEW_BINDING');
  const action=decodePQNativeAction(bytes);bind(action,bill,kind,refund);
  if(action.owner!==reviewed.owner||action.nonce!==reviewed.nonce||reviewed.feeAtoms!=='1'||await selected(current)!==action.owner)fail('NATIVE_PAY_REVIEW_BINDING');
  const rows=await journal.readPQOriginals(action.owner,current);current();
  if(rows.some(row=>row.kind==='pq-typed-action'&&digest(messageOf(row.typed.review,encodePQNativeAction))===digest(bytes))||await journal.unresolvedPreparation(action.owner))fail('NATIVE_INVOICE_ORIGINAL_RECONCILE_REQUIRED');current();
  const invoiceOriginals=await originals(bill,kind,current);
  const pending=await main.requestPQTypedAction({kind:action.kind,fee:action.fee,payload:action.payload,invoiceOriginals});
  try{current();if(pending?.status!=='approval-required'||pending.request?.method!=='ynx_signPQNativeAction'||!messageOf(pending.request.review.typedReview,encodePQNativeAction).equals(bytes))fail('NATIVE_INVOICE_MAIN_REVIEW_CHANGED');}
  catch(error){if(pending?.request?.id)try{rejectNativePayPending(main,pending.request.id);}catch(cleanup){if(error&&typeof error==='object')error.cleanupCause=cleanup;}throw error;}
  return pending;
 }
 return Object.freeze({
  requestSettlement:(merchant,invoiceId,current)=>request('invoice_settle',merchant,invoiceId,current),
  requestRefund:(merchant,invoiceId,refundId,amountAtoms,current)=>request('invoice_refund',merchant,invoiceId,current,{refundId,amountAtoms}),
  async readOriginalActionMember({merchant,invoiceId,kind,originalHash},current){
   if(!['invoice_settle','invoice_refund'].includes(kind)||typeof current!=='function')fail('NATIVE_PAY_ACTION_REFERENCE_REQUIRED');
   current();const bill=await pay.readInvoice(merchant,invoiceId);current();
   const account=await selected(current),rows=await journal.readPQOriginals(account,current);current();
   const saved=rows.find(row=>row.kind==='pq-typed-action'&&row.hash===originalHash&&row.account===account);
   if(!saved)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_REQUIRED');
   const {encodePQNativeAction}=await sdk();bind(saved.typed.review.action,bill,kind);
   const {decodePQActionTransportData}=await import('@ynx-chain/wallet-auth/pq-action-transport');
   const envelope=Buffer.from(saved.wire,'base64url');if(envelope.toString('base64url')!==saved.wire||'0x'+digest(envelope)!==saved.hash)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_BINDING');
   const decoded=decodePQActionTransportData(envelope),member=Buffer.from(decoded.member);
   if(decoded.originals.length||'0x'+digest(member)!==saved.typed.memberHash||digest(messageOf(saved.typed.review,encodePQNativeAction))!==saved.typed.review.requestDigest)fail('NATIVE_INVOICE_ORIGINAL_MEMBER_BINDING');
   current();return Object.freeze({kind,merchant,invoiceId,operationId:saved.operationId,member:member.toString('base64'),nativeHash:saved.typed.memberHash,abciHash:saved.hash,owner:account,broadcastApprovalRequired:true,consensusFinality:false});
  }
 });
}
