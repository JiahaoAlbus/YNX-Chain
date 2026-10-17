import test from 'node:test';
import assert from 'node:assert/strict';
import {BitcoinReadClient,formatBitcoinSats,validateBitcoinReadAddress} from './bitcoinRead';
const ADDRESS='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // PUBLIC BIP84 vector
const GENESIS='000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const origin='https://btc.example/api';
const row=(value:unknown=1,id='a',confirmed=true)=>({txid:id.repeat(64),vout:0,value,status:{confirmed,block_height:1,block_hash:'b'.repeat(64)}});
function fixture(rows:unknown=[row()],override?:(path:string,index:number)=>Response|Promise<Response>|undefined){
  const calls:{url:string;init:RequestInit}[]=[];
  const client=new BitcoinReadClient({network:'mainnet',baseURL:origin,fetchImpl:async(url,init)=>{
    calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);
    return override?.(url.slice(origin.length),calls.length)??new Response(url.endsWith('/block-height/0')?GENESIS:JSON.stringify(rows),{headers:{'content-type':url.endsWith('/block-height/0')?'text/plain':'application/json'}});
  }});return {client,calls};
}
test('mobile BTC watch-only exact sat balance, source and network use original public address and repeated genesis',async()=>{
  const f=fixture([row(1),row('123456789','c',false)]),result=await f.client.readAddress(ADDRESS.toUpperCase());
  assert.equal(result.address,ADDRESS);assert.equal(result.network,'mainnet');assert.equal(result.source,origin);assert.equal(result.genesis,GENESIS);assert.equal(result.unit,'sat');assert.equal(result.confirmedSats,'1');assert.equal(result.unconfirmedSats,'123456789');assert.equal(result.totalSats,'123456790');assert.equal(result.totalBTC,'1.23456790');assert.equal(result.utxoCount,2);assert.equal(result.verification,'provider-reported-not-spv');assert.equal(result.watchOnly,true);assert.equal(result.signingSupported,false);assert.equal(result.broadcastSupported,false);assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.calls.map(c=>c.url.slice(origin.length)),['/block-height/0',`/address/${ADDRESS}/utxo`,'/block-height/0']);
  assert.equal((await fixture([]).client.readAddress(ADDRESS)).totalBTC,'0.00000000');
});

test('mobile BTC exact byte limit still accepts a valid single-output public response',async()=>{
 const template=JSON.stringify([{...row(),note:''}]),raw=JSON.stringify([{...row(),note:'x'.repeat(1000000-template.length)}]);assert.equal(new TextEncoder().encode(raw).byteLength,1000000);
 const f=fixture(undefined,(_path,n)=>n===2?new Response(raw,{headers:{'content-type':'application/json'}}):undefined),result=await f.client.readAddress(ADDRESS);assert.equal(result.totalSats,'1');assert.equal(result.watchOnly,true);
});
test('mobile BTC Bech32 matches desktop supported scope and refuses YNX ETH wrong-network checksum mixed-case',async()=>{
  assert.equal(validateBitcoinReadAddress(ADDRESS,'mainnet'),ADDRESS);
  for(const address of ['ynx1abcdef','0x'+'1'.repeat(40),ADDRESS.slice(0,-1)+'q','bC'+ADDRESS.slice(2),'1BoatSLRHtKNngkdXEeobR76b53LETtpyT',' '+ADDRESS]){const f=fixture();await assert.rejects(f.client.readAddress(address));assert.equal(f.calls.length,0);}
  assert.throws(()=>validateBitcoinReadAddress(ADDRESS,'testnet4'),{code:'BTC_ADDRESS_NETWORK'});
  for(const url of ['http://btc.example','https://localhost/api','https://127.0.0.1','https://[::1]','https://btc.local','https://btc.example?key=x','https://u:p@btc.example','https://btc.example/%2f','https://btc.example:123'])assert.throws(()=>new BitcoinReadClient({network:'mainnet',baseURL:url}));
  assert.throws(()=>new BitcoinReadClient({network:'unknown' as any,baseURL:origin}));
});
test('mobile BTC integer precision range and malformed duplicate UTXOs fail closed, never display zero on error',async()=>{
  assert.equal(formatBitcoinSats('2100000000000000'),'21000000.00000000');assert.equal((await fixture([row('2100000000000000')]).client.readAddress(ADDRESS)).totalSats,'2100000000000000');
  for(const rows of [[row(Number.MAX_SAFE_INTEGER+1)],[row(1.5)],[row(-1)],[row('1e8')],[row('01')],[row('2100000000000001')],[row(0)],[row(),row()],[{...row(),vout:4294967296}],[{...row(),status:{confirmed:true}}],{balance:100},[row('2100000000000000'),row(1,'c')]])await assert.rejects(fixture(rows).client.readAddress(ADDRESS));
  for(const value of ['-1','1e2','0.1','9007199254740993'])assert.throws(()=>formatBitcoinSats(value));
});
test('mobile BTC rejects initial/final wrong genesis, redirects origin/status/mime and malformed bodies',async()=>{
  for(const index of [1,3]){const f=fixture(undefined,(_path,n)=>n===index?new Response('0'.repeat(64),{headers:{'content-type':'text/plain'}}):undefined);await assert.rejects(f.client.readAddress(ADDRESS),{code:'BTC_PROVIDER_NETWORK_MISMATCH'});assert.equal(f.calls.length,index);}
  for(const response of [new Response('oops',{status:500}),new Response('[]',{headers:{'content-type':'text/html'}}),new Response('{',{headers:{'content-type':'application/json'}}),new Response('[]',{headers:{'content-type':'application/json','content-length':'1000001'}})])await assert.rejects(fixture(undefined,path=>path.includes('/address/')?response:undefined).client.readAddress(ADDRESS));
  const redirected=new Response(GENESIS,{headers:{'content-type':'text/plain'}});Object.defineProperty(redirected,'redirected',{value:true});await assert.rejects(fixture(undefined,()=>redirected).client.readAddress(ADDRESS));
  const changed=new Response(GENESIS,{headers:{'content-type':'text/plain'}});Object.defineProperty(changed,'url',{value:'https://other.example/api'});await assert.rejects(fixture(undefined,()=>changed).client.readAddress(ADDRESS));
});
test('mobile BTC whole-operation timeout and cancellation work even when fetch ignores AbortSignal',async()=>{
  let resolveLate!:(v:Response)=>void,calls=0;
  const client=new BitcoinReadClient({network:'mainnet',baseURL:origin,timeoutMs:10,fetchImpl:async()=>{calls++;return new Promise(r=>{resolveLate=r;});}});
  await assert.rejects(client.readAddress(ADDRESS),{code:'BTC_REQUEST_TIMEOUT'});resolveLate(new Response(GENESIS,{headers:{'content-type':'text/plain'}}));await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
  const before=new AbortController();before.abort();const f=fixture();await assert.rejects(f.client.readAddress(ADDRESS,{signal:before.signal}),{code:'BTC_REQUEST_CANCELLED'});assert.equal(f.calls.length,0);
  const active=new AbortController();const hanging=new BitcoinReadClient({network:'mainnet',baseURL:origin,fetchImpl:async()=>new Promise(()=>{})});const pending=hanging.readAddress(ADDRESS,{signal:active.signal});active.abort();await assert.rejects(pending,{code:'BTC_REQUEST_CANCELLED'});
});
test('mobile BTC lifecycle guard runs before and after awaits and cannot leak late stale balance',async()=>{
  let live=true;const f=fixture(undefined,(_path,n)=>{if(n===2)live=false;return undefined;});
  await assert.rejects(f.client.readAddress(ADDRESS,{guard:()=>{if(!live)throw Object.assign(new Error('changed'),{code:'PUBLIC_CONTEXT_CHANGED'});}}),{code:'PUBLIC_CONTEXT_CHANGED'});assert.equal(f.calls.length,2);
  const unavailable=new BitcoinReadClient({network:'mainnet',baseURL:origin,fetchImpl:async()=>{throw new Error('private platform diagnostic');}});await assert.rejects(unavailable.readAddress(ADDRESS),{code:'BTC_READ_UNAVAILABLE'});
});

