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
  attempts.set(ref,{source,check,selected,now,floor:-1,assertCustodyCurrent,entered:false,child:null,retired:false,first:null,firstPresent:false,cleanup:null,cleanupFailure:null,cleanupFailurePresent:false,closed:false,waiting:new Set(),stream:null,channel:null,closing:null,retirement:new Set(),host:null,prelude:null,senderSelected:false,senderDescriptor:null,descriptorClose:null,descriptorCloseEntered:false});
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
  if(s.host&&s.host.assertCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
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
    const configuration=s.source.originalConfiguration;
    if(typeof configuration?.reserveParentHost!=='function')throw failure('ADMISSION_NATIVE_PARENT_NOT_SUPPLIED');
    s.host=configuration.reserveParentHost(); // Capture partial custody BEFORE a current check.
    if(!s.host||['assertCurrent','readPending','beginPrelude','takeSenderDescriptor','readInstalledFrame','acknowledge','retire','join','close','outcome'].some(key=>typeof s.host[key]!=='function'))throw failure('ADMISSION_NATIVE_PARENT_NOT_SUPPLIED');
    assertOriginalAdmissionParentCurrent(ref);
    const pending=s.host.readPending();
    if(pending?.pending!==true||!Number.isSafeInteger(pending.descriptor)||pending.descriptor<0||pending.currentReference!==s.selected.currentReference||pending.requestNonce!==s.source.raw.expectedRequest.requestNonce)throw failure('ADMISSION_NATIVE_PARENT_BINDING_CHANGED');
    assertOriginalAdmissionParentCurrent(ref);
    // Native must enter its worker now. Awaiting here before spawn deadlocks
    // the prelude waiting for that very child. Borrowed fd is file-action only.
    const prelude=s.host.beginPrelude();
    if(!prelude||typeof prelude.then!=='function')throw failure('ADMISSION_NATIVE_PRELUDE_PROMISE_REQUIRED');
    s.prelude=trackOriginalAdmissionParentCall(ref,prelude);
    assertOriginalAdmissionParentCurrent(ref);
    const child=spawn(s.selected.executable,s.selected.args,{stdio:['ignore','inherit','inherit','ignore',pending.descriptor],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'},shell:false,detached:false});
    s.child=child; // Capture late/partial child before any property/current call.
    return child;
  }catch(error){first(s,error);retireOriginalAdmissionParentSource(ref,error);throw error;}
}
export async function waitOriginalAdmissionParentPrelude(ref){
  const s=state(ref);if(!s.prelude)throw failure('ADMISSION_NATIVE_PRELUDE_NOT_ENTERED');
  if(await s.prelude!==undefined)throw failure('ADMISSION_NATIVE_PRELUDE_INCOMPLETE');
  assertOriginalAdmissionParentCurrent(ref);return undefined;
}
export function takeOriginalAdmissionParentStream(ref,createStream,closeDescriptor){
  const s=state(ref);assertOriginalAdmissionParentCurrent(ref);
  if(s.senderSelected||typeof createStream!=='function'||typeof closeDescriptor!=='function')throw failure('ADMISSION_NATIVE_SENDER_UNAVAILABLE');
  s.senderSelected=true;s.descriptorClose=closeDescriptor;
  s.senderDescriptor=s.host.takeSenderDescriptor(); // Transferred ownership: capture BEFORE fencing.
  if(!Number.isSafeInteger(s.senderDescriptor)||s.senderDescriptor<0)throw failure('ADMISSION_NATIVE_SENDER_INVALID');
  try{
    s.stream=createStream(s.senderDescriptor);
    if(!s.stream||typeof s.stream.destroy!=='function')throw failure('ADMISSION_NATIVE_SENDER_INVALID');
    s.senderDescriptor=null; // The captured stream now owns only this duplicate.
    if(typeof s.stream.once!=='function'||typeof s.stream.on!=='function')throw failure('ADMISSION_NATIVE_SENDER_INVALID');
    if(!s.stream.closed){
      const closed=new Promise(resolve=>s.stream.once('close',resolve));
      trackOriginalAdmissionParentCall(ref,closed);
    }
    s.stream.on('error',error=>{first(s,error);retireOriginalAdmissionParentSource(ref,error);});
    assertOriginalAdmissionParentCurrent(ref);return s.stream;
  }catch(error){first(s,error);retireOriginalAdmissionParentSource(ref,error);throw error;}
}
export function readOriginalAdmissionParentInstalledFrame(ref){const s=state(ref);assertOriginalAdmissionParentCurrent(ref);return s.host.readInstalledFrame();}
export function acknowledgeOriginalAdmissionParentFrame(ref,raw){const s=state(ref);assertOriginalAdmissionParentCurrent(ref);const result=s.host.acknowledge(raw);if(result!==undefined)throw failure('ADMISSION_NATIVE_ACK_INCOMPLETE');assertOriginalAdmissionParentCurrent(ref);s.installedAcknowledged=true;return undefined;}
export async function handleOriginalAdmissionParentPayload(ref,raw){
  const s=state(ref);assertOriginalAdmissionParentCurrent(ref);
  if(s.installedAcknowledged!==true)throw failure('ADMISSION_PRIVATE_INSTALLED_ACK_REQUIRED');
  if(typeof s.host?.handlePrivateServicePayload!=='function')throw failure('ADMISSION_PRIVATE_HANDLER_NOT_SUPPLIED');
  // Register custody BEFORE supplier invocation, including synchronous failure
  // or retirement reentry. Its full task is joined before the parent closes.
  const work=Promise.resolve().then(async()=>{assertOriginalAdmissionParentCurrent(ref);const result=await s.host.handlePrivateServicePayload(raw);assertOriginalAdmissionParentCurrent(ref);return result;});
  return await trackOriginalAdmissionParentCall(ref,work);
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
export function retireOriginalAdmissionParentSource(ref,...causes){
  const error=causes.length?causes[0]:failure('ADMISSION_PARENT_RETIRED');
  const s=state(ref);first(s,error);s.retired=true;
  if(s.host&&!s.nativeRetireEntered){s.nativeRetireEntered=true;try{if(s.host.retire()!==undefined)throw failure('ADMISSION_NATIVE_RETIRE_INCOMPLETE');}catch(e){if(!s.cleanupFailurePresent){s.cleanupFailure=e;s.cleanupFailurePresent=true;}}}
  // Revoking the capability stream does not kill a standalone IDE or its data.
  if(s.stream&&!s.cleanup){
    s.cleanup={entered:true};
    try{if(s.channel)s.channel.close(error);}catch(e){if(!s.cleanupFailurePresent){s.cleanupFailure=e;s.cleanupFailurePresent=true;}}
    // Closing the protocol may throw; the independently owned duplicate still
    // needs its physical close. Never destroy the borrowed child file-action fd.
    try{if(!s.stream.destroyed)s.stream.destroy();}catch(e){if(!s.cleanupFailurePresent){s.cleanupFailure=e;s.cleanupFailurePresent=true;}}
  }
  if(s.senderDescriptor!==null&&!s.descriptorCloseEntered&&s.descriptorClose){s.descriptorCloseEntered=true;try{s.descriptorClose(s.senderDescriptor);s.senderDescriptor=null;}catch(e){if(!s.cleanupFailurePresent){s.cleanupFailure=e;s.cleanupFailurePresent=true;}}}
  for(const callback of [...s.retirement])callback(s.first);
  return undefined;
}
export async function joinOriginalAdmissionParentSource(ref){
  const s=state(ref);while(s.waiting.size)await Promise.allSettled([...s.waiting]);
  if(s.host){s.nativeJoining??=Promise.resolve().then(()=>s.host.join());if(await s.nativeJoining!==undefined)throw failure('ADMISSION_NATIVE_JOIN_INCOMPLETE');}
  return undefined;
}
export function closeOriginalAdmissionParentSource(ref){
  const s=state(ref);if(s.closing)return s.closing;
  // Reserve the exact pass before channel.close or retirement observers can
  // synchronously reenter. Retirement still happens before this call returns.
  let resolve,reject;s.closing=new Promise((yes,no)=>{resolve=yes;reject=no;});
  void s.closing.catch(()=>{});
  try{retireOriginalAdmissionParentSource(ref);}catch(error){if(!s.cleanupFailurePresent){s.cleanupFailure=error;s.cleanupFailurePresent=true;}}
  void (async()=>{
    const cleanup=async operation=>{try{if(await operation()!==undefined)throw failure('ADMISSION_NATIVE_CLEANUP_INCOMPLETE');}catch(error){if(!s.cleanupFailurePresent){s.cleanupFailure=error;s.cleanupFailurePresent=true;}}};
    await cleanup(()=>joinOriginalAdmissionParentSource(ref));
    if(s.host)await cleanup(()=>s.host.close());
    if(s.cleanupFailurePresent)throw s.cleanupFailure;s.closed=true;return undefined;
  })().then(resolve,reject);
  return s.closing;
}
export function selectOriginalAdmissionParentOutcome(ref,observe){
  const s=state(ref);if(typeof observe!=='function')throw failure('ADMISSION_PARENT_OBSERVER_INVALID');
  return observe(Object.freeze({child:s.child,source:s.source,launchEntered:s.entered,retired:s.retired,closed:s.closed,firstCause:s.first,firstCausePresent:s.firstPresent,cleanupCause:s.cleanupFailure,cleanupFailurePresent:s.cleanupFailurePresent}));
}
