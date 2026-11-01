import {createHash,createPublicKey,verify} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync} from 'node:fs';
import {isAbsolute,dirname,normalize} from 'node:path';
import {types} from 'node:util';
import {Server as HTTPServer} from 'node:http';
import {Server as NetServer} from 'node:net';
import {EventEmitter} from 'node:events';
import {canonicalJSON,WalletAuthError} from './canonical.js';
import {parseProductSessionRegistry} from './product-session-registry.js';
import {captureOriginalWalletServiceRuntimeHostSource} from './product-session-gateway-node-host.js';

const PURPOSE='wallet-product-session-v2-runtime-instance/v1';
const DOMAIN='YNX_WALLET_SERVICE_RUNTIME_INSTANCE_V1\n';
const observers=new WeakMap(),captures=new WeakMap();
const unresolvedObserverCustody=new Set();
const acquisitionOwners=new WeakMap();
// Cleanup-only same-operation custody, never observer/business authority.
export function beginOriginalWalletRuntimeObserverAcquisition(){
  const ref=Object.freeze({});acquisitionOwners.set(ref,{entered:false,settled:false,held:[],observer:null,partial:null,firstCause:null,firstCausePresent:false,cleanupCause:null,cleanupFailurePresent:false,closing:null});return ref;
}
function acquisitionOwned(ref){const value=acquisitionOwners.get(ref);if(!value)fail('ORIGINAL_RUNTIME_ACQUISITION_OWNER_REQUIRED');return value;}
export function closeOriginalWalletRuntimeObserverAcquisition(ref){
  const state=acquisitionOwned(ref);if(state.closing)return state.closing;
  state.closing=Promise.resolve().then(()=>{
    if(state.entered&&!state.settled)fail('ORIGINAL_RUNTIME_ACQUISITION_INFLIGHT');
    if(state.observer!==null){closeOriginalWalletServiceRuntimeObserver(state.observer);return undefined;}
    // Failed-before-return disposal was already selected once by the creator.
    // Observe this exact original acquisition, not global absence or a retry.
    if(state.cleanupFailurePresent)throw state.cleanupCause;
    for(const custody of state.held){if(custody.cleanupFailurePresent)throw custody.cleanupCause;if(!custody.closed)fail('ORIGINAL_RUNTIME_CLEANUP_INCOMPLETE');}
    if(state.partial?.cleanupFailurePresent)throw state.partial.cleanupCause;
    return undefined;
  }).catch(cause=>{if(!state.cleanupFailurePresent){state.cleanupCause=cause;state.cleanupFailurePresent=true;}throw cause;});return state.closing;
}
let activeObserver=null;
const address=NetServer.prototype.address, listeners=EventEmitter.prototype.rawListeners;
const on=EventEmitter.prototype.on, remove=EventEmitter.prototype.removeListener;
const listening=Object.getOwnPropertyDescriptor(NetServer.prototype,'listening').get;
const ROOT=['version','purpose','rootId','rootKeyId','publicKey'];
const BODY=['version','purpose','rootId','rootKeyId','registrationId','service','productId','platform','gatewayOrigin','keyId','roleDigest','registryDigest','instanceId','currentReference','gatewayManifestDigest','bindAddress','bindPort','issuedAtMs','expiresAtMs'];
const BINDING=['keyId','roleDigest','registryDigest'];
const fail=(code='ORIGINAL_RUNTIME_INVALID')=>{throw new WalletAuthError(code,'Original runtime source is unavailable or invalid');};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
function object(value,fields){
  if(!value||typeof value!=='object'||types.isProxy(value)||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
  const own=Reflect.ownKeys(value);if(own.length!==fields.length||own.some(k=>typeof k!=='string'||!fields.includes(k)))fail();
  const out={};for(const k of fields){const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();out[k]=d.value;}return out;
}
function publicJSON(raw,fields){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)fail();
  let v;try{v=JSON.parse(raw);}catch{fail();}const out=object(v,fields);if(canonicalJSON(v)!==raw)fail();return out;
}
function stamp(s){return [s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');}
function safe(s,file){
  const uid=process.getuid();if(file?!s.isFile()||s.uid!==uid||s.nlink!==1||(s.mode&0o077)!==0:!s.isDirectory()||![uid,0].includes(s.uid)||(s.mode&0o022)!==0)fail();
}
function bytes(fd){const out=Buffer.alloc(65537);let n=0,r;while(n<out.length&&(r=readSync(fd,out,n,out.length-n,n))>0)n+=r;if(n>65536)fail();return out.subarray(0,n);}
function disposeHeld(custody){
  if(custody.closeEntered){if(custody.cleanupFailurePresent)throw custody.cleanupCause;if(custody.closed)return;fail('ORIGINAL_RUNTIME_CLEANUP_INFLIGHT');}
  custody.closeEntered=true; // Reserve before the first OS disposal callback.
  for(const row of [...custody.rows].reverse()){
    row.closeEntered=true;
    try{closeSync(row.fd);row.closed=true;}catch(cause){row.cleanupCause=cause;row.cleanupFailurePresent=true;if(!custody.cleanupFailurePresent){custody.cleanupCause=cause;custody.cleanupFailurePresent=true;}}
  }
  if(custody.cleanupFailurePresent){if(custody.acquisition&&!custody.acquisition.cleanupFailurePresent){custody.acquisition.cleanupCause=custody.cleanupCause;custody.acquisition.cleanupFailurePresent=true;}unresolvedObserverCustody.add(custody);throw custody.cleanupCause;}
  custody.closed=true;
}
function held(path,expected,acquisition){
  if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path||path==='/'||!digest(expected))fail('ORIGINAL_RUNTIME_NOT_CONFIGURED');
  const chain=[];let p=dirname(path);while(true){chain.unshift(p);if(p==='/')break;p=dirname(p);}
  const rows=[],custody={rows,acquisition:acquisition??null,source:null,raw:null,firstCause:null,firstCausePresent:false,closeEntered:false,closed:false,cleanupCause:null,cleanupFailurePresent:false};
  if(acquisition)acquisition.held.push(custody);
  try{
    for(const part of [...chain,path]){const file=part===path;const before=lstatSync(part);safe(before,file);const fd=openSync(part,constants.O_RDONLY|constants.O_NOFOLLOW|(file?0:constants.O_DIRECTORY));const row={path:part,fd,file,identity:null,closeEntered:false,closed:false,cleanupFailurePresent:false};rows.push(row);row.identity=stamp(before);const after=fstatSync(fd);safe(after,file);if(stamp(after)!==stamp(before))fail();}
    const leaf=rows.at(-1);if(leaf.identity!==stamp(fstatSync(leaf.fd)))fail();const raw=bytes(leaf.fd);custody.raw=raw;if(sha(raw)!==expected)fail();
    const source={raw:raw.toString('utf8'),check(){if(custody.closeEntered)fail('ORIGINAL_RUNTIME_UNAVAILABLE');for(const r of rows){const a=fstatSync(r.fd),b=lstatSync(r.path);safe(a,r.file);safe(b,r.file);if(stamp(a)!==r.identity||stamp(b)!==r.identity)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');}if(sha(bytes(leaf.fd))!==expected)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');for(const r of rows)if(stamp(fstatSync(r.fd))!==r.identity||stamp(lstatSync(r.path))!==r.identity)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');},close(){return disposeHeld(custody);}};
    custody.source=source;
    source.check();return source;
  }catch(e){custody.firstCause=e;custody.firstCausePresent=true;try{disposeHeld(custody);}catch{/* Same rows/first cause/debt already strongly retained; no retry. */}throw e;}
}
function rejectReentry(){if(activeObserver){activeObserver.invalid=true;fail('ORIGINAL_RUNTIME_REENTRY');}}
function enter(o){rejectReentry();if(o.active){o.invalid=true;fail('ORIGINAL_RUNTIME_REENTRY');}if(o.invalid||o.closed)fail('ORIGINAL_RUNTIME_UNAVAILABLE');o.active=true;activeObserver=o;}
function owned(value){rejectReentry();const o=observers.get(value);if(!o)fail('ORIGINAL_RUNTIME_NOT_CONFIGURED');return o;}
function serverCurrent(o){
  if(types.isProxy(o.server)||!HTTPServer.prototype.isPrototypeOf(o.server)||!listening.call(o.server))fail('ORIGINAL_RUNTIME_UNAVAILABLE');
  const request=listeners.call(o.server,'request');if(request.length!==1||request[0]!==o.host.handler)fail('ORIGINAL_RUNTIME_HANDLER_MISMATCH');
  if(o.host.server!==null&&o.host.server!==undefined&&o.host.server!==o.server)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');
  const a=address.call(o.server);if(!a||typeof a==='string'||a.address!==o.body.bindAddress||a.port!==o.body.bindPort)fail('ORIGINAL_RUNTIME_LISTENER_CHANGED');
  const host=captureOriginalWalletServiceRuntimeHostSource(o.hostSource);if(host!==o.host)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');
}
// No user callbacks after this owned clock: all remaining checks are fixed source/intrinsics.
function current(o){
  try {
  const now=o.now();if(o.invalid)fail('ORIGINAL_RUNTIME_REENTRY');if(!Number.isSafeInteger(now)||now<o.floor||now<o.body.issuedAtMs||now>=o.body.expiresAtMs)fail('ORIGINAL_RUNTIME_EXPIRED');o.floor=now;
  for(const f of o.files)f.check();serverCurrent(o);
  // Intrinsic Server checks can touch its original fields: fence sources again afterwards.
  for(const f of o.files)f.check();if(captureOriginalWalletServiceRuntimeHostSource(o.hostSource)!==o.host)fail('ORIGINAL_RUNTIME_SOURCE_CHANGED');
  if(o.invalid)fail('ORIGINAL_RUNTIME_UNAVAILABLE');return now;
  } catch(e) {o.invalid=true;throw e;}
}

export function createOriginalWalletServiceRuntimeObserver(input,acquisitionRef=beginOriginalWalletRuntimeObserverAcquisition()){
  const acquisition=acquisitionOwned(acquisitionRef);
  if(acquisition.entered)fail('ORIGINAL_RUNTIME_ACQUISITION_ALREADY_ENTERED');acquisition.entered=true;
  try{return acquireOriginalWalletServiceRuntimeObserver(input,acquisition);}
  catch(cause){acquisition.firstCause=cause;acquisition.firstCausePresent=true;throw cause;}
  finally{acquisition.settled=true;}
}
function acquireOriginalWalletServiceRuntimeObserver(input,acquisition){
  rejectReentry();
  if(unresolvedObserverCustody.size)fail('ORIGINAL_RUNTIME_CLEANUP_UNRESOLVED');
  const c=object(input,['hostSource','server','instanceSource','roleBinding','originalNow']);
  if(typeof c.originalNow!=='function'||types.isProxy(c.originalNow))fail('ORIGINAL_RUNTIME_NOT_CONFIGURED');
  const selection=object(c.instanceSource,['rootPath','rootDigest','instancePath','instanceDigest','gatewayManifestPath','gatewayManifestDigest','registryPath','registryFileDigest']);
  const role=object(c.roleBinding,BINDING);if(!id(role.keyId)||!digest(role.roleDigest)||!digest(role.registryDigest))fail();
  const files=[];let o;try{
    for(const [path,hash] of [['rootPath','rootDigest'],['instancePath','instanceDigest'],['gatewayManifestPath','gatewayManifestDigest'],['registryPath','registryFileDigest']])files.push(held(selection[path],selection[hash],acquisition));
    const root=publicJSON(files[0].raw,ROOT);if(root.version!==1||root.purpose!==PURPOSE||!id(root.rootId)||!id(root.rootKeyId)||typeof root.publicKey!=='string')fail();
    const envelope=publicJSON(files[1].raw,['body','signature']),body=object(envelope.body,BODY);
    if(body.version!==1||body.purpose!==PURPOSE||body.rootId!==root.rootId||body.rootKeyId!==root.rootKeyId||!id(body.registrationId)||body.service!=='wallet-product-session-v2'||body.productId!=='developer'||body.platform!=='macos'||body.gatewayOrigin!=='https://wallet-auth.ynxweb4.com')fail();
    if(body.keyId!==role.keyId||body.roleDigest!==role.roleDigest||body.registryDigest!==role.registryDigest||body.gatewayManifestDigest!==selection.gatewayManifestDigest||!id(body.instanceId)||!digest(body.currentReference)||typeof body.bindAddress!=='string'||!['127.0.0.1','::1'].includes(body.bindAddress)||!Number.isSafeInteger(body.bindPort)||body.bindPort<1||body.bindPort>65535)fail();
    if(!Number.isSafeInteger(body.issuedAtMs)||!Number.isSafeInteger(body.expiresAtMs)||body.issuedAtMs<0||body.expiresAtMs<=body.issuedAtMs||body.expiresAtMs-body.issuedAtMs>86400000)fail();
    if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))fail();const signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==envelope.signature)fail();
    const key=createPublicKey(root.publicKey);if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(DOMAIN+canonicalJSON(body)),key,signature))fail();
    const host=captureOriginalWalletServiceRuntimeHostSource(c.hostSource);let registry;try{registry=parseProductSessionRegistry(JSON.parse(files[3].raw));}catch{fail();}if(canonicalJSON(registry)!==host.registryRaw||host.registryDigest!==role.registryDigest)fail();
    const binding=Object.freeze({keyId:body.keyId,roleDigest:body.roleDigest,instanceId:body.instanceId,currentReference:body.currentReference,gatewayManifestDigest:body.gatewayManifestDigest,registryDigest:body.registryDigest});
    o={files,host,hostSource:c.hostSource,server:c.server,body,binding,now:c.originalNow,floor:0,active:true,invalid:false,closed:false,event:()=>{o.invalid=true;}};
    activeObserver=o;
    if(!c.server||types.isProxy(c.server)||!HTTPServer.prototype.isPrototypeOf(c.server))fail('ORIGINAL_RUNTIME_NOT_CONFIGURED');
    for(const event of ['close','error','listening'])on.call(c.server,event,o.event);
    current(o);o.active=false;const result=Object.freeze({});observers.set(result,o);acquisition.observer=result;return result;
  }catch(e){
    const partial={owner:o??null,files,firstCause:e,firstCausePresent:true,cleanupCause:null,cleanupFailurePresent:false};
    acquisition.partial=partial;
    const retain=cause=>{if(!partial.cleanupFailurePresent){partial.cleanupCause=cause;partial.cleanupFailurePresent=true;}if(!acquisition.cleanupFailurePresent){acquisition.cleanupCause=cause;acquisition.cleanupFailurePresent=true;}};
    if(o){o.invalid=true;for(const event of ['close','error','listening'])try{remove.call(o.server,event,o.event);}catch(cause){retain(cause);}}
    for(const f of files)try{f.close();}catch(cause){retain(cause);}
    if(partial.cleanupFailurePresent)unresolvedObserverCustody.add(partial);
    throw e;
  }finally{if(activeObserver===o)activeObserver=null;}
}
export function assertOriginalWalletServiceRuntimeObserver(observer){
  const o=owned(observer);enter(o);try{current(o);}catch(e){o.invalid=true;throw e;}finally{o.active=false;activeObserver=null;}
}
export function captureOriginalWalletServiceRuntimeObservation(observer,sequence){
  const o=owned(observer);enter(o);try{
    if(!Number.isSafeInteger(sequence)||sequence<1)fail();const at=current(o);
    const observationRaw=canonicalJSON({instanceId:o.binding.instanceId,currentReference:o.binding.currentReference,gatewayManifestDigest:o.binding.gatewayManifestDigest,registryDigest:o.binding.registryDigest,observedAtMs:at,expiresAtMs:Math.min(at+30000,o.body.expiresAtMs),sequence,state:'ready'});
    const value=Object.freeze({binding:o.binding,sequence,observationRaw});captures.set(value,{owner:o,at,expiresAt:Math.min(at+30000,o.body.expiresAtMs)});return value;
  }catch(e){if(e.code!=='ORIGINAL_RUNTIME_INVALID')o.invalid=true;throw e;}finally{o.active=false;activeObserver=null;}
}
export function assertOriginalWalletServiceRuntimeObservationCurrent(observer,captured){
  const o=owned(observer);enter(o);try{const cap=captures.get(captured);if(!cap||cap.owner!==o)fail();const at=current(o);if(at<cap.at||at>=cap.expiresAt)fail('ORIGINAL_RUNTIME_EXPIRED');}catch(e){if(e.code!=='ORIGINAL_RUNTIME_INVALID')o.invalid=true;throw e;}finally{o.active=false;activeObserver=null;}
}
export function closeOriginalWalletServiceRuntimeObserver(observer){
  const o=owned(observer);if(o.active){o.invalid=true;fail('ORIGINAL_RUNTIME_REENTRY');}
  if(o.closeEntered){if(o.cleanupFailed)throw o.cleanupCause;if(o.closed)return;fail('ORIGINAL_RUNTIME_CLEANUP_INCOMPLETE');}
  o.closeEntered=true;o.invalid=true;
  let first,hasFirst=false;const retain=e=>{if(!hasFirst){first=e;hasFirst=true;}};
  for(const event of ['close','error','listening'])try{remove.call(o.server,event,o.event);}catch(e){retain(e);}
  for(const f of o.files)try{f.close();}catch(e){retain(e);}
  if(hasFirst){o.cleanupCause=first;o.cleanupFailed=true;throw first;}o.closed=true;
}
