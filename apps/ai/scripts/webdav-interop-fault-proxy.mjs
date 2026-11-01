#!/usr/bin/env node
// Transparent loopback fault injector in front of a genuine official upstream.
// It does NOT implement DAV or return fake upload success. Every PUT response
// is dropped only after the actual upstream has replied and drained.
import http from 'node:http';
import {readFile,writeFile,appendFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const dir=resolve(process.argv[2]||'');
if(!process.argv[2]||!dir.startsWith('/Volumes/'))throw new Error('External isolation directory required');
const connection=JSON.parse(await readFile(join(dir,'connection.private.json'),'utf8'));
const base=new URL(connection.url);if(base.hostname!=='127.0.0.1')throw new Error('Loopback upstream required');
const log=join(dir,'evidence/fault-proxy.jsonl');
const pending=new Set();
function record(event){const promise=appendFile(log,JSON.stringify({...event,at:new Date().toISOString()})+'\n');pending.add(promise);promise.finally(()=>pending.delete(promise));}
const server=http.createServer((req,res)=>{
 if(!['PUT','GET','HEAD','PROPFIND','OPTIONS','MKCOL'].includes(req.method)||!req.url.startsWith('/')||req.url.includes('?')||req.url.startsWith('//')){res.writeHead(400);res.end();return}
 const method=req.method,path=req.url,hash=createHash('sha256');let bytes=0;
 const headers={...req.headers,host:base.host,connection:'close'};delete headers['proxy-authorization'];
 const upstream=http.request({hostname:base.hostname,port:base.port,method,path,headers},response=>{
  if(method==='PUT'){
   response.resume();response.on('end',()=>{record({method,path,bytes,requestSha256:hash.digest('hex'),upstreamStatus:response.statusCode,ackDropped:true,upstream:base.href});res.socket?.destroy()});
  }else{record({method,path,upstreamStatus:response.statusCode,ackDropped:false,upstream:base.href});res.writeHead(response.statusCode,response.headers);response.pipe(res)}
 });
 req.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);if(bytes>4*1024*1024){upstream.destroy();req.destroy()}});
 req.on('aborted',()=>upstream.destroy());
 upstream.on('error',error=>{record({method,path,error:error.code||'transport-error',ackDropped:false});res.socket?.destroy()});
 req.pipe(upstream);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const url=`http://127.0.0.1:${server.address().port}/`;
const output=join(dir,'fault-connection.private.json');await writeFile(output,JSON.stringify({...connection,url,upstreamUrl:base.href,proxyPid:process.pid,fault:'drop all real PUT acknowledgements'},null,2),{mode:0o600});await chmod(output,0o600);
await writeFile(join(dir,'evidence/fault-proxy-live.json'),JSON.stringify({url,upstream:base.href,pid:process.pid,fault:'forward PUT once then drop actual response; GET passes through',log,startedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({ready:true,url,upstream:base.href,pid:process.pid,privateConnection:output}));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await Promise.allSettled([...pending]);process.exit()}));
