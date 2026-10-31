import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {mkdtemp,chmod,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {openAuthorityCaller,currentAuthorityCaller,exchangeAuthority,retireAuthorityCaller,CallerTransportError} from './private-caller.mjs';

function profile(socketPath) {
  return {socketPath,serverUID:process.geteuid(),serverPID:process.pid,service:'isolated-auth',connectTimeoutMs:1000,requestTimeoutMs:1000,routes:[
    {id:'effect',method:'POST',path:'/internal/auth/task-grants/effect',maxRequestBytes:1024,maxResponseBytes:1024},
    {id:'effect-query',method:'POST',path:'/internal/auth/task-grants/effect-query',maxRequestBytes:512,maxResponseBytes:512},
  ]};
}
async function fixture(t,handler,{raw=false}={}) {
  // Short private path also fits Darwin's 104-byte sockaddr_un.sun_path.
  const directory=await mkdtemp(path.join('/tmp','ynx-native-caller-'));
  await chmod(directory,0o700);
  const socketPath=path.join(directory,'caller.sock');
  const server=raw?net.createServer(handler):http.createServer(handler);
  server.listen(socketPath); await once(server,'listening'); await chmod(socketPath,0o600);
  t.after(async()=>{server.closeAllConnections?.(); await new Promise(resolve=>server.close(resolve)); await rm(directory,{recursive:true,force:true});});
  return {socketPath,server,profile:profile(socketPath)};
}
async function consume(r) {const chunks=[]; for await(const chunk of r)chunks.push(chunk);return Buffer.concat(chunks);}
async function closeCaller(handle) {await retireAuthorityCaller(handle).catch(()=>{});}

test('actual native UID/PID and opaque exact HTTP routes are DATA only',async t=>{
  let calls=0;
  const input=Buffer.from('{ "originalOp":"same-original", "signed":"opaque" }');
  const output=Buffer.from('{"dataOnly":true,"operationVerified":false,"sourceVerified":false}');
  const f=await fixture(t,async(r,w)=>{
    calls++;
    assert.equal(r.headers.host,'isolated-auth');
    assert.equal(r.method,'POST');
    assert.equal(r.url,'/internal/auth/task-grants/effect');
    assert.equal(r.headers['content-type'],'application/json');
    assert.equal(r.headers['content-length'],String(input.length));
    assert.equal(r.headers['x-ynx-service-id'],undefined);
    assert.deepEqual(await consume(r),input);
    w.setHeader('Content-Type','application/json');w.end(output);
  });
  const supplied=f.profile;
  const handle=await openAuthorityCaller(supplied);
  t.after(()=>closeCaller(handle));
  supplied.service='changed'; supplied.routes[0].path='/changed'; supplied.routes[0].maxRequestBytes=1;
  assert.deepEqual(currentAuthorityCaller(handle),{selfPID:process.pid,selfUID:process.geteuid(),peerPID:process.pid,peerUID:process.geteuid(),service:'isolated-auth'});
  const result=await exchangeAuthority(handle,'effect',input);
  assert.equal(result.statusCode,200);assert.deepEqual(result.body,output);
  assert.equal(result.dataOnly,true);assert.equal(result.sourceVerified,false);assert.equal(result.operationVerified,false);
  assert.equal(calls,1);assert.throws(()=>currentAuthorityCaller(handle));
  await assert.rejects(exchangeAuthority(handle,'effect',input),e=>e.dispatchPossible===false);
  await retireAuthorityCaller(handle);
  assert.equal((await lstat(f.socketPath)).isSocket(),true);
});

test('actual peer PID/UID mismatch and unbranded/JSON/copied handles are refused',async t=>{
  const f=await fixture(t,(_r,w)=>{w.end();});
  await assert.rejects(openAuthorityCaller({...f.profile,serverPID:process.pid+100000}),e=>e.dispatchPossible===false&&e.cause?.code==='UNAVAILABLE');
  await assert.rejects(openAuthorityCaller({...f.profile,serverUID:process.geteuid()+1}),e=>e.dispatchPossible===false);
  const handle=await openAuthorityCaller(f.profile);t.after(()=>closeCaller(handle));
  for(const forged of [{},JSON.parse(JSON.stringify(handle)),{...handle},Object.create(handle),{fd:123,peerPID:process.pid,peerUID:process.geteuid()}]) {
    assert.throws(()=>currentAuthorityCaller(forged));
    await assert.rejects(exchangeAuthority(forged,'effect',Buffer.from('{}')),e=>e.dispatchPossible===false);
  }
  const native=createRequire(import.meta.url)('./build/caller.node');
  for(const forged of [{},JSON.parse(JSON.stringify(handle)),{...handle}]) assert.throws(()=>native.current(forged));
});

test('registration rejects hooks, arbitrary routes, URLs, headers and limit aliases',async t=>{
  const f=await fixture(t,(_r,w)=>w.end());
  for(const mutate of [
    p=>{p.headers={'X-YNX-Service-ID':'fake'};},p=>{p.createConnection=()=>{};},p=>{p.fd=4;},
    p=>{p.routes[0].path+='?query=1';},p=>{p.routes[0].method='GET';},p=>{p.routes[0].id='arbitrary';},
    p=>{p.service='http://localhost';},p=>{p.requestTimeoutMs=Infinity;},p=>{p.routes[0].maxRequestBytes=0;},
  ]) {const p=structuredClone(f.profile);mutate(p);await assert.rejects(openAuthorityCaller(p),e=>e.dispatchPossible===false);}
  let touched=0;
  const hooked={...f.profile};Object.defineProperty(hooked,'socketPath',{get(){touched++;throw Error('hook');},enumerable:true});
  await assert.rejects(openAuthorityCaller(hooked));assert.equal(touched,0);
});

test('retire forbids dispatch, joins in-flight failure and preserves first cause',async t=>{
  let calls=0;let entered;
  const entry=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,async(r,_w)=>{calls++;await consume(r);entered();});
  const h=await openAuthorityCaller(f.profile);
  const request=exchangeAuthority(h,'effect',Buffer.from('{}'));
  await entry;
  const drain=retireAuthorityCaller(h);
  let original;
  await assert.rejects(request,e=>{original=e;return e.dispatchPossible&&e.responseProgress.requestBytesWritten>0&&!Object.hasOwn(e,'partial');});
  await assert.rejects(drain,e=>e===original);
  await assert.rejects(exchangeAuthority(h,'effect-query',Buffer.from('{}')),e=>!e.dispatchPossible);
  assert.equal(calls,1);
  const idle=await openAuthorityCaller(f.profile);await retireAuthorityCaller(idle);
  await assert.rejects(exchangeAuthority(idle,'effect',Buffer.from('{}')),e=>!e.dispatchPossible);
});

