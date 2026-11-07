// Fixed package-private Native backend component, not a package export,
// provider registry or transport codec. Called only by the qualified backend
// with its SAME ledger and original caller inventory. Root/LINK carrier must
// retain this owner, never serialize its methods or reconstruct it from DATA.
import{canonicalJSON}from'./canonical.js';
const fault=c=>Object.assign(Error(c),{code:c}),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const method=(o,k)=>{if(typeof o?.[k]!=='function')throw fault('TASK_CONTINUATION_'+k+'_NOT_SUPPLIED');return o[k].bind(o)};
const sync=(o,k,...a)=>{if(method(o,k)(...a)!==undefined)throw fault('TASK_CONTINUATION_VOID_RESULT')};
async function checked(o,k,...a){if(await method(o,k)(...a)!==undefined)throw fault('TASK_CONTINUATION_VOID_RESULT')}
export function createOriginalTaskReadContinuationInventory(originalNativeRoot,store,originalCallerOwner){
 const ledger=store.taskGrants,selected=new WeakSet(),holds=new Set();let retired=false;
 const alive=()=>{if(retired)throw fault('TASK_CONTINUATION_INVENTORY_RETIRED')};
 return Object.freeze({
  async openOriginal(ctx,request,cap){
   alive();if(!cap||typeof cap!=='object'||selected.has(cap))throw fault('TASK_CONTINUATION_ORIGINAL_CAP_SELECTED');
   const g=request?.grant;if(!g||!same(request.step,g.binding)||request.expectedGrantRevision!==g.rev||typeof request.operationId!=='string'||!request.operationId||!(request.rawInput instanceof Uint8Array))throw fault('TASK_CONTINUATION_EXACT_REQUEST');
   // Recognition BEFORE adoption. No query UNKNOWN row can replace this call.
   method(ledger,'currentOriginalTaskEffectContinuation')(cap,{grant:g,operationId:request.operationId,at:Date.now()});
   selected.add(cap);const original=structuredClone(request),args=()=>({grant:original.grant,operationId:original.operationId,at:Date.now()});
   let first,childRetired=false,closed=false,claimSelected=false,active=0;const pending=new Set();
   const remember=cause=>{first??={cause};return first.cause};
   const local=()=>{alive();if(first)throw first.cause;if(childRetired||closed)throw fault('TASK_CONTINUATION_CHILD_RETIRED');sync(originalNativeRoot,'assertNativeObservedCurrent');sync(originalCallerOwner,'assertOriginalTaskCallerAtCommit',ctx);method(ledger,'currentOriginalTaskEffectContinuation')(cap,args());};
   const owner=Object.freeze({
    async assertCurrent(){let work;work=Promise.resolve().then(async()=>{active++;try{local();await checked(originalCallerOwner,'assertTaskCaller',ctx,{action:'effect',value:original.grant});sync(originalNativeRoot,'assertNativeCurrent');local();}catch(cause){throw remember(cause)}finally{active--;pending.delete(work)}});pending.add(work);return work;},
    readOriginalRequestDATA(){local();return structuredClone(original)},
    // Only the genuine private transport's ORIGINAL final resource claim may
    // invoke this; dispatch/prewrite/Current are never a claim. There is no
    // HTTP/public wire to invoke it. No full Source IO occurs inside SQL.
    claimAtOriginalResourceFence(){local();if(claimSelected)throw fault('TASK_CONTINUATION_ALREADY_CLAIMED');claimSelected=true;try{method(ledger,'claimOriginalTaskEffectContinuation')(cap,args());local();}catch(cause){throw remember(cause)}},
    assertOriginalTaskEffectReceiptAtCommit(expected){local();if(!claimSelected||expected.operationId!==original.operationId||!same(expected.grant,original.grant)||expected.state!=='COMMITTED')throw fault('TASK_CONTINUATION_ORIGINAL_RECEIPT_ASSOCIATION');},
    retire(){childRetired=true;},
    async join(){if(!childRetired)throw fault('TASK_CONTINUATION_RETIRE_REQUIRED');await Promise.allSettled([...pending]);if(active||pending.size)throw fault('TASK_CONTINUATION_DRAIN_PENDING')},
    async close(){owner.retire();await owner.join();closed=true;holds.delete(owner);},
    isClosed(){return closed;},firstCause(){return Object.freeze({errorPresent:!!first,error:first?.cause})}
   });holds.add(owner);
   try{await owner.assertCurrent();return{owner,errorPresent:false,error:null}}catch(cause){return{owner,errorPresent:true,error:cause}}
  },
  retire(){retired=true;for(const h of holds)h.retire()},
  async join(){if(!retired)throw fault('TASK_CONTINUATION_RETIRE_REQUIRED');for(const h of holds)await h.join()},
  async close(){this.retire();await this.join();for(const h of [...holds])await h.close()},
  lifetime(){return Object.freeze({retired,children:holds.size})}
 });
}
