#!/usr/bin/env node
// A real truncated upload to the official isolated upstream. No DAV emulation.
import net from 'node:net';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const dir=resolve(process.argv[2]||'');if(!process.argv[2]||!dir.startsWith('/Volumes/'))throw new Error('External isolation directory required');
const c=JSON.parse(await readFile(join(dir,'connection.private.json'),'utf8')),base=new URL(c.url);
assert.equal(base.hostname,'127.0.0.1');
const id='interrupted-'+randomUUID(),out=join(dir,'evidence',id);await mkdir(out);
const path=id+'.bin',expected=randomBytes(65536),partial=expected.subarray(0,4096),auth='Basic '+Buffer.from(c.username+':'+c.password).toString('base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
await writeFile(join(out,'expected.bin'),expected);
await writeFile(join(out,'original-operation.json'),JSON.stringify({operationId:id,originalObject:path,expectedSha256:hash(expected),state:'UNKNOWN',putAttempts:1},null,2));
await new Promise((ok,fail)=>{
 const socket=net.createConnection({host:base.hostname,port:base.port},()=>{
  const header=`PUT /${path} HTTP/1.1\r\nHost: ${base.host}\r\nAuthorization: ${auth}\r\nContent-Type: application/octet-stream\r\nContent-Length: ${expected.length}\r\nIf-None-Match: *\r\nConnection: close\r\n\r\n`;
  socket.write(header);socket.write(partial,()=>setTimeout(()=>{socket.destroy();ok()},100));
 });socket.on('error',fail);socket.setTimeout(5000,()=>{socket.destroy();fail(new Error('interrupted request timeout'))});
});
const response=await fetch(new URL(path,base),{headers:{Authorization:auth},signal:AbortSignal.timeout(10000)}),body=Buffer.from(await response.arrayBuffer());
assert.ok([200,404].includes(response.status));assert.notEqual(hash(body),hash(expected),'A truncated upload must never qualify as exact complete content');
const result={at:new Date().toISOString(),endpoint:base.href,operationId:id,originalObject:path,clientResult:'UNKNOWN',putAttempts:1,declaredBytes:expected.length,sentBodyBytes:partial.length,originalQueryStatus:response.status,observedBytes:body.length,expectedSha256:hash(expected),actualSha256:hash(body),observation:response.status===404?'ABSENT':'CONTENT_MISMATCH',authorProven:false,recoveryPutAttempts:0,note:'Truncated request and later absence/mismatch never justify blindly replaying the original UNKNOWN operation; parent persistence acceptance is separate'};
await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));await writeFile(join(dir,'evidence/interrupted-put.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
