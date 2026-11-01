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
export function createOriginalWalletPayContextBridge(getContext){
 if(typeof getContext!=='function')fail('PAY_NATIVE_CONTEXT_PROVIDER_REQUIRED');
 const peers=new WeakMap(),held=new Set();
 function capture(...args){
  if(args.length)fail('PAY_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED');
  const ctx=getContext();
  if(!ctx||ctx.captureOpen!==true||ctx.captureSelected)fail('PAY_NATIVE_CONTEXT_NOT_ACTIVE');
  if(held.size>=64)fail('PAY_NATIVE_CONTEXT_PENDING_LIMIT');
  ctx.captureSelected=true;
  const state={ctx,claimed:false,retired:false,closed:false,inFlight:0,waiters:[],packet:null,member:null};
  const current=()=>{
   if(state.retired||state.closed)fail('PAY_NATIVE_CONTEXT_RETIRED');
   if(ctx.assertCurrent()!==undefined)fail('PAY_NATIVE_CONTEXT_CURRENT_RESULT');
  };
  const retire=()=>{state.retired=true;};
  const join=async()=>{retire();if(state.inFlight)await new Promise(resolve=>state.waiters.push(resolve));};
  const close=async()=>{if(state.closed)return;await join();state.closed=true;state.member?.fill(0);state.member=null;state.packet=null;held.delete(state);};
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
 return Object.freeze({capture,isPeer:peer=>peers.has(peer),async closeContext(ctx){for(const state of [...held])if(state.ctx===ctx){state.retired=true;if(state.inFlight)await new Promise(resolve=>state.waiters.push(resolve));state.closed=true;state.member?.fill(0);state.member=null;state.packet=null;held.delete(state);}},assertSafeToClose(){if(held.size)fail('PAY_NATIVE_CONTEXT_CLOSE_UNCONFIRMED');}});
}
