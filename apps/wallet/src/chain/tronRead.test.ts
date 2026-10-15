import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hexlify,toUtf8Bytes} from 'ethers';
import {createTronReader,tronPublicAddress,tronReadDisplay} from './tronRead';
const A='TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',B='TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const config={network:'nile' as const,genesisBlockId:'a'.repeat(64),rpcURL:'https://public.example/api'};
const word=(n:bigint|number)=>BigInt(n).toString(16).padStart(64,'0');
const abiText=(text:string)=>{const bytes=hexlify(toUtf8Bytes(text)).slice(2);return word(32)+word(bytes.length/2)+bytes.padEnd(Math.ceil(bytes.length/64)*64,'0');};
const constant=(encoded:string)=>({result:{result:true},constant_result:[encoded],transaction:{ret:[{ret:'SUCESS',contractRet:'SUCCESS'}]}});
type ContractFixture={result:{result:boolean};constant_result:string[];transaction?:{ret:Array<{ret:string;contractRet:string}>}};
type ContractSelector='decimals()'|'symbol()'|'name()'|'balanceOf(address)';
type FixtureData={genesis:{blockID:string;block_header:{raw_data:{number?:unknown}}};account:unknown}&Record<ContractSelector,ContractFixture>;
function fixture(change:(data:FixtureData)=>void=()=>{},assertCurrent=()=>{}){
  const data:FixtureData={genesis:{blockID:config.genesisBlockId,block_header:{raw_data:{}}},account:{address:tronPublicAddress(A).hex,balance:'9223372036854775807'},
    'decimals()':constant(word(6)),'symbol()':constant(abiText('PUBLIC')),'name()':constant(abiText('Public Token')),'balanceOf(address)':constant(word((1n<<256n)-1n))};
  change(data);const calls:{url:string;body:Record<string,unknown>;init:RequestInit}[]=[];
  const fetchImpl:typeof fetch=async(url,init)=>{assert.ok(init);const parsed:unknown=JSON.parse(String(init.body));assert.ok(parsed&&typeof parsed==='object'&&!Array.isArray(parsed));const body=parsed as Record<string,unknown>;calls.push({url:String(url),body,init});let value:unknown;
    if(String(url).endsWith('/getblockbynum'))value=data.genesis;
    else if(String(url).endsWith('/getaccount'))value=data.account;
    else{const selector=body.function_selector;assert.ok(selector==='decimals()'||selector==='symbol()'||selector==='name()'||selector==='balanceOf(address)');value=data[selector]}
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});};
  return {reader:createTronReader(config,{fetchImpl,assertCurrent}),calls,data,fetchImpl};
}
test('strict TRON base58check/hex normalize public vectors, never EVM/YNX or bad checksum',()=>{
  assert.equal(tronPublicAddress(tronPublicAddress(A).hex.toUpperCase()).address,A);assert.equal(tronPublicAddress(B).address,B);
  for(const bad of ['0x'+'11'.repeat(20),'ynx1public',A.slice(0,-1)+'1','41'+'00'.repeat(20),' '+A,A+' ',A.slice(1)])assert.throws(()=>tronPublicAddress(bad));
});
test('native TRX integer64 exact display binds source network/account without full-wallet claims',async()=>{
  const f=fixture(),r=await f.reader.read({address:A});assert.equal(r.trx.sun,'9223372036854775807');assert.equal(r.trx.display,'9223372036854.775807');assert.equal(r.address,A);assert.equal(r.network,'nile');assert.equal(r.genesisBlockId,config.genesisBlockId);assert.equal(r.source.verification,'provider-reported-not-consensus');assert.equal(r.source.rpcURL,config.rpcURL);assert.equal(f.calls.length,2);assert(Object.isFrozen(r.trx));
  const genesisCall=f.calls[0],accountCall=f.calls[1];assert.ok(genesisCall);assert.ok(accountCall);
  assert.equal(genesisCall.url,config.rpcURL+'/wallet/getblockbynum');assert.deepEqual(accountCall.body,{address:tronPublicAddress(A).hex,visible:false});
  for(const c of f.calls){assert.equal(c.init.method,'POST');assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert(c.init.signal);}
});
test('only empty account object means unactivated zero; activated omitted balance is zero',async()=>{
  for(const [body,activated]of [[{},false],[{address:tronPublicAddress(A).hex},true]]as const){const f=fixture(d=>{d.account=body;});assert.deepEqual((await f.reader.read({address:A})).trx,{sun:'0',display:'0',activated});}
  for(const body of [{Error:'remote error'},{balance:'0'},{address:tronPublicAddress(B).hex,balance:0},{address:tronPublicAddress(A).hex,balance:9007199254740992},{address:tronPublicAddress(A).hex,balance:'9223372036854775808'},{address:tronPublicAddress(A).hex,balance:'-1'}]){const f=fixture(d=>{d.account=body;});await assert.rejects(f.reader.read({address:A}));}
});
test('TRC20 explicit contract metadata canonical ABI and uint256 balance remain exact',async()=>{
  const f=fixture(),r=await f.reader.read({address:A,contract:B,expectedDecimals:6});assert.equal(r.token?.name,'Public Token');assert.equal(r.token?.symbol,'PUBLIC');assert.equal(r.token?.units,((1n<<256n)-1n).toString());assert.equal(r.token?.contract,B);assert.equal(r.token?.decimals,6);assert.equal(f.calls.length,6);
  assert.deepEqual(f.calls.slice(2).map(c=>c.body.function_selector),['decimals()','symbol()','name()','balanceOf(address)']);
  assert.equal(f.calls.at(-1)?.body.parameter,tronPublicAddress(A).hex.slice(2).padStart(64,'0'));assert(!f.calls.some(c=>/sign|broadcast|triggersmart/.test(c.url)));
});
test('no defaults: invalid URL/network/genesis refuses before fetch, config snapshot cannot mutate',async()=>{
  for(const patch of [{network:'ethereum'},{genesisBlockId:'0'.repeat(64)},{rpcURL:'http://public.example'},{rpcURL:'https://127.0.0.1'},{rpcURL:'https://[::1]'},{rpcURL:'https://user:pass@public.example'},{rpcURL:'https://public.example?key=x'},{rpcURL:'https://public.local'},{rpcURL:'https://public.example/a/../b'}])assert.throws(()=>createTronReader({...config,...patch}as any));
  const f=fixture(),mutable={...config};const reader=createTronReader(mutable,{fetchImpl:f.fetchImpl});mutable.genesisBlockId='b'.repeat(64);assert.equal((await reader.read({address:A})).genesisBlockId,config.genesisBlockId);
});
test('wrong genesis stops before account/contract calls',async()=>{
  const f=fixture(d=>{d.genesis.blockID='b'.repeat(64);});await assert.rejects(f.reader.read({address:A,contract:B}),{code:'TRON_READ_NETWORK_MISMATCH'});assert.equal(f.calls.length,1);
});
test('contract failure, metadata changes, unsafe ABI/UTF8/padding/decimals never become zero',async()=>{
  const mutations:Array<(data:FixtureData)=>void>=[d=>{d['decimals()']=constant(word(256));},d=>{d['decimals()']=constant(word(18));},d=>{d['symbol()']=constant(word(0));},d=>{d['symbol()']=constant(abiText('bad\u202e'));},d=>{d['name()']=constant(word(32)+word(1)+'ff'+'0'.repeat(62));},d=>{d['name()']=constant(abiText('Name')+'00');},d=>{d['balanceOf(address)']={result:{result:false},constant_result:[word(0)]};},d=>{const transaction=d['balanceOf(address)'].transaction;assert.ok(transaction);const ret=transaction.ret[0];assert.ok(ret);ret.contractRet='REVERT';},d=>{d['balanceOf(address)']=constant(word(0)+'00');}];
  for(const change of mutations){
    const f=fixture(change);await assert.rejects(f.reader.read({address:A,contract:B,expectedDecimals:6}));
  }
  assert.equal(tronReadDisplay('1',0),'1');assert.equal(tronReadDisplay('1',255),'0.'+'0'.repeat(254)+'1');assert.throws(()=>tronReadDisplay('01'));assert.throws(()=>tronReadDisplay('1',256));
});
test('guard at every async read boundary blocks account/network/lock revision supersession',async()=>{
  for(const stopAt of [0,1,2,3,4,5]){
    let retired=false;const f=fixture(()=>{},()=>{if(retired)throw Object.assign(Error('original guard failure'),{code:'PUBLIC_GUARD_RETIRED'});});
    let count=0;const reader=createTronReader(config,{assertCurrent:()=>{if(retired)throw Object.assign(Error('original guard failure'),{code:'PUBLIC_GUARD_RETIRED'});},fetchImpl:async(url,init)=>{const response=await f.fetchImpl(url,init);if(count++===stopAt)retired=true;return response;}});
    await assert.rejects(reader.read({address:A,contract:B}),{code:'PUBLIC_GUARD_RETIRED'});assert.equal(f.calls.length,stopAt+1);
  }
});
test('abort and timeout settle even if stand-in fetch ignores signal, no retries or stale output',async()=>{
  const aborted=new AbortController();aborted.abort();let count=0;
  const reader=createTronReader(config,{timeoutMs:10,fetchImpl:async()=>{count++;return new Promise(()=>{});}});
  await assert.rejects(reader.read({address:A},{signal:aborted.signal}),{code:'TRON_READ_CANCELLED'});assert.equal(count,0);
  await assert.rejects(reader.read({address:A}),{code:'TRON_READ_TIMEOUT'});assert.equal(count,1);
  const controller=new AbortController(),p=reader.read({address:A},{signal:controller.signal});controller.abort();await assert.rejects(p,{code:'TRON_READ_CANCELLED'});assert.equal(count,2);
});
test('HTTP/malformed/oversized/body errors reject rather than displaying synthetic zeros',async()=>{
  for(const response of [new Response('{}',{status:500,headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/plain'}}),new Response('bad',{headers:{'content-type':'application/json'}}),new Response(' '.repeat(32769),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'40000'}})]){
    let count=0;const reader=createTronReader(config,{fetchImpl:async()=>{count++;return response;}});await assert.rejects(reader.read({address:A}));assert.equal(count,1);
  }
  const reader=createTronReader(config,{fetchImpl:async()=>{throw Error('remote detail');}});await assert.rejects(reader.read({address:A}),{code:'TRON_READ_UNAVAILABLE'});
});
test('RN text fallback shares cancellation guard and byte budget; invalid signal rejected without request',async()=>{
  let count=0;const reader=createTronReader(config,{timeoutMs:10,fetchImpl:async()=>{count++;return {status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body:null,text:async()=>new Promise<string>(()=>{})}as Response;}});
  await assert.rejects(reader.read({address:A},{signal:{}as AbortSignal}),{code:'TRON_READ_SIGNAL_INVALID'});assert.equal(count,0);
  await assert.rejects(reader.read({address:A}),{code:'TRON_READ_TIMEOUT'});assert.equal(count,1);
  const huge=createTronReader(config,{fetchImpl:async()=>({status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body:null,text:async()=>'中'.repeat(12000)})as Response});
  await assert.rejects(huge.read({address:A}),{code:'TRON_READ_RESPONSE_TOO_LARGE'});
});
