import {spawn as spawnChild} from 'node:child_process';
import {acquireOriginalAdmissionParentSource,assertOriginalAdmissionParentCurrent,enterOriginalAdmissionParentLaunch,trackOriginalAdmissionParentCall,attachOriginalAdmissionParentChannel,onOriginalAdmissionParentRetirement,retireOriginalAdmissionParentSource,joinOriginalAdmissionParentSource,closeOriginalAdmissionParentSource,selectOriginalAdmissionParentOutcome} from './original-admission-parent-source.mjs';
// Only an original trusted launcher may construct this endpoint over its held
// inherited duplex stream. A descriptor number/opaque ID is never admission.
const failure = code => Object.assign(new Error(code), {code});
const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).sort().join('|') !== [...keys].sort().join('|')) throw failure('ADMISSION_RECORD_INVALID');
  for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) if (!Object.hasOwn(d,'value') || !d.enumerable) throw failure('ADMISSION_RECORD_INVALID');
}
export function admissionCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(admissionCanonical).join(',') + ']';
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('ADMISSION_RECORD_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value), keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable)) throw failure('ADMISSION_RECORD_INVALID');
  return '{'+keys.sort().map(k=>JSON.stringify(k)+':'+admissionCanonical(descriptors[k].value)).join(',')+'}';
}
export function captureInstalledAdmission(value, now) {
  const text=admissionCanonical(value);
  if(Buffer.byteLength(text)>65536) throw failure('ADMISSION_RECORD_CAPACITY');
  const v=JSON.parse(text); exact(v,['selection','sequence','expiresAtMs','account']);
  exact(v.selection,['sourceSelection','receiptSelection','expectedRequest','receiptDirectory']);
  exact(v.selection.sourceSelection,['rootPath','rootDigest','rolePath','roleDigest']);
  exact(v.selection.receiptSelection,['receiptPath','receiptDigest']);
  const r=v.selection.expectedRequest;
  exact(r,['version','purpose','service','productId','platform','applicationId','gatewayOrigin','registryDigest','consumerManifestDigest','gatewayManifestDigest','instanceId','currentReference','operations','requestNonce','requestedAtMs','expiresAtMs']);
  if(r.version!==1||r.purpose!=='wallet-product-session-v2-service-admission/v1'||r.service!=='wallet-product-session-v2'||r.productId!=='developer'||r.platform!=='macos'||r.applicationId!=='com.ynxweb4.developer.testnetpreview'||r.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||JSON.stringify(r.operations)!==JSON.stringify(['beginYNX','handleReturn','restore','disconnect'])||!hex(r.consumerManifestDigest)||!hex(r.gatewayManifestDigest)||!hex(r.registryDigest)||!hex(r.currentReference)||!hex(v.selection.receiptSelection.receiptDigest)||!hex(v.selection.sourceSelection.rootDigest)||!hex(v.selection.sourceSelection.roleDigest)||typeof r.requestNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(r.requestNonce)||typeof r.instanceId!=='string'||!r.instanceId||typeof v.account!=='string'||!v.account||!Number.isSafeInteger(v.sequence)||v.sequence<1||!Number.isSafeInteger(v.expiresAtMs)||v.expiresAtMs<=now||v.expiresAtMs>r.expiresAtMs||v.expiresAtMs-now>30000||!Number.isSafeInteger(r.requestedAtMs)||r.requestedAtMs>now||!Number.isSafeInteger(r.expiresAtMs)) throw failure('ADMISSION_RECORD_INVALID');
  for(const path of [v.selection.sourceSelection.rootPath,v.selection.sourceSelection.rolePath,v.selection.receiptSelection.receiptPath,v.selection.receiptDirectory]) if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0')||path.split('/').some(p=>p==='.'||p==='..')) throw failure('ADMISSION_RECORD_INVALID');
  if(v.selection.receiptSelection.receiptPath!==v.selection.receiptDirectory+'/'+r.requestNonce+'.admission.json') throw failure('ADMISSION_RECORD_INVALID');
  return v; // Structural capture only; IDE verifies original signatures/custody.
}
export function createOriginalAdmissionBroker({stream, assertChannelCurrent, now=Date.now, schedule=setTimeout, unschedule=clearTimeout}) {
  if(!stream||typeof assertChannelCurrent!=='function') throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
  let retired=false, pending=null, used=false, first=null, bytes=Buffer.alloc(0), floor=-1, expiry=null, holding=false, holdTimer=null, expiryTimer=null;
  const waiters=[],drainers=[],entered=new Set();
  function drained(){if(entered.size)return;for(const resolve of drainers.splice(0))resolve();if(retired)for(const resolve of waiters.splice(0))resolve({reason:first.code??'ADMISSION_CHANNEL_CLOSED',error:first});}
  function enter(){const record={};entered.add(record);let done=false;return()=>{if(done)return;done=true;entered.delete(record);drained();};}
  const current=()=>{const at=now();if(retired||!Number.isSafeInteger(at)||at<floor||expiry!==null&&at>=expiry) throw first??failure('ADMISSION_CHANNEL_RETIRED');floor=at;if(assertChannelCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');return at;};
  const close=(error=failure('ADMISSION_CHANNEL_CLOSED'))=>{
    if(retired)return;
    if(!first) first=error; retired=true;
    unschedule(holdTimer);holdTimer=null;unschedule(expiryTimer);expiryTimer=null;
    if(pending){const p=pending;pending=null;unschedule(p.timer);p.reject(first);}
    stream.off('data',data); stream.off('end',ended); stream.off('close',ended); stream.off('error',errored);
    stream.on('error',()=>{});try{stream.destroy();}finally{drained();}
  };
  const ended=()=>close(failure('ADMISSION_CHANNEL_EOF')),errored=e=>close(e);
  const data=chunk=>{
    try{
      current();if(!pending||pending.acked)throw failure('ADMISSION_ACK_DUPLICATE');
      bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>65536)throw failure('ADMISSION_RECORD_CAPACITY');
      const i=bytes.indexOf(10);if(i<0)return;
      if(i!==bytes.length-1)throw failure('ADMISSION_ACK_CONFLICT');
      const text=bytes.subarray(0,i).toString('utf8'),ack=JSON.parse(text);if(admissionCanonical(ack)!==text)throw failure('ADMISSION_ACK_INVALID');
      exact(ack,['type','requestNonce','receiptDigest','sequence','consumerManifestDigest']);
      if(admissionCanonical(ack)!==admissionCanonical(pending.expected)||current()>=pending.expires)throw failure('ADMISSION_ACK_MISMATCH');
      pending.acked=true;settle();
    }catch(e){close(e);}
  };
  function settle(){if(pending?.acked&&pending.written){const p=pending;pending=null;unschedule(p.timer);p.resolve();}}
  stream.on('data',data);stream.on('end',ended);stream.on('close',ended);stream.on('error',errored);
  return Object.freeze({
    assertCurrent(){current();},close,
    joinEntered(){return entered.size?new Promise(resolve=>drainers.push(resolve)):Promise.resolve();},
    waitRetirement(assertOwnerCurrent){
      if(holding||typeof assertOwnerCurrent!=='function'||expiry===null||pending)throw failure('ADMISSION_CHANNEL_INVALID_HOLD');holding=true;
      const result=new Promise(resolve=>waiters.push(resolve));
      if(retired){drained();return result;}
      const tick=async()=>{
        if(retired)return;
        if(now()>=expiry){close(failure('ADMISSION_EPOCH_EXPIRED'));return;}
        const leave=enter();
        try{current();await assertOwnerCurrent();if(retired)return;current();if(!retired)holdTimer=schedule(tick,Math.min(1000,Math.max(1,expiry-now())));}catch(e){close(e);}finally{leave();}
      };
      void tick();return result;
    },
    async deliver(publication){
      current();if(used)throw failure('ADMISSION_CHANNEL_ALREADY_USED');used=true;
      const v=captureInstalledAdmission(publication,current()),r=v.selection.expectedRequest;
      expiry=v.expiresAtMs;
      // Absolute original epoch timer is independent of ACK and owner-current
      // callbacks. Never renew it when a tick or asynchronous callback returns.
      expiryTimer=schedule(()=>close(failure('ADMISSION_EPOCH_EXPIRED')),Math.max(1,expiry-current()));
      const wire=admissionCanonical({type:'installed',selection:v.selection,sequence:v.sequence,expiresAtMs:v.expiresAtMs})+'\n';
      if(Buffer.byteLength(wire)>65536)throw failure('ADMISSION_RECORD_CAPACITY');
      await new Promise((resolve,reject)=>{
        pending={resolve,reject,expires:v.expiresAtMs,acked:false,written:false,expected:{type:'ack',requestNonce:r.requestNonce,receiptDigest:v.selection.receiptSelection.receiptDigest,sequence:v.sequence,consumerManifestDigest:r.consumerManifestDigest}};
        pending.timer=schedule(()=>close(failure('ADMISSION_ACK_TIMEOUT')),Math.max(1,v.expiresAtMs-current()));
        const leave=enter();
        try{stream.write(wire,error=>{try{if(error){close(error);return;}if(!pending)return;try{if(current()>=pending.expires)throw failure('ADMISSION_ACK_TIMEOUT');pending.written=true;settle();}catch(e){close(e);}}finally{leave();}});}catch(e){close(e);leave();}
      });
      current();if(now()>=v.expiresAtMs)throw failure('ADMISSION_ACK_TIMEOUT');
    },
  });
}

// Wallet is the sole custodian and real parent. The original approved executor
// source is supplied ONLY by fixed main custody, never a renderer path/ENV/ID.
// Current callbacks must belong to that existing protected issuer/launch owner;
// structural validation here does not enroll, approve or authenticate a child.
const retainedLaunches=new Set();
export function selectRetainedOriginalAdmissionLaunches(observer){
  if(typeof observer!=='function')throw failure('ADMISSION_PARENT_OBSERVER_INVALID');
  for(const ref of retainedLaunches)selectOriginalAdmissionParentOutcome(ref,observer);
}
export async function launchOriginalAdmissionIDE({executor,assertExecutorCurrent,assertCustodyCurrent,spawn=spawnChild,now=Date.now,schedule=setTimeout,unschedule=clearTimeout}){
  if(!executor||typeof assertExecutorCurrent!=='function'||typeof assertCustodyCurrent!=='function')throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
  const selected=immutable(JSON.parse(admissionCanonical(executor)));
  exact(selected,['executable','args','applicationId','consumerManifestDigest','instanceId','currentReference','expiresAtMs']);
  if(typeof selected.executable!=='string'||!selected.executable.startsWith('/')||selected.executable.split('/').some(p=>p==='.'||p==='..')||!Array.isArray(selected.args)||selected.args.some(a=>typeof a!=='string'||a.length>4096)||selected.applicationId!=='com.ynxweb4.developer.testnetpreview'||!hex(selected.consumerManifestDigest)||!hex(selected.currentReference)||typeof selected.instanceId!=='string'||!selected.instanceId||!Number.isSafeInteger(selected.expiresAtMs))throw failure('ADMISSION_EXECUTOR_INVALID');
  const ref=acquireOriginalAdmissionParentSource(assertExecutorCurrent,selected,admissionCanonical,now,assertCustodyCurrent);
  retainedLaunches.add(ref);
  let child=null,broker=null,poll=null,expiry=null;
  const current=()=>assertOriginalAdmissionParentCurrent(ref);
  const retire=error=>{unschedule(poll);unschedule(expiry);retireOriginalAdmissionParentSource(ref,error);};
  const tick=()=>{try{current();poll=schedule(tick,25);}catch(error){retire(error);}};
  expiry=schedule(()=>retire(failure('ADMISSION_EXECUTOR_RETIRED')),Math.max(1,selected.expiresAtMs-now()));
  poll=schedule(tick,25);
  try{
    child=enterOriginalAdmissionParentLaunch(ref,spawn);
    const exited=()=>retire(failure('ADMISSION_EXECUTOR_EXITED'));
    child.once('exit',exited);child.once('close',exited);child.on('error',retire);
    const started=new Promise((resolve,reject)=>{
      let remove;
      const cleanup=()=>{child.off('spawn',spawned);child.off('error',failed);remove?.();};
      const spawned=()=>{cleanup();resolve();},failed=error=>{cleanup();reject(error);};
      child.once('spawn',spawned);child.once('error',failed);
      remove=onOriginalAdmissionParentRetirement(ref,failed);
    });
    await trackOriginalAdmissionParentCall(ref,started);
    current();const stream=child.stdio?.[4];if(!stream)throw failure('ADMISSION_EXECUTOR_CHANNEL_ABSENT');
    broker=createOriginalAdmissionBroker({stream,assertChannelCurrent:current,now});
    attachOriginalAdmissionParentChannel(ref,broker);
    return Object.freeze({assertCurrent:current,deliver:value=>broker.deliver(value),waitRetirement:assertOwner=>broker.waitRetirement(assertOwner),
      close(error){retire(error);},
      async joinEntered(){await broker.joinEntered();await joinOriginalAdmissionParentSource(ref);await closeOriginalAdmissionParentSource(ref);retainedLaunches.delete(ref);},
    });
  }catch(error){retire(error);try{await closeOriginalAdmissionParentSource(ref);}catch{/* Exact debt/ref and first cause remain privately selected. */}throw error;}
  // Disposal closes only this capability stream. It never kills unrelated
  // standalone IDE windows or destroys their project/draft/profile state.
}
