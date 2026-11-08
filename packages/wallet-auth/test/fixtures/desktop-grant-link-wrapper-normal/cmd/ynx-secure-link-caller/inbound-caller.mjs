// Private incoming transport only. This module never constructs an Auth caller,
// business context, Source, account, nonce, Grant, issuer or receipt.
//
// openInboundAuthorityServer(registration, handler(req,res)) owns the private
// listener/internal http.Server. Registration fixes socketPath/nodeUID,
// bridgeUID/bridgePID/service, acceptTimeoutMs/currentTimeoutMs/maxConnections,
// and the two exact POST routes with independent request/response byte budgets.
// No listener/socket/server.emit or native control FD is returned to the caller.
//
// acquireInboundCaller(req) returns the same opaque handle for the same original
// IncomingMessage. It does not read or replace the stream. Current obtains Go's
// original Body over that request's private control FD; the Auth adapter still
// reads and compares the original HTTP bytes and performs all business checks.
// Release drops a logical hold only. The base request capability lives until
// response finish/close/abort or server retirement, including callback kernels
// that return undefined before the response producer completes.
// The original private Auth resolver must additionally pass its closed-over
// registeredServer to acquire/current. One-argument acquisition is transport
// evidence only; it does not enroll another public factory as that Source.
// assertCurrentInboundCaller(req,handle,registeredServer) is a synchronous
// error-only local lifetime fence AFTER a full async Current capture. It uses
// private flags and original data descriptors only, without native/FD/OS I/O,
// supplied getters/callbacks, Promises, or body copies. It cannot discover an
// unobserved peer/control close or replace Go's Source-current check at CAS.
//
// Retire stops accept/new work and closes owned native/Node descriptors. Join
// waits for accept/current, returned handler promises and actual socket close.
// Async work outside a handler's returned promise remains its original owner's
// responsibility; this module cannot claim it drained or mint error.partial.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {createRequire} from 'node:module';
import {types} from 'node:util';
import {closeSync} from 'node:fs';
import {SOCIAL_DIRECTORY_PATHS,SOCIAL_DIRECTORY_PROOF_HEADER,SOCIAL_DIRECTORY_MAX_PROOF_BYTES,SOCIAL_DIRECTORY_MAX_HEADER_BYTES,SOCIAL_DIRECTORY_MAX_CONTROL_BYTES,socialDirectoryMaterial} from './social-directory-transport-private.mjs';

