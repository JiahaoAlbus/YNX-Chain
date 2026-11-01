import {types} from 'node:util';
import {NativePayBusinessClient,nativePaySummary,nativePayFailureCode,nativePayFailureResultDATA} from './pay-business-client.mjs';
import {rejectNativePayPending} from './merchant-invoice-approval.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const shapes={invoice:['merchant','invoiceId'],intent:['intentId'],'create-intent':['productId','sourceOrder'],'lookup-intent':['productId','sourceOrder'],'terms-review':['intentId'],'pay-review':['merchant','invoiceId'],'refund-review':['merchant','invoiceId','refundId','amountAtoms'],events:['merchant','invoiceId'],recover:['merchant','invoiceId','nativeHash'],'recover-archive':['productId','sourceOrder','merchant','invoiceId','nativeHash'],'reconcile-archive':['productId','sourceOrder','merchant','invoiceId'],'recover-intent':['intentId'],'broadcast-review':['kind','merchant','invoiceId','intentId','originalHash']};
// Bookkeeping only. Main remains the sole review/cleanup owner. Completion is
// notified by that same Main after its real approval/rejection has settled;
// neither deleting this entry nor observing an absent id is a payment result.
export function createOriginalPayReviewTracker(){
 const pending=new Map();
 function isPending(owner,id){
  if(typeof owner?.pendingRequests!=='function')fail('NATIVE_PAY_MAIN_PENDING_SOURCE_UNAVAILABLE');
  const rows=owner.pendingRequests();
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.id!=='string'))fail('NATIVE_PAY_MAIN_PENDING_SOURCE_UNAVAILABLE');
  return rows.some(row=>row.id===id);
 }
 return Object.freeze({
  remember(id,owner){
   if(typeof id!=='string'||!id||id.length>256)fail('NATIVE_PAY_MAIN_REVIEW_ID_REQUIRED');
   const prior=pending.get(id);if(prior&&prior.owner!==owner)fail('NATIVE_PAY_MAIN_REVIEW_OWNER_CHANGED');
   if(!prior)pending.set(id,{owner,failed:false,cause:undefined});
  },
  settled(id,owner){
   const row=pending.get(id);if(!row)return {settled:false};
   if(row.owner!==owner)fail('NATIVE_PAY_MAIN_REVIEW_OWNER_CHANGED');
   if(isPending(owner,id))fail('NATIVE_PAY_MAIN_REVIEW_STILL_PENDING');
   pending.delete(id);return {settled:true,originalRetained:true};
  },
  cancel(){
   let failed=false,cause;
   for(const [id,row]of pending)try{
    if(row.failed)throw row.cause;
    if(isPending(row.owner,id))rejectNativePayPending(row.owner,id);
    pending.delete(id);
   }catch(error){if(!row.failed){row.failed=true;row.cause=error;}if(!failed){failed=true;cause=row.cause;}}
   if(failed)throw cause;return {cancelled:true,originalRetained:true};
  }
 });
}
function input(value){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('NATIVE_PAY_MAIN_INPUT_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.some(k=>typeof k!=='string'||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('NATIVE_PAY_MAIN_INPUT_INVALID');
 const action=d.action?.value,fields=shapes[action];
 if(!fields||keys.length!==fields.length+1||keys.some(k=>k!=='action'&&!fields.includes(k))||fields.some(k=>typeof d[k]?.value!=='string'||d[k].value.length>256))fail('NATIVE_PAY_MAIN_INPUT_INVALID');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
/** Main boot composition only. Source and Main remain borrowed originals.
 * compose() is never exported to IPC, environment or a renderer. This owns no
 * signer, approval, HTTP credential, transaction journal or Source lifetime. */
export function createNativePayMainEntry({getMain,getContext}){
 if(typeof getMain!=='function'||typeof getContext!=='function')fail('NATIVE_PAY_MAIN_ENTRY_UNAVAILABLE');
 let source=null,epoch=0,active=false,client=null;const pending=createOriginalPayReviewTracker();
 const context=()=>{
  const c=getContext(),e=epoch;
  if(!c||c.locked||c.changing||!c.focused||typeof c.account!=='string'||!/^0x[0-9a-f]{40}$/.test(c.account))fail('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');
  return ()=>{const now=getContext();if(epoch!==e||!now||now.account!==c.account||now.revision!==c.revision||now.locked||now.changing||!now.focused)fail('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');};
 };
 function cancel(){epoch++;client?.invalidate('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');return pending.cancel();}
 async function invoke(raw,onFailure){
   const request=input(raw);if(!source)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');if(active)fail('NATIVE_PAY_MAIN_BUSY');
   const assertContext=context(),originalSource=source,main=getMain();
   const current=()=>{assertContext();if(originalSource.current()!==undefined)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');};
   current();active=true;let operationClient=null;
   try{
    const runtime={main,pay:originalSource.pay,current,
     ...(typeof originalSource.readOriginalInvoiceIntent==='function'?{readOriginalInvoiceIntent:(...args)=>originalSource.readOriginalInvoiceIntent(...args)}:{}),
     ...(typeof originalSource.readInvoiceOriginals==='function'?{readInvoiceOriginals:(...args)=>originalSource.readInvoiceOriginals(...args)}:{}),
     ...(typeof originalSource.readOriginalArchiveReceipt==='function'?{readOriginalArchiveReceipt:(...args)=>originalSource.readOriginalArchiveReceipt(...args)}:{}),
     ...(typeof originalSource.readOriginalArchiveReconciliation==='function'?{readOriginalArchiveReconciliation:(...args)=>originalSource.readOriginalArchiveReconciliation(...args)}:{}),
     ...(originalSource.notificationInbox?{notificationInbox:originalSource.notificationInbox}:{}),
     ...(typeof originalSource.readNotificationScope==='function'?{readNotificationScope:()=>originalSource.readNotificationScope()}:{}),
     ...(typeof originalSource.refreshOriginalProduct==='function'?{refreshOriginalProduct:(...args)=>originalSource.refreshOriginalProduct(...args)}:{})};
    client=operationClient=new NativePayBusinessClient(runtime);let state;
    const {action,merchant,invoiceId,intentId}=request;
    if(action==='invoice')state=await client.openInvoice(merchant,invoiceId);
    else if(action==='intent')state=await client.openIntent(intentId);
    else if(action==='create-intent')state=await client.createInvoiceIntent(request.productId,request.sourceOrder);
    else if(action==='lookup-intent')state=await client.lookupOriginalInvoiceIntent(request.productId,request.sourceOrder);
    else if(action==='terms-review')state=await client.reviewMerchantTerms(intentId);
    else if(action==='pay-review')state=await client.reviewPayment(merchant,invoiceId);
    else if(action==='refund-review')state=await client.reviewRefund(merchant,invoiceId,request.refundId,request.amountAtoms);
    else if(action==='events')state=await client.syncNotifications(merchant,invoiceId);
    else if(action==='recover')state=await client.recoverInvoice(merchant,invoiceId,request.nativeHash||undefined);
    else if(action==='recover-archive')state=await client.recoverArchivedInvoice(request.productId,request.sourceOrder,merchant,invoiceId,request.nativeHash);
    else if(action==='reconcile-archive')state=await client.reconcileArchivedInvoice(request.productId,request.sourceOrder,merchant,invoiceId);
    else if(action==='recover-intent')state=await client.recoverIntent(intentId);
    else if(action==='broadcast-review'){const {action:_,...ref}=request;state=await client.reviewOriginalBroadcast(ref);}
    current();if(state.walletRequest?.id)pending.remember(state.walletRequest.id,main);
    return nativePaySummary(state);
   }catch(error){
    // Error DATA is captured only while the same account and Source remain
    // current. invoke itself preserves the exact original thrown cause.
    if(onFailure&&operationClient)try{current();onFailure(operationClient.snapshot(),current);}catch{}
    throw error;
   }finally{active=false;}
  }
 return Object.freeze({
  compose(originalSource){
   if(source||active)fail('NATIVE_PAY_MAIN_ALREADY_COMPOSED');
   if(!originalSource?.pay||typeof originalSource.current!=='function')fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
   source=originalSource;
  },
  status(){let reason=source?null:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE';
   if(source)try{context()();if(source.current()!==undefined)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');}catch(error){reason=nativePayFailureCode(error,'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');}
   return {client:'YNX Pay',normalMainEntry:true,sourceSupplied:!!source,available:reason===null,reason,approvalInOriginalMain:true,paymentAuthorized:false};},
  cancel,
  // Main-only completion notification; never install as an IPC action. Main
  // calls it only after the original review/cleanup actually settles.
  settleOriginalReview:(id,owner)=>pending.settled(id,owner),
  invoke:raw=>invoke(raw),
  async invokeResult(raw){
   let failureState=null,failureCurrent=null;
   try{return {version:'ynx.pay.main-result/v1',ok:true,...await invoke(raw,(state,current)=>{failureState=state;failureCurrent=current;})};}
   catch(error){if(failureCurrent)try{failureCurrent();}catch{failureState=null;}return nativePayFailureResultDATA(error,failureState);}
  }
 });
}
