// One normal V5 sender and its Native read-only resource bridge. No public
// transport-peer constructor, endpoint/provider/hash setter, or Source installer.
import{types}from'node:util';
import{loadOriginalAuthIdentityNativeImage}from'./original-auth-identity-fixed-native-image.js';
import{canonicalJSON}from'./canonical.js';
import{createProductSessionHTTPBodyV5DATA,parseProductSessionHTTPProofV5Unsigned,assertProductSessionHTTPBodyV5DATA,inspectProductSessionHTTPProofV5Data,encodeProductSessionProofHeaderV5,PRODUCT_SESSION_V5_BODY_MAX_BYTES,PRODUCT_SESSION_PROOF_HEADER_V5}from'./product-session-proof-v5.js';
const peers=new WeakMap(),packets=new WeakMap(),originalFetch=globalThis.fetch,originalNow=Date.now;
const ta=Object.getPrototypeOf(Uint8Array.prototype),len=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buf=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const fail=code=>{throw Object.assign(Error(code),{code})};
const record=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('HTTP_V5_EXACT_DATA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('HTTP_V5_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,d[k].value]))};
const bytes=(v,max)=>{if(types.isProxy(v)||!types.isUint8Array(v))fail('HTTP_V5_ACTUAL_BYTES');let n,b;try{n=len.call(v);b=buf.call(v)}catch{fail('HTTP_V5_ACTUAL_BYTES')}if(!n||n>max||types.isSharedArrayBuffer(b))fail('HTTP_V5_ACTUAL_BYTES');const out=Buffer.alloc(n);try{set.call(out,v)}catch{fail('HTTP_V5_ACTUAL_BYTES')}return out};
const method=(v,name,...args)=>{if(!v||types.isProxy(v))fail('HTTP_V5_ORIGINAL_NATIVE_ABI');const d=Object.getOwnPropertyDescriptor(v,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('HTTP_V5_ORIGINAL_NATIVE_ABI');return d.value.call(v,...args)};
const context=v=>{if(!v||types.isProxy(v)||!Object.isFrozen(v))fail('HTTP_V5_ORIGINAL_CONTEXT');const{signal}=record(v,['signal']);let stopped;try{stopped=aborted.call(signal)}catch{fail('HTTP_V5_ORIGINAL_CONTEXT')}if(stopped)throw reason.call(signal);return v};
const identityKeys=['sessionBinding','productId','clientId','applicationId','bundleId','packageId','origin','callback','account','canonicalOwner','deviceId','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest'];
function originalScope(source){
 const r=record(method(source,'readOriginalScopeDATA'),['version','targetURL','networkId','pkA','pkB','identity','expiresAtMs','maxBodyBytes']);
 if(r.version!=='5'||typeof r.targetURL!=='string'||r.targetURL.length>2048||!Number.isSafeInteger(r.expiresAtMs)||r.expiresAtMs<=originalNow()||typeof r.maxBodyBytes!=='string'||! /^[1-9][0-9]{0,7}$/.test(r.maxBodyBytes)||Number(r.maxBodyBytes)>PRODUCT_SESSION_V5_BODY_MAX_BYTES)fail('HTTP_V5_SOURCE_SCOPE');
 const u=new URL(r.targetURL);if(u.hostname.length>253||u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.pathname!=='/api/v1/ide/deployments'||u.toString()!==r.targetURL)fail('HTTP_V5_SOURCE_TARGET');
 r.identity=Object.freeze(record(r.identity,identityKeys));return Object.freeze(r);
}
function clock(r){const at=originalNow();if(!Number.isSafeInteger(at)||at<r.clockFloor||at>=Math.min(r.scope.expiresAtMs,r.proofExpiresAtMs??Infinity))fail('HTTP_V5_CURRENT_EXPIRED');r.clockFloor=at;return at}
function current(r){if(r.owner.closed||r.unknown||r.phase==='closed')fail('HTTP_V5_RESOURCE_RETIRED');context(r.context);clock(r)}
function peer(v){const r=peers.get(v);if(!r)fail('HTTP_V5_ORIGINAL_TRANSPORT_PEER_REQUIRED');return r}
// Fixed release-selected Native module uses ONLY these read/check functions.
// A hash/JSON copy/ordinary submission reference never belongs to this map.
export function isOriginalHTTPBinaryTransportV5Peer(v){return peers.has(v)}
export function readOriginalHTTPBinaryTransportV5ForNative(v){if(arguments.length!==1)fail('HTTP_V5_PEER_ARGUMENTS');const r=peer(v);current(r);return Object.freeze({version:'5',requestId:r.requestId,method:'POST',path:'/api/v1/ide/deployments',url:r.scope.targetURL,contentType:r.contentType,bodyOriginal:Buffer.from(r.body),expectedSlotRevision:r.expectedSlotRevision,rollbackTarget:r.rollbackTarget})}
export function assertOriginalHTTPBinaryTransportV5Current(v){if(arguments.length!==1)fail('HTTP_V5_PEER_ARGUMENTS');current(peer(v))}
export async function recheckOriginalHTTPBinaryTransportV5(v){if(arguments.length!==1)fail('HTTP_V5_PEER_ARGUMENTS');current(peer(v))}
const drainStates=new WeakMap();
function stateOf(v){let s=drainStates.get(v);if(!s){s={retired:false,closeSelected:false,done:false,failed:false,cause:undefined};drainStates.set(v,s)}return s}
function keepDrain(s,e){if(!s.failed){s.failed=true;s.cause=e}}
function retireOnce(v){const s=stateOf(v);if(!s.retired){s.retired=true;try{if(method(v,'retire')!==undefined)fail('HTTP_V5_NATIVE_DRAIN_RESULT')}catch(e){keepDrain(s,e)}}if(s.failed)throw s.cause}
async function drain(v){const s=stateOf(v);if(s.done){if(s.failed)throw s.cause;return}try{retireOnce(v)}catch{}try{if(await method(v,'join')!==undefined)fail('HTTP_V5_NATIVE_JOIN_PENDING')}catch(e){keepDrain(s,e);throw s.cause}if(!s.closeSelected){s.closeSelected=true;try{if(await method(v,'close')!==undefined)fail('HTTP_V5_NATIVE_DRAIN_RESULT');s.done=true}catch(e){keepDrain(s,e)}}if(s.failed)throw s.cause}
async function originalResponse(r,response){
 if(!response||!Number.isInteger(response.status)||typeof response.headers?.entries!=='function'||typeof response.body?.getReader!=='function')fail('HTTP_V5_ORIGINAL_RESPONSE_REQUIRED');
 const headers=Object.freeze([...response.headers]),reader=response.body.getReader(),chunks=[];let size=0,complete=false;
 const retain=()=>{r.response=Object.freeze({status:response.status,headers,bodyOriginal:Buffer.concat(chunks,size),complete})};retain();
 try{for(;;){const p=await reader.read();if(p.done){complete=true;retain();break}if(!types.isUint8Array(p.value)||types.isProxy(p.value))fail('HTTP_V5_RESPONSE_BYTES');const n=len.call(p.value);if(size+n>1048576)fail('HTTP_V5_RESPONSE_LIMIT');chunks.push(bytes(p.value,1048576));size+=n;retain()}}
 finally{if(!complete)try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
}

const ownPartial=e=>{if(e===null||!['object','function'].includes(typeof e)||types.isProxy(e))return null;const d=Object.getOwnPropertyDescriptor(e,'partial');return d&&Object.hasOwn(d,'value')?d.value:null};
export async function openOriginalHTTPBinaryClientV5(...args){
 if(args.length)fail('HTTP_V5_ZERO_INPUT');const native=loadOriginalAuthIdentityNativeImage();let source;
 const entry=native&&!types.isProxy(native)?Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionHTTPProofV5Source'):null;if(!entry||!Object.hasOwn(entry,'value')||typeof entry.value!=='function')fail('HTTP_V5_NATIVE_SOURCE_NOT_SUPPLIED');
 try{source=method(native,'acquireOriginalProductSessionHTTPProofV5Source')}catch(cause){const partial=ownPartial(cause);if(partial)throw Object.assign(Error('HTTP_V5_NATIVE_ACQUISITION_PARTIAL'),{code:'HTTP_V5_NATIVE_ACQUISITION_PARTIAL',cause,partial});throw cause}
 if(source===null||source===undefined)fail('HTTP_V5_NATIVE_SOURCE_NOT_SUPPLIED');
 try{for(const name of['readOriginalScopeDATA','assertCurrent','produceOriginalHTTPProofV5','retire','join','close']){const d=Object.getOwnPropertyDescriptor(source,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('HTTP_V5_ORIGINAL_NATIVE_ABI')}}catch(cause){throw Object.assign(Error('HTTP_V5_NATIVE_ACQUISITION_PARTIAL'),{code:'HTTP_V5_NATIVE_ACQUISITION_PARTIAL',cause,partial:source})}
 const owner={closed:false},flights=new Set(),resources=new Set(),operationIds=new Set();let closing,firstPresent=false,first;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e}};
 const alive=()=>{if(owner.closed||firstPresent)fail('HTTP_V5_CLIENT_RETIRED')};
 const track=fn=>{const f=fn();flights.add(f);f.then(()=>flights.delete(f),()=>flights.delete(f));return f};
 const packet=v=>{const r=packets.get(v);if(!r||r.owner!==owner)fail('HTTP_V5_ORIGINAL_PACKET_REQUIRED');return r};
 function prepare(input){
  alive();const i=record(input,['requestId','expectedSlotRevision','rollbackTarget','bodySnapshot','abortContext']),snapshot=record(i.bodySnapshot,['bodyOriginal','contentType']),body=bytes(snapshot.bodyOriginal,PRODUCT_SESSION_V5_BODY_MAX_BYTES),ctx=context(i.abortContext);
  if(typeof i.requestId!=='string'||! /^[A-Za-z0-9._:-]{1,128}$/.test(i.requestId)||typeof i.expectedSlotRevision!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(i.expectedSlotRevision)||BigInt(i.expectedSlotRevision)>0xffffffffffffffffn||typeof i.rollbackTarget!=='string'||i.rollbackTarget.length>128||/[\r\n\0]/.test(i.rollbackTarget))fail('HTTP_V5_ORIGINAL_OPERATION');
  if(operationIds.has(i.requestId))fail('HTTP_V5_QUERY_ORIGINAL_ONLY');
  if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');const scope=originalScope(source);if(body.length>Number(scope.maxBodyBytes))fail('HTTP_V5_SELECTED_BODY_LIMIT');
  // Hash/Content-Type parsing here is DATA preflight only. Native independently
  // copies this resource and Core recomputes all actual-byte commitments.
  createProductSessionHTTPBodyV5DATA(body,snapshot.contentType);
  const r={owner,scope,body,contentType:snapshot.contentType,context:ctx,requestId:i.requestId,expectedSlotRevision:i.expectedSlotRevision,rollbackTarget:i.rollbackTarget,clockFloor:originalNow(),phase:'prepared',unknown:false,proofEntered:false,httpEntered:false,member:null,unsignedOriginal:null,header:null,response:null,firstPresent:false,first:null,op:null};const p=Object.freeze({}),n=Object.freeze({});r.nativePeer=n;r.reference=p;peers.set(n,r);packets.set(p,r);resources.add(r);operationIds.add(i.requestId);current(r);if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');return p;
 }
 function read(v){const r=packet(v);return Object.freeze({requestId:r.requestId,method:'POST',path:'/api/v1/ide/deployments',url:r.scope.targetURL,contentType:r.contentType,bodyOriginal:Buffer.from(r.body),expectedSlotRevision:r.expectedSlotRevision,rollbackTarget:r.rollbackTarget,proofHeaderName:PRODUCT_SESSION_PROOF_HEADER_V5,proofHeader:r.header,memberOriginal:r.member?Buffer.from(r.member):null,unsignedOriginal:r.unsignedOriginal,proofEntered:r.proofEntered,httpEntered:r.httpEntered,responseOriginal:r.response?Object.freeze({...r.response,bodyOriginal:Buffer.from(r.response.bodyOriginal)}):null,unknown:r.unknown,dataOnly:true,SourceAdmission:false,NativeAdmission:false})}
 async function prove(v){
  alive();const r=packet(v);current(r);if(r.proofEntered)fail('HTTP_V5_QUERY_ORIGINAL_ONLY');if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');r.proofEntered=true;r.phase='signing';let operation,failed=false,cause;
  const retain=()=>{if(operation){r.member=bytes(method(operation,'readOriginalMember'),98304);const text=method(operation,'readOriginalUnsigned');if(typeof text!=='string'||Buffer.byteLength(text)>16384)fail('HTTP_V5_UNSIGNED_ORIGINAL');r.unsignedOriginal=text}};
  try{
   try{operation=await method(source,'produceOriginalHTTPProofV5',r.nativePeer,r.context)}catch(e){operation=ownPartial(e);throw e}r.op=operation;retain();
   const raw=JSON.parse(r.unsignedOriginal),u=parseProductSessionHTTPProofV5Unsigned(raw);if(canonicalJSON(u)!==r.unsignedOriginal)fail('HTTP_V5_UNSIGNED_CANONICAL');for(const k of identityKeys)if(u[k]!==r.scope.identity[k])fail('HTTP_V5_SOURCE_IDENTITY_CHANGED');
   assertProductSessionHTTPBodyV5DATA(r.body,r.contentType,u);const at=clock(r);if(at<Date.parse(u.issuedAt)||at>=Date.parse(u.expiresAt)||Date.parse(u.expiresAt)>r.scope.expiresAtMs)fail('HTTP_V5_PROOF_WINDOW');inspectProductSessionHTTPProofV5Data(r.member,{networkId:r.scope.networkId,unsigned:u,pkA:r.scope.pkA,pkB:r.scope.pkB});
   if(method(operation,'assertCurrent')!==undefined||method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');current(r);r.header=encodeProductSessionProofHeaderV5(u,r.member);r.proofExpiresAtMs=Date.parse(u.expiresAt);
  }catch(e){failed=true;cause=e;try{if(!r.member)retain()}catch{}}finally{if(operation)try{await drain(operation)}catch(e){if(!failed){failed=true;cause=e}}if(!operation||drainStates.get(operation)?.done)r.op=null}
  if(failed){r.unknown=true;r.phase='unknown';r.firstPresent=true;r.first=cause;remember(cause);throw cause}try{current(r);if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');r.phase='signed';return read(v)}catch(e){r.unknown=true;r.phase='unknown';r.firstPresent=true;r.first=e;remember(e);throw e};
 }
 async function submit(v,sameContext){
  alive();const r=packet(v);current(r);if(sameContext!==r.context||context(sameContext)!==r.context)fail('HTTP_V5_ORIGINAL_CONTEXT');if(!r.header||r.phase!=='signed'||r.httpEntered)fail('HTTP_V5_QUERY_ORIGINAL_ONLY');if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');
  const headers={'content-type':r.contentType,'accept':'application/json',[PRODUCT_SESSION_PROOF_HEADER_V5]:r.header,'idempotency-key':r.requestId,'x-deployment-manifest-version':'2','x-expected-deployment-revision':r.expectedSlotRevision};if(r.rollbackTarget)headers['x-rollback-to']=r.rollbackTarget;
  if(Buffer.byteLength(Object.entries(headers).map(([k,v])=>k+': '+v+'\r\n').join(''))>262144)fail('HTTP_V5_TOTAL_HEADER_LIMIT');r.httpEntered=true;r.phase='entered';
  const controller=new AbortController(),forward=()=>controller.abort(reason.call(r.context.signal));r.controller=controller;r.context.signal.addEventListener('abort',forward,{once:true});const timer=setTimeout(()=>controller.abort(Object.assign(Error('HTTP_V5_HTTP_TIMEOUT'),{code:'HTTP_V5_HTTP_TIMEOUT'})),Math.max(1,Math.min(30000,Math.min(r.scope.expiresAtMs,r.proofExpiresAtMs)-originalNow())));
  try{
   const response=await originalFetch(r.scope.targetURL,{method:'POST',headers,body:r.body,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   // Retain the actual original response BEFORE current/status interpretation.
   await originalResponse(r,response);
   current(r);if(method(source,'assertCurrent')!==undefined)fail('HTTP_V5_SOURCE_CURRENT');r.phase='returned';return read(v);
  }catch(cause){r.unknown=true;r.phase='unknown';r.firstPresent=true;r.first=cause;remember(cause);throw cause}finally{clearTimeout(timer);r.context.signal.removeEventListener('abort',forward);r.controller=null}
 }
 async function cleanup(){
  await Promise.allSettled([...flights]);let failed=false,cause,debt=false;const keep=e=>{if(!failed){failed=true;cause=e;remember(e)}};
  for(const r of resources)if(r.op)try{await drain(r.op);r.op=null}catch(e){keep(e);if(stateOf(r.op).done)r.op=null;else debt=true}
  if(!debt)try{await drain(source)}catch(e){keep(e)}
  if(failed)throw cause;
 }
 function retire(){owner.closed=true;for(const r of resources){r.phase='closed';r.controller?.abort(Object.assign(Error('HTTP_V5_CLIENT_RETIRED'),{code:'HTTP_V5_CLIENT_RETIRED'}))}try{retireOnce(source)}catch(e){remember(e);throw e}}
 return Object.freeze({prepareOriginalRequest:prepare,readOriginalRequestDATA:read,produceOriginalProof(v){return track(()=>prove(v))},submitPrepared(v,ctx){return track(()=>submit(v,ctx))},status(){return Object.freeze({closed:owner.closed,physicalSourceClosed:stateOf(source).done,cleanupDebt:[...resources].some(r=>r.op!==null),firstCausePresent:firstPresent,firstCause:first,SourceAdmission:false,NativeAdmission:false})},retire,join(){if(!owner.closed)fail('HTTP_V5_RETIRE_BEFORE_JOIN');return cleanup()},close(){try{retire()}catch{}return closing??=(async()=>{await cleanup()})()},drainOriginal(){if(!owner.closed)fail('HTTP_V5_RETIRE_BEFORE_JOIN');return cleanup()}});
}