const native=createRequire(import.meta.url)('./build/caller.node');
const servers=new WeakMap(),requests=new WeakMap(),callers=new WeakMap();
const headersGetter=Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype,'headers').get;
const headersSetter=Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype,'headers').set;
const routes=new Set(['/internal/auth/task-grants/effect','/internal/auth/task-grants/effect-query']);
const desktopTaskGrantRoutes=new Set(['issue','effect','query','effect-query','effect-reconcile','revoke','management'].map(suffix=>'/internal/auth/task-grants/'+suffix));
const socialDirectoryRoutes=new Set(SOCIAL_DIRECTORY_PATHS);
const taskRoutes=new Set(['/internal/auth/ai-task-v6/effect','/internal/auth/ai-task-v6/effect-query']);
const taskOperations=Object.freeze(['capture','capture-conversation','execute-local','observe','outcome','observe-outcome','reconcile-observe','release']);
const taskProfile='AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT/v1';
const decoder=new TextDecoder('utf-8',{fatal:true});
const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
const bufferGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'buffer').get;
const offsetGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteOffset').get;
function fail(message,cause){const e=new Error(message,{cause});e.code='INBOUND_DENIED';return e;}
function exact(value,keys){
  if(!value||typeof value!=='object'||types.isProxy(value))throw fail('plain inbound registration/material required');
  const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k))||keys.some(k=>!fields[k]||!Object.hasOwn(fields[k],'value')))throw fail('exact inbound DATA fields required');
  return Object.fromEntries(keys.map(k=>[k,fields[k].value]));
}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('bounded inbound integer required');return value;}
function registration(input,runtime=false,desktopTaskGrant=false,socialDirectory=false){
  const p=exact(input,['socketPath','nodeUID','bridgeUID','bridgePID','service','acceptTimeoutMs','currentTimeoutMs','maxConnections','routes']);
  if(typeof p.socketPath!=='string'||!path.isAbsolute(p.socketPath)||path.normalize(p.socketPath)!==p.socketPath||/[\0\r\n]/.test(p.socketPath)||Buffer.byteLength(p.socketPath)>=(process.platform==='darwin'?104:108))throw fail('private exact socket path required');
  if(p.nodeUID!==process.geteuid())throw fail('actual Node UID required');
  integer(p.bridgeUID,0,0xffffffff);integer(p.bridgePID,1,0x7fffffff);integer(p.acceptTimeoutMs,1,30000);integer(p.currentTimeoutMs,1,30000);integer(p.maxConnections,1,64);
  if(typeof p.service!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(p.service))throw fail('exact registered service required');
  const count=desktopTaskGrant?7:2;
  if(!Array.isArray(p.routes)||types.isProxy(p.routes)||p.routes.length!==count)throw fail('closed exact registered authority routes required');
  const list=Object.getOwnPropertyDescriptors(p.routes);
  if(Reflect.ownKeys(list).length!==count+1)throw fail('owned route list required');
  const items=[];
  for(let n=0;n<count;n++){if(!Object.hasOwn(list[n]||{},'value'))throw fail('owned route list required');items.push(list[n].value);}
  const selected=new Map();
  for(const item of items){
    const r=exact(item,['method','path','maxRequestBytes','maxResponseBytes']);
    if(r.method!==(socialDirectory?'GET':'POST')||typeof r.path!=='string'||!(socialDirectory?socialDirectoryRoutes:desktopTaskGrant?desktopTaskGrantRoutes:runtime?taskRoutes:routes).has(r.path)||selected.has(r.path))throw fail('exact incoming method/path required');
    if(socialDirectory){if(r.maxRequestBytes!==0)throw fail('empty original Social GET required');}
    else integer(r.maxRequestBytes,1,desktopTaskGrant?1048576:runtime?1835008:16<<20);
    integer(r.maxResponseBytes,1,socialDirectory?524288:runtime?2097152:16<<20);selected.set(r.path,Object.freeze(r));
  }
  return Object.freeze({...p,socialDirectory,routes:selected});
}
function valueOf(req,key){const d=Object.getOwnPropertyDescriptor(req,key);if(!d||!Object.hasOwn(d,'value'))throw fail('original request field required');return d.value;}
function rawHeaderPairs(raw){if(!Array.isArray(raw)||raw.length>256||raw.some(v=>typeof v!=='string'))throw fail('bounded original headers required');return [...raw];}
function identity(req,socket,profile){
  const method=valueOf(req,'method'),url=valueOf(req,'url'),raw=valueOf(req,'rawHeaders');
  if(valueOf(req,'socket')!==socket||method!==(profile.socialDirectory?'GET':'POST')||!profile.routes.has(url)||req.httpVersion!=='1.1')throw fail('original exact incoming route required');
  if(Object.hasOwn(req,'headers'))throw fail('original headers accessor required');
  const headers=headersGetter.call(req),pairs=rawHeaderPairs(raw);
  const counts=new Map();
  for(let n=0;n<pairs.length;n+=2){const k=pairs[n].toLowerCase();counts.set(k,(counts.get(k)||0)+1);if(k==='forwarded'||k.startsWith('x-forwarded-')||k.startsWith('x-ynx-peer-')||k.startsWith('x-ynx-service-')||k.startsWith('x-ssl-')||k.startsWith('x-tls-'))throw fail('proxy identity headers refused');}
  if(counts.get('host')!==1||headers.host!==profile.service||headers.upgrade)throw fail('registered incoming Host required');
  if(profile.socialDirectory){
    const proof=headers[SOCIAL_DIRECTORY_PROOF_HEADER];
    if(counts.get(SOCIAL_DIRECTORY_PROOF_HEADER)!==1||typeof proof!=='string'||Buffer.byteLength(proof)<1||Buffer.byteLength(proof)>SOCIAL_DIRECTORY_MAX_PROOF_BYTES||/[\0\r\n]/.test(proof)||counts.has('content-type')||counts.has('content-encoding')||headers['transfer-encoding']!==undefined||counts.has('trailer')||headers.expect||((counts.get('content-length')??0)!==0&&(counts.get('content-length')!==1||headers['content-length']!=='0')))throw fail('exact original Social proof and empty GET required');
    return {method,url,raw,headers,pairs,length:0,socket};
  }
  if(counts.get('content-type')!==1||headers['content-type']!=='application/json')throw fail('registered incoming content type required');
  const declared=headers['content-length'];
  if(typeof declared!=='string'||counts.get('content-length')!==1||headers['transfer-encoding']!==undefined||!/^(0|[1-9][0-9]*)$/.test(declared)||BigInt(declared)>BigInt(profile.routes.get(url).maxRequestBytes))throw fail('bounded explicit original Content-Length required');
  const length=Number(declared);
  return {method,url,raw,headers,pairs,length,socket};
}
function assertRequest(record,req){
  if(record.req!==req||record.closed||record.server.retired||record.socket.destroyed)throw fail('original live incoming request required');
  const actual=identity(req,record.socket,record.server.profile),original=record.identity;
  if(actual.method!==original.method||actual.url!==original.url||actual.raw!==original.raw||actual.headers!==original.headers||actual.length!==original.length||actual.pairs.length!==original.pairs.length||actual.pairs.some((v,n)=>v!==original.pairs[n]))throw fail('incoming request identity changed');
}
function descriptorData(object,key){
  const d=Object.getOwnPropertyDescriptor(object,key);
  if(!d||!Object.hasOwn(d,'value'))throw fail('original local data descriptor required');
  return d;
}
function localDataSnapshot(object,array=false){
  if(!object||typeof object!=='object'||types.isProxy(object)||(array&&!Array.isArray(object)))throw fail('original local header DATA required');
  const descriptors=Object.getOwnPropertyDescriptors(object),keys=Reflect.ownKeys(descriptors);
  if(keys.length>257)throw fail('bounded local header descriptors required');
  const fields=[];
  for(const key of keys){
    const d=descriptors[key];
    if(typeof key!=='string'||!Object.hasOwn(d,'value'))throw fail('local header accessors refused');
    const child=Array.isArray(d.value)?localDataSnapshot(d.value,true):null;
    if(!child&&typeof d.value!=='string'&&!(array&&key==='length'&&Number.isSafeInteger(d.value)))throw fail('local header strings required');
    fields.push({key,descriptor:d,child});
  }
  return {object,prototype:Object.getPrototypeOf(object),fields};
}
function localDataMatches(snapshot){
  const object=snapshot.object;
  if(types.isProxy(object)||Object.getPrototypeOf(object)!==snapshot.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(object),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==snapshot.fields.length)return false;
  for(const field of snapshot.fields){
    const d=descriptors[field.key],original=field.descriptor;
    if(!d||!Object.hasOwn(d,'value')||d.value!==original.value||d.enumerable!==original.enumerable||d.configurable!==original.configurable||d.writable!==original.writable||(field.child&&!localDataMatches(field.child)))return false;
  }
  return true;
}
function localIdentitySnapshot(req,original){
  const fields=[];
  for(const key of ['method','url','socket','rawHeaders','httpVersion','httpVersionMajor','httpVersionMinor'])fields.push({key,descriptor:descriptorData(req,key)});
  const descriptors=Object.getOwnPropertyDescriptors(req);
  const slots=Reflect.ownKeys(descriptors).filter(key=>typeof key==='symbol'&&Object.hasOwn(descriptors[key],'value')&&descriptors[key].value===original.headers);
  if(slots.length!==1)throw fail('original parsed-header cache identity required');
  return {prototype:Object.getPrototypeOf(req),fields,headerSlot:slots[0],headers:localDataSnapshot(original.headers),raw:localDataSnapshot(original.raw,true)};
}
function assertLocalIdentity(record,req){
  const original=record.localIdentity;
  if(Object.getPrototypeOf(req)!==original.prototype||Object.hasOwn(req,'headers'))throw fail('original local request prototype required');
  const accessor=Object.getOwnPropertyDescriptor(original.prototype,'headers');
  if(!accessor||accessor.get!==headersGetter||accessor.set!==headersSetter)throw fail('original local headers accessor required');
  for(const field of original.fields){
    const d=descriptorData(req,field.key),expected=field.descriptor;
    if(d.value!==expected.value||d.enumerable!==expected.enumerable||d.configurable!==expected.configurable||d.writable!==expected.writable)throw fail('original local request identity changed');
  }
  if(descriptorData(req,original.headerSlot).value!==record.identity.headers||!localDataMatches(original.headers)||!localDataMatches(original.raw))throw fail('original local request headers changed');
}
function peerView(value){
  const p=exact(value,['ServiceID','SubjectAltName','CertDigest','RootDigest','Edge','Epoch','Expires']);
  for(const k of ['ServiceID','SubjectAltName','Edge','Expires'])if(typeof p[k]!=='string'||!p[k]||p[k].length>256||/[\0\r\n]/.test(p[k]))throw fail('bounded original peer fields required');
  if(typeof p.CertDigest!=='string'||typeof p.RootDigest!=='string'||!/^[0-9a-f]{64}$/.test(p.CertDigest)||!/^[0-9a-f]{64}$/.test(p.RootDigest))throw fail('original peer digest required');integer(p.Epoch,1,Number.MAX_SAFE_INTEGER);
  return Object.freeze(p);
}
function material(record,frame){
  const meta=exact(JSON.parse(decoder.decode(frame.metadata)),['Service','Method','Path','Host','ContentType','ContentLength','Channel']);
  const channel=exact(meta.Channel,['Peer','Exporter','LocalSAN']);
  if(meta.Service!==record.server.profile.service||meta.Method!==record.identity.method||meta.Path!==record.identity.url||meta.ContentType!=='application/json'||meta.ContentLength!==record.identity.length||typeof meta.Host!=='string'||!meta.Host||meta.Host.length>256||/[\0\r\n]/.test(meta.Host))throw fail('original Go request material differs');
  if(!Buffer.isBuffer(frame.body)||frame.body.length>record.route.maxRequestBytes||(meta.ContentLength>=0&&frame.body.length!==meta.ContentLength))throw fail('original Go body bounds differ');
  if(typeof channel.Exporter!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(channel.Exporter)||typeof channel.LocalSAN!=='string'||!channel.LocalSAN||channel.LocalSAN.length>253)throw fail('original TLS channel fields required');
  const exporter=Buffer.from(channel.Exporter,'base64');if(exporter.length!==32||exporter.toString('base64')!==channel.Exporter)throw fail('original TLS exporter encoding required');
  // Host is the original TLS Host supplied by Go. The local HTTP Host remains
  // the registered Service. Neither is a business audience/Source constructor.
  return Object.freeze({...meta,Channel:Object.freeze({Peer:peerView(channel.Peer),Exporter:exporter,LocalSAN:channel.LocalSAN}),Body:Buffer.from(frame.body)});
}
function runtimeMaterial(record,frame){
  const meta=exact(JSON.parse(decoder.decode(frame.metadata)),['Profile','Service','Method','Path','Host','ContentType','ContentLength']);
  if(meta.Profile!==taskProfile||meta.Service!==record.server.profile.service||meta.Host!==meta.Service||meta.Method!==record.identity.method||meta.Path!==record.identity.url||meta.ContentType!=='application/json'||meta.ContentLength!==record.identity.length||!Buffer.isBuffer(frame.body)||frame.body.length!==meta.ContentLength||frame.body.length>record.route.maxRequestBytes)throw fail('original runtime carrier material differs');
  // Ordinary original Go HTTP/OS-peer custody, never a manufactured TLS
  // Channel or an interpretation of the Auth/P08 business envelope.
  return Object.freeze({...meta,Body:Buffer.from(frame.body),Peer:Object.freeze({uid:record.server.profile.bridgeUID,pid:record.server.profile.bridgePID}),dataOnly:true,sourceVerified:false,operationVerified:false});
}
function endRecord(record){
  if(record.closed)return;record.closed=true;
  try{record.server.api.retire(record.native);}catch(error){record.server.failure??=error;}
}
function guardResponse(record,res){
  const write=res.write,end=res.end;let sent=0;
  const count=(chunk,encoding)=>{
    if(chunk===undefined||chunk===null)return;
    let size;if(typeof chunk==='string')size=Buffer.byteLength(chunk,typeof encoding==='string'?encoding:undefined);else if(types.isUint8Array(chunk))size=byteLength.call(chunk);else throw fail('opaque response bytes required');
    if(size>record.route.maxResponseBytes-sent){const error=fail('registered response byte budget exceeded');endRecord(record);res.destroy(error);throw error;}sent+=size;
  };
  res.write=function(chunk,encoding,...rest){count(chunk,encoding);return write.call(this,chunk,encoding,...rest);};
  res.end=function(chunk,encoding,...rest){count(chunk,encoding);return end.call(this,chunk,encoding,...rest);};
}
function listenRequest(state,req,res){
  const connection=state.connections.get(req.socket);
  if(state.retired||!connection||connection.used){req.socket.destroy();return;}
  connection.used=true;
  let record;
  try{
    const original=identity(req,req.socket,state.profile),handle=Object.freeze(Object.create(null));
    record={server:state,req,socket:req.socket,native:connection.native,identity:original,localIdentity:localIdentitySnapshot(req,original),route:state.profile.routes.get(original.url),handle,closed:false,holds:0,currentTail:Promise.resolve()};
    requests.set(req,record);callers.set(handle,record);connection.record=record;
    res.once('finish',()=>{if(state.profile.socialDirectory)record.socialResponseFinished=true;else endRecord(record);});
    res.once('close',()=>{if(!state.profile.socialDirectory||!res.writableFinished)endRecord(record);});req.once('aborted',()=>endRecord(record));
    guardResponse(record,res);
    const work=Promise.resolve().then(()=>{if(record.closed)throw fail('incoming response closed before handler');return state.handler(req,res);});
    state.handlers.add(work);work.catch(error=>{state.failure??=error;endRecord(record);res.destroy(error);}).finally(()=>state.handlers.delete(work));
    // A synchronous handler may start the original callback-based HTTP kernel.
    // It does not retire the caller: ownership lasts through response finish.
  }catch(error){state.failure??=error;if(record)endRecord(record);req.socket.destroy(error);}
}

