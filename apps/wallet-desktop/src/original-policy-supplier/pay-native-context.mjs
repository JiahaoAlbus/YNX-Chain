import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const typed=Object.getPrototypeOf(Uint8Array.prototype),bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get,offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,lengthOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get;
const resizableOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable').get,detachedOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached').get;
function memberCopy(value){
 if(types.isProxy(value)||!types.isUint8Array(value))fail('PAY_NATIVE_CONTEXT_MEMBER_INVALID');
 const backing=bufferOf.call(value),length=lengthOf.call(value),offset=offsetOf.call(value);
 if(!types.isArrayBuffer(backing)||resizableOf.call(backing)||detachedOf.call(backing)||length<1||length>98304)fail('PAY_NATIVE_CONTEXT_MEMBER_INVALID');
 return Buffer.from(new Uint8Array(backing,offset,length));
}
/** Main-private caller lease, NOT Native Source/Root authority. Only the one
 * bridge instance kept inside actual Main is exported to the fixed Native
 * getter. A separately constructed bridge cannot pass that instance's test.
 * Native owns its type_tag/unwrap/env/actor/inventory and genuine Source gate.
 * No setter, approved flag, key, signing or effect is accepted by capture(). */
export function createOriginalWalletPayContextBridge(getContext,{isOriginalNativeOwner=()=>false}={}){
 if(typeof getContext!=='function')fail('PAY_NATIVE_CONTEXT_PROVIDER_REQUIRED');
 const peers=new WeakMap(),held=new Set();
 function capture(...args){
  if(args.length)fail('PAY_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');
  const ctx=getContext();
  if(!ctx||ctx.captureOpen!==true||ctx.captureSelected)fail('PAY_NATIVE_CONTEXT_NOT_ACTIVE');
  if(held.size>=64)fail('PAY_NATIVE_CONTEXT_PENDING_LIMIT');
  ctx.captureSelected=true;
  const state={ctx,claimed:false,retired:false,closed:false,inFlight:0,waiters:[],packet:null,member:null,nativeOwner:null,nativeJoined:false,nativeRetireSelected:false};
  const current=()=>{
   if(state.retired||state.closed)fail('PAY_NATIVE_CONTEXT_RETIRED');
   if(ctx.assertCurrent()!==undefined)fail('PAY_NATIVE_CONTEXT_CURRENT_RESULT');
  };
  const retire=()=>retireState(state);
  const join=async()=>{let failed=false,cause;try{retire();}catch(e){failed=true;cause=e;}if(state.inFlight)await new Promise(resolve=>state.waiters.push(resolve));if(failed)throw cause;};
  const close=async()=>{if(state.closed)return;await join();finishClose(state);};
  const peer=Object.freeze(Object.assign(Object.create(null),{
   readOriginal(){current();if(!state.packet)fail('PAY_NATIVE_CONTEXT_PARTIAL');return state.packet;},
   claim(){current();if(state.claimed)fail('PAY_NATIVE_CONTEXT_ALREADY_CLAIMED');state.claimed=true;},
   assertCurrent:current,
   async recheck(){current();state.inFlight++;try{if(await ctx.recheck()!==undefined)fail('PAY_NATIVE_CONTEXT_RECHECK_RESULT');current();}finally{state.inFlight--;if(!state.inFlight)for(const resolve of state.waiters.splice(0))resolve();}},
   retire,join,close,
  }));
  peers.set(peer,state);held.add(state);
  try{
   ctx.onCaptured?.(peer);
   current();
   if(!Number.isSafeInteger(ctx.expiresAtMs)||ctx.expiresAtMs<=0)fail('PAY_NATIVE_CONTEXT_DEADLINE_NOT_SUPPLIED');state.expiresAtMs=ctx.expiresAtMs;
   if(ctx.request===null){if(ctx.permission!==null||ctx.capsule!==null||ctx.borrow!==null)fail('PAY_NATIVE_CONTEXT_QUERY_AUTHORITY');}
   else if(!ctx.permission||!ctx.capsule||!ctx.borrow)fail('PAY_NATIVE_CONTEXT_APPROVAL_REQUIRED');
   if(!Object.isFrozen(ctx.original)||!Object.isFrozen(ctx.target))fail('PAY_NATIVE_CONTEXT_ORIGINAL_REQUIRED');
   state.member=memberCopy(ctx.signedMember);
   state.packet=Object.freeze({purpose:ctx.request===null?'query':'broadcast',request:ctx.request,permission:ctx.permission,capsule:ctx.capsule,borrow:ctx.borrow,original:ctx.original,target:ctx.target,get signedMember(){current();return Buffer.from(state.member);}});
   current();return peer;
  }catch(cause){
   // Same nonnull peer owns any allocated public bytes/borrow refs even when
   // currentness or packet validation fails. Never return nil success.
   const error=Object.assign(new Error('Original Main Pay context capture failed.',{cause}),{code:'PAY_NATIVE_CONTEXT_CAPTURE_FAILED'});
   Object.defineProperty(error,'partial',{value:peer});throw error;
  }
 }
 function retireState(state){
  state.retired=true;
  if(state.nativeOwner&&!state.nativeRetireSelected){
   state.nativeRetireSelected=true;
   try{if(Reflect.apply(state.nativeRetire,state.nativeOwner,[])!==undefined)fail('PAY_NATIVE_RETIRE_RESULT');}
   catch(cause){state.retireFailurePresent=true;state.retireFailure=cause;throw cause;}
  }
 }
 function finishClose(state){
  if(state.nativeOwner&&!state.nativeJoined)fail('PAY_NATIVE_CONTEXT_NATIVE_JOIN_REQUIRED');
  state.closed=true;state.member?.fill(0);state.member=null;state.packet=null;state.nativeOwner=null;state.nativeRetire=null;held.delete(state);
 }
 function invalidate(predicate){let failed=false,cause;for(const state of [...held])if(predicate(state))try{retireState(state);}catch(e){if(!failed){failed=true;cause=e;}}if(failed)throw cause;}
 return Object.freeze({capture,isPeer:peer=>peers.has(peer),
  associate(peer,owner){
   const s=peers.get(peer);if(!s||s.ctx!==getContext()||!s.ctx.captureOpen)fail('PAY_NATIVE_ASSOCIATION_SCOPE');
   if(isOriginalNativeOwner(owner)!==true)fail('PAY_NATIVE_ASSOCIATION_OWNER');
   const d=Object.getOwnPropertyDescriptor(owner,'retire');if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value)||d.writable!==false||d.configurable!==false)fail('PAY_NATIVE_ASSOCIATION_RETIRE_METHOD');
   if(s.nativeOwner&&s.nativeOwner!==owner)fail('PAY_NATIVE_ASSOCIATION_CONFLICT');
   if(!s.nativeOwner){s.nativeOwner=owner;s.nativeRetire=d.value;}
   if(s.retired||s.closed){retireState(s);fail('PAY_NATIVE_CONTEXT_RETIRED');}
   try{if(s.ctx.assertCurrent()!==undefined)fail('PAY_NATIVE_CONTEXT_CURRENT_RESULT');}catch(cause){try{retireState(s);}catch{}throw cause;}
  },
  copyDeadline(peer){const s=peers.get(peer);if(!s||s.retired||s.closed)fail('PAY_NATIVE_CONTEXT_RETIRED');if(s.ctx.assertCurrent()!==undefined)fail('PAY_NATIVE_CONTEXT_CURRENT_RESULT');if(!Number.isSafeInteger(s.expiresAtMs))fail('PAY_NATIVE_CONTEXT_DEADLINE_NOT_SUPPLIED');return Object.freeze({expiresAtMs:s.expiresAtMs});},
  invalidateAll(){invalidate(()=>true);},invalidateReview(id){invalidate(s=>s.ctx.reviewId===id);},
  observedNativeJoin(owner){for(const s of held)if(s.nativeOwner===owner)s.nativeJoined=true;},
  async closeContext(ctx){let failed=false,cause;for(const s of [...held])if(s.ctx===ctx){try{retireState(s);}catch(e){if(!failed){failed=true;cause=e;}}if(s.inFlight)await new Promise(resolve=>s.waiters.push(resolve));try{finishClose(s);}catch(e){if(!failed){failed=true;cause=e;}}}if(failed)throw cause;},
  assertSafeToClose(){if(held.size)fail('PAY_NATIVE_CONTEXT_CLOSE_UNCONFIRMED');}});
}
