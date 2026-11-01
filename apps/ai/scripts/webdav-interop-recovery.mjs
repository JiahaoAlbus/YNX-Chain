#!/usr/bin/env node
// New recovery/edge checks against the actual official upstream and retained proxy.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'');if(!process.argv[2]||!dir.startsWith('/Volumes/'))throw new Error('External isolation directory required');
const conn=JSON.parse(await readFile(join(dir,'connection.private.json'),'utf8'));
const fault=JSON.parse(await readFile(join(dir,'fault-connection.private.json'),'utf8'));
const auth='Basic '+Buffer.from(`${conn.username}:${conn.password}`).toString('base64');
const root='recovery-'+randomUUID(),out=join(dir,'evidence',root);await mkdir(out);
const checks=[],startedAt=new Date().toISOString();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function call(method,path,body,headers={}){const r=await fetch(new URL(path,conn.url),{method,headers:{Authorization:auth,...headers},body,redirect:'manual',signal:AbortSignal.timeout(10000)});return {status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())}}
async function check(name,fn){try{checks.push({name,pass:true,...await fn()})}catch(e){checks.push({name,pass:false,error:e.message});console.error(name+': '+e.message)}}
assert.equal((await call('MKCOL',root+'/')).status,201);
await check('binary bytes including NUL and non-UTF8 survive real PUT GET',async()=>{const bytes=randomBytes(1024*1024);bytes[0]=0;bytes[1]=255;const path=root+'/binary.bin';assert.equal((await call('PUT',path,bytes,{'If-None-Match':'*'})).status,201);const r=await call('GET',path);assert.deepEqual(r.bytes,bytes);return {size:bytes.length,sha256:sha(bytes),etag:r.headers.get('etag')}});
await check('empty file is present, distinct from absent object',async()=>{const path=root+'/empty';assert.equal((await call('PUT',path,Buffer.alloc(0),{'If-None-Match':'*'})).status,201);const r=await call('GET',path);assert.equal(r.status,200);assert.equal(r.bytes.length,0);assert.equal((await call('GET',root+'/absent')).status,404)});
await check('wrong credentials do not create or disclose object',async()=>{const path=root+'/unauthorized';const r=await call('PUT',path,Buffer.from('unauthorized'),{Authorization:'Basic '+Buffer.from('wrong:wrong').toString('base64')});assert.equal(r.status,401);assert.equal((await call('GET',path)).status,404)});
const lostPath=root+'/lost-ack-original.bin',bytes=randomBytes(32768);
await writeFile(join(out,'expected.bin'),bytes);
await check('retained fault endpoint drops actual ACK; fresh client queries exact original without PUT replay',async()=>{
 const target=new URL(lostPath,fault.url);
 const result=await new Promise((ok,fail)=>{const req=http.request(target,{method:'PUT',headers:{Authorization:auth,'Content-Length':bytes.length,'If-None-Match':'*'}},res=>{res.resume();fail(new Error('ACK was not dropped'))});req.on('error',e=>ok(e.code));req.setTimeout(10000,()=>req.destroy(new Error('timeout')));req.end(bytes)});assert.equal(result,'ECONNRESET');
 const journal={operationId:root,originalObject:lostPath,expectedSha256:sha(bytes),state:'UNKNOWN',putAttempts:1};await writeFile(join(out,'unknown-journal.json'),JSON.stringify(journal,null,2));
 // Run a genuinely separate client process. Auth is inherited via environment,
 // never argv, URL, result or request logs. This is not parent Store persistence.
 const code=`const r=await fetch(process.env.DAV_OBJECT,{headers:{Authorization:process.env.DAV_AUTH}});const b=Buffer.from(await r.arrayBuffer());console.log(JSON.stringify({status:r.status,sha256:require('node:crypto').createHash('sha256').update(b).digest('hex'),etag:r.headers.get('etag')}));`;
 const observed=await new Promise((ok,fail)=>{let text='';const c=spawn(process.execPath,['--input-type=commonjs','-e',`(async()=>{${code}})().catch(e=>{console.error(e.message);process.exit(1)})`],{env:{PATH:process.env.PATH,DAV_OBJECT:new URL(lostPath,conn.url).href,DAV_AUTH:auth},stdio:['ignore','pipe','pipe']});c.stdout.on('data',b=>text+=b);let errors='';c.stderr.on('data',b=>errors+=b);c.on('exit',n=>n===0?ok(JSON.parse(text)):fail(new Error(errors)));c.on('error',fail)});
 assert.equal(observed.status,200);assert.equal(observed.sha256,journal.expectedSha256);
 const logs=(await readFile(join(dir,'evidence/fault-proxy.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.path==='/'+lostPath);
 assert.equal(logs.filter(x=>x.method==='PUT').length,1);assert.equal(logs[0].ackDropped,true);assert.equal(logs[0].upstreamStatus,201);
 return {operationId:root,originalObject:lostPath,putAttempts:1,observation:'CONTENT_PRESENT',authorProven:false,...observed};
});
await check('If-Match with stale ETag rejects replacement and preserves bytes',async()=>{const path=root+'/conditional';await call('PUT',path,bytes,{'If-None-Match':'*'});const first=await call('GET',path);const stale=await call('PUT',path,Buffer.from('different'),{'If-Match':'"not-the-etag"'});assert.equal(stale.status,412);const after=await call('GET',path);assert.equal(after.headers.get('etag'),first.headers.get('etag'));assert.deepEqual(after.bytes,bytes)});
const summary={startedAt,finishedAt:new Date().toISOString(),endpoint:conn.url,checks,root,restartReadback:{path:lostPath,expectedSha256:sha(bytes),expectedFile:join(out,'expected.bin')},boundary:'Independent upstream/fault/client evidence, not Auth acceptance, parent normal CLI/persistence, Nextcloud product or strong resource fence'};
await writeFile(join(out,'result.json'),JSON.stringify(summary,null,2));await writeFile(join(dir,'evidence/latest-recovery.json'),JSON.stringify({result:join(out,'result.json'),restartReadback:summary.restartReadback},null,2));
console.log(JSON.stringify({result:join(out,'result.json'),passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length}));process.exitCode=checks.every(x=>x.pass)?0:1;
