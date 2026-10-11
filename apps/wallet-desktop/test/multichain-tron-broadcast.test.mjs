import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {utils as tronUtils} from 'tronweb';
import {tronIntentPreview,buildTronUnsigned} from '../src/multichain-tron.mjs';
import {createTronBroadcastTransport} from '../src/multichain-tron-broadcast.mjs';
// Published scalar-one fixture, not any user's key or actual account. Signing
// only makes offline fixture bytes; fake request does not use a network socket.
const PUBLIC_SCALAR_ONE='0'.repeat(63)+'1';
const owner='417e5f4552091a69125d5dfcb7b8c2659029395bdf',to='41'+'22'.repeat(20),contract='41'+'33'.repeat(20);
const network={id:'nile',genesisBlockId:'00'.repeat(32)};
function tuple(token=false){
  const intent=tronIntentPreview({network,owner,to,asset:token?'trc20':'trx',amount:'1',decimals:6,...(token?{contract}:{})});
  const context={network,reference:{number:'100',blockID:'0000000000000064'+'12'.repeat(24),timestamp:1000},timestamp:1200,expiration:61200,feeLimitSun:token?'1000000':'0',permissionId:0};
  const transaction=tronUtils.crypto.signTransaction(PUBLIC_SCALAR_ONE,structuredClone(buildTronUnsigned(intent,context,1200)));
  return {network:'nile',txid:transaction.txID,transaction};
}
const original=tuple();
function harness(config={}){
  const seen={calls:0,dns:0,bodies:[]};
  const dnsLookup=(host,opts,cb)=>{seen.dns++;queueMicrotask(()=>{const a=config.addresses??[{address:'8.8.8.8',family:4}];cb(config.dnsError,a);if(config.duplicateDNS)cb(null,a);});};
  const request=(url,options,callback)=>{
    seen.calls++;seen.options=options;seen.url=url.href;const req=new EventEmitter();req.destroy=()=>{seen.destroyed=true;};
    req.end=body=>{seen.bodies.push(body);if(config.hang)return;queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=config.status??200;response.headers={'content-type':config.type??'application/json',...(config.encoding?{'content-encoding':config.encoding}:{})};response.destroy=()=>{seen.responseDestroyed=true;};callback(response);
      if(config.responseError){response.emit('error',Error('private failure'));return;}
      for(const chunk of config.chunks??[config.body??JSON.stringify({result:true,txid:config.txid??original.txid})])response.emit('data',Buffer.from(chunk));
      if(config.aborted)response.emit('aborted');else response.emit('end');response.emit('close');
    });};
    queueMicrotask(()=>options.lookup(url.hostname,{family:config.lookupFamily??0},(error,address,family)=>{
      if(error){req.emit('error',error);return;}seen.pin={address,family};const socket=new EventEmitter();socket.remoteAddress=config.remote??address;socket.authorized=config.authorized??true;socket.encrypted=config.encrypted??true;
      req.emit('socket',socket);if(config.earlyResponse){const r=new EventEmitter();r.statusCode=200;r.headers={'content-type':'application/json'};r.destroy=()=>{};callback(r);}
      socket.emit('secureConnect');if(config.duplicateTLS)socket.emit('secureConnect');
    }));return req;
  };
  return {send:createTronBroadcastTransport({networkId:'nile',baseURL:'https://rpc.example/api/',request,dnsLookup,timeout:config.hang?30:1000,maxBytes:256}),seen};
}
test('original signed TRX bytes exact JSON single POST after public DNS authorized TLS',async()=>{
  const {send,seen}=harness({duplicateDNS:true,duplicateTLS:true});const r=await send(original);
  assert.deepEqual(r,{networkId:'nile',txid:original.txid,state:'submitted-unconfirmed',receipt:null});assert(Object.isFrozen(r));
  assert.equal(seen.url,'https://rpc.example/api/wallet/broadcasttransaction');assert.deepEqual(seen.bodies,[JSON.stringify(original.transaction)]);
  assert.equal(seen.options.method,'POST');assert.equal(seen.options.headers['content-type'],'application/json');assert.equal(seen.options.headers['content-length'],Buffer.byteLength(seen.bodies[0]));
  assert.equal(seen.options.agent,false);assert.equal(seen.options.useEnvProxy,false);assert.equal(seen.options.rejectUnauthorized,true);assert.equal(seen.dns,1);
  await assert.rejects(send(original),{code:'TRON_BROADCAST_ALREADY_ATTEMPTED'});assert.equal(seen.calls,1);
});
test('TRC20 original canonical signed transfer sends without rebuilding/signing',async()=>{
  const input=tuple(true),{send,seen}=harness({txid:input.txid});assert.equal((await send(input)).state,'submitted-unconfirmed');assert.deepEqual(seen.bodies,[JSON.stringify(input.transaction)]);
});
test('wrong network/hash/signature/raw/JSON/permission/extra contracts fail before DNS and consume attempt',async()=>{
  const mutations=[t=>{t.network='mainnet';},t=>{t.txid='00'.repeat(32);},t=>{t.transaction.signature=['00'.repeat(65)];},t=>{t.transaction.raw_data_hex+='0801';},t=>{t.transaction.raw_data.contract[0].parameter.value.amount++;},t=>{t.transaction.raw_data.memo='hidden';},t=>{t.transaction.raw_data.contract[0].Permission_id=2;},t=>{t.transaction.raw_data.contract.push(t.transaction.raw_data.contract[0]);},t=>{t.transaction.visible=true;},t=>{t.transaction.signature.push(t.transaction.signature[0]);},t=>{t.approved=true;}];
  for(const mutate of mutations){const input=structuredClone(original);mutate(input);const {send,seen}=harness();await assert.rejects(send(input));assert.equal(seen.dns,0);assert.equal(seen.bodies.length,0);await assert.rejects(send(original),{code:'TRON_BROADCAST_ALREADY_ATTEMPTED'});}
});
test('unsupported approve/TRX value/noncanonical token ABI/zero amount are never sent',async()=>{
  for(const mutate of [t=>{t.transaction.raw_data.contract[0].parameter.value.data='095ea7b3'+t.transaction.raw_data.contract[0].parameter.value.data.slice(8);},t=>{t.transaction.raw_data.contract[0].parameter.value.call_value=1;},t=>{t.transaction.raw_data.contract[0].parameter.value.data='a9059cbb'+'1'.repeat(128);},t=>{t.transaction.raw_data.contract[0].parameter.value.data=t.transaction.raw_data.contract[0].parameter.value.data.slice(0,72)+'0'.repeat(64);}]){
    const input=tuple(true);mutate(input);const {send,seen}=harness();await assert.rejects(send(input));assert.equal(seen.dns,0);
  }
});
test('config URLs proxy/auth/private literal/credentials/paths cannot expand endpoint authority',()=>{
  for(const baseURL of ['http://rpc.example','https://user:pass@rpc.example','https://127.0.0.1','https://[::1]','https://rpc.example:444','https://rpc.example/?key=x','https://rpc.example/#x','https://rpc.example/%2f','https://rpc.example/a/../b'])assert.throws(()=>createTronBroadcastTransport({networkId:'nile',baseURL}));
  assert.throws(()=>createTronBroadcastTransport({networkId:'nile',baseURL:'https://rpc.example',proxy:'http://proxy.example'}));
  assert.throws(()=>createTronBroadcastTransport({networkId:'fake',baseURL:'https://rpc.example'}));
});
test('mixed private reserved DNS and rebound/unauthorized TLS no body; IPv6 globally routed accepted',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','100.64.1.1','169.254.1.1','192.168.1.1','198.18.0.1','224.1.1.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002:0808:0808::1']){
    const {send,seen}=harness({addresses:[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}]});assert.equal((await send(original)).state,'unknown');assert.equal(seen.calls,0);await assert.rejects(send(original));
  }
  for(const config of [{remote:'9.9.9.9'},{remote:'127.0.0.1'},{authorized:false},{encrypted:false},{lookupFamily:6},{earlyResponse:true}]){const {send,seen}=harness(config);assert.equal((await send(original)).state,'unknown');assert.equal(seen.bodies.length,0);}
  const {send}=harness({addresses:[{address:'2606:4700:4700::1111',family:6}]});assert.equal((await send(original)).state,'submitted-unconfirmed');
});
test('error/HTTP redirect/missing or foreign ACK never imply success and never retry',async()=>{
  for(const config of [{status:302},{status:400},{status:500},{body:JSON.stringify({result:true})},{body:JSON.stringify({result:true,txid:'00'.repeat(32)})},{body:JSON.stringify({result:false,txid:original.txid})},{body:JSON.stringify({result:true,txid:original.txid,code:'DUP_TRANSACTION_ERROR'})},{body:JSON.stringify({result:true,txid:original.txid,Error:'failed'})},{body:JSON.stringify({result:true,txid:original.txid,message:'failure'})},{body:'[]'},{body:'{}'},{body:'malformed'},{type:'text/plain'},{encoding:'gzip'},{chunks:['x'.repeat(257)]},{chunks:[Buffer.from([0xff])]},{aborted:true},{responseError:true}]){
    const {send,seen}=harness(config);assert.deepEqual(await send(original),{networkId:'nile',txid:original.txid,state:'unknown',receipt:null});await assert.rejects(send(original));assert.equal(seen.calls,1);assert.deepEqual(seen.bodies,[JSON.stringify(original.transaction)]);
  }
});
test('timeout/DNS error/pre-abort/post-begin abort use up single attempt with UNKNOWN',async()=>{
  for(const config of [{hang:true},{dnsError:Error('offline')}]){const {send,seen}=harness(config);assert.equal((await send(original)).state,'unknown');await assert.rejects(send(original));assert.equal(seen.calls,config.hang?1:0);}
  const abort=new AbortController();abort.abort();const {send,seen}=harness();assert.equal((await send(original,{signal:abort.signal})).state,'unknown');assert.equal(seen.dns,0);await assert.rejects(send(original));
  const active=new AbortController(),pending=harness({hang:true});const p=pending.send(original,{signal:active.signal});queueMicrotask(()=>active.abort());assert.equal((await p).state,'unknown');await assert.rejects(pending.send(original));
});
test('tuple snapshot after invocation is immutable despite caller mutation',async()=>{
  const input=structuredClone(original),{send,seen}=harness();const p=send(input);input.transaction.raw_data.contract[0].parameter.value.amount=999;input.txid='00'.repeat(32);
  const r=await p;assert.equal(r.txid,original.txid);assert.deepEqual(seen.bodies,[JSON.stringify(original.transaction)]);
});
test('ambiguous duplicate/escaped JSON ACK keys remain UNKNOWN',async()=>{
  for(const body of ['{"result":false,"result":true,"txid":"'+original.txid+'"}','{"result":true,"txid":"'+original.txid+'","txid":"'+original.txid+'"}','{"r\\u0065sult":true,"txid":"'+original.txid+'"}']){
    const {send,seen}=harness({body});assert.equal((await send(original)).state,'unknown');assert.equal(seen.bodies.length,1);await assert.rejects(send(original));
  }
});
test('request and DNS synchronous faults remain UNKNOWN; extra options cannot inject headers or authority',async()=>{
  for(const override of [{dnsLookup(){throw Error('private DNS failure');}},{request(){throw Error('private TLS failure');},dnsLookup(host,opts,cb){cb(null,[{address:'8.8.8.8',family:4}]);}}]){
    const send=createTronBroadcastTransport({networkId:'nile',baseURL:'https://rpc.example',timeout:30,...override});assert.equal((await send(original)).state,'unknown');await assert.rejects(send(original));
  }
  for(const extra of [{headers:{authorization:'no'}},{signal:{}},{approved:true}]){
    const {send,seen}=harness();await assert.rejects(send(original,extra));assert.equal(seen.dns,0);await assert.rejects(send(original));
  }
});
