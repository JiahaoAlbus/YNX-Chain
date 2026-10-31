// Normal daemon custody only. A startup result is never a Source/Root grant.
import{types}from'node:util';
import{acquireOriginalProductSessionDeviceV4ServerCurrent,assertOriginalProductSessionDeviceV4ServerCurrentResult}from'../src/product-pair-session-v4-source.js';
import{OriginalReadOnlyChildDebtV4}from'../src/original-readonly-child-debt-v4.js';
const states=new WeakMap(),fail=code=>{throw Object.assign(Error(code),{code})};
const own=(v,key)=>{if(!v||(typeof v!=='object'&&typeof v!=='function')||types.isProxy(v))return;const d=Object.getOwnPropertyDescriptor(v,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const state=r=>{const s=states.get(r);if(!s)fail('DEVICE_V4_SERVER_CURRENT_STARTUP_REQUIRED');return s;};
export async function openOriginalDeviceV4ServerCurrentBeforeHost(){
 if(arguments.length)fail('DEVICE_V4_SERVER_CURRENT_STARTUP_ZERO_INPUT');
 const reference=Object.freeze({}),s={owner:null,debt:null,provider:null,configured:false,failurePresent:false,failure:undefined,closeSelected:false,closePromise:null,drainPromise:null,closed:false};states.set(reference,s);
 const adopt=owner=>{if(owner!==null&&owner!==undefined){s.owner=owner;s.debt=new OriginalReadOnlyChildDebtV4(owner);}};
 try{const outcome=await acquireOriginalProductSessionDeviceV4ServerCurrent();adopt(own(outcome,'owner'));const owner=assertOriginalProductSessionDeviceV4ServerCurrentResult(outcome);if(owner!==s.owner)fail('DEVICE_V4_SERVER_CURRENT_OWNER_SUBSTITUTED');s.provider=owner.deviceCurrent;s.configured=true;}
 catch(cause){if(s.owner===null)adopt(own(cause,'partial'));s.failurePresent=true;s.failure=cause;}
 return reference;
}
export function originalDeviceV4ServerCurrentHostOptions(reference){const s=state(reference);return Object.freeze(s.configured&&!s.closeSelected?{deviceCurrent:s.provider}:{});}
export function originalDeviceV4ServerCurrentStartupStatus(reference){const s=state(reference),d=s.debt?.status();return Object.freeze({configured:s.configured,failurePresent:s.failurePresent,failure:s.failure,closeSelected:s.closeSelected,closed:s.closed,cleanupFailurePresent:d?.firstCausePresent??false,cleanupFailure:d?.firstCause,unknown:(s.failurePresent&&s.owner!==null)||!!d?.firstCausePresent});}
export function closeOriginalDeviceV4ServerCurrentAfterHost(reference){const s=state(reference);if(s.closeSelected)return s.closePromise;s.closeSelected=true;s.closePromise=(async()=>{try{await s.debt?.drain();}finally{s.closed=s.debt?s.debt.closed:true;}if(s.debt?.firstCausePresent)throw s.debt.firstCause;})();return s.closePromise;}
// Only explicit drain of the SAME original owner, after close entry. The
// original close promise/result remains unchanged even after debt settles.
export function drainOriginalDeviceV4ServerCurrentPartial(reference){const s=state(reference);if(!s.closeSelected)fail('DEVICE_V4_SERVER_CURRENT_CLOSE_NOT_ENTERED');if(s.drainPromise)return s.drainPromise;const work=(async()=>{try{await s.debt?.drain();}finally{s.closed=s.debt?s.debt.closed:true;}})();s.drainPromise=work;work.then(()=>{s.drainPromise=null},()=>{s.drainPromise=null});return work;}
