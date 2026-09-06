import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createCsrfToken, createToken, hashPassword } from './auth.js';
import { OpsStore } from './store.js';
import type { Role } from './types.js';

const operatorOrigin='https://monitor.test';

async function listen(server:Server){
  server.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();
  assert(address&&typeof address!=='string');
  return `http://127.0.0.1:${address.port}`;
}

const close=(server:Server)=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

async function fixture(extra:Partial<Parameters<typeof createApp>[0]>={}){
  const directory=await mkdtemp(join(tmpdir(),'ynx-monitor-no-store-'));
  const secret=randomBytes(32).toString('hex');
  const password=randomBytes(24).toString('hex');
  const store=new OpsStore(join(directory,'state.json'),randomBytes(32).toString('hex'));
  const app=await createApp({
    store,secret,
    users:[{username:'test-operator',role:'operator',passwordHash:hashPassword(password)}],
    allowedOrigins:[operatorOrigin],walletOrigin:operatorOrigin,
    walletRoles:{},publicStatusSource:null,p0ConnectivityProbes:[],trustedProxyAddresses:[],
    ...extra,
  });
  app.set('env','production');
  const server=createServer(app),base=await listen(server);
  const session=(role:Role='operator',username='test-operator')=>{
    const token=createToken({username,role},secret);
    return{authorization:`Bearer ${token}`,origin:operatorOrigin,'x-ynx-csrf-token':createCsrfToken(token,secret),'content-type':'application/json'};
  };
  return{base,store,password,session,close:async()=>{await close(server);await rm(directory,{recursive:true,force:true});}};
}

async function request(base:string,path:string,init:RequestInit={},expectedStatus=200){
  const response=await fetch(base+path,init);
  assert.equal(response.status,expectedStatus,`${init.method??'GET'} ${path} status`);
  assert.equal(response.headers.get('cache-control'),'no-store',`${init.method??'GET'} ${path} Cache-Control`);
  return response;
}

test('password and synthetic wallet session responses never permit caching',async()=>{
  const monitor=await fixture({walletRoles:{'synthetic-wallet':'viewer'},walletVerifier:async()=>({account:'synthetic-wallet'})});
  try{
    const login=await request(monitor.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test-operator',password:monitor.password})});
    const session=await login.json() as {token?:string;csrfToken?:string};
    assert.equal(typeof session.token,'string');assert.equal(typeof session.csrfToken,'string');
    await request(monitor.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test-operator',password:'wrong'})},401);
    const challengeResponse=await request(monitor.base,'/ops/wallet/challenges',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},201);
    const challenge=await challengeResponse.json() as {challengeId:string;nonce:string};
    // A local verifier stub accepts this fixture; no wallet signing is performed.
    const payload=JSON.stringify({...challenge,signature:'synthetic-fixture',signedPayload:'synthetic-fixture'});
    const walletResponse=await request(monitor.base,'/ops/wallet/sessions',{method:'POST',headers:{'content-type':'application/json'},body:payload});
    const walletSession=await walletResponse.json() as {token?:string};
    assert.equal(typeof walletSession.token,'string');
    await request(monitor.base,'/ops/wallet/sessions',{method:'POST',headers:{'content-type':'application/json'},body:payload},409);
  }finally{await monitor.close();}
});

test('read, write, authentication, role, Origin and CSRF responses are no-store',async()=>{
  const monitor=await fixture();
  try{
    await request(monitor.base,'/ops/me',{},401);
    await request(monitor.base,'/OPS/me?source=fixture',{headers:{authorization:'Bearer invalid'}},401);
    const headers=monitor.session(),viewer=monitor.session('viewer','test-viewer');
    for(const path of ['/ops/me','/OPS/ME','/oPs/me/?q=%2Fops%2Fme','/ops/audit','/ops/automation-policy','/ops/automation-proposals']){
      const response=await request(monitor.base,path,{headers});await response.arrayBuffer();
    }
    const body=JSON.stringify({title:'Fixture incident',source:'evidence://fixture',severity:'low',evidence:[]});
    await request(monitor.base,'/ops/incidents',{method:'POST',headers:viewer,body},403);
    await request(monitor.base,'/ops/incidents',{method:'POST',headers:{...headers,origin:''},body},403);
    await request(monitor.base,'/ops/incidents',{method:'POST',headers:{...headers,'x-ynx-csrf-token':''},body},403);
    await request(monitor.base,'/ops/incidents',{method:'POST',headers,body},201);
    await request(monitor.base,'/ops/unknown?route=fixture',{headers},404);
    await request(monitor.base,'/ops/me',{method:'HEAD',headers});
  }finally{await monitor.close();}
});

test('parser failures and encoded route parameters retain early no-store protection',async()=>{
  const monitor=await fixture();
  try{
    await request(monitor.base,'/OpS/login?next=%2Fops',{method:'POST',headers:{'content-type':'application/json'},body:'{'},400);
    await request(monitor.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oversized:'x'.repeat(140_000)})},413);
    const headers=monitor.session();
    // Express decodes parameter values after the /ops middleware has run.
    await request(monitor.base,'/ops/incidents/%6Dissing/export',{headers},404);
    await request(monitor.base,'/OPS/incidents/%E0%A4%A/export',{headers},400);
  }finally{await monitor.close();}
});

