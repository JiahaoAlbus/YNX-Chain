// Private transport bridge only. OS credentials do not prove a Grant, Source,
// receipt, operation, account or Agent. The original authority owns those facts.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {closeSync} from 'node:fs';
import {createRequire} from 'node:module';
import {types} from 'node:util';

const native = createRequire(import.meta.url)('./build/caller.node');
const callers = new WeakMap();
const routes = Object.freeze({effect:'/internal/auth/task-grants/effect','effect-query':'/internal/auth/task-grants/effect-query'});
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typed,'buffer').get;
const offsetOf = Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const lengthOf = Object.getOwnPropertyDescriptor(typed,'byteLength').get;
const setBytes = Uint8Array.prototype.set;

export class CallerTransportError extends Error {
  constructor(code,message,{cause,dispatchPossible=false,responseProgress={bytesReceived:0,requestBytesWritten:0},cleanupErrors=[]}={}) {
    super(message,{cause}); this.name='CallerTransportError'; this.code=code;
    this.dispatchPossible=dispatchPossible;
    this.responseProgress=Object.freeze({...responseProgress});
    this.cleanupErrors=Object.freeze([...cleanupErrors]);
  }
}
function denied(message) { return new CallerTransportError('DENIED',message); }
function dataRecord(value,keys) {
  if (!value || typeof value!=='object' || types.isProxy(value)) throw denied('plain registered DATA required');
  const descriptors=Object.getOwnPropertyDescriptors(value), actual=Reflect.ownKeys(descriptors);
  if (actual.length!==keys.length || keys.some(k=>!descriptors[k] || !Object.hasOwn(descriptors[k],'value')) || actual.some(k=>typeof k!=='string'||!keys.includes(k))) throw denied('exact registered DATA fields required');
  return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
function integer(value,min,max) { if (!Number.isSafeInteger(value)||value<min||value>max) throw denied('bounded registered integer required'); return value; }
function registration(input) {
  const p=dataRecord(input,['socketPath','serverUID','serverPID','service','connectTimeoutMs','requestTimeoutMs','routes']);
  if (typeof p.socketPath!=='string'||!path.isAbsolute(p.socketPath)||path.normalize(p.socketPath)!==p.socketPath||/[\0\r\n]/.test(p.socketPath)||Buffer.byteLength(p.socketPath)>=(process.platform==='darwin'?104:108)) throw denied('exact bounded absolute Unix socket path required');
  if (typeof p.service!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(p.service)) throw denied('exact registered service token required');
  integer(p.serverUID,0,0xffffffff); integer(p.serverPID,1,0x7fffffff);
  integer(p.connectTimeoutMs,1,30000); integer(p.requestTimeoutMs,1,300000);
  if (!Array.isArray(p.routes)||types.isProxy(p.routes)||p.routes.length!==2) throw denied('both exact authority routes required');
  const list=Object.getOwnPropertyDescriptors(p.routes);
  if (Reflect.ownKeys(list).length!==3 || !Object.hasOwn(list[0]||{},'value')||!Object.hasOwn(list[1]||{},'value')) throw denied('owned registered route list required');
  const operations=new Map();
  for (const item of [list[0].value,list[1].value]) {
    const r=dataRecord(item,['id','method','path','maxRequestBytes','maxResponseBytes']);
    if (typeof r.id!=='string'||typeof r.method!=='string'||typeof r.path!=='string'||!Object.hasOwn(routes,r.id)||r.method!=='POST'||r.path!==routes[r.id]||operations.has(r.id)) throw denied('exact authority route required');
    integer(r.maxRequestBytes,1,16<<20); integer(r.maxResponseBytes,1,16<<20);
    operations.set(r.id,Object.freeze(r));
  }
  return Object.freeze({...p,routes:Object.freeze([...operations.values()]),operations});
}
function captureBytes(input,limit) {
  if (!types.isUint8Array(input)||types.isProxy(input)) throw denied('owned opaque Uint8Array required');
  const buffer=bufferOf.call(input), offset=offsetOf.call(input), length=lengthOf.call(input);
  if (types.isSharedArrayBuffer(buffer)) throw denied('shared request bytes refused');
  if (length<1||length>limit) throw new CallerTransportError('BOUNDS','request byte budget exceeded');
  const copy=Buffer.alloc(length);
  setBytes.call(copy,new Uint8Array(buffer,offset,length));
  return copy;
}
function stateFor(handle) {
  const state=handle&&typeof handle==='object'?callers.get(handle):undefined;
  if (!state || state.pid!==process.pid) throw denied('private native caller handle required');
  return state;
}
function signalReason(signal) { return signal?.reason??new Error('caller operation cancelled'); }
function signalOption(options) {
  if (options===undefined) return undefined;
  const {signal}=dataRecord(options,['signal']);
  if (signal!==undefined && !(signal instanceof AbortSignal)) throw denied('AbortSignal required');
  return signal;
}
function transportFailure(cause,dispatchPossible,responseProgress={bytesReceived:0,requestBytesWritten:0}) {
  if (cause instanceof CallerTransportError) {
    // Never reduce an earlier uncertain dispatch or discard its first cause.
    cause.dispatchPossible ||= dispatchPossible;
    cause.responseProgress=Object.freeze({bytesReceived:Math.max(cause.responseProgress.bytesReceived,responseProgress.bytesReceived),requestBytesWritten:Math.max(cause.responseProgress.requestBytesWritten,responseProgress.requestBytesWritten)});
    return cause;
  }
  return new CallerTransportError(cause?.name==='AbortError'?'CANCELLED':'UNAVAILABLE','private authority transport failed',{cause,dispatchPossible,responseProgress});
}

// One handle owns one actual OS connection and permits one HTTP request. A
// query opens another explicitly registered handle; it is never a retry path.
export async function openAuthorityCaller(profile,options) {
  const p=registration(profile), signal=signalOption(options);
  if (signal?.aborted) throw new CallerTransportError('CANCELLED','caller connect cancelled',{cause:signalReason(signal)});
  let aborted=false;
  const onAbort=()=>{aborted=true;};
  signal?.addEventListener('abort',onAbort,{once:true});
  let handle;
  try {
    // Native connect is asynchronous and bounded. On cancellation we join it
    // and close its owned descriptors before rejecting; no orphan worker/fd.
    handle=await native.connectUnix({socketPath:p.socketPath,serverUID:p.serverUID,serverPID:p.serverPID,timeoutMs:p.connectTimeoutMs});
    if (aborted||signal?.aborted) {
      native.retire(handle);
      throw new CallerTransportError('CANCELLED','caller connect cancelled',{cause:signalReason(signal)});
    }
    native.current(handle);
    const fd=native.takeFD(handle);
    let socket;
    try { socket=new net.Socket({fd,readable:true,writable:true}); }
    catch (cause) { try { closeSync(fd); } catch {} throw cause; }
    const opaque=Object.freeze(Object.create(null));
    const socketClosed=new Promise(resolve=>socket.once('close',resolve));
    const state={pid:process.pid,profile:p,native:handle,socket,socketClosed,phase:'OPEN',used:false,work:null,request:null,retirePromise:null};
    // An idle socket's asynchronous error has an owner even before dispatch.
    socket.on('error',error=>{state.socketError??=error;});
    callers.set(opaque,state);
    return opaque;
  } catch (cause) {
    if (handle) { try { native.retire(handle); } catch {} }
    if (aborted||signal?.aborted) throw new CallerTransportError('CANCELLED','caller connect cancelled',{cause:signalReason(signal)});
    throw transportFailure(cause,false);
  } finally { signal?.removeEventListener('abort',onAbort); }
}

export function currentAuthorityCaller(handle) {
  const state=stateFor(handle);
  if (state.phase!=='OPEN'&&state.phase!=='INFLIGHT') throw denied('caller retired');
  if (state.socket.destroyed||state.socketError) throw transportFailure(state.socketError||denied('caller socket closed'),false);
  return Object.freeze({...native.current(state.native),service:state.profile.service});
}

function shutdown(state) {
  state.phase='RETIRED';
  const errors=[];
  try { native.retire(state.native); } catch (e) { errors.push(e); }
  state.socket.destroy();
  state.agent?.destroy();
  return errors;
}

export function exchangeAuthority(handle,operation,input,options) {
  let state, route, body, signal;
  try {
    state=stateFor(handle); signal=signalOption(options);
    if (state.phase!=='OPEN'||state.used) throw denied('caller handle already consumed or retired');
    if (typeof operation!=='string'||!state.profile.operations.has(operation)) throw denied('unregistered authority operation');
    route=state.profile.operations.get(operation);
    body=captureBytes(input,route.maxRequestBytes);
    currentAuthorityCaller(handle);
    if (signal?.aborted) throw new CallerTransportError('CANCELLED','caller request cancelled',{cause:signalReason(signal)});
    state.used=true; state.phase='INFLIGHT';
  } catch (cause) { return Promise.reject(transportFailure(cause,false)); }

  state.work=new Promise((resolve,reject)=>{
    let request, response, finished=false, dispatchPossible=false, received=0;
    const writtenAtStart=state.socket.bytesWritten;
    const progress=()=>({bytesReceived:received,requestBytesWritten:Math.max(0,state.socket.bytesWritten-writtenAtStart)});
    const settle=(cause,result)=>{
      if (finished) return;
      finished=true; clearTimeout(timer); signal?.removeEventListener('abort',onAbort);
      const responseProgress=progress();
      const cleanup=shutdown(state);
      response?.destroy(); request?.destroy(); state.request=null;
      // Destroy schedules libuv descriptor release. Join its close event before
      // returning either response DATA or the original uncertain failure.
      state.socketClosed.then(()=>{
        if (cause) {
          const first=transportFailure(cause,dispatchPossible,responseProgress);
          if (cleanup.length) first.cleanupErrors=Object.freeze([...first.cleanupErrors,...cleanup]);
          reject(first);
        } else if (cleanup.length) {
          reject(new CallerTransportError('UNAVAILABLE','caller descriptor cleanup failed',{cause:cleanup[0],cleanupErrors:cleanup.slice(1),dispatchPossible,responseProgress}));
        } else resolve(result);
      });
    };
    const onAbort=()=>settle(new CallerTransportError('CANCELLED','caller request cancelled',{cause:signalReason(signal)}));
    const timer=setTimeout(()=>settle(new CallerTransportError('TIMEOUT','caller request timed out')),state.profile.requestTimeoutMs);
    signal?.addEventListener('abort',onAbort,{once:true});
    try {
      currentAuthorityCaller(handle);
      const agent=new http.Agent({keepAlive:false,maxSockets:1,maxFreeSockets:0});
      let transferred=false;
      agent.createConnection=()=>{
        if (transferred) throw denied('one owned connection only; reconnect refused');
        transferred=true;
        return state.socket;
      };
      state.agent=agent;
      request=http.request({
        method:route.method,path:route.path,host:state.profile.service,port:80,
        agent,maxHeaderSize:64<<10,
        headers:{Host:state.profile.service,'Content-Type':'application/json',Accept:'application/json','Content-Length':String(body.length),Connection:'close'},
      },incoming=>{
        response=incoming;
        const contentTypes=incoming.headersDistinct['content-type']||[];
        if (contentTypes.length!==1||contentTypes[0]!=='application/json') return settle(new CallerTransportError('DENIED','unregistered response Content-Type'));
        const declared=incoming.headers['content-length'];
        if (declared!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(declared)||BigInt(declared)>BigInt(route.maxResponseBytes))) return settle(new CallerTransportError('BOUNDS','response byte budget exceeded'));
        const chunks=[];
        incoming.on('data',chunk=>{
          received+=chunk.length;
          if (received>route.maxResponseBytes) return settle(new CallerTransportError('BOUNDS','response byte budget exceeded'));
          chunks.push(chunk);
        });
        incoming.once('error',error=>settle(error));
        // Node emits the original stream error after its 'aborted' event.
        // Settling at 'aborted' would erase that first concrete failure.
        incoming.once('close',()=>{
          if (!incoming.complete) {
            const cause=new Error('response closed before completion');
            cause.code='ERR_RESPONSE_INCOMPLETE';
            settle(cause);
          }
        });
        incoming.once('end',()=>{
          if (!incoming.complete) return settle(new CallerTransportError('UNAVAILABLE','response incomplete'));
          settle(null,Object.freeze({statusCode:incoming.statusCode,contentType:contentTypes[0],body:Buffer.concat(chunks,received),peer:Object.freeze({uid:state.profile.serverUID,pid:state.profile.serverPID}),service:state.profile.service,dataOnly:true,sourceVerified:false,operationVerified:false}));
        });
      });
      state.request=request;
      request.once('error',error=>settle(error));
      currentAuthorityCaller(handle);
      if (signal?.aborted) return onAbort();
      // Once handed to the HTTP engine, errors can no longer prove no dispatch.
      dispatchPossible=true;
      request.end(body);
    } catch (cause) { settle(cause); }
  });
  // Retire joins the original promise without causing an unhandled rejection.
  state.work.catch(()=>{});
  return state.work;
}

export function retireAuthorityCaller(handle) {
  const state=stateFor(handle);
  if (state.retirePromise) return state.retirePromise;
  const cleanup=shutdown(state);
  // Preserve the original in-flight failure object/cause, rather than masking
  // uncertain response progress with an independent generic drain error. The
  // SDK's error.partial means an owned native member and is never used here.
  state.retirePromise=(async()=>{
    let first;
    if (state.work) { try { await state.work; } catch(error) { first=error; } }
    await state.socketClosed;
    if (first) throw first;
    if (cleanup.length) throw new CallerTransportError('UNAVAILABLE','caller retire failed',{cause:cleanup[0],cleanupErrors:cleanup.slice(1)});
  })();
  return state.retirePromise;
}