async function openInboundServer(profile,handler,runtime,desktopTaskGrant=false,socialDirectory=false){
  const p=registration(profile,runtime,desktopTaskGrant,socialDirectory);if(typeof handler!=='function')throw fail('original incoming handler required');
  const api=runtime?{listen:native.listenTaskRuntime,accept:native.acceptTaskRuntime,take:native.takeTaskRuntimeFD,retireListener:native.retireTaskRuntimeListener,retire:native.retireTaskRuntime,current:native.currentTaskRuntime}:{listen:native.listenInbound,accept:native.acceptInbound,take:native.takeInboundFD,retireListener:native.retireListener,retire:native.retireInbound,current:native.currentInbound};
  const listener=api.listen({socketPath:p.socketPath,nodeUID:p.nodeUID,bridgeUID:p.bridgeUID,bridgePID:p.bridgePID,timeoutMs:p.acceptTimeoutMs});
  const server=http.createServer({maxHeaderSize:socialDirectory?SOCIAL_DIRECTORY_MAX_HEADER_BYTES:64<<10,requestTimeout:30000,headersTimeout:5000},(req,res)=>listenRequest(state,req,res));
  server.maxRequestsPerSocket=socialDirectory?0:1;
  if(socialDirectory){server.keepAliveTimeout=0;server.headersTimeout=5000;}
  server.on('clientError',(_error,socket)=>socket.destroy());
  const state={profile:p,listener,server,handler,api,runtime,pid:process.pid,retired:false,physicalJoined:false,physicalClosed:false,connections:new Map(),handlers:new Set(),currents:new Set(),failure:null,accept:null};
  const opaque=Object.freeze(Object.create(null));servers.set(opaque,state);
  state.accept=(async()=>{
    while(!state.retired){
      let accepted;
      try{accepted=await api.accept(listener);}catch(error){if(state.retired)break;if(error.code==='DENIED')continue;state.failure??=error;break;}
      if(!accepted)continue;
      if(state.retired||state.connections.size>=p.maxConnections){api.retire(accepted);continue;}
      let socket;
      try{const fd=api.take(accepted);try{socket=new net.Socket({fd,readable:true,writable:true});}catch(error){try{closeSync(fd);}catch{}throw error;}
        const connection={native:accepted,socket,used:false,record:null};
        connection.closed=new Promise(resolve=>socket.once('close',()=>{if(connection.record)endRecord(connection.record);else api.retire(accepted);state.connections.delete(socket);resolve();}));
        socket.on('error',()=>{});state.connections.set(socket,connection);
        // The private server is never returned. Only a native accepted fd can
        // reach its connection event and mint a request binding.
        server.emit('connection',socket);
      }catch(error){state.failure??=error;try{api.retire(accepted);}catch{}socket?.destroy();}
    }
  })();
  state.accept.catch(error=>{state.failure??=error;});return opaque;
}
export async function openInboundAuthorityServer(profile,handler){return openInboundServer(profile,handler,false);}
// Separate closed desktop-TaskGrant registration. It shares the original L/C
// transport, not Source/Grant authority, with the unchanged legacy two routes.
export async function openInboundDesktopTaskGrantServer(profile,handler){return openInboundServer(profile,handler,false,true);}
export async function openInboundSocialDirectoryServer(profile,handler){return openInboundServer(profile,handler,false,false,true);}
export async function openInboundTaskRuntimeServer(profile,handler){return openInboundServer(profile,handler,true);}
export function acquireInboundCaller(req,registeredServer){
  const record=req&&requests.get(req);if(!record||record.server.runtime)throw fail('original authority incoming request required');
  if(arguments.length>=2&&record.server!==serverState(registeredServer))throw fail('original registered listener instance required');
  assertRequest(record,req);record.holds++;return record.handle;
}
export function releaseInboundCaller(handle){const record=handle&&callers.get(handle);if(!record||record.server.runtime)throw fail('authority inbound handle required');if(record.holds>0)record.holds--;}
export function assertCurrentInboundCaller(req,handle,registeredServer){
  const record=handle&&callers.get(handle),registered=registeredServer&&servers.get(registeredServer);
  if(arguments.length!==3||!record||record.server.runtime||!registered||record.server!==registered||record.req!==req||requests.get(req)!==record||record.server.pid!==process.pid||record.holds<1||record.closed||record.server.retired||record.socialWaitStarted)throw fail('same acquired original caller and registered listener required');
  assertLocalIdentity(record,req);
}
export function currentInboundCaller(req,handle,registeredServer){
  const record=handle&&callers.get(handle);if(!record||record.server.runtime||requests.get(req)!==record||record.server.pid!==process.pid||record.closed||record.server.retired||record.socialWaitStarted)return Promise.reject(fail('same original incoming request and handle required'));
  if(arguments.length>=3){try{if(record.server!==serverState(registeredServer))throw fail('original registered listener instance required');}catch(error){return Promise.reject(error);}}
  const run=record.currentTail.then(async()=>{
    if(record.holds<1)throw fail('acquired original caller hold required');
    assertRequest(record,req);
    const frame=await native.currentInbound(record.native,{timeoutMs:record.server.profile.currentTimeoutMs,maxFrameBytes:record.server.profile.socialDirectory?SOCIAL_DIRECTORY_MAX_CONTROL_BYTES:record.route.maxRequestBytes+65536});
    assertRequest(record,req);return record.server.profile.socialDirectory?socialDirectoryMaterial(record,frame):material(record,frame);
  }).catch(error=>{endRecord(record);record.socket.destroy();throw error;});
  record.currentTail=run.catch(()=>{});record.server.currents.add(run);run.finally(()=>record.server.currents.delete(run)).catch(()=>{});return run;
}
function serverState(handle,runtime=false){const state=handle&&servers.get(handle);if(!state||state.runtime!==runtime||state.pid!==process.pid)throw fail('owned incoming server profile required');return state;}
export function retireInboundAuthorityServer(handle){
  retireServer(serverState(handle));
}
function retireServer(state){
  if(state.retired)return;state.retired=true;state.api.retireListener(state.listener);
  for(const connection of state.connections.values()){if(connection.record)endRecord(connection.record);else state.api.retire(connection.native);connection.socket.destroy();}
}
async function joinServer(state){
  if(!state.retired)throw fail('retire incoming server before join');
  await state.accept;
  const results=await Promise.allSettled([...state.currents,...state.handlers,...[...state.connections.values()].map(c=>c.closed)]);
  // This fact is independent of an earlier handler/current rejection. It is
  // set only after all accepted work and owned descriptor close events join.
  state.physicalJoined=true;
  if(state.failure)throw state.failure;
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
}
export async function joinInboundAuthorityServer(handle){return joinServer(serverState(handle));}
export async function closeInboundAuthorityServer(handle){
  const state=serverState(handle);retireServer(state);
  try{await joinServer(state);}finally{if(state.physicalJoined)state.physicalClosed=true;}
}
// Read-only transport facts for this exact opaque listener. Rejections remain
// original errors; this getter neither authenticates a Source nor clears them.
export function inboundAuthorityServerLifetime(handle){
  const state=serverState(handle);
  return Object.freeze({retired:state.retired,physicalJoined:state.physicalJoined,physicalClosed:state.physicalClosed});
}
export function retireInboundSocialDirectoryServer(handle){
  const state=serverState(handle);if(!state.profile.socialDirectory)throw fail('original Social listener required');
  if(state.retired)return;state.retired=true;state.api.retireListener(state.listener);
  // Existing response/control capabilities must remain until the fixed W/A
  // release, actual Source loan close and Main's physical transport finish.
}
export async function joinInboundSocialDirectoryServer(handle){
  const state=serverState(handle);if(!state.profile.socialDirectory)throw fail('original Social listener required');return joinServer(state);
}
export async function closeInboundSocialDirectoryServer(handle){
  const state=serverState(handle);if(!state.profile.socialDirectory)throw fail('original Social listener required');retireInboundSocialDirectoryServer(handle);
  try{await joinServer(state);}finally{if(state.physicalJoined)state.physicalClosed=true;}
}
function socialDirectoryRecord(req,handle,registeredServer){
  const state=serverState(registeredServer),record=handle&&callers.get(handle);
  if(!state.profile.socialDirectory||!record||record.server!==state||record.req!==req||requests.get(req)!==record||record.closed||record.holds<1)throw fail('same held original Social request required');
  return record;
}
export function waitInboundSocialDirectoryReadRelease(req,handle,registeredServer){
  let record;try{record=socialDirectoryRecord(req,handle,registeredServer);if(!record.socialResponseFinished||record.socialWaitStarted)throw fail('one completed original Social response required');record.socialWaitStarted=true;}catch(error){return Promise.reject(error);}
  const run=record.currentTail.then(async()=>{
    const frame=await native.waitSocialDirectoryReadRelease(record.native,{timeoutMs:record.server.profile.currentTimeoutMs});
    socialDirectoryRecord(req,handle,registeredServer);
    record.socialReadRelease=Buffer.from(frame);return Buffer.from(frame);
  }).catch(error=>{record.socialFailure??=error;throw error;});
  return trackTask(record,run);
}
export function writeInboundSocialDirectoryClosedAck(req,handle,registeredServer,ownedACK){
  let record,frame;try{record=socialDirectoryRecord(req,handle,registeredServer);if(!record.socialReadRelease||record.socialAckStarted||!Buffer.isBuffer(ownedACK)||ownedACK.length!==81)throw fail('one original Social closure ACK required');frame=Buffer.from(ownedACK);record.socialAckStarted=true;}catch(error){return Promise.reject(error);}
  const run=record.currentTail.then(async()=>{
    socialDirectoryRecord(req,handle,registeredServer);
    await native.writeSocialDirectoryClosedAck(record.native,frame,{timeoutMs:record.server.profile.currentTimeoutMs});
    record.socialAckWritten=true;
    // Do not close the socket here: Main must validate the complete A while
    // this same actual Node endpoint is still present, then close its own fds.
  }).catch(error=>{record.socialFailure??=error;throw error;});
  return trackTask(record,run);
}
export function retireInboundTaskRuntimeServer(handle){retireServer(serverState(handle,true));}
export async function joinInboundTaskRuntimeServer(handle){return joinServer(serverState(handle,true));}
export async function closeInboundTaskRuntimeServer(handle){retireInboundTaskRuntimeServer(handle);await joinInboundTaskRuntimeServer(handle);}