test('both authentication and existing sensitive admission 429 responses are no-store',async()=>{
  const authentication=await fixture({users:[]});
  try{
    for(let index=0;index<20;index++)await request(authentication.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},503);
    const limited=await request(authentication.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},429);
    assert.equal(limited.headers.get('retry-after'),'60');
  }finally{await authentication.close();}
  const operations=await fixture();
  try{
    const headers=operations.session();
    // Preserve the existing 20/min sensitive policy; separating reads is a later change.
    for(let index=0;index<20;index++)await request(operations.base,'/ops/me',{headers});
    const limited=await request(operations.base,'/ops/me',{headers},429);
    assert.equal(limited.headers.get('retry-after'),'60');
  }finally{await operations.close();}
});

test('unexpected application failures remain no-store',async()=>{
  const monitor=await fixture();
  try{
    monitor.store.audit=async()=>{throw new Error('synthetic_audit_failure');};
    await request(monitor.base,'/ops/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'test-operator',password:monitor.password})},500);
  }finally{await monitor.close();}
});

test('AI success and error streams cannot override authenticated no-store headers',async()=>{
  let upstreamStatus=200,calls=0;
  const upstream=createServer((_request,response)=>{calls++;response.writeHead(upstreamStatus,{'content-type':'text/event-stream','cache-control':'public, max-age=600'}).end('data: synthetic advisory\n\n');});
  const aiUrl=await listen(upstream),previousKey=process.env.YNX_MONITOR_AI_KEY;
  process.env.YNX_MONITOR_AI_KEY=randomBytes(32).toString('hex');
  const monitor=await fixture({aiUrl});
  try{
    const incident=await monitor.store.createIncident({username:'test-operator',role:'operator'},{title:'Fixture AI incident',source:'evidence://fixture',severity:'low',evidence:[]});
    const headers=monitor.session('viewer','test-viewer');
    for(const status of [200,503]){
      upstreamStatus=status;
      const response=await request(monitor.base,`/ops/incidents/${incident.id}/ai`,{method:'POST',headers,body:'{}'},status);
      assert.match(response.headers.get('content-type')??'',/^text\/event-stream/);
      assert.equal(await response.text(),'data: synthetic advisory\n\n');
    }
    assert.equal(calls,2);
  }finally{
    if(previousKey===undefined)delete process.env.YNX_MONITOR_AI_KEY;else process.env.YNX_MONITOR_AI_KEY=previousKey;
    await monitor.close();await close(upstream);
  }
});
