import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,rename,mkdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Duplex} from 'node:stream';
import {createRequire} from 'node:module';
import {createPublicChainHost} from './chain-public-reader.mjs';
const {servePublicChain,publicChainClient}=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/chain-public-channel.js');
const status={chainId:6423,nativeCurrencySymbol:'YNXT',network:'YNX Testnet',publicNetwork:true,height:27};
async function fixture(fn){const workspace=await realpath(await mkdtemp(join(tmpdir(),'ynx-public-chain-'))),context={id:'12345678-1234-1234-1234-123456789abc',workspace};const calls=[];let override;
 const fetcher=async(url,options)=>{calls.push({url,options});if(override)return override(url,options);if(url.endsWith('/status'))return Response.json(status);if(url.endsWith('/ide/compiler'))return Response.json({runtimeMode:'restricted',limitations:['no arbitrary Solidity execution']});const request=JSON.parse(options.body);return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0x1917':request.method==='eth_getBalance'?'0xa':null});};
 const stat=await lstat(workspace),expectedIdentity={dev:String(stat.dev),ino:String(stat.ino)},assertPathCurrent=async()=>{const now=await lstat(workspace);if(String(now.dev)!==expectedIdentity.dev||String(now.ino)!==expectedIdentity.ino)throw Error('Chain project directory changed.');};
 const host=createPublicChainHost(context,{fetcher,expectedIdentity,assertPathCurrent});try{await fn({host,context,calls,expectedIdentity,assertPathCurrent,setFetch:value=>override=value});}finally{host.close();await rm(workspace,{recursive:true,force:true});await rm(workspace+'-old',{recursive:true,force:true});}}
function pipes(){let left,right;left=new Duplex({read(){},write(chunk,enc,done){right.push(chunk);done();}});right=new Duplex({read(){},write(chunk,enc,done){left.push(chunk);done();}});return[left,right];}
test('public host uses only fixed REST and canonical EVM endpoints, shared validation and no credentials',()=>fixture(async f=>{
 const initial=await f.host.current();assert.equal(initial.protocolVersion,'ynx-code-chain-public/v1');assert.equal(await f.host.read('balance',['0x'+'1'.repeat(40)]),'0xa');assert.equal((await f.host.read('compiler',[])).runtimeMode,'restricted');
 for(const c of f.calls){assert.ok(['https://rpc.ynxweb4.com/status','https://rpc.ynxweb4.com/ide/compiler','https://evm.ynxweb4.com/'].includes(c.url));assert.equal(c.options.redirect,'error');assert.equal(c.options.credentials,'omit');assert.equal(c.options.headers.authorization,undefined);}
 assert.equal((await f.host.current()).launch,initial.launch);
}));
test('write actions and malformed request are rejected before network; fixed chain mismatch fails',()=>fixture(async f=>{
 await assert.rejects(f.host.read('eth_sendTransaction',[]),/not allowed/);await assert.rejects(f.host.read('status',['https://evil.test']),/not allowed/);assert.equal(f.calls.length,0);
 f.setFetch(async(url,options)=>url.endsWith('/status')?Response.json(status):Response.json({jsonrpc:'2.0',id:JSON.parse(options.body).id,result:'0x1'}));await assert.rejects(f.host.read('status',[]),/canonical YNX/);
}));
test('host rejects changed project identity and closed launch',()=>fixture(async f=>{
 // Replace before even the first current/read, not only after lazy capture.
 await rename(f.context.workspace,f.context.workspace+'-old');await mkdir(f.context.workspace);await assert.rejects(f.host.current(),/directory changed/);assert.equal(f.calls.length,0);f.host.close();await assert.rejects(f.host.current(),/stopped/);
}));
test('oversized and redirected responses are refused',()=>fixture(async f=>{
 f.setFetch(async()=>new Response('{}',{headers:{'content-length':String(2*1024*1024+1)}}));await assert.rejects(f.host.read('status',[]),/too large/);
 f.setFetch(async()=>({ok:true,redirected:true}));await assert.rejects(f.host.read('status',[]),/rejected/);
}));
test('cancel reaches in-flight fetch and no later result is accepted',()=>fixture(async f=>{
 let received;f.setFetch((url,options)=>new Promise((resolve,reject)=>{received=options.signal;options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}));
 const controller=new AbortController(),pending=f.host.read('status',[],controller.signal);while(!received)await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/aborted/);assert.equal(received.aborted,true);
}));
test('dedicated pipe returns real host contract, aborts only cancelled operation and allows retry',()=>fixture(async f=>{
 const [left,right]=pipes(),server=servePublicChain(left,f.host),client=publicChainClient(right);try{assert.equal((await client.request('current')).workspace,f.context.workspace);assert.equal((await client.request('status')).height,27);
 let received;f.setFetch((url,options)=>new Promise((resolve,reject)=>{received=options.signal;options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}));
 const controller=new AbortController(),pending=client.request('status',[],controller.signal);while(!received)await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/unavailable/);await new Promise(r=>setImmediate(r));assert.equal(received.aborted,true);f.setFetch(undefined);assert.equal((await client.request('status')).height,27);
 }finally{client.close();server.close();}
}));

test('launch proof cannot bind replacement which existed before host construction',()=>fixture(async f=>{
 await rename(f.context.workspace,f.context.workspace+'-old');await mkdir(f.context.workspace);assert.throws(()=>createPublicChainHost(f.context,{expectedIdentity:f.expectedIdentity,assertPathCurrent:f.assertPathCurrent}),/directory changed/);assert.equal(f.calls.length,0);
}));
