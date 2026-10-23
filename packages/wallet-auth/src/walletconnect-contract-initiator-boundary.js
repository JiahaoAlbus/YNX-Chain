// Private adapter for the exact locked 2.23.10 instance created by our factory.
// These per-instance method boundaries are not an official Core injection API.
// No global methods, payloads, signing semantics or foreign Core are changed.
const installed=new WeakMap();
const forbidden=new Set(['wc_sessionPropose','wc_sessionRequest','wc_sessionAuthenticate']);
const error=code=>Object.assign(new Error(code),{code});
const shape=()=>{throw error('YNX_CONTRACT_INITIATOR_BOUNDARY_SHAPE_INVALID');};
function ownMethod(object,name){const d=Object.getOwnPropertyDescriptor(object,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||!d.writable||!d.configurable)shape();return d.value.bind(object);}
function method(object,name){let p=object;while(p){const d=Object.getOwnPropertyDescriptor(p,name);if(d){if(!Object.hasOwn(d,'value')||typeof d.value!=='function')shape();return d.value.bind(object);}p=Object.getPrototypeOf(p);}shape();}
function replace(object,name,value){Object.defineProperty(object,name,{value,writable:false,configurable:false,enumerable:true});}
function requestMethod(payload){
 if(!payload||typeof payload!=='object')return null;
 const d=Object.getOwnPropertyDescriptors(payload);
 // Match the original JSON-RPC request distinction. Responses are unchanged.
 if(d.jsonrpc?.value!=='2.0'||!Object.hasOwn(d,'method')||!Object.hasOwn(d.method,'value'))return null;
 return d.method.value;
}
export function installContractInitiatorBoundary(core,{lockedVersion,current,ownsCore,onTerminal,cancelGuard,drainDeadlineMs=1500}={}){
 if(lockedVersion!=='2.23.10'||!core||installed.has(core)||![current,ownsCore,onTerminal,cancelGuard].every(v=>typeof v==='function')||!Number.isSafeInteger(drainDeadlineMs)||drainDeadlineMs<1||drainDeadlineMs>1500)shape();
 if(ownsCore()!==true)throw error('YNX_CONTRACT_INITIATOR_CORE_NOT_OWNED');
 const crypto=core.crypto,verify=core.verify,relayer=core.relayer;
 if(!crypto||!verify||!relayer)shape();
 const decode=ownMethod(crypto,'decode'),resolve=ownMethod(verify,'resolve');
 void resolve; // Intentionally never called, even if an engine catches refusal.
 const open=method(relayer,'transportOpen'),restart=method(relayer,'restartTransport'),close=method(relayer,'transportClose');
 let terminal=false,first=null,cancelFlight=null,drainFlight=null,cleanup='unobserved',cancelState='unobserved',unknown=false;
 const opening=new Set();
 let wrappedDecode,wrappedResolve,wrappedOpen,wrappedRestart;
 const coherent=()=>core.crypto===crypto&&core.verify===verify&&core.relayer===relayer&&crypto.decode===wrappedDecode&&verify.resolve===wrappedResolve&&relayer.transportOpen===wrappedOpen&&relayer.restartTransport===wrappedRestart;
 const bounded=async work=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('YNX_CONTRACT_INITIATOR_DRAIN_UNKNOWN')),drainDeadlineMs);})]);}finally{clearTimeout(timer);}};
 const drain=()=>{
  if(drainFlight)return drainFlight;
  drainFlight=(async()=>{
   try{
    if(ownsCore()!==true||!coherent())throw error('YNX_CONTRACT_INITIATOR_CORE_NOT_OWNED');
    // Close exactly this original Core once, retaining all unresolved work.
    const closing=Promise.resolve().then(()=>{if(ownsCore()!==true||!coherent())throw error('YNX_CONTRACT_INITIATOR_CORE_NOT_OWNED');return close();});
    const outcomes=await bounded(Promise.allSettled([...opening,closing]));
    const closed=outcomes.at(-1);if(closed.status==='rejected')throw closed.reason;
    if(ownsCore()!==true||!coherent()||opening.size||relayer.connected!==false||relayer.connecting!==false)throw error('YNX_CONTRACT_INITIATOR_DRAIN_UNKNOWN');
    cleanup=unknown?'unknown':'transport-paused';return true;
   }catch(cause){unknown=true;cleanup='unknown';throw cause;}
  })();drainFlight.catch(()=>{});return drainFlight;
 };
 const terminate=cause=>{
  if(terminal)return first;
  terminal=true;first=cause??error('YNX_CONTRACT_INITIATOR_ROLE_VIOLATION');
  try{onTerminal(first);}catch{unknown=true;cleanup='unknown';}
  // Native cancellation starts independently of transport cleanup and is never
  // retried by this adapter. Neither failure can replace the original cause.
  try{cancelFlight=Promise.resolve(cancelGuard());}catch(cause){cancelFlight=Promise.reject(cause);}
  cancelFlight=cancelFlight.then(value=>{if(value!==true)throw error('YNX_CONTRACT_INITIATOR_CANCEL_UNKNOWN');cancelState='confirmed';return true;},cause=>{throw cause;});
  cancelFlight.catch(()=>{unknown=true;cancelState='unknown';cleanup='unknown';});
  void drain();return first;
 };
 const check=()=>{
  if(terminal)throw first;
  try{
   if(ownsCore()!==true||!coherent())throw error('YNX_CONTRACT_INITIATOR_CORE_NOT_OWNED');
   if(terminal)throw first;
   const token=current();
   // Native current can synchronously deliver its revocation observer.
   if(terminal)throw first;
   if(ownsCore()!==true||!coherent())throw error('YNX_CONTRACT_INITIATOR_CORE_NOT_OWNED');
   if(terminal)throw first;
   return token;
  }catch(cause){throw terminate(cause);}
 };
 wrappedDecode=async(...args)=>{
  const before=check();let payload;
  try{payload=await decode(...args);}catch(cause){if(terminal)throw first;throw cause;}
  const after=check();if(before!==after)throw terminate(error('YNX_CONTRACT_INITIATOR_CONTEXT_CHANGED'));
  if(forbidden.has(requestMethod(payload)))throw terminate(error('YNX_CONTRACT_INITIATOR_ROLE_VIOLATION'));
  return payload;
 };
 wrappedResolve=async()=>{throw terminate(error('YNX_CONTRACT_INITIATOR_VERIFY_FORBIDDEN'));};
 const transport=original=>(...args)=>{
  const before=check();let work;
  try{work=Promise.resolve(original(...args));}catch(cause){return Promise.reject(cause);}
  const tracked=work.then(value=>{if(before!==check())throw terminate(error('YNX_CONTRACT_INITIATOR_CONTEXT_CHANGED'));return value;});
  opening.add(tracked);tracked.then(()=>opening.delete(tracked),()=>opening.delete(tracked));return tracked;
 };
 wrappedOpen=transport(open);wrappedRestart=transport(restart);
 replace(crypto,'decode',wrappedDecode);replace(verify,'resolve',wrappedResolve);
 replace(relayer,'transportOpen',wrappedOpen);replace(relayer,'restartTransport',wrappedRestart);
 replace(core,'crypto',crypto);replace(core,'verify',verify);replace(core,'relayer',relayer);
 const boundary=Object.freeze({assertCurrent:check,terminate,drain,
  snapshot:()=>Object.freeze({scope:'local-only',role:'developer-contract-initiator',terminal,firstCausePresent:first!==null,cancel:cancelState,cleanup,pendingTransport:opening.size,remoteCleanup:'not-proven',replayAllowed:false}),
 });installed.set(core,boundary);check();return boundary;
}