test('cancel and timeout are bounded and uncertain dispatch is never retried',async t=>{
  let calls=0;let entered;
  const entry=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,async(r,_w)=>{calls++;await consume(r);entered();});
  const handle=await openAuthorityCaller(f.profile);t.after(()=>closeCaller(handle));
  const controller=new AbortController();const reason=Error('original cancellation');
  const waiting=exchangeAuthority(handle,'effect',Buffer.from('{}'),{signal:controller.signal});
  await entry;controller.abort(reason);
  await assert.rejects(waiting,e=>e.code==='CANCELLED'&&e.cause===reason&&e.dispatchPossible&&e.responseProgress.requestBytesWritten>0&&!Object.hasOwn(e,'partial'));
  assert.equal(calls,1);
  const timeout=await openAuthorityCaller({...f.profile,requestTimeoutMs:40});t.after(()=>closeCaller(timeout));
  await assert.rejects(exchangeAuthority(timeout,'effect',Buffer.from('{}')),e=>e.code==='TIMEOUT'&&e.dispatchPossible);
  assert.equal(calls,2);
  const cancelled=new AbortController();cancelled.abort(reason);
  await assert.rejects(openAuthorityCaller(f.profile,{signal:cancelled.signal}),e=>e.code==='CANCELLED'&&!e.dispatchPossible&&e.cause===reason);
});

test('cancellation during native connect joins and releases every owned descriptor',async t=>{
  let calls=0;let closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const f=await fixture(t,(_r,w)=>{calls++;w.end();});
  f.server.once('connection',socket=>socket.once('close',closedResolve));
  const controller=new AbortController(), reason=Error('cancel native connect');
  const opening=openAuthorityCaller(f.profile,{signal:controller.signal});
  controller.abort(reason);
  await assert.rejects(opening,error=>error.code==='CANCELLED'&&error.cause===reason&&!error.dispatchPossible&&!Object.hasOwn(error,'partial'));
  await closed;
  assert.equal(calls,0);
});

test('independent operation body bounds, response MIME and redirect do not authorize',async t=>{
  let calls=0;let mode='normal';
  const f=await fixture(t,async(r,w)=>{
    calls++;const body=await consume(r);
    if(mode==='oversized'){w.setHeader('Content-Type','application/json');w.end('x'.repeat(65));return;}
    if(mode==='media'){w.setHeader('Content-Type','application/json; charset=utf-8');w.end('{}');return;}
    if(mode==='redirect'){w.statusCode=307;w.setHeader('Location','http://127.0.0.1:1/not-followed');}
    w.setHeader('Content-Type','application/json');w.end(body);
  });
  const p=structuredClone(f.profile);p.routes[0].maxRequestBytes=64;p.routes[0].maxResponseBytes=64;
  const tooLarge=await openAuthorityCaller(p);t.after(()=>closeCaller(tooLarge));
  await assert.rejects(exchangeAuthority(tooLarge,'effect',Buffer.alloc(65)),e=>e.code==='BOUNDS'&&!e.dispatchPossible);assert.equal(calls,0);
  for(const next of ['normal','oversized','media','redirect']) {
    mode=next;const h=await openAuthorityCaller(p);t.after(()=>closeCaller(h));
    const work=exchangeAuthority(h,'effect',Buffer.from('{}'));
    if(next==='oversized')await assert.rejects(work,e=>e.code==='BOUNDS'&&e.dispatchPossible);
    else if(next==='media')await assert.rejects(work,e=>e.code==='DENIED'&&e.dispatchPossible);
    else {const r=await work;assert.equal(r.statusCode,next==='redirect'?307:200);assert.deepEqual(r.body,Buffer.from('{}'));}
  }
  assert.equal(calls,4);
});

test('partial response / early disconnect stays UNKNOWN transport DATA and no query fallback',async t=>{
  let calls=0;
  const f=await fixture(t,socket=>socket.once('data',()=>{
    calls++;socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{"partial":');socket.end();
  }),{raw:true});
  const h=await openAuthorityCaller(f.profile);t.after(()=>closeCaller(h));
  await assert.rejects(exchangeAuthority(h,'effect',Buffer.from('{}')),e=>e instanceof CallerTransportError&&e.dispatchPossible&&e.responseProgress.bytesReceived>0&&e.cause!==undefined&&!Object.hasOwn(e,'partial'));
  assert.equal(calls,1);
});
