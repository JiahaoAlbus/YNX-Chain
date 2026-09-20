import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { summarize, validateTarget, readOnce, run } from './rpc-read-latency.mjs';

test('reports all observations, including errors, in latency and error rate',()=>{
  assert.deepEqual(summarize([{ok:true,totalMs:1},{ok:false,totalMs:9000},{ok:true,totalMs:3,reusedSocket:true}]),{count:3,errors:1,errorRate:1/3,p50Ms:3,p95Ms:9000,maxMs:9000,reusedConnections:1});
});
test('target allowlist rejects credentials, query, arbitrary host and HTTP downgrade',()=>{
  for(const x of ['https://evil.example','http://rpc.ynxweb4.com','https://x:y@rpc.ynxweb4.com','https://rpc.ynxweb4.com/?x=1','https://rpc.ynxweb4.com/evm','https://rpc.ynxweb4.com:99']) assert.throws(()=>validateTarget(x));
  assert.equal(validateTarget('https://rpc-testnet.ynxweb4.com'),'https://rpc-testnet.ynxweb4.com');
});
test('mutation methods cannot be passed to probe',()=>{
  for(const method of ['eth_sendRawTransaction','eth_sendTransaction','ynx_faucet']) assert.throws(()=>readOnce('http://127.0.0.1',method,'',false,1));
});
test('probe rejects incorrect chain, mismatched id, RPC error, and missing receipt',async()=>{
  let body={jsonrpc:'2.0',id:1,result:'0x1917'};
  const server=http.createServer((req,res)=>res.end(JSON.stringify(body)));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await readOnce(origin,'eth_chainId','',false,1)).ok,true);
    for(const invalid of [{jsonrpc:'2.0',id:1,result:'0x1'},{jsonrpc:'2.0',id:2,result:'0x1917'},{jsonrpc:'2.0',id:1,error:{code:-1}}]) {body=invalid;assert.equal((await readOnce(origin,'eth_chainId','',false,1)).ok,false);}
    body={jsonrpc:'2.0',id:1,result:null};assert.equal((await readOnce(origin,'eth_getTransactionReceipt','0x'+'1'.repeat(64),false,1)).ok,false);
  } finally {server.close();await once(server,'close');}
});
test('absolute deadline applies even before any response, without retries',async()=>{
  let requests=0;const server=http.createServer(()=>{requests++;});server.listen(0,'127.0.0.1');await once(server,'listening');
  try {const r=await readOnce(`http://127.0.0.1:${server.address().port}`,'health','',false,1,30);assert.equal(r.ok,false);assert.match(r.error,/deadline/);assert.equal(requests,1);}finally{server.closeAllConnections();server.close();await once(server,'close');}
});
test('public load is strictly bounded before any request',async()=>{
  await assert.rejects(run({targets:['https://rpc.ynxweb4.com'],receipt:'0x'+'1'.repeat(64),users:4}),/Bounded/);
  await assert.rejects(run({targets:['https://rpc.ynxweb4.com'],receipt:'0x'+'1'.repeat(64),rounds:999}),/Bounded/);
});
