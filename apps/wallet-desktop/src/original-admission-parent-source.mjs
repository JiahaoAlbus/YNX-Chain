// Private original-main launch custody, not an OS or service grant. Its source
// binding is installed only after Auth's fixed getter returns a real selection.
// The original source checks must authenticate registration and kernel child
// identity themselves; this module never infers approval from path/PID/fd4.
const sources=new WeakMap(),attempts=new WeakMap(),launchedSources=new WeakSet();
const failure=code=>Object.assign(new Error(code),{code});
export function bindOriginalAdmissionParentSelection(check,selection){
  if(typeof check!=='function'||sources.has(check)||!selection?.vault||!selection.raw||!selection.executor||typeof selection.assertCurrent!=='function')throw failure('ADMISSION_PARENT_SOURCE_INVALID');
  sources.set(check,Object.freeze({...selection}));
}
export function acquireOriginalAdmissionParentSource(check,selected,canonical,now,assertCustodyCurrent){
  const source=sources.get(check);
  if(!source)throw failure('ADMISSION_PARENT_QUALIFICATION_NOT_SUPPLIED');
  if(launchedSources.has(source))throw failure('ADMISSION_PARENT_LAUNCH_ALREADY_ENTERED');
  if(canonical(selected)!==canonical(source.executor)||selected.expiresAtMs>source.raw.expiresAtMs)throw failure('ADMISSION_PARENT_BINDING_CHANGED');
  const request=source.raw.expectedRequest;
  if(['applicationId','consumerManifestDigest','instanceId','currentReference'].some(k=>selected[k]!==request[k]))throw failure('ADMISSION_PARENT_BINDING_CHANGED');
  const ref=Object.freeze({});
  if(typeof assertCustodyCurrent!=='function')throw failure('ADMISSION_PARENT_CUSTODY_NOT_SUPPLIED');
  attempts.set(ref,{source,check,selected,now,floor:-1,assertCustodyCurrent,entered:false,child:null,retired:false,first:null,firstPresent:false,cleanup:null,cleanupFailure:null,cleanupFailurePresent:false,closed:false,waiting:new Set(),stream:null,channel:null,closing:null,retirement:new Set()});
  assertOriginalAdmissionParentCurrent(ref);return ref;
}
const state=ref=>{const value=attempts.get(ref);if(!value)throw failure('ADMISSION_PARENT_OWNER_REQUIRED');return value;};
function first(s,error){if(!s.firstPresent){s.first=error;s.firstPresent=true;}}
export function assertOriginalAdmissionParentCurrent(ref){
  const s=state(ref);
  const at=s.now();
  if(s.retired||s.closed||!Number.isSafeInteger(at)||at<s.floor||at>=s.selected.expiresAtMs)throw failure('ADMISSION_PARENT_RETIRED');
  s.floor=at;
  if(s.assertCustodyCurrent()!==undefined||s.source.assertCurrent()!==undefined||s.check(s.selected,s.child)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
  // The custody closure ends with the original local generation/guard fence.
  // A supplier callback may synchronously cancel or consume the deadline.
  if(s.assertCustodyCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
  assertLocalCurrent(s);
  return undefined;
}
function assertLocalCurrent(s){
  const at=s.now();
  if(s.retired||s.closed||!Number.isSafeInteger(at)||at<s.floor||at>=s.selected.expiresAtMs)throw failure('ADMISSION_PARENT_RETIRED');
  s.floor=at;
}
export function enterOriginalAdmissionParentLaunch(ref,spawn){
  const s=state(ref);assertOriginalAdmissionParentCurrent(ref);
  assertLocalCurrent(s);
  if(s.entered||launchedSources.has(s.source))throw failure('ADMISSION_PARENT_LAUNCH_ALREADY_ENTERED');
  s.entered=true; // Reserve BEFORE actual foreign spawn; never retry this ref.
  launchedSources.add(s.source);
  try{
    const child=spawn(s.selected.executable,s.selected.args,{stdio:['ignore','inherit','inherit','ignore','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'},shell:false,detached:false});
    s.child=child; // Capture late/partial child before any property/current call.
    try{s.stream=child.stdio?.[4]??null;}catch(error){s.cleanupFailure=error;s.cleanupFailurePresent=true;throw error;}
    return child;
  }catch(error){first(s,error);retireOriginalAdmissionParentSource(ref,error);throw error;}
}
export function trackOriginalAdmissionParentCall(ref,promise){
  const s=state(ref);s.waiting.add(promise);
  void promise.then(()=>s.waiting.delete(promise),error=>{first(s,error);s.waiting.delete(promise);});return promise;
}
export function attachOriginalAdmissionParentChannel(ref,channel){
  const s=state(ref);assertOriginalAdmissionParentCurrent(ref);
  if(s.channel||typeof channel?.close!=='function')throw failure('ADMISSION_PARENT_CHANNEL_INVALID');
  s.channel=channel;return undefined;
}
export function onOriginalAdmissionParentRetirement(ref,callback){
  const s=state(ref);s.retirement.add(callback);if(s.retired)callback(s.first);
  return ()=>s.retirement.delete(callback);
}
export function retireOriginalAdmissionParentSource(ref,error=failure('ADMISSION_PARENT_RETIRED')){
  const s=state(ref);first(s,error);s.retired=true;
  // Revoking the capability stream does not kill a standalone IDE or its data.
  if(s.stream&&!s.cleanup){s.cleanup={entered:true};try{if(s.channel)s.channel.close(error);else s.stream.destroy();}catch(e){s.cleanupFailure=e;s.cleanupFailurePresent=true;}}
  for(const callback of [...s.retirement])callback(s.first);
  return undefined;
}
export async function joinOriginalAdmissionParentSource(ref){
  const s=state(ref);while(s.waiting.size)await Promise.allSettled([...s.waiting]);return undefined;
}
export function closeOriginalAdmissionParentSource(ref){
  const s=state(ref);if(s.closing)return s.closing;
  retireOriginalAdmissionParentSource(ref);
  s.closing=(async()=>{await joinOriginalAdmissionParentSource(ref);if(s.cleanupFailurePresent)throw s.cleanupFailure;s.closed=true;return undefined;})();
  void s.closing.catch(()=>{});return s.closing;
}
export function selectOriginalAdmissionParentOutcome(ref,observe){
  const s=state(ref);if(typeof observe!=='function')throw failure('ADMISSION_PARENT_OBSERVER_INVALID');
  return observe(Object.freeze({child:s.child,source:s.source,launchEntered:s.entered,retired:s.retired,closed:s.closed,firstCause:s.first,firstCausePresent:s.firstPresent,cleanupCause:s.cleanupFailure,cleanupFailurePresent:s.cleanupFailurePresent}));
}
