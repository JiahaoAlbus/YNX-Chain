import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createChainService} from '../src/service.mjs';
import {once} from 'node:events';
const address='0x'+'a'.repeat(40), protocolVersion='ynx-code-chain/v1';
async function fixture(t, transform=value=>value) {
  const calls=[];
  const result={address,function:'count',selector:'0x06661abd',returnValue:'7',encodedResult:'0x07',executionStatus:'source_analyzer_literal_return',artifactKind:'source-analyzer-artifact',runtimeMode:'local-devnet',limitations:['not full EVM execution']};
  const service=createChainService({ownerForRequest:req=>req.headers['x-owner'],fetcher:async(url,options={})=>{
    calls.push({url:String(url),options});
    return new Response(JSON.stringify(transform(String(url).includes('/contracts/')?{address,functions:[{name:'count',signature:'count()',stateMutability:'view'}],limitations:result.limitations}:result)),{headers:{'content-type':'application/json'}});
  }});
  const server=createServer((req,res)=>service.handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const send=async(path,body,owner='owner-A')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/runtime/chain/contracts/${path}`,{method:body?'POST':'GET',headers:{...(owner?{'x-owner':owner}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
  return {send,calls};
}
test('normal HTTP inspector and read-only call preserve real mode, limits and exact fixed upstream paths',async t=>{
  const h=await fixture(t);assert.equal((await h.send(address,undefined,null)).status,401);assert.equal(h.calls.length,0);
  const inspected=await h.send(address);assert.equal(inspected.status,200);assert.equal(inspected.value.artifact.address,address);
  for(const fn of ['count','0x06661abd']) {const called=await h.send('call',{protocolVersion,address,function:fn});assert.equal(called.status,200);assert.equal(called.value.result.executionStatus,'source_analyzer_literal_return');assert.deepEqual(called.value.result.limitations,['not full EVM execution']);assert.equal(called.value.submitted,false);assert.equal(called.value.signed,false);assert.deepEqual(JSON.parse(h.calls.at(-1).options.body),{address,function:fn});}
  assert.ok(h.calls.every(row=>row.url===`https://rpc.ynxweb4.com/contracts/${address}`||row.url==='https://rpc.ynxweb4.com/ide/call'));
});
test('forged caller, mutation fields, noncanonical address and malformed or oversized calldata fail before upstream',async t=>{
  const h=await fixture(t),base={protocolVersion,address,function:'count'};
  for(const value of [{...base,caller:'owner-B'},{...base,action:'ide_contract_call'},{...base,address:'../../ide/execute'},{...base,address:address.toUpperCase()},{...base,function:'0x123'},{...base,function:'0x'+'ab'.repeat(4097)},{...base,function:'count();execute()'},{...base,protocolVersion:'other'}])assert.equal((await h.send('call',value)).status,400);
  assert.equal(h.calls.length,0);
});
test('ABI selector mismatch and oversized contract metadata never become successful call evidence',async t=>{
  const wrong=await fixture(t,value=>({...value,selector:'0xdeadbeef'}));assert.equal((await wrong.send('call',{protocolVersion,address,function:'0x06661abd'})).status,502);
  const large=await fixture(t,value=>({...value,source:'x'.repeat(2*1024*1024)}));const response=await large.send(address);assert.equal(response.status,502);assert.equal(response.value.code,'chain_response_too_large');
});
for(const alteration of [value=>({...value,address:'0x'+'b'.repeat(40)}),value=>({...value,function:'other'}),value=>({...value,returnValue:undefined}),value=>({...value,transactionHash:'0x'+'f'.repeat(64)}),value=>({...value,storageWrites:[{slot:'0',newValue:'1'}]}),value=>({...value,executionStatus:undefined})])test('inconsistent or write-like read-only evidence is rejected',async t=>{const h=await fixture(t,alteration);const called=await h.send('call',{protocolVersion,address,function:'count'});assert.equal(called.status,502);assert.equal(called.value.code,'contract_call_evidence_mismatch');assert.equal(called.value.result,undefined);});
test('actual upstream headers with a stalled contract response body cannot hold the tools busy past the request deadline',async t=>{
  let held;
  const upstream=createServer((req,res)=>{held=res;res.writeHead(200,{'content-type':'application/json'});res.write('{"address":');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const service=createChainService({ownerForRequest:()=> 'owner-A',upstreamURL:`http://127.0.0.1:${upstream.address().port}`});
  const server=createServer((req,res)=>service.handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{held?.end('null}');upstream.closeAllConnections();server.closeAllConnections();await Promise.all([new Promise(resolve=>upstream.close(resolve)),new Promise(resolve=>server.close(resolve))]);});
  let received;try {const res=await fetch(`http://127.0.0.1:${server.address().port}/runtime/chain/contracts/${address}`,{signal:AbortSignal.timeout(9000)});received={status:res.status,value:await res.json()};}catch(error){received={failedToSettle:true,error:error.name};}
  assert.equal(received.status,503,JSON.stringify(received));assert.equal(received.value.code,'chain_unreachable');
});
