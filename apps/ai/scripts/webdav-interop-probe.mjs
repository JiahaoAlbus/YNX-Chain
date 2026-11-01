#!/usr/bin/env node
// Real requests go to official rclone. The forwarding fault injector only drops
// a real upstream PUT acknowledgement; it never serves or fabricates DAV data.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const dir=resolve(process.argv[2]||'');
if(!process.argv[2]||!dir.startsWith('/Volumes/'))throw new Error('External evidence directory required');
const connection=JSON.parse(await readFile(join(dir,'connection.private.json'),'utf8'));
const base=new URL(connection.url);if(base.hostname!=='127.0.0.1')throw new Error('Loopback isolation required');
const auth='Basic '+Buffer.from(`${connection.username}:${connection.password}`).toString('base64');
const run='run-'+randomUUID();const out=join(dir,'evidence',run);await mkdir(out);
const startedAt=new Date().toISOString(),checks=[],requests=[];
async function request(method,path,body,headers={}){
 const response=await fetch(new URL(path,base),{method,headers:{Authorization:auth,...headers},body,redirect:'manual',signal:AbortSignal.timeout(10000)});
 const bytes=Buffer.from(await response.arrayBuffer());
 requests.push({method,path,status:response.status,etag:response.headers.get('etag'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 return {status:response.status,bytes,headers:response.headers};
}
async function check(name,fn){try{const detail=await fn();checks.push({name,pass:true,...detail})}catch(error){checks.push({name,pass:false,error:error.message});console.error(name+': '+error.message)}}
const content=Buffer.from('P08 S1 synthetic WebDAV content\n无支付 / no payment\n'+randomUUID()+'\n');
const digest=createHash('sha256').update(content).digest('hex');
await writeFile(join(out,'synthetic.bin'),content);
let path=`${run}/file.txt`,etag;
await check('official upstream unauthorized rejected',async()=>{const r=await fetch(base,{signal:AbortSignal.timeout(5000)});await r.arrayBuffer();assert.equal(r.status,401);return {status:r.status}});
await check('MKCOL real isolated collection',async()=>{assert.equal((await request('MKCOL',run+'/')).status,201)});
await check('PUT with If-None-Match star then independent GET byte digest and ETag',async()=>{const put=await request('PUT',path,content,{'If-None-Match':'*','Content-Type':'application/octet-stream'});assert.ok([200,201,204].includes(put.status));const get=await request('GET',path);assert.equal(get.status,200);assert.deepEqual(get.bytes,content);etag=get.headers.get('etag');assert.ok(etag);return {digest,etag,putStatus:put.status}});
await check('HEAD metadata matches independent GET',async()=>{const head=await request('HEAD',path);assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),content.length);assert.equal(head.headers.get('etag'),etag)});
await check('PROPFIND depth zero is real DAV multistatus',async()=>{const result=await request('PROPFIND',path,undefined,{Depth:'0'});assert.equal(result.status,207);assert.match(result.bytes.toString(),/multistatus/)});
await check('missing original object remains 404',async()=>{assert.equal((await request('GET',`${run}/never-written`)).status,404)});
await check('create-only collision rejects overwrite',async()=>{const r=await request('PUT',path,Buffer.from('collision must not replace original'),{'If-None-Match':'*'});const get=await request('GET',path);assert.equal(r.status,412,'Upstream must enforce create-only conditional');assert.deepEqual(get.bytes,content)});
// A raw HTTP client deliberately avoids fetch automatic retry on a dead socket.
let forwardedPuts=0,ackedStatus=null;
const lostPath=`${run}/lost-ack.txt`;
const proxy=http.createServer((req,res)=>{
 if(req.method!=='PUT'||req.url!=='/'+lostPath){res.writeHead(400);res.end();return}
 forwardedPuts++;
 const upstream=http.request(new URL(lostPath,base),{method:'PUT',headers:{Authorization:auth,'Content-Length':req.headers['content-length'],'If-None-Match':'*','Content-Type':'application/octet-stream'}},response=>{
  ackedStatus=response.statusCode;response.resume();response.on('end',()=>res.socket.destroy());
 });upstream.on('error',()=>res.socket?.destroy());req.pipe(upstream);
});
await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
await check('lost ACK becomes UNKNOWN; reconcile original object GET without re-PUT',async()=>{
 let clientResult='';
 await new Promise((ok,fail)=>{const req=http.request({hostname:'127.0.0.1',port:proxy.address().port,path:'/'+lostPath,method:'PUT',headers:{'Content-Length':content.length}},res=>{res.resume();fail(new Error('ACK unexpectedly delivered'))});req.on('error',error=>{clientResult=error.code;ok()});req.setTimeout(10000,()=>req.destroy(new Error('timeout')));req.end(content)});
 assert.equal(clientResult,'ECONNRESET');assert.ok([200,201,204].includes(ackedStatus));
 const original=await request('GET',lostPath);assert.equal(original.status,200);assert.deepEqual(original.bytes,content);assert.equal(forwardedPuts,1);
 return {clientResult:'UNKNOWN',upstreamActualStatus:ackedStatus,forwardedPuts,reconciled:'CONTENT_PRESENT',authorProven:false,operationId:run+'-lost-ack',originalObject:lostPath,etag:original.headers.get('etag'),sha256:digest,note:'Bytes and ETag do not prove actor identity or exclusive authorship; no retry PUT'};
});
await new Promise(ok=>proxy.close(ok));
await check('escaped Unicode object name roundtrip',async()=>{const p=`${run}/`+encodeURIComponent('合成 文件 #1.txt');assert.ok([200,201,204].includes((await request('PUT',p,content,{'If-None-Match':'*'})).status));assert.deepEqual((await request('GET',p)).bytes,content)});
const summary={schema:1,startedAt,finishedAt:new Date().toISOString(),endpoint:base.href,upstream:{version:connection.version,binarySha256:connection.binarySha256},run,contentSha256:digest,checks,requests,allPassed:checks.every(x=>x.pass),boundary:'Official rclone WebDAV interoperability only, not Nextcloud deployment, target strong fence, Auth Grant, parent persistence, model result or release proof. Local synthetic fault proxy forwards to genuine upstream; it is not the upstream.'};
await writeFile(join(out,'result.json'),JSON.stringify(summary,null,2));await writeFile(join(dir,'evidence/latest-probe.json'),JSON.stringify({result:join(out,'result.json'),allPassed:summary.allPassed,checks:checks.map(({name,pass})=>({name,pass}))},null,2));
console.log(JSON.stringify({result:join(out,'result.json'),passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length}));
process.exitCode=summary.allPassed?0:1;
