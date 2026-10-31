import {types} from 'node:util';
import {NativePayBusinessClient,nativePaySummary} from './pay-business-client.mjs';
import {rejectNativePayPending} from './merchant-invoice-approval.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const shapes={invoice:['merchant','invoiceId'],intent:['intentId'],'terms-review':['intentId'],'pay-review':['merchant','invoiceId'],'refund-review':['merchant','invoiceId','refundId','amountAtoms'],events:['merchant','invoiceId'],recover:['merchant','invoiceId','nativeHash'],'recover-intent':['intentId'],'broadcast-review':['kind','merchant','invoiceId','intentId','originalHash']};
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
 let source=null,epoch=0,active=false,client=null;const pending=new Map();
 const context=()=>{
  const c=getContext(),e=epoch;
  if(!c||c.locked||c.changing||!c.focused||typeof c.account!=='string'||!/^0x[0-9a-f]{40}$/.test(c.account))fail('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');
  return ()=>{const now=getContext();if(epoch!==e||!now||now.account!==c.account||now.revision!==c.revision||now.locked||now.changing||!now.focused)fail('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');};
 };
 function cancel(){epoch++;client?.invalidate('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');let failed=false,cause;
  for(const [id,owner] of pending)try{rejectNativePayPending(owner,id);pending.delete(id);}catch(error){if(!failed){failed=true;cause=error;}}
  if(failed)throw cause;return {cancelled:true,originalRetained:true};}
 return Object.freeze({
  compose(originalSource){
   if(source||active)fail('NATIVE_PAY_MAIN_ALREADY_COMPOSED');
   if(!originalSource?.pay||typeof originalSource.current!=='function')fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');
   source=originalSource;
  },
  status(){let reason=source?null:'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE';
   if(source)try{context()();if(source.current()!==undefined)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');}catch(error){reason=error?.code??'NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE';}
   return {client:'YNX Pay',normalMainEntry:true,sourceSupplied:!!source,available:reason===null,reason,approvalInOriginalMain:true,paymentAuthorized:false};},
  cancel,
  async invoke(raw){
   const request=input(raw);if(!source)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');if(active)fail('NATIVE_PAY_MAIN_BUSY');
   const assertContext=context(),originalSource=source,main=getMain();
   const current=()=>{assertContext();if(originalSource.current()!==undefined)fail('NATIVE_PAY_MAIN_SOURCE_UNAVAILABLE');};
   current();active=true;
   try{
    const runtime={main,pay:originalSource.pay,current,
     ...(typeof originalSource.readInvoiceOriginals==='function'?{readInvoiceOriginals:(...args)=>originalSource.readInvoiceOriginals(...args)}:{}),
     ...(originalSource.notificationInbox?{notificationInbox:originalSource.notificationInbox}:{}),
     ...(typeof originalSource.readNotificationScope==='function'?{readNotificationScope:()=>originalSource.readNotificationScope()}:{}),
     ...(typeof originalSource.refreshOriginalProduct==='function'?{refreshOriginalProduct:(...args)=>originalSource.refreshOriginalProduct(...args)}:{})};
    client=new NativePayBusinessClient(runtime);let state;
    const {action,merchant,invoiceId,intentId}=request;
    if(action==='invoice')state=await client.openInvoice(merchant,invoiceId);
    else if(action==='intent')state=await client.openIntent(intentId);
    else if(action==='terms-review')state=await client.reviewMerchantTerms(intentId);
    else if(action==='pay-review')state=await client.reviewPayment(merchant,invoiceId);
    else if(action==='refund-review')state=await client.reviewRefund(merchant,invoiceId,request.refundId,request.amountAtoms);
    else if(action==='events')state=await client.syncNotifications(merchant,invoiceId);
    else if(action==='recover')state=await client.recoverInvoice(merchant,invoiceId,request.nativeHash||undefined);
    else if(action==='recover-intent')state=await client.recoverIntent(intentId);
    else if(action==='broadcast-review'){const {action:_,...ref}=request;state=await client.reviewOriginalBroadcast(ref);}
    current();if(state.walletRequest?.id)pending.set(state.walletRequest.id,main);
    return nativePaySummary(state);
   }finally{active=false;}
  }
 });
}
