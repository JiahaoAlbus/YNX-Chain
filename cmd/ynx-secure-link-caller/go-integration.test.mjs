import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,chmod,rm,lstat} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {openAuthorityCaller,currentAuthorityCaller,exchangeAuthority,retireAuthorityCaller} from './private-caller.mjs';

async function peer(t,clientPID=process.pid,clientUID=process.geteuid()) {
  const executable=process.env.YNX_CALLER_GO_FIXTURE;
  assert.ok(executable,'run check.sh to build the actual Go transport peer');
  const directory=await mkdtemp('/tmp/ynx-node-go-caller-');await chmod(directory,0o700);
  const socketPath=path.join(directory,'peer.sock');
  const child=spawn(executable,[socketPath,String(clientUID),String(clientPID)],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const events=[], lines=createInterface({input:child.stdout});
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timer=setTimeout(()=>readyReject(Error('Go fixture start timeout: '+stderr)),3000);
  lines.on('line',line=>{const event=JSON.parse(line);events.push(event);if(event.event==='ready')readyResolve(event);});
  child.once('exit',code=>{if(!events.some(e=>e.event==='ready'))readyReject(Error('Go fixture exited '+code+': '+stderr));});
  t.after(async()=>{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}lines.close();await rm(directory,{recursive:true,force:true});});
  const actual=await ready;clearTimeout(timer);
  const registration={socketPath,serverUID:actual.uid,serverPID:actual.pid,service:'isolated-auth',connectTimeoutMs:1000,requestTimeoutMs:1000,routes:[
    {id:'effect',method:'POST',path:'/internal/auth/task-grants/effect',maxRequestBytes:4096,maxResponseBytes:4096},
    {id:'effect-query',method:'POST',path:'/internal/auth/task-grants/effect-query',maxRequestBytes:4096,maxResponseBytes:4096},
  ]};
  return {registration,events,socketPath};
}

test('actual Node native caller -> Go opaque LocalCaller has both OS UID/PID checks',async t=>{
  const fixture=await peer(t);
  const original=Buffer.from('{ "originalOp":"same", "grantRef":"original", "purpose":"PUBLIC transport DATA" }');
  for(const operation of ['effect','effect-query']) {
    const handle=await openAuthorityCaller(fixture.registration);
    const current=currentAuthorityCaller(handle);
    assert.equal(current.peerPID,fixture.registration.serverPID);assert.equal(current.selfPID,process.pid);
    const result=await exchangeAuthority(handle,operation,original);
    assert.equal(result.statusCode,200);assert.deepEqual(result.body,original);
    assert.equal(result.sourceVerified,false);assert.equal(result.operationVerified,false);
    await retireAuthorityCaller(handle);
  }
  const requests=fixture.events.filter(e=>e.event==='request');
  assert.deepEqual(requests.map(r=>r.path),['/internal/auth/task-grants/effect','/internal/auth/task-grants/effect-query']);
  for(const request of requests){assert.equal(request.peerPID,process.pid);assert.equal(request.peerUID,process.geteuid());}
  assert.equal((await lstat(fixture.socketPath)).isSocket(),true);
});

test('Go registration rejects a wrong actual Node PID before minting LocalCaller',async t=>{
  const fixture=await peer(t,process.pid+100000);
  let handle, openError;
  try {
    handle=await openAuthorityCaller(fixture.registration);
  } catch(error) { openError=error; }
  if(handle) {
    try { await assert.rejects(exchangeAuthority(handle,'effect',Buffer.from('{}'))); }
    finally { await retireAuthorityCaller(handle).catch(()=>{}); }
  } else { assert.ok(openError); }
  assert.equal(fixture.events.filter(e=>e.event==='request').length,0);
});
