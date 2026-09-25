import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sampleFinanceTrustedClock,FINANCE_TRUSTED_TIME_URL} from './trusted-time.mjs';

const root=path.resolve(`apps/finance/.trusted-time-test-${process.pid}`);
await fs.mkdir(root,{recursive:true,mode:0o700});after(()=>fs.rm(root,{recursive:true,force:true}));
const at=Date.parse('2026-09-25T00:00:00.000Z');
const response=(requestId,time=at,headers={})=>new Response(JSON.stringify({ok:true,requestId,result:{serverTime:new Date(time).toISOString()},schemaVersion:2}),{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':requestId,...headers}});
async function fixture(t){const directory=await fs.mkdtemp(path.join(root,'clock-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return path.join(directory,'trusted-time.json')}

test('fixed Wallet Auth sample advances protected high-water across restart and expires in-process',async t=>{
  const file=await fixture(t);let mono=0,remote=at,calls=0;
  const fetchImpl=async(url,init)=>{calls++;assert.equal(url,FINANCE_TRUSTED_TIME_URL);assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return response(init.headers['x-request-id'],remote)};
  let sample=await sampleFinanceTrustedClock(file,{fetchImpl,monotonic:()=>mono});
  assert.equal(sample.clock(),at);mono=1000;assert.equal(sample.clock(),at+1000);
  mono=3001;assert.throws(()=>sample.clock(),/CLOCK_STALE/);
  remote=at+4000;sample=await sampleFinanceTrustedClock(file,{fetchImpl,monotonic:()=>mono});assert.equal(sample.clock(),remote);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{schemaVersion:'ynx-trusted-time/v1',unixTimeMs:remote});
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
  assert.equal(calls,2);
  remote=at+3000;await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl,monotonic:()=>mono}),/CLOCK_ROLLBACK/);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).unixTimeMs,at+4000);
});

test('bad response, stale RTT, network failure and unprotected file fail closed',async t=>{
  const file=await fixture(t);let mono=0;
  const base=async(_url,init)=>response(init.headers['x-request-id']);
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async(_url,init)=>response('req_wrong_request_000'),monotonic:()=>mono}),/CLOCK_RESPONSE_INVALID/);
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async(_url,init)=>{mono=2100;return response(init.headers['x-request-id'])},monotonic:()=>mono}),/CLOCK_STALE/);
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async()=>{throw Error('offline')},monotonic:()=>mono}),/CLOCK_UNAVAILABLE/);
  mono=0;await sampleFinanceTrustedClock(file,{fetchImpl:base,monotonic:()=>mono});
  await fs.chmod(file,0o644);
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:base,monotonic:()=>mono}),/CLOCK_FILE_INVALID/);
});

test('missing or substituted lock never becomes an authority clock',async t=>{
  const file=await fixture(t),target=path.join(path.dirname(file),'foreign');
  await fs.writeFile(target,'foreign');await fs.symlink(target,file+'.lock');
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async(_url,init)=>response(init.headers['x-request-id']),monotonic:()=>0}),/CLOCK_STORE_BUSY/);
  assert.equal(await fs.readFile(target,'utf8'),'foreign');
  await fs.unlink(file+'.lock');
});

test('headers alone cannot authorize time when body stalls or exceeds the bound',async t=>{
  const file=await fixture(t),headers=id=>({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':id});
  const start=Date.now();
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async(_url,init)=>new Response(new ReadableStream({start(){}}),{status:200,headers:headers(init.headers['x-request-id'])})}),/CLOCK_STALE/);
  assert.ok(Date.now()-start>=1900&&Date.now()-start<4000);
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl:async(_url,init)=>new Response('x'.repeat(2049),{status:200,headers:headers(init.headers['x-request-id'])})}),/CLOCK_RESPONSE_INVALID/);
  await assert.rejects(fs.stat(file),{code:'ENOENT'});
});

test('a dead owner lock is recovered but unknown or live owners remain fail closed',async t=>{
  const file=await fixture(t),fetchImpl=async(_url,init)=>response(init.headers['x-request-id']);
  await fs.writeFile(file+'.lock',JSON.stringify({schemaVersion:'ynx-trusted-time-lock/v1',pid:2147483647})+'\n',{mode:0o600});
  const sample=await sampleFinanceTrustedClock(file,{fetchImpl,monotonic:()=>0});assert.equal(sample.clock(),at);
  await assert.rejects(fs.stat(file+'.lock'),{code:'ENOENT'});
  await fs.writeFile(file+'.lock',JSON.stringify({schemaVersion:'ynx-trusted-time-lock/v1',pid:process.pid})+'\n',{mode:0o600});
  await assert.rejects(sampleFinanceTrustedClock(file,{fetchImpl,monotonic:()=>0}),/CLOCK_STORE_BUSY/);
  await fs.unlink(file+'.lock');
});
