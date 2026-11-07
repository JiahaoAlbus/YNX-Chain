import {types} from 'node:util';
import {createPrivateNativeProductPayClient} from './merchant-invoice-approval.mjs';
import {nativeInvoiceProductIntentData} from './invoice-product-intent.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const methods=Object.freeze({createInvoiceIntent:1,lookupInvoiceIntent:1,merchantTermsReview:1,readInvoiceIntent:1,readInvoice:2,readInvoiceEvents:2,reviewSettlement:2,reviewRefund:4,reconcileInvoiceIntent:1,reconcileOperation:3,readOriginalArchiveReceipt:1,readOriginalArchiveReconciliation:1});
const scopeOperations=new Set([...Object.keys(methods),'readOriginalInvoiceIntent','readInvoiceOriginals']);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v);
function data(value,keys,code){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail(code);
 const d=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(d);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail(code);
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function arrayDATA(value,max){
 if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');
 const d=Object.getOwnPropertyDescriptors(value),length=d.length?.value;
 if(!Number.isSafeInteger(length)||length>max||Reflect.ownKeys(d).length!==length+1)fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');
 const rows=[];for(let i=0;i<length;i++){const p=d[String(i)];if(!p||!p.enumerable||!Object.hasOwn(p,'value'))fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');rows.push(p.value);}return rows;
}
function copyScope(value){
 const s=data(value,['version','networkId','account','protectedResourceRef','operations','products'],'MAIN_PRODUCT_PAY_SCOPE_INVALID');
 s.operations=arrayDATA(s.operations,scopeOperations.size);s.products=arrayDATA(s.products,64);
 if(s.version!==1||!/^[0-9a-f]{64}$/.test(s.networkId??'')||!/^0x[0-9a-f]{40}$/.test(s.account??'')||!token(s.protectedResourceRef)||
  !s.operations.length||s.operations.some(x=>!scopeOperations.has(x))||new Set(s.operations).size!==s.operations.length)fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');
 const products=s.products.map(value=>{
  const p=data(value,['productId','sourceOrder'],'MAIN_PRODUCT_PAY_SCOPE_INVALID');
  if(!['shop.order','cloud.ide-usage'].includes(p.productId)||!token(p.sourceOrder))fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');
  return Object.freeze(p);
 });
 if(new Set(products.map(p=>JSON.stringify(p))).size!==products.length||s.operations.includes('readOriginalInvoiceIntent')&&!products.length)fail('MAIN_PRODUCT_PAY_SCOPE_INVALID');
 return Object.freeze({...s,operations:Object.freeze([...s.operations]),products:Object.freeze(products)});
}

/** Main-only composition of the existing fixed private Pay client. The scope
 * is a restriction copied from Auth's independently qualified ProductRoot,
 * never an authorization token. Main must first obtain the actual protected
 * resource selected by that same Root and bind this producer to its Native
 * peer/current epoch. This constructor cannot qualify a Root/resource/Source;
 * neither it nor a resource map/setter is exposed to IPC or a renderer.
 *
 * The existing private request transport still owns authentication, route
 * authorization and the immediate pre-write current fence. No Member POST,
 * signer, approval, key, retry, alternative transport or generic request port
 * is exported. Native must separately borrow its real per-operation permission
 * before invoking this facade. Missing that genuine callee remains a refusal.
 */
export function createMainProductPeerPayProducer({scopeDATA,resource,getContext}){
 const scope=copyScope(scopeDATA);
 const r=data(resource,['protectedResourceRef','networkId','origin','requestPrivate','current','retire','join','close'],'MAIN_PRODUCT_PAY_RESOURCE_INVALID');
 if(r.protectedResourceRef!==scope.protectedResourceRef||r.networkId!==scope.networkId||typeof getContext!=='function'||
  ['requestPrivate','current','retire','join','close'].some(k=>typeof r[k]!=='function'))fail('MAIN_PRODUCT_PAY_RESOURCE_NOT_SELECTED');
 const invoke=(name,...args)=>Reflect.apply(r[name],resource,args);
 let retired=false,joined=false,closed=false,active=0,joinPass=null,closePass=null;
 let firstPresent=false,first,cleanupPresent=false,cleanup,currentFailed=false,currentCause;
 const requests=new Set(),waiters=new Set();
 const remember=cause=>{if(!firstPresent){firstPresent=true;first=cause;}};
 const rememberCleanup=cause=>{if(!cleanupPresent){cleanupPresent=true;cleanup=cause;}};
 function context(){
  const c=getContext();
  if(!c||c.locked!==false||c.changing!==false||c.focused!==true||c.account!==scope.account||c.networkId!==scope.networkId||!['number','string'].includes(typeof c.revision))fail('MAIN_PRODUCT_PAY_CURRENT_UNAVAILABLE');
  return {account:c.account,networkId:c.networkId,revision:c.revision};
 }
 const captured=context();
 function current(){
  if(currentFailed)throw currentCause;
  if(retired||closed)fail('MAIN_PRODUCT_PAY_RETIRED');
  try{
   const now=context();
   if(now.account!==captured.account||now.networkId!==captured.networkId||now.revision!==captured.revision)fail('MAIN_PRODUCT_PAY_CURRENT_UNAVAILABLE');
   if(invoke('current')!==undefined)fail('MAIN_PRODUCT_PAY_CURRENT_RESULT');
  }catch(cause){currentFailed=true;currentCause=cause;remember(cause);throw cause;}
 }
 const client=createPrivateNativeProductPayClient({origin:r.origin,requestPrivate:request=>invoke('requestPrivate',request)});
 async function run(operation,args,callerCurrent){
  if(typeof callerCurrent!=='function')fail('NATIVE_INVOICE_CURRENT_SOURCE_REQUIRED');
  if(!scope.operations.includes(operation))fail('MAIN_PRODUCT_PAY_OPERATION_NOT_ALLOWED');
  if(typeof client[operation]!=='function')fail('MAIN_PRODUCT_PAY_CLIENT_METHOD_NOT_SUPPLIED');
  if(active>=32)fail('MAIN_PRODUCT_PAY_RESOURCE_LIMIT');
  current();
  if(callerCurrent()!==undefined)fail('MAIN_PRODUCT_PAY_CALLER_CURRENT_RESULT');
  const abort=new AbortController(),callerSignal=Object.getOwnPropertyDescriptor(callerCurrent,'signal')?.value;
  if(callerSignal!==undefined&&!(callerSignal instanceof AbortSignal))fail('MAIN_PRODUCT_PAY_CALLER_SIGNAL_INVALID');
  const cancelled=()=>abort.abort();
  if(callerSignal?.aborted)abort.abort();else callerSignal?.addEventListener('abort',cancelled,{once:true});
  requests.add(abort);active++;
  const fence=()=>{current();if(abort.signal.aborted)fail('MAIN_PRODUCT_PAY_REQUEST_CANCELLED');if(callerCurrent()!==undefined)fail('MAIN_PRODUCT_PAY_CALLER_CURRENT_RESULT');};
  Object.defineProperty(fence,'signal',{value:abort.signal});
  try{
   fence();
   if(operation==='createInvoiceIntent'||operation==='lookupInvoiceIntent'){
    const original=nativeInvoiceProductIntentData(args[0]);
    if(!scope.products.some(p=>p.productId===original.productId&&p.sourceOrder===original.sourceOrder))fail('MAIN_PRODUCT_PAY_PRODUCT_NOT_ALLOWED');
    if(original.genesis!==scope.networkId)fail('MAIN_PRODUCT_PAY_NETWORK_CHANGED');
    args=[original];
   }else if(operation==='readOriginalArchiveReceipt'||operation==='readOriginalArchiveReconciliation'){
    const ref=data(args[0],['productId','sourceOrder','merchant','invoiceId',...(operation==='readOriginalArchiveReceipt'?['nativeHash']:[])],'NATIVE_PAY_PRODUCT_REFERENCE_INVALID');
    if(!scope.products.some(p=>p.productId===ref.productId&&p.sourceOrder===ref.sourceOrder))fail('MAIN_PRODUCT_PAY_PRODUCT_NOT_ALLOWED');
    args=[ref];
   }
   const value=await client[operation](...args,fence);fence();return value;
  }catch(cause){remember(cause);throw cause;}
  finally{callerSignal?.removeEventListener('abort',cancelled);requests.delete(abort);active--;if(!active){for(const resolve of waiters)resolve();waiters.clear();}}
 }
 const pay={};
 for(const [name,count]of Object.entries(methods))pay[name]=(...args)=>{
  if(args.length!==count+1)fail('MAIN_PRODUCT_PAY_ARGUMENTS_INVALID');
  const callerCurrent=args.pop();return run(name,args,callerCurrent);
 };
 Object.freeze(pay);
 const producer=Object.freeze({
  current,pay,
  readInvoiceOriginals(reference,callerCurrent){return run('readInvoiceOriginals',[reference],callerCurrent);},
  retire(){
   if(retired)return;retired=true;for(const abort of requests)abort.abort();
   try{if(invoke('retire')!==undefined)fail('MAIN_PRODUCT_PAY_RETIRE_RESULT');}catch(cause){rememberCleanup(cause);throw cause;}
  },
  join(){
   if(!retired)fail('MAIN_PRODUCT_PAY_RETIRE_REQUIRED');
   if(joinPass)return joinPass;
   let resolve,reject;joinPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
   // Reserve before calling an original port: even a synchronous/reentrant
   // callee observes this same debt, never a second join or close attempt.
   void(async()=>{
    if(active)await new Promise(resolve=>waiters.add(resolve));
    if(await invoke('join')!==undefined)fail('MAIN_PRODUCT_PAY_JOIN_RESULT');joined=true;
   })().then(resolve,cause=>{rememberCleanup(cause);reject(cause);});
   // Keep failed join and its original cause; UNKNOWN cleanup is not retried.
   void joinPass.catch(()=>{});return joinPass;
  },
  close(){
   if(closePass)return closePass;
   if(!retired||!joined||active)fail('MAIN_PRODUCT_PAY_CHILDREN_RETAINED');
   let resolve,reject;closePass=new Promise((yes,no)=>{resolve=yes;reject=no;});
   void(async()=>{
    if(await invoke('close')!==undefined)fail('MAIN_PRODUCT_PAY_CLOSE_RESULT');closed=true;
    if(cleanupPresent)throw cleanup;
   })().then(resolve,cause=>{rememberCleanup(cause);reject(cause);});
   void closePass.catch(()=>{});return closePass;
  },
  assertSafeToClose(){if(!closed||active||cleanupPresent)fail('MAIN_PRODUCT_PAY_CLOSE_UNCONFIRMED');},
  statusDATA(){return Object.freeze({retired,joined,closed,active,currentFailed,operationErrorPresent:firstPresent,operationError:first,cleanupErrorPresent:cleanupPresent,cleanupError:cleanup,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,paymentAuthorized:false});}
 });
 // A failed initial current leaves the borrowed original resource with Main;
 // it has not been transferred to an unreturned producer or auto-closed.
 current();return producer;
}
