// Request/custody half of the IDE Cloud GET bridge. This does not generate an
// HTTP proof or confer Source qualification. The accepted GET proof wire and
// Native Source producer are separate owning CODE, currently NOT_SUPPLIED.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';

const objectKeys=['method','path','url','operationRequestId'];
const fail=code=>{throw Object.assign(Error(code),{code})};
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const abortReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
function exact(v,keys){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('IDE_CLOUD_GET_EXACT_DATA');
 const d=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('IDE_CLOUD_GET_EXACT_DATA');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function snapshot(v){
 const r=exact(v,objectKeys);
 if(r.method!=='GET'||typeof r.operationRequestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(r.operationRequestId))fail('IDE_CLOUD_GET_REQUEST');
 if(typeof r.path!=='string'||r.path.length>512||typeof r.url!=='string'||r.url.length>2048||/[^\x21-\x7e]/.test(r.path+r.url))fail('IDE_CLOUD_GET_REQUEST');
 // Current actual seven routes have no query. Never silently strip one.
 if(r.path.includes('?')||r.url.includes('?'))fail('IDE_CLOUD_GET_QUERY_NOT_REGISTERED');
 let u;try{u=new URL(r.url)}catch{fail('IDE_CLOUD_GET_TARGET')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.toString()!==r.url||u.pathname!==r.path)fail('IDE_CLOUD_GET_TARGET');
 const prefix='/api/v1/ide/deployments/'+r.operationRequestId;
 if(!r.path.startsWith(prefix)||!['','/logs','/runtime','/usage','/usage/records'].includes(r.path.slice(prefix.length))&&!/^\/billing\/\d{4}-\d{2}-\d{2}(?:\/native-intent)?$/.test(r.path.slice(prefix.length)))fail('IDE_CLOUD_GET_ROUTE');
 const day=/\/billing\/(\d{4}-\d{2}-\d{2})/.exec(r.path)?.[1];
 if(day){const ms=Date.parse(day+'T00:00:00.000Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==day)fail('IDE_CLOUD_GET_PERIOD')}
 return Object.freeze(r);
}
export function inspectOriginalIDECloudGETRequestDATA(input,expected){
 if(arguments.length!==2)fail('IDE_CLOUD_GET_ARGUMENTS');
 const r=snapshot(input),e=exact(expected,['serviceOrigin','operationRequestId']);let origin;
 try{const u=new URL(e.serviceOrigin);if(u.origin!==e.serviceOrigin||u.protocol!=='https:')fail('IDE_CLOUD_GET_EXPECTED');origin=u.origin}catch{fail('IDE_CLOUD_GET_EXPECTED')}
 if(new URL(r.url).origin!==origin||r.operationRequestId!==e.operationRequestId)fail('IDE_CLOUD_GET_SELECTION_CHANGED');
 return Object.freeze({request:r,dataOnly:true,SourceAdmission:false,NativeAdmission:false});
}
function refs(v,names){
 if(!v||!['object','function'].includes(typeof v)||types.isProxy(v))fail('IDE_CLOUD_GET_NATIVE_ABI');
 const r={};for(const n of names){const d=Object.getOwnPropertyDescriptor(v,n);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('IDE_CLOUD_GET_NATIVE_ABI');r[n]=d.value}
 return Object.freeze(r);
}
function partial(e){if(!e||!['object','function'].includes(typeof e)||types.isProxy(e))return null;const d=Object.getOwnPropertyDescriptor(e,'partial');return d&&Object.hasOwn(d,'value')?d.value:null}
const sourceNames=['assertCurrent','recheck','captureOriginalGETRequest','retire','join','close'];
const childNames=['assertCurrent','recheck','readOriginalRequestDATA','retire','join','close'];
function loan(owner,names){return {owner,refs:refs(owner,names),retired:false,closed:false,joining:false}}
function context(v){const c=exact(v,['signal']);if(!Object.isFrozen(v)||types.isProxy(c.signal))fail('IDE_CLOUD_GET_CONTEXT');try{aborted.call(c.signal)}catch{fail('IDE_CLOUD_GET_CONTEXT')}return v}
const same=(a,b)=>objectKeys.every(k=>a[k]===b[k]);

// Draft Native ABI, intentionally not exported in package.json until its owner
// freezes the corresponding Source and server proof wire. No injected provider,
// loader, endpoint, fake parent brand or V4/legacy proof fallback is accepted.
export function acquireOriginalIDECloudGETRequestController(originalSelection){
 if(arguments.length!==1||!originalSelection||!['object','function'].includes(typeof originalSelection)||types.isProxy(originalSelection))fail('IDE_CLOUD_GET_ORIGINAL_SELECTION');
 const native=loadOriginalAuthIdentityNativeImage();
 if(!native||types.isProxy(native))fail('IDE_CLOUD_GET_NATIVE_SOURCE_NOT_SUPPLIED');
 const getDescriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalIDECloudGETSource');
 if(!getDescriptor||!Object.hasOwn(getDescriptor,'value')||typeof getDescriptor.value!=='function')fail('IDE_CLOUD_GET_NATIVE_SOURCE_NOT_SUPPLIED');
 const get=getDescriptor.value;
 let owner;try{owner=Reflect.apply(get,native,[originalSelection])}catch(e){throw e}
 if(owner===null||owner===undefined)fail('IDE_CLOUD_GET_NATIVE_SOURCE_NOT_SUPPLIED');
 let source;try{source=loan(owner,sourceNames)}catch(cause){throw Object.assign(Error('IDE_CLOUD_GET_SOURCE_PARTIAL'),{code:'IDE_CLOUD_GET_SOURCE_PARTIAL',cause,partial:owner})}
 const tickets=new WeakMap(),all=[],flights=new Set();let retired=false,active=0,draining=false,firstPresent=false,first,closing=null;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e}};
 const invoke=(l,name,...args)=>{active++;try{return Reflect.apply(l.refs[name],l.owner,args)}finally{active--}};
 const zero=(l,name,...args)=>{if(invoke(l,name,...args)!==undefined)fail('IDE_CLOUD_GET_NATIVE_RESULT')};
 function stopLoan(l){if(!l||l.closed||l.retired)return;l.retired=true;zero(l,'retire')}
 function stop(){retired=true;let bad=false,cause;for(const r of all){try{stopLoan(r.loan)}catch(e){if(!bad){bad=true;cause=e;remember(e)}}}try{stopLoan(source)}catch(e){if(!bad){bad=true;cause=e;remember(e)}}if(bad)throw cause}
 function current(r){if(r&&aborted.call(r.context.signal))throw abortReason.call(r.context.signal);if(retired||firstPresent)fail('IDE_CLOUD_GET_RETIRED');zero(source,'assertCurrent');if(retired)fail('IDE_CLOUD_GET_RETIRED');if(r){zero(r.loan,'assertCurrent');if(aborted.call(r.context.signal))throw abortReason.call(r.context.signal);if(retired)fail('IDE_CLOUD_GET_RETIRED')}}
 function known(ticket){const r=tickets.get(ticket);if(!r)fail('IDE_CLOUD_GET_ORIGINAL_REQUEST_REQUIRED');return r}
 async function drain(l){if(l.closed)return;if(l.joining)fail('IDE_CLOUD_GET_DRAIN_BUSY');l.joining=true;try{stopLoan(l);if(await invoke(l,'join')!==undefined)fail('IDE_CLOUD_GET_JOIN_PENDING');if(await invoke(l,'close')!==undefined)fail('IDE_CLOUD_GET_CLOSE_PENDING');l.closed=true}finally{l.joining=false}}
 async function cleanup(){
  if(!retired)fail('IDE_CLOUD_GET_RETIRE_BEFORE_JOIN');if(active||draining)fail('IDE_CLOUD_GET_DRAIN_BUSY');draining=true;
  try{await Promise.allSettled([...flights]);let failed=false,cause;for(const r of all){if(!r.loan)continue;try{await drain(r.loan)}catch(e){if(!failed){failed=true;cause=e;remember(e)}}}
   // Never release the Source while a child loan is still owed.
   if(all.some(r=>r.uncapturedOwner!==null)){if(!failed){failed=true;cause=Object.assign(Error('IDE_CLOUD_GET_UNCLASSIFIED_PARTIAL'),{code:'IDE_CLOUD_GET_UNCLASSIFIED_PARTIAL'});remember(cause)}}
   if(!all.some(r=>r.uncapturedOwner!==null||r.loan&&!r.loan.closed))try{await drain(source)}catch(e){if(!failed){failed=true;cause=e;remember(e)}}
   if(source.closed)for(const r of all)remove.call(r.context.signal,'abort',r.onAbort);
   if(failed)throw cause;
  }finally{draining=false}
 }
 function prepare(input,ctx){
  const request=snapshot(input),c=context(ctx);if(retired||firstPresent)fail('IDE_CLOUD_GET_RETIRED');if(aborted.call(c.signal))throw abortReason.call(c.signal);
  if(all.some(r=>same(r.request,request)))fail('IDE_CLOUD_GET_QUERY_ORIGINAL_ONLY');
  const r={request,context:c,loan:null,unknown:false,causePresent:false,cause:undefined,uncapturedOwner:null};all.push(r);
  const ticket=Object.freeze({});tickets.set(ticket,r);
  const onAbort=()=>{remember(abortReason.call(c.signal));try{stop()}catch(e){remember(e)}};r.onAbort=onAbort;add.call(c.signal,'abort',onAbort,{once:true});
  try{
   current();let child;
   try{child=invoke(source,'captureOriginalGETRequest',request,c)}catch(e){child=partial(e);if(child!==null&&child!==undefined){r.uncapturedOwner=child;try{r.loan=loan(child,childNames);r.uncapturedOwner=null}catch{}}throw e}
   // Adopt before ABI inspection, current checks or observing a late abort.
   r.uncapturedOwner=child??null;r.loan=loan(child,childNames);r.uncapturedOwner=null;
   const actual=snapshot(invoke(r.loan,'readOriginalRequestDATA'));if(!same(actual,request))fail('IDE_CLOUD_GET_REQUEST_CHANGED');current(r);return ticket;
  }catch(cause){r.unknown=true;r.causePresent=true;r.cause=cause;remember(cause);try{stop()}catch{}throw Object.assign(Error('IDE_CLOUD_GET_REQUEST_PARTIAL'),{code:'IDE_CLOUD_GET_REQUEST_PARTIAL',cause,partial:ticket})}
 }
 function read(ticket){const r=known(ticket);return Object.freeze({request:r.request,unknown:r.unknown,causePresent:r.causePresent,cause:r.cause,unclassifiedPartial:r.uncapturedOwner,dataOnly:true,SourceAdmission:false,NativeAdmission:false})}
 async function recheck(ticket){const r=known(ticket);current(r);if(await invoke(source,'recheck')!==undefined)fail('IDE_CLOUD_GET_NATIVE_RESULT');current(r);if(await invoke(r.loan,'recheck')!==undefined)fail('IDE_CLOUD_GET_NATIVE_RESULT');current(r);const a=snapshot(invoke(r.loan,'readOriginalRequestDATA'));if(!same(a,r.request))fail('IDE_CLOUD_GET_REQUEST_CHANGED');return read(ticket)}
 function track(ticket){const f=recheck(ticket);flights.add(f);f.then(()=>flights.delete(f),cause=>{flights.delete(f);const r=known(ticket);r.unknown=true;r.causePresent=true;r.cause=cause;remember(cause);try{stop()}catch{}});return f}
 function headers(){fail('IDE_CLOUD_GET_PROOF_WIRE_NOT_SUPPLIED')}
 return Object.freeze({prepareOriginalGETRequest:prepare,readOriginalRequestDATA:read,recheckOriginalGETRequest:track,
  // No guessed V2/V4/V5 headers, crypto/domain change, HTTP request or replay.
  getDeploymentRequestHeaders:headers,retire:stop,join:cleanup,
  close(){try{stop()}catch(e){remember(e)}if(!closing)closing=cleanup().finally(()=>{closing=null});return closing},drainOriginal:cleanup,
  status(){return Object.freeze({retired,sourceClosed:source.closed,cleanupDebt:!source.closed||all.some(r=>r.uncapturedOwner!==null||r.loan&&!r.loan.closed),unclassifiedPartial:all.some(r=>r.uncapturedOwner!==null),firstCausePresent:firstPresent,firstCause:first,proofWire:'NOT_SUPPLIED',dataOnly:true,SourceAdmission:false,NativeAdmission:false})}
 });
}