function taskRecord(req,handle,registeredServer){
  const record=handle&&callers.get(handle),state=serverState(registeredServer,true);
  if(!record||record.server!==state||record.req!==req||requests.get(req)!==record||record.holds<1||record.closed||state.retired||record.runtimeTerminal)throw fail('same held original runtime caller required');
  assertLocalIdentity(record,req);return record;
}
export function acquireInboundTaskRuntimeCaller(req,registeredServer){
  const state=serverState(registeredServer,true),record=req&&requests.get(req);
  if(!record||record.server!==state||record.runtimeTerminal)throw fail('same registered runtime request required');
  assertRequest(record,req);record.holds++;return record.handle;
}
export function releaseInboundTaskRuntimeCaller(handle){
  const record=handle&&callers.get(handle);if(!record||!record.server.runtime||record.server.pid!==process.pid)throw fail('owned runtime caller required');
  if(record.holds>0)record.holds--;
}
export function assertCurrentInboundTaskRuntimeCaller(req,handle,registeredServer){taskRecord(req,handle,registeredServer);}
function trackTask(record,run){record.currentTail=run.catch(()=>{});record.server.currents.add(run);run.finally(()=>record.server.currents.delete(run)).catch(()=>{});return run;}
export function currentInboundTaskRuntimeCaller(req,handle,registeredServer){
  let record;try{record=taskRecord(req,handle,registeredServer);}catch(error){return Promise.reject(error);}
  const run=record.currentTail.then(async()=>{
    taskRecord(req,handle,registeredServer);
    const frame=await record.server.api.current(record.native,{timeoutMs:record.server.profile.currentTimeoutMs,maxFrameBytes:record.route.maxRequestBytes+65536});
    taskRecord(req,handle,registeredServer);return runtimeMaterial(record,frame);
  }).catch(error=>{record.server.failure??=error;endRecord(record);record.socket.destroy();throw error;});
  return trackTask(record,run);
}
export class InboundTaskRuntimeError extends Error {
  constructor(code,message,{cause,dispatchPossible=false,responseData,responseProgress}={}){
    super(message,{cause});this.name='InboundTaskRuntimeError';this.code=code;this.dispatchPossible=dispatchPossible;
    if(responseData!==undefined)this.responseData=responseData;
    if(responseProgress!==undefined)this.responseProgress=Object.freeze({...responseProgress});
  }
}
function runtimeBytes(input){
  if(!types.isUint8Array(input)||types.isProxy(input))throw fail('owned runtime Uint8Array required');
  const buffer=bufferGetter.call(input),offset=offsetGetter.call(input),length=byteLength.call(input);
  if(types.isSharedArrayBuffer(buffer)||length<1||length>1048576)throw fail('runtime request bytes out of bounds');
  return Buffer.from(new Uint8Array(buffer,offset,length));
}
export function exchangeInboundTaskRuntime(req,handle,registeredServer,operationID,ownedUint8){
  let record,operation,body;
  try{record=taskRecord(req,handle,registeredServer);operation=taskOperations.indexOf(operationID)+1;if(typeof operationID!=='string'||operation<1)throw fail('closed runtime operation required');body=runtimeBytes(ownedUint8);}
  catch(cause){return Promise.reject(new InboundTaskRuntimeError('RUNTIME_DENIED','runtime dispatch refused',{cause}));}
  const run=record.currentTail.then(async()=>{
    try{taskRecord(req,handle,registeredServer);}catch(cause){throw new InboundTaskRuntimeError('RUNTIME_DENIED','queued runtime dispatch refused',{cause});}
    let result;
    try{result=await native.exchangeTaskRuntime(record.native,operation,body,{timeoutMs:record.server.profile.currentTimeoutMs,maxResponseBytes:33554432});}
    catch(cause){throw new InboundTaskRuntimeError('RUNTIME_UNAVAILABLE','original runtime exchange failed',{cause,dispatchPossible:cause.dispatchPossible===true,responseData:cause.responseData,responseProgress:cause.responseProgress});}
    const data=Object.freeze({...result,contentType:'application/json',sourceVerified:false,operationVerified:false});
    try{taskRecord(req,handle,registeredServer);}catch(cause){throw new InboundTaskRuntimeError('RUNTIME_RETIRED','original runtime caller retired after dispatch',{cause,dispatchPossible:true,responseData:data});}
    if(operation===8)record.runtimeTerminal=true;
    if(data.errorPresent)throw new InboundTaskRuntimeError('RUNTIME_REMOTE_ERROR','runtime returned opaque original error DATA',{dispatchPossible:true,responseData:data});
    return data;
  }).catch(error=>{
    if(error.code!=='RUNTIME_REMOTE_ERROR'){record.server.failure??=error;record.runtimeTerminal=true;endRecord(record);record.socket.destroy();}
    throw error;
  });
  return trackTask(record,run);
}
