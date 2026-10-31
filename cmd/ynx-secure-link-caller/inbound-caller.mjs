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

const native=createRequire(import.meta.url)('./build/caller.node');
const servers=new WeakMap(),requests=new WeakMap(),callers=new WeakMap();
const headersGetter=Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype,'headers').get;
const routes=new Set(['/internal/auth/task-grants/effect','/internal/auth/task-grants/effect-query']);
const decoder=new TextDecoder('utf-8',{fatal:true});
const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
function fail(message,cause){const e=new Error(message,{cause});e.code='INBOUND_DENIED';return e;}
function exact(value,keys){
  if(!value||typeof value!=='object'||types.isProxy(value))throw fail('plain inbound registration/material required');
  const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k))||keys.some(k=>!fields[k]||!Object.hasOwn(fields[k],'value')))throw fail('exact inbound DATA fields required');
  return Object.fromEntries(keys.map(k=>[k,fields[k].value]));
}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('bounded inbound integer required');return value;}
function registration(input){
  const p=exact(input,['socketPath','nodeUID','bridgeUID','bridgePID','service','acceptTimeoutMs','currentTimeoutMs','maxConnections','routes']);
  if(typeof p.socketPath!=='string'||!path.isAbsolute(p.socketPath)||path.normalize(p.socketPath)!==p.socketPath||/[\0\r\n]/.test(p.socketPath)||Buffer.byteLength(p.socketPath)>=(process.platform==='darwin'?104:108))throw fail('private exact socket path required');
  if(p.nodeUID!==process.geteuid())throw fail('actual Node UID required');
  integer(p.bridgeUID,0,0xffffffff);integer(p.bridgePID,1,0x7fffffff);integer(p.acceptTimeoutMs,1,30000);integer(p.currentTimeoutMs,1,30000);integer(p.maxConnections,1,64);
  if(typeof p.service!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(p.service))throw fail('exact registered service required');
  if(!Array.isArray(p.routes)||types.isProxy(p.routes)||p.routes.length!==2)throw fail('two exact registered authority routes required');
  const list=Object.getOwnPropertyDescriptors(p.routes);
  if(Reflect.ownKeys(list).length!==3||!Object.hasOwn(list[0]||{},'value')||!Object.hasOwn(list[1]||{},'value'))throw fail('owned route list required');
  const selected=new Map();
  for(const item of [list[0].value,list[1].value]){
    const r=exact(item,['method','path','maxRequestBytes','maxResponseBytes']);
    if(r.method!=='POST'||typeof r.path!=='string'||!routes.has(r.path)||selected.has(r.path))throw fail('exact incoming method/path required');
    integer(r.maxRequestBytes,1,16<<20);integer(r.maxResponseBytes,1,16<<20);selected.set(r.path,Object.freeze(r));
  }
  return Object.freeze({...p,routes:selected});
}
function valueOf(req,key){const d=Object.getOwnPropertyDescriptor(req,key);if(!d||!Object.hasOwn(d,'value'))throw fail('original request field required');return d.value;}
function rawHeaderPairs(raw){if(!Array.isArray(raw)||raw.length>256||raw.some(v=>typeof v!=='string'))throw fail('bounded original headers required');return [...raw];}
function identity(req,socket,profile){
  const method=valueOf(req,'method'),url=valueOf(req,'url'),raw=valueOf(req,'rawHeaders');
  if(valueOf(req,'socket')!==socket||method!=='POST'||!profile.routes.has(url)||req.httpVersion!=='1.1')throw fail('original exact incoming route required');
  if(Object.hasOwn(req,'headers'))throw fail('original headers accessor required');
  const headers=headersGetter.call(req),pairs=rawHeaderPairs(raw);
  const counts=new Map();
  for(let n=0;n<pairs.length;n+=2){const k=pairs[n].toLowerCase();counts.set(k,(counts.get(k)||0)+1);if(k==='forwarded'||k.startsWith('x-forwarded-')||k.startsWith('x-ynx-peer-')||k.startsWith('x-ynx-service-')||k.startsWith('x-ssl-')||k.startsWith('x-tls-'))throw fail('proxy identity headers refused');}
  if(counts.get('host')!==1||headers.host!==profile.service||counts.get('content-type')!==1||headers['content-type']!=='application/json'||headers.upgrade)throw fail('registered incoming Host/content type required');
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
function endRecord(record){
  if(record.closed)return;record.closed=true;
  try{native.retireInbound(record.native);}catch(error){record.server.failure??=error;}
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
    record={server:state,req,socket:req.socket,native:connection.native,identity:original,route:state.profile.routes.get(original.url),handle,closed:false,holds:0,currentTail:Promise.resolve()};
    requests.set(req,record);callers.set(handle,record);connection.record=record;
    res.once('finish',()=>endRecord(record));res.once('close',()=>endRecord(record));req.once('aborted',()=>endRecord(record));
    guardResponse(record,res);
    const work=Promise.resolve().then(()=>{if(record.closed)throw fail('incoming response closed before handler');return state.handler(req,res);});
    state.handlers.add(work);work.catch(error=>{state.failure??=error;endRecord(record);res.destroy(error);}).finally(()=>state.handlers.delete(work));
    // A synchronous handler may start the original callback-based HTTP kernel.
    // It does not retire the caller: ownership lasts through response finish.
  }catch(error){state.failure??=error;if(record)endRecord(record);req.socket.destroy(error);}
}

