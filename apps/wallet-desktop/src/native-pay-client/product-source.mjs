import {types} from 'node:util';
import {nativeInvoiceProductIntentData} from './invoice-product-intent.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const productPayMethods={createInvoiceIntent:1,lookupInvoiceIntent:1,merchantTermsReview:1,readInvoiceIntent:1,readInvoice:2,readInvoiceEvents:2,reviewSettlement:2,reviewRefund:4,reconcileInvoiceIntent:1,reconcileOperation:3,readOriginalArchiveReceipt:1,readOriginalArchiveReconciliation:1};
const ownValue=(value,key)=>{
 const d=Object.getOwnPropertyDescriptor(value,key);
 return d&&Object.hasOwn(d,'value')?d.value:undefined;
};
const partialOf=cause=>cause&&typeof cause==='object'&&!types.isProxy(cause)?ownValue(cause,'partial'):undefined;
const reference=value=>{
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(keys.length!==2||keys.some(k=>!['productId','sourceOrder'].includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value'))||
  !['productId','sourceOrder'].every(k=>typeof d[k]?.value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(d[k].value)))fail('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
 return Object.freeze({productId:d.productId.value,sourceOrder:d.sourceOrder.value});
};
const archiveReference=(value,withHash)=>{
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),keys=['productId','sourceOrder','merchant','invoiceId',...(withHash?['nativeHash']:[])];
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')||typeof d[k].value!=='string'))fail('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
 const out=Object.fromEntries(keys.map(k=>[k,d[k].value]));reference({productId:out.productId,sourceOrder:out.sourceOrder});
 if(!['shop.order','cloud.ide-usage'].includes(out.productId)||!/^0x[0-9a-f]{40}$/.test(out.merchant)||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/.test(out.invoiceId)||withHash&&!/^0x[0-9a-f]{64}$/.test(out.nativeHash))fail('NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
 return Object.freeze(out);
};

/** Normal Main boot consumer of a separately qualified ProductSource. The
 * original factory/recognizer comes from the admitted normal namespace, never
 * IPC, ENV, a renderer, request JSON or the Wallet Member5 supplier. This
 * adapter cannot qualify a source or produce Root/price/archive permission. */
export async function openNativePayProductSource({acquireOriginalProductSource,isOriginalProductSource}){
 let loan=null,recognized=false,ready=false,retired=false,joined=false,closed=false,active=0,firstPresent=false,first,cleanupPresent=false,cleanup;
 const waiters=new Set(),requests=new Set();let closePass=null,joinPass=null,originalEvidence=null;
 function remember(cause){if(!firstPresent){firstPresent=true;first=cause;}}
 function rememberCleanup(cause){if(!cleanupPresent){cleanupPresent=true;cleanup=cause;}}
 function current(){
  if(firstPresent)throw first;
  if(!ready||retired||closed||!loan)fail('NATIVE_PAY_PRODUCT_SOURCE_UNAVAILABLE');
  try{if(loan.current()!==undefined)fail('NATIVE_PAY_PRODUCT_CURRENT_RESULT');}catch(cause){remember(cause);throw cause;}
 }
 async function run(callerCurrent,work){
  if(typeof callerCurrent!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
  const callerSignal=Object.getOwnPropertyDescriptor(callerCurrent,'signal')?.value;
  if(callerSignal!==undefined&&!(callerSignal instanceof AbortSignal))fail('NATIVE_PAY_PRODUCT_CALLER_SIGNAL_INVALID');
  current();if(callerCurrent()!==undefined)fail('NATIVE_PAY_PRODUCT_CALLER_CURRENT_RESULT');
  const abort=new AbortController(),cancelled=()=>abort.abort();
  let listenerSelected=false,operationFailed=false,operationCause;
  active++;requests.add(abort);
  try{
   if(callerSignal?.aborted)abort.abort();
   else if(callerSignal){
    // Registration may install the listener and then throw. Adopt that debt
    // before entering the caller so cleanup cannot disappear on partial work.
    listenerSelected=true;callerSignal.addEventListener('abort',cancelled,{once:true});
   }
   const fence=()=>{current();if(abort.signal.aborted)fail('NATIVE_PAY_PRODUCT_REQUEST_CANCELLED');if(callerCurrent()!==undefined)fail('NATIVE_PAY_PRODUCT_CALLER_CURRENT_RESULT');};
   Object.defineProperty(fence,'signal',{value:abort.signal});
   fence();const value=await work(fence);fence();return value;
  }catch(cause){operationFailed=true;operationCause=cause;throw cause;}
  finally{
   let detachFailed=false,detachCause;
   try{if(listenerSelected)callerSignal.removeEventListener('abort',cancelled);}
   catch(cause){
    detachFailed=true;detachCause=cause;rememberCleanup(cause);
    remember(operationFailed?operationCause:cause);
   }finally{
    requests.delete(abort);active--;
    if(!active){for(const resolve of waiters)resolve();waiters.clear();}
   }
   // Cleanup must not replace a preceding read/add failure, including falsy
   // causes. Failed detach still prevents any later read or safe-close claim.
   if(detachFailed&&!operationFailed)throw detachCause;
  }
 }

 const pay={};
 for(const [name,count]of Object.entries(productPayMethods))pay[name]=(...args)=>{
  if(args.length<count||args.length>count+1)fail('NATIVE_PAY_PRODUCT_PAY_ARGUMENTS');
  const callerCurrent=args.length===count+1?args.pop():()=>{};
  return run(callerCurrent,fence=>{
  if(typeof loan.pay?.[name]!=='function')fail('NATIVE_PAY_PRODUCT_PAY_METHOD_UNAVAILABLE');
  return loan.pay[name](...args,fence);
  });
 };
 // These methods are preparation/read service operations, never the three
 // signed-Member dispatch methods of Wallet's separate original Source.
 Object.freeze(pay);
 async function readShopOrder(ref,fence){
  if(ref.productId!=='shop.order'||typeof loan.readOriginalShopNativeInvoiceRequestDATA!=='function')fail('NATIVE_PAY_SHOP_ORIGINAL_SOURCE_NOT_SUPPLIED');
  const value=await loan.readOriginalShopNativeInvoiceRequestDATA(ref.sourceOrder,fence);
  fence();return value;
 }
 function boundIntent(value,ref){
  const original=nativeInvoiceProductIntentData(value);
  if(original.productId!==ref.productId||original.sourceOrder!==ref.sourceOrder)fail('NATIVE_PAY_PRODUCT_REFERENCE_CHANGED');
  return original;
 }
 const runtime=Object.freeze({
  current,pay,
  readOriginalArchiveReceipt(ref,callerCurrent){return run(callerCurrent,fence=>{
   const checked=archiveReference(ref,true);
   if(typeof loan.readOriginalArchiveReceipt==='function')return loan.readOriginalArchiveReceipt(checked,fence);
   if(typeof loan.pay?.readOriginalArchiveReceipt==='function')return loan.pay.readOriginalArchiveReceipt(checked,fence);
   fail('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  });},
  readOriginalArchiveReconciliation(ref,callerCurrent){return run(callerCurrent,fence=>{
   const checked=archiveReference(ref,false);
   if(typeof loan.readOriginalArchiveReconciliation==='function')return loan.readOriginalArchiveReconciliation(checked,fence);
   if(typeof loan.pay?.readOriginalArchiveReconciliation==='function')return loan.pay.readOriginalArchiveReconciliation(checked,fence);
   fail('NATIVE_PAY_ARCHIVE_READER_UNAVAILABLE');
  });},
  readOriginalInvoiceIntent(input,callerCurrent){return run(callerCurrent,async fence=>{
   const ref=reference(input);let value,pendingEvidence;
   if(ref.productId==='shop.order'&&typeof loan.readOriginalShopNativeInvoiceRequestDATA==='function'){
    // Actor/role and the normal route stay inside the genuine supplier.
    value=await readShopOrder(ref,fence);
   }else if(ref.productId==='cloud.ide-usage'&&typeof loan.readOriginalCloudBillLocator==='function'&&typeof loan.cloudClient?.nativeInvoiceIntentOriginal==='function'){
    const locator=await loan.readOriginalCloudBillLocator(ref,fence);fence();
    if(!locator||!locator.selection||typeof locator.utcDay!=='string')fail('NATIVE_PAY_CLOUD_ORIGINAL_LOCATOR_UNAVAILABLE');
    const envelope=await loan.cloudClient.nativeInvoiceIntentOriginal(locator.selection,locator.utcDay,{...ref,signal:fence.signal});fence();
    value=envelope?.request;
    // Keep the supplier's complete bill/manifest/full Ref evidence, not a
    // newly constructed bill. This bounded in-memory read receipt is no
    // transaction journal and grants no Source or payment authority.
    const saved=structuredClone(envelope);
    if(Buffer.byteLength(JSON.stringify(saved))>2*1024*1024)fail('NATIVE_PAY_PRODUCT_EVIDENCE_BOUNDS');
    pendingEvidence={ref,envelope:saved};
   }else if(typeof loan.readOriginalInvoiceIntent==='function')value=await loan.readOriginalInvoiceIntent(ref,fence);
   else fail('NATIVE_PAY_PRODUCT_ORIGINAL_UNAVAILABLE');
   fence();const original=boundIntent(value,ref);
   if(pendingEvidence)originalEvidence=pendingEvidence;
   return original;
  });},
  readOriginalShopInvoiceIntent(input,callerCurrent){return run(callerCurrent,async fence=>{
   const ref=reference(input);
   return boundIntent(await readShopOrder(ref,fence),ref);
  });},
  readOriginalProductEvidence(input,callerCurrent){return run(callerCurrent,()=>{
   const ref=reference(input);
   if(!originalEvidence||originalEvidence.ref.productId!==ref.productId||originalEvidence.ref.sourceOrder!==ref.sourceOrder)fail('NATIVE_PAY_PRODUCT_EVIDENCE_UNAVAILABLE');
   return structuredClone(originalEvidence.envelope);
  });},
  readInvoiceOriginals(ref,callerCurrent){return run(callerCurrent,fence=>{
   // A genuine archive may provide the payer's real historical original.
   // The service fallback supports retained terms only; refunds fail closed.
   if(typeof loan.readInvoiceOriginals==='function')return loan.readInvoiceOriginals(ref,fence);
   if(typeof loan.pay?.readInvoiceOriginals!=='function')fail('NATIVE_PAY_INVOICE_ORIGINALS_UNAVAILABLE');
   return loan.pay.readInvoiceOriginals(ref,fence);
  });},
  retire(){
   if(retired)return;retired=true;for(const abort of requests)abort.abort();
   if(loan)try{if(!recognized)fail('NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED');if(loan.retire()!==undefined)fail('NATIVE_PAY_PRODUCT_RETIRE_RESULT');}catch(cause){rememberCleanup(cause);throw cause;}
  },
  join(){
   if(!retired)fail('NATIVE_PAY_PRODUCT_RETIRE_REQUIRED');
   if(joinPass)return joinPass;
   let resolve,reject;joinPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
   // Reserve custody before invoking a possibly synchronous/reentrant Native
   // port. A failed or UNKNOWN join is the same retained debt, never a retry.
   void(async()=>{
    if(active)await new Promise(resolve=>waiters.add(resolve));
    if(loan){if(!recognized)fail('NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED');if(await loan.join()!==undefined)fail('NATIVE_PAY_PRODUCT_JOIN_RESULT');}joined=true;
   })().then(resolve,cause=>{rememberCleanup(cause);reject(cause);});
   void joinPass.catch(()=>{});
   return joinPass;
  },
  close(){
   if(closePass)return closePass;
   if(!retired||!joined||active)fail('NATIVE_PAY_PRODUCT_CHILDREN_RETAINED');
   let resolve,reject;closePass=new Promise((yes,no)=>{resolve=yes;reject=no;});
   void(async()=>{
    if(loan){if(!recognized)fail('NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED');if(await loan.close()!==undefined)fail('NATIVE_PAY_PRODUCT_CLOSE_RESULT');}closed=true;originalEvidence=null;
    if(cleanupPresent)throw cleanup;
   })().then(resolve,cause=>{rememberCleanup(cause);reject(cause);});
   void closePass.catch(()=>{});
   // Keep the same failed close/cause/loan; never retry an UNKNOWN close.
   return closePass;
  },
  assertSafeToClose(){if(!closed||active||cleanupPresent)fail('NATIVE_PAY_PRODUCT_CLOSE_UNCONFIRMED');},
  status(){return Object.freeze({ready,retired,joined,closed,active,operationFailed:firstPresent,cleanupFailed:cleanupPresent,SourceAdmission:false});}
 });
 try{
  if(typeof acquireOriginalProductSource!=='function'||typeof isOriginalProductSource!=='function')fail('NATIVE_PAY_PRODUCT_SOURCE_FACTORY_UNAVAILABLE');
  let captureFailed=false,captureCause;
  try{loan=await acquireOriginalProductSource();}catch(cause){loan=partialOf(cause)??null;captureFailed=true;captureCause=cause;remember(cause);}
  if(loan&&!types.isProxy(loan))recognized=isOriginalProductSource(loan)===true;
  if(captureFailed)throw captureCause;
  if(!recognized)fail('NATIVE_PAY_PRODUCT_SOURCE_UNRECOGNIZED');
  if(['current','retire','join','close'].some(k=>typeof loan[k]!=='function')||!loan.pay)fail('NATIVE_PAY_PRODUCT_SOURCE_PORTS_UNAVAILABLE');
  ready=true;current();return runtime;
 }catch(cause){
  remember(cause);
  // Caller adopts the nonnull consumer partial before interpreting cause,
  // including primitive false/null/undefined from the original factory.
  throw Object.assign(Error('NATIVE_PAY_PRODUCT_SOURCE_CAPTURE_FAILED'),{code:'NATIVE_PAY_PRODUCT_SOURCE_CAPTURE_FAILED',cause:first,partial:runtime});
 }
}

/** Normal composition only; no caller-supplied loader, URL, path or approval. */
export async function composeNativePayProductSource(entry,factories){
 const runtime=await openNativePayProductSource(factories);
 try{entry.compose(runtime);return runtime;}
 catch(cause){throw Object.assign(Error('NATIVE_PAY_PRODUCT_COMPOSITION_FAILED'),{code:'NATIVE_PAY_PRODUCT_COMPOSITION_FAILED',cause,partial:runtime});}
}