test('mobile BTC byte cap rejects multibyte JSON in text-only fetch transports',async()=>{
 const raw=JSON.stringify([{...row(),note:'é'.repeat(510000)}]);assert.ok(raw.length<1000000);assert.ok(new TextEncoder().encode(raw).byteLength>1000000);
 const f=fixture(undefined,(_path,n)=>n===2?{status:200,redirected:false,url:'',headers:new Headers({'content-type':'application/json'}),text:async()=>raw} as Response:undefined);
 await assert.rejects(f.client.readAddress(ADDRESS),{code:'BTC_RESPONSE_SIZE'});assert.equal(f.calls.length,2);
});
test('mobile BTC stream cap cancels before buffering the whole oversized provider response',async()=>{
 let pulls=0,cancelled=0,textCalls=0;
 const body=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(600000).fill(32));if(pulls===6)controller.close()},cancel(){cancelled++}});
 const response=new Response(body,{headers:{'content-type':'application/json'}}),text=response.text.bind(response);response.text=()=>{textCalls++;return text()};
 const f=fixture(undefined,(_path,n)=>n===2?response:undefined);await assert.rejects(f.client.readAddress(ADDRESS),{code:'BTC_RESPONSE_SIZE'});
 assert.equal(textCalls,0);assert.ok(pulls<=3);assert.equal(cancelled,1);assert.equal(f.calls.length,2);
});
test('mobile BTC cancellation also cancels a pending response reader which ignores fetch AbortSignal',async()=>{
 let cancelled=0;
 const body=new ReadableStream<Uint8Array>({pull:()=>new Promise<void>(()=>{}),cancel(){cancelled++}}),response=new Response(body,{headers:{'content-type':'application/json'}});
 const controller=new AbortController(),f=fixture(undefined,(_path,n)=>n===2?response:undefined),pending=f.client.readAddress(ADDRESS,{signal:controller.signal});
 await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{code:'BTC_REQUEST_CANCELLED'});await new Promise(r=>setImmediate(r));assert.equal(cancelled,1);
});
test('mobile BTC bounded stream preserves split multibyte UTF8 and normal leading BOM semantics',async()=>{
 const raw='\uFEFF'+JSON.stringify([{...row(),note:'漢字'}]),bytes=new TextEncoder().encode(raw);
 const response=new Response(new ReadableStream<Uint8Array>({start(c){for(let at=0;at<bytes.length;at+=7)c.enqueue(bytes.slice(at,at+7));c.close()}}),{headers:{'content-type':'application/json'}});
 const f=fixture(undefined,(_path,n)=>n===2?response:undefined),result=await f.client.readAddress(ADDRESS);assert.equal(result.totalSats,'1');assert.equal(result.watchOnly,true);assert.equal(f.calls.length,3);
});