export async function openInboundAuthorityServer(profile,handler){
  const p=registration(profile);if(typeof handler!=='function')throw fail('original incoming handler required');
  const listener=native.listenInbound({socketPath:p.socketPath,nodeUID:p.nodeUID,bridgeUID:p.bridgeUID,bridgePID:p.bridgePID,timeoutMs:p.acceptTimeoutMs});
  const server=http.createServer({maxHeaderSize:64<<10,requestTimeout:30000,headersTimeout:5000},(req,res)=>listenRequest(state,req,res));
  server.maxRequestsPerSocket=1;
  server.on('clientError',(_error,socket)=>socket.destroy());
  const state={profile:p,listener,server,handler,pid:process.pid,retired:false,connections:new Map(),handlers:new Set(),currents:new Set(),failure:null,accept:null};
  const opaque=Object.freeze(Object.create(null));servers.set(opaque,state);
  state.accept=(async()=>{
    while(!state.retired){
      let accepted;
      try{accepted=await native.acceptInbound(listener);}catch(error){if(state.retired)break;if(error.code==='DENIED')continue;state.failure??=error;break;}
      if(!accepted)continue;
      if(state.retired||state.connections.size>=p.maxConnections){native.retireInbound(accepted);continue;}
      let socket;
      try{const fd=native.takeInboundFD(accepted);try{socket=new net.Socket({fd,readable:true,writable:true});}catch(error){try{closeSync(fd);}catch{}throw error;}
        const connection={native:accepted,socket,used:false,record:null};
        connection.closed=new Promise(resolve=>socket.once('close',()=>{if(connection.record)endRecord(connection.record);else native.retireInbound(accepted);state.connections.delete(socket);resolve();}));
        socket.on('error',()=>{});state.connections.set(socket,connection);
        // The private server is never returned. Only a native accepted fd can
        // reach its connection event and mint a request binding.
        server.emit('connection',socket);
      }catch(error){state.failure??=error;try{native.retireInbound(accepted);}catch{}socket?.destroy();}
    }
  })();
  state.accept.catch(error=>{state.failure??=error;});return opaque;
}
export function acquireInboundCaller(req,registeredServer){
  const record=req&&requests.get(req);if(!record)throw fail('original incoming request required');
  if(arguments.length>=2&&record.server!==serverState(registeredServer))throw fail('original registered listener instance required');
  assertRequest(record,req);record.holds++;return record.handle;
}
export function releaseInboundCaller(handle){const record=handle&&callers.get(handle);if(!record)throw fail('inbound handle required');if(record.holds>0)record.holds--;}
export function currentInboundCaller(req,handle,registeredServer){
  const record=handle&&callers.get(handle);if(!record||requests.get(req)!==record||record.server.pid!==process.pid)return Promise.reject(fail('same original incoming request and handle required'));
  if(arguments.length>=3){try{if(record.server!==serverState(registeredServer))throw fail('original registered listener instance required');}catch(error){return Promise.reject(error);}}
  const run=record.currentTail.then(async()=>{
    if(record.holds<1)throw fail('acquired original caller hold required');
    assertRequest(record,req);
    const frame=await native.currentInbound(record.native,{timeoutMs:record.server.profile.currentTimeoutMs,maxFrameBytes:record.route.maxRequestBytes+65536});
    assertRequest(record,req);return material(record,frame);
  }).catch(error=>{endRecord(record);record.socket.destroy();throw error;});
  record.currentTail=run.catch(()=>{});record.server.currents.add(run);run.finally(()=>record.server.currents.delete(run)).catch(()=>{});return run;
}
function serverState(handle){const state=handle&&servers.get(handle);if(!state||state.pid!==process.pid)throw fail('owned incoming server required');return state;}
export function retireInboundAuthorityServer(handle){
  const state=serverState(handle);if(state.retired)return;state.retired=true;native.retireListener(state.listener);
  for(const connection of state.connections.values()){if(connection.record)endRecord(connection.record);else native.retireInbound(connection.native);connection.socket.destroy();}
}
export async function joinInboundAuthorityServer(handle){
  const state=serverState(handle);if(!state.retired)throw fail('retire incoming server before join');
  await state.accept;
  const results=await Promise.allSettled([...state.currents,...state.handlers,...[...state.connections.values()].map(c=>c.closed)]);
  if(state.failure)throw state.failure;
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
}
export async function closeInboundAuthorityServer(handle){retireInboundAuthorityServer(handle);await joinInboundAuthorityServer(handle);}
