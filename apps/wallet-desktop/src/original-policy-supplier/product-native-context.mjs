import {types} from 'node:util';
import {createMainProductPeerPayProducer} from '../native-pay-client/main-product-peer-pay.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
function method(owner,name,{frozen=false}={}){
 if(!owner||types.isProxy(owner))fail('PRODUCT_NATIVE_CONTEXT_ORIGINAL_PORT_REQUIRED');
 const d=Object.getOwnPropertyDescriptor(owner,name);
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value)||frozen&&(d.writable!==false||d.configurable!==false))fail('PRODUCT_NATIVE_CONTEXT_ORIGINAL_PORT_REQUIRED');
 return d.value;
}
const invoke=(owner,name,...args)=>Reflect.apply(method(owner,name),owner,args);
function frozenData(value,keys,code){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype||!Object.isFrozen(value))fail(code);
 const d=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(d);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail(code);
 return value;
}
function frozenArray(value){
 if(!Array.isArray(value)||types.isProxy(value)||!Object.isFrozen(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('PRODUCT_NATIVE_PAY_SCOPE_NOT_SUPPLIED');
 const d=Object.getOwnPropertyDescriptors(value),n=d.length.value;
 if(n>64||Reflect.ownKeys(d).length!==n+1)fail('PRODUCT_NATIVE_PAY_SCOPE_NOT_SUPPLIED');
 for(let i=0;i<n;i++)if(!d[String(i)]?.enumerable||!Object.hasOwn(d[String(i)],'value'))fail('PRODUCT_NATIVE_PAY_SCOPE_NOT_SUPPLIED');return value;
}

/** Main's per-acquisition context custody only. These peers are not a Root,
 * independent ProductSource, registered resource or payment permission. The
 * fixed Native constructor captures from the SAME Main AsyncLocalStorage slot
 * and independently qualifies Source/root/resource/current. No IPC/ENV/global
 * registry/provider setter, Member, signer or approval is accepted here.
 */
export function createOriginalWalletProductContextBridge(getContext,{isOriginalNativeOwner=()=>false}={}){
 if(typeof getContext!=='function'||typeof isOriginalNativeOwner!=='function')fail('PRODUCT_NATIVE_CONTEXT_MAIN_BOOT_REQUIRED');
 const peers=new WeakMap(),held=new Set();
 function remember(s,cause){if(!s.firstPresent){s.firstPresent=true;s.first=cause;}}
 function cleanup(s,cause){if(!s.cleanupPresent){s.cleanupPresent=true;s.cleanup=cause;}}
 function current(s){
  if(s.firstPresent)throw s.first;
  if(s.retired||s.closed)fail('PRODUCT_NATIVE_CONTEXT_RETIRED');
  try{
   if(invoke(s.ctx,'assertCurrent')!==undefined)fail('PRODUCT_NATIVE_CONTEXT_CURRENT_RESULT');
   const at=Date.now();if(at<s.floor||at>=s.expiresAtMs)fail('PRODUCT_NATIVE_CONTEXT_EXPIRED');s.floor=at;
   if(s.ctx.account!==s.account||s.ctx.networkId!==s.networkId||s.ctx.revision!==s.revision)fail('PRODUCT_NATIVE_CONTEXT_IDENTITY_CHANGED');
   const live=invoke(s.ctx,'readCurrentState');
   if(!live||live.account!==s.account||live.networkId!==s.networkId||live.revision!==s.revision||live.locked!==false||live.changing!==false||live.focused!==true)fail('PRODUCT_NATIVE_CONTEXT_IDENTITY_CHANGED');
   // Never call s.nativeOwner.current(): Native's own current includes this
   // Main peer, so doing so would create a cycle and fabricate no authority.
  }catch(cause){remember(s,cause);throw cause;}
 }
 function retire(s){
  if(s.retired)return;s.retired=true;for(const request of s.requests)request.abort();
  let failed=false,first;
  for(const attempt of [()=>{if(s.producer&&s.producer.retire()!==undefined)fail('PRODUCT_NATIVE_PAY_RETIRE_RESULT');},()=>{
   if(s.nativeOwner&&!s.nativeRetireSelected){s.nativeRetireSelected=true;if(Reflect.apply(s.nativeRetire,s.nativeOwner,[])!==undefined)fail('PRODUCT_NATIVE_CONTEXT_RETIRE_RESULT');}
  }])try{attempt();}catch(cause){cleanup(s,cause);if(!failed){failed=true;first=cause;}}
  if(failed)throw first;
 }
 function flight(s,work){
  current(s);if(s.active>=32)fail('PRODUCT_NATIVE_CONTEXT_CHILD_LIMIT');s.active++;
  const task=Promise.resolve().then(work).catch(cause=>{remember(s,cause);throw cause;}).finally(()=>{s.active--;if(!s.active){for(const resolve of s.waiters)resolve();s.waiters.clear();}});
  void task.catch(()=>{});return task;
 }
 function read(s,name,args,combinedCurrent){
  if(typeof combinedCurrent!=='function')fail('PRODUCT_NATIVE_CONTEXT_CALLER_CURRENT_REQUIRED');
  return flight(s,async()=>{
   if(s.retired)fail('PRODUCT_NATIVE_CONTEXT_RETIRED');
   const abort=new AbortController(),callerSignal=Object.getOwnPropertyDescriptor(combinedCurrent,'signal')?.value;
   if(callerSignal!==undefined&&!(callerSignal instanceof AbortSignal))fail('PRODUCT_NATIVE_CONTEXT_CALLER_SIGNAL_INVALID');
   const onAbort=()=>abort.abort();if(callerSignal?.aborted)abort.abort();else callerSignal?.addEventListener('abort',onAbort,{once:true});s.requests.add(abort);
   const fence=()=>{current(s);if(abort.signal.aborted)fail('PRODUCT_NATIVE_CONTEXT_REQUEST_CANCELLED');if(combinedCurrent()!==undefined)fail('PRODUCT_NATIVE_CONTEXT_CALLER_CURRENT_RESULT');};
   Object.defineProperty(fence,'signal',{value:abort.signal});
   try{
    fence();const d=Object.getOwnPropertyDescriptor(s.ctx,name);
    if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail(name==='readOriginalShopNativeInvoiceRequestDATA'?'PRODUCT_NATIVE_SHOP_ORIGINAL_NOT_SUPPLIED':'PRODUCT_NATIVE_CLOUD_LOCATOR_NOT_SUPPLIED');
    const result=await Reflect.apply(d.value,s.ctx,[...args,fence]);fence();return result;
   }finally{callerSignal?.removeEventListener('abort',onAbort);s.requests.delete(abort);}
  });
 }
 function join(s){
  if(!s.retired)fail('PRODUCT_NATIVE_CONTEXT_RETIRE_REQUIRED');if(s.joinPass)return s.joinPass;
  let resolve,reject;s.joinPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
  void(async()=>{
   if(s.active)await new Promise(resolve=>s.waiters.add(resolve));
   if(s.producer){if(await s.producer.join()!==undefined)fail('PRODUCT_NATIVE_PAY_JOIN_RESULT');}
   s.joined=true;
  })().then(resolve,cause=>{cleanup(s,cause);reject(cause);});void s.joinPass.catch(()=>{});return s.joinPass;
 }
 function close(s){
  if(s.closePass)return s.closePass;if(!s.retired||!s.joined||s.active)fail('PRODUCT_NATIVE_CONTEXT_CHILDREN_RETAINED');
  let resolve,reject;s.closePass=new Promise((yes,no)=>{resolve=yes;reject=no;});
  void(async()=>{
   if(s.producer){if(await s.producer.close()!==undefined)fail('PRODUCT_NATIVE_PAY_CLOSE_RESULT');s.producer.assertSafeToClose();}
   if(s.cleanupPresent)throw s.cleanup;s.closed=true;held.delete(s);
   // Native's parent is currently draining this Main child. Its join cannot
   // be a precondition for this close; that would deadlock the same owner.
  })().then(resolve,cause=>{cleanup(s,cause);reject(cause);});void s.closePass.catch(()=>{});return s.closePass;
 }
 function capturePay(s){
  if(s.payPass)return s.payPass;
  current(s);if(!s.nativeOwner)fail('PRODUCT_NATIVE_CONTEXT_ASSOCIATION_REQUIRED');
  // Reserve before either original getter. Reentrancy/UNKNOWN can never
  // acquire a second resource, select a new scope or repeat a failed capture.
  let resolve,reject;s.payPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
  let task;try{task=flight(s,async()=>{
   const owner=s.nativeOwner;
   current(s);const scopeDATA=await invoke(owner,'readOriginalProductScopeDATAForMain');current(s);
   frozenData(scopeDATA,['version','networkId','account','protectedResourceRef','operations','products'],'PRODUCT_NATIVE_PAY_SCOPE_NOT_SUPPLIED');
   frozenArray(scopeDATA.operations);for(const p of frozenArray(scopeDATA.products))frozenData(p,['productId','sourceOrder'],'PRODUCT_NATIVE_PAY_SCOPE_NOT_SUPPLIED');
   if(scopeDATA.networkId!==s.networkId||scopeDATA.account!==s.account)fail('PRODUCT_NATIVE_PAY_SCOPE_CHANGED');
   const resource=await invoke(owner,'captureOriginalProductPayResourceForMain');
   // Native retains resource custody until the safe13 constructor succeeds;
   // including late cancellation and constructor failure. Do not close a raw
   // partial using guessed methods or create an alternate request transport.
   current(s);if(s.nativeOwner!==owner)fail('PRODUCT_NATIVE_CONTEXT_ASSOCIATION_CHANGED');
   frozenData(resource,['protectedResourceRef','networkId','origin','requestPrivate','current','retire','join','close'],'PRODUCT_NATIVE_PAY_RESOURCE_NOT_SUPPLIED');
   const producer=createMainProductPeerPayProducer({scopeDATA,resource,getContext:()=>{current(s);return invoke(s.ctx,'readCurrentState');}});
   s.producer=producer; // Adopt the successful transfer before a late failure.
   try{current(s);}catch(cause){try{producer.retire();}catch(e){cleanup(s,e);}throw cause;}
   return producer;
  });}catch(cause){remember(s,cause);reject(cause);}
  task?.then(resolve,reject);void s.payPass.catch(()=>{});return s.payPass;
 }
 function capture(...args){
  if(args.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');const ctx=getContext();
  if(!ctx||types.isProxy(ctx)||ctx.captureOpen!==true||ctx.captureSelected)fail('PRODUCT_NATIVE_CONTEXT_NOT_ACTIVE');
  if(held.size>=64)fail('PRODUCT_NATIVE_CONTEXT_PENDING_LIMIT');ctx.captureSelected=true;
  const s={ctx,account:ctx.account,networkId:ctx.networkId,revision:ctx.revision,expiresAtMs:ctx.expiresAtMs,floor:Date.now(),retired:false,joined:false,closed:false,firstPresent:false,cleanupPresent:false,active:0,waiters:new Set(),requests:new Set(),nativeOwner:null,nativeRetireSelected:false,producer:null,payPass:null};
  const peer=Object.freeze(Object.assign(Object.create(null),{
   current(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');current(s);},
   readOriginalContextDATA(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');current(s);return Object.freeze({networkId:s.networkId,account:s.account});},
   readOriginalShopNativeInvoiceRequestDATA(orderId,combinedCurrent){if(arguments.length!==2)fail('PRODUCT_NATIVE_CONTEXT_ARGUMENTS_INVALID');return read(s,'readOriginalShopNativeInvoiceRequestDATA',[orderId],combinedCurrent);},
   readOriginalCloudBillLocator(ref,combinedCurrent){if(arguments.length!==2)fail('PRODUCT_NATIVE_CONTEXT_ARGUMENTS_INVALID');return read(s,'readOriginalCloudBillLocator',[ref],combinedCurrent);},
   captureOriginalPayPreparationReaderForNative(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');return capturePay(s);},
   retire(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');retire(s);},
   join(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');return join(s);},
   close(){if(arguments.length)fail('PRODUCT_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');return close(s);}
  }));s.peer=peer;peers.set(peer,s);held.add(s);
  try{
   ctx.onCaptured?.(peer);
   if(!/^[0-9a-f]{64}$/.test(s.networkId??'')||!/^0x[0-9a-f]{40}$/.test(s.account??'')||!['number','string'].includes(typeof s.revision)||!Number.isSafeInteger(s.expiresAtMs)||s.expiresAtMs<=s.floor)fail('PRODUCT_NATIVE_CONTEXT_BINDING_INVALID');
   current(s);return peer;
  }catch(cause){remember(s,cause);const error=Object.assign(Error('Original Main Product context capture failed.',{cause}),{code:'PRODUCT_NATIVE_CONTEXT_CAPTURE_FAILED'});Object.defineProperty(error,'partial',{value:peer});throw error;}
 }
 return Object.freeze({
  capture,isPeer:peer=>peers.has(peer),
  associate(peer,owner){
   if(arguments.length!==2)fail('PRODUCT_NATIVE_CONTEXT_ARGUMENTS_INVALID');const s=peers.get(peer);
   if(!s||s.ctx!==getContext()||s.ctx.captureOpen!==true)fail('PRODUCT_NATIVE_CONTEXT_ASSOCIATION_SCOPE');
   if(isOriginalNativeOwner(owner)!==true)fail('PRODUCT_NATIVE_CONTEXT_ASSOCIATION_OWNER');
   const nativeRetire=method(owner,'retire',{frozen:true});
   if(s.nativeOwner&&s.nativeOwner!==owner)fail('PRODUCT_NATIVE_CONTEXT_ASSOCIATION_CONFLICT');
   if(!s.nativeOwner){s.nativeOwner=owner;s.nativeRetire=nativeRetire;}
   if(s.retired||s.closed){if(!s.nativeRetireSelected){s.nativeRetireSelected=true;Reflect.apply(s.nativeRetire,owner,[]);}fail('PRODUCT_NATIVE_CONTEXT_RETIRED');}
   current(s);return undefined;
  },
  invalidateAll(){let failed=false,first;for(const s of held)try{retire(s);}catch(cause){if(!failed){failed=true;first=cause;}}if(failed)throw first;},
  async closeContext(ctx){
   let failed=false,first;
   // Parent uses this only after its original Native drain is observed. A
   // retirement error still permits draining own in-flight children; it does
   // not permit closing another Root/Source/Store or retrying UNKNOWN close.
   for(const s of [...held])if(s.ctx===ctx){
    try{retire(s);}catch(cause){if(!failed){failed=true;first=cause;}}
    try{await join(s);await close(s);}catch(cause){if(!failed){failed=true;first=cause;}}
   }
   if(failed)throw first;
  },
  assertSafeToClose(){if(held.size)fail('PRODUCT_NATIVE_CONTEXT_CLOSE_UNCONFIRMED');},
  statusDATA(){return Object.freeze({held:held.size,rows:Object.freeze([...held].map(s=>Object.freeze({account:s.account,networkId:s.networkId,retired:s.retired,joined:s.joined,closed:s.closed,active:s.active,associated:!!s.nativeOwner,paySelected:!!s.payPass,payProducerRetained:!!s.producer,firstCausePresent:s.firstPresent,firstCause:s.first,cleanupErrorPresent:s.cleanupPresent,cleanupError:s.cleanup}))),RootAdmission:false,SourceAdmission:false,NativeAdmission:false});}
 });
}
