import {types} from 'node:util';
import {createNativePayMainEntry} from './native-pay-client/main-entry.mjs';
import {readNativePayFailureCause} from './native-pay-client/pay-business-client.mjs';
import {composeNativePayProductSource} from './native-pay-client/product-source.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const partial=cause=>{if(!cause||typeof cause!=='object'||types.isProxy(cause))return null;const d=Object.getOwnPropertyDescriptor(cause,'partial');return d&&Object.hasOwn(d,'value')?d.value:null;};
// Boot captures only fixed admitted Native factories. Each explicit request
// acquires its own original read parent under the actual selected key guard.
// P06 still owns service orchestration; Main still owns every signing review.
export function createWalletNativePayProductStartup({captureFactories,getMain,getContext,getGuard}){
 let factories=null,configurationCause,closing=false,shutdownPass=null;
 const rows=new Set(),tasks=new Set(),entries=new Set(),entryFailures=new Map();
 function configure(){try{factories=captureFactories();configurationCause=undefined;}catch(cause){configurationCause=cause;throw cause;}}
 function lower(row){row.cancelled=true;if(row.runtime&&!row.retireSelected){row.retireSelected=true;if(row.runtime.retire()!==undefined)fail('NATIVE_PAY_PRODUCT_RETIRE_RESULT');}}
 function drain(row){
  if(row.drain)return row.drain;
  let resolve,reject;row.drain=new Promise((yes,no)=>{resolve=yes;reject=no;});
  let failed=false,cause;try{lower(row);}catch(error){failed=true;cause=error;}
  void(async()=>{
   try{
    if(row.runtime){if(await row.runtime.join()!==undefined)fail('NATIVE_PAY_PRODUCT_JOIN_RESULT');if(await row.runtime.close()!==undefined)fail('NATIVE_PAY_PRODUCT_CLOSE_RESULT');row.runtime.assertSafeToClose();}
    if(failed)throw cause;rows.delete(row);resolve();
   }catch(error){row.cleanupPresent=true;row.cleanupCause=failed?cause:error;reject(row.cleanupCause);}
  })();void row.drain.catch(()=>{});return row.drain;
 }
 function cancel(){
  let failed=false,cause;const attempt=fn=>{try{fn();}catch(error){if(!failed){failed=true;cause=error;}}};
  for(const row of rows)attempt(()=>lower(row));
  for(const entry of [...entries])attempt(()=>{
   if(entryFailures.has(entry))throw entryFailures.get(entry);
   try{entry.cancel();entries.delete(entry);}catch(error){entryFailures.set(entry,error);throw error;}
  });if(failed)throw cause;return {cancelled:true,originalRetained:true};
 }
 function invoke(input, original){
   if(closing)return Promise.reject(Object.assign(Error('NATIVE_PAY_MAIN_CLOSING'),{code:'NATIVE_PAY_MAIN_CLOSING'}));
   const guard=getGuard();
   const current=()=>{guard.assert();if(original&&original.assertHostCurrent()!==undefined)fail('NATIVE_PAY_MAIN_HOST_CURRENT_RESULT');};
   current();if(rows.size>=32||entries.size>=64)fail('NATIVE_PAY_PRODUCT_RESOURCE_LIMIT');
   const entry=createNativePayMainEntry({getMain,getContext}),row={entry,runtime:null,cancelled:false,retireSelected:false,drain:null};rows.add(row);entries.add(entry);
   const task=(async()=>{
    let result,failed=false,cause,composing=false;
    try{
     if(!factories)configure();current();composing=true;
     try{row.runtime=await composeNativePayProductSource(entry,factories);}catch(error){row.runtime=partial(error);throw error;}
     if(row.cancelled||closing)fail('NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE');current();
     result=await (original?entry.invokeOriginalOrderResult(input,original.operation,current):entry.invokeResult(input));current();
    }catch(error){failed=true;cause=error;}
    finally{
     // The outer P06 constructor always supplies its own runtime partial;
     // no methods on the underlying unknown Native loan are guessed here.
     if(!composing)row.runtime=null;
     try{await drain(row);}catch(error){if(!failed){failed=true;cause=error;}}
     // An earlier cancellation may remove an entry before its Main review returns.
     // Re-adopt that SAME late entry and its first cleanup cause together.
     if(original&&!failed)try{current();}catch(error){failed=true;cause=error;}
     if(failed||!result?.walletRequest){try{entry.cancel();entries.delete(entry);}catch(error){entries.add(entry);if(!entryFailures.has(entry))entryFailures.set(entry,error);if(!failed){failed=true;cause=error;}}}
    }
    if(failed)throw cause;return result;
   })();tasks.add(task);void task.then(()=>tasks.delete(task),()=>tasks.delete(task));return task;
 }
 const controller=Object.freeze({
  configure,
  // Main-only weak diagnostic association; never a renderer action or retry token.
  readOriginalFailureCause:readNativePayFailureCause,
  status(){const ctx=getContext();return {client:'YNX Pay',normalMainEntry:true,sourceSupplied:false,available:false,
   reason:closing?'NATIVE_PAY_MAIN_CLOSING':configurationCause?.code??'NATIVE_PAY_PRODUCT_SOURCE_REQUIRES_CURRENT_REQUEST',
   canRequest:!closing&&!ctx.locked&&!ctx.changing&&ctx.focused===true,approvalInOriginalMain:true,paymentAuthorized:false};},
  cancel,
  settleOriginalReview(id,owner){
   for(const entry of [...entries]){const result=entry.settleOriginalReview(id,owner);if(result.settled){entries.delete(entry);entryFailures.delete(entry);return result;}}
   return {settled:false};
  },
  invoke(input){return invoke(input);},
  invokeOriginalOrderResult(input,operation,assertHostCurrent){
   if(arguments.length!==3||typeof operation!=='string'||!/^npi_[0-9a-f]{48}$/.test(operation)||typeof assertHostCurrent!=='function')fail('NATIVE_PAY_MAIN_ORIGINAL_ORDER_REQUIRED');
   return invoke(input,{operation,assertHostCurrent});
  },
  shutdown(){
   if(shutdownPass)return shutdownPass;closing=true;let resolve,reject;shutdownPass=new Promise((yes,no)=>{resolve=yes;reject=no;});
   let failed=false,cause;try{cancel();}catch(error){failed=true;cause=error;}
   void(async()=>{try{while(tasks.size)await Promise.allSettled([...tasks]);for(const row of [...rows])try{await drain(row);}catch(error){if(!failed){failed=true;cause=error;}}if(failed)throw cause;controller.assertSafeToClose();resolve();}catch(error){reject(error);}})();
   void shutdownPass.catch(()=>{});return shutdownPass;
  },
  assertSafeToClose(){if(rows.size||tasks.size||entries.size||entryFailures.size)fail('NATIVE_PAY_PRODUCT_CLEANUP_PENDING');},
 });return controller;
}
