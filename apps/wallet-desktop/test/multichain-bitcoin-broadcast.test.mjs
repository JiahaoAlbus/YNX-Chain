import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Transaction} from 'bitcoinjs-lib';
import {createBitcoinBroadcastTransport} from '../src/multichain-bitcoin-broadcast.mjs';

// Synthetic PUBLIC witness bytes only, no account/key/funds/signature production.
const tx=new Transaction();tx.version=2;tx.addInput(new Uint8Array(32),0);tx.addOutput(Uint8Array.from([0x00,0x14,...new Array(20).fill(1)]),1000n);tx.setWitness(0,[Uint8Array.from([1]),Uint8Array.from([2])]);
const tuple={network:'testnet4',txid:tx.getId(),rawTransaction:tx.toHex()};
function harness(config={}) {
  const seen={calls:0,dns:0,bodies:[],options:null};
  const dnsLookup=(host,opts,cb)=>{seen.dns++;queueMicrotask(()=>{const a=config.addresses??[{address:'8.8.8.8',family:4}];cb(config.dnsError,a);if(config.duplicateDNS)cb(null,a);});};
  const request=(url,options,callback)=>{
    seen.calls++;seen.options=options;seen.url=url.href;
    const req=new EventEmitter();req.destroy=()=>{seen.destroyed=true;};
    req.end=body=>{
      seen.bodies.push(body);
      if(config.hang)return;
      queueMicrotask(()=>{
        const response=new EventEmitter();response.statusCode=config.status??200;response.headers={'content-type':config.type??'text/plain',...(config.encoding?{'content-encoding':config.encoding}:{})};response.destroy=()=>{seen.responseDestroyed=true;};
        callback(response);
        if(config.responseError){response.emit('error',new Error('offline'));return;}
        for(const chunk of config.chunks??[config.body??tuple.txid]) response.emit('data',Buffer.from(chunk));
        if(config.aborted)response.emit('aborted');else response.emit('end');
        response.emit('close');
      });
    };
    queueMicrotask(()=>options.lookup(url.hostname,{family:config.lookupFamily??0},(error,address,family)=>{
      if(error){req.emit('error',error);return;}
      seen.pin={address,family};
      const socket=new EventEmitter();socket.remoteAddress=config.remote??address;socket.authorized=config.authorized??true;socket.encrypted=config.encrypted??true;
      req.emit('socket',socket);socket.emit('secureConnect');
    }));
    return req;
  };
  const send=createBitcoinBroadcastTransport({networkId:'testnet4',baseURL:'https://explorer.example/api/',request,dnsLookup,timeout:30,maxBytes:128});
  return {send,seen};
}
test('BTC broadcast exact original text POST after pinned authorized TLS and one-shot ACK',async()=>{
  const {send,seen}=harness({duplicateDNS:true});assert.deepEqual(await send(tuple),{networkId:'testnet4',txid:tuple.txid,state:'submitted-unconfirmed',receipt:null});
  assert.equal(seen.url,'https://explorer.example/api/tx');assert.deepEqual(seen.bodies,[tuple.rawTransaction]);assert.equal(seen.options.method,'POST');assert.equal(seen.options.headers['content-type'],'text/plain');assert.equal(seen.options.headers['content-length'],tuple.rawTransaction.length);assert.equal(seen.options.agent,false);assert.equal(seen.options.rejectUnauthorized,true);assert.equal(seen.options.useEnvProxy,false);assert.equal(seen.dns,1);
  await assert.rejects(send(tuple),{code:'BTC_BROADCAST_ALREADY_ATTEMPTED'});assert.equal(seen.calls,1);
});
test('BTC broadcast invalid tuple and config never send body or get authority',async()=>{
  for(const changed of [{...tuple,network:'mainnet'},{...tuple,txid:'0'.repeat(64)},{...tuple,rawTransaction:'{}'},{...tuple,rawTransaction:tuple.rawTransaction.toUpperCase()},{...tuple,signer:true}]){const {send,seen}=harness();await assert.rejects(send(changed));assert.equal(seen.calls,0);}
  for(const baseURL of ['http://explorer.example/api','https://u:p@explorer.example','https://127.0.0.1','https://[::1]','https://explorer.example:444','https://explorer.example/?key=x','https://explorer.example/#x','https://explorer.example/%2f'])assert.throws(()=>createBitcoinBroadcastTransport({networkId:'testnet4',baseURL}));
  assert.throws(()=>createBitcoinBroadcastTransport({networkId:'testnet4',baseURL:'https://explorer.example',proxy:'http://proxy.example'}));
});
test('BTC broadcast mixed/private/reserved DNS and rebound/unauthorized TLS blocked before body',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','100.64.1.1','169.254.1.1','192.168.1.1','198.18.0.1','224.1.1.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002:0808:0808::1']){const {send,seen}=harness({addresses:[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}]});assert.equal((await send(tuple)).state,'unknown');assert.equal(seen.calls,0);}
  for(const config of [{remote:'9.9.9.9'},{remote:'127.0.0.1'},{authorized:false},{encrypted:false},{lookupFamily:6}]){const {send,seen}=harness(config);assert.equal((await send(tuple)).state,'unknown');assert.equal(seen.bodies.length,0);await assert.rejects(send(tuple));}
  const {send}=harness({addresses:[{address:'2606:4700:4700::1111',family:6}]});assert.equal((await send(tuple)).state,'submitted-unconfirmed');
});
test('BTC broadcast HTTP errors redirects mismatches malformed bounded reply remain UNKNOWN no retry',async()=>{
  for(const config of [{status:302},{status:400},{status:500},{body:'0'.repeat(64)},{body:tuple.txid+'\n'},{body:JSON.stringify(tuple.txid)},{type:'application/json'},{encoding:'gzip'},{chunks:['x'.repeat(129)]},{aborted:true},{responseError:true}]){const {send,seen}=harness(config);assert.deepEqual(await send(tuple),{networkId:'testnet4',txid:tuple.txid,state:'unknown',receipt:null});await assert.rejects(send(tuple));assert.equal(seen.calls,1);assert.deepEqual(seen.bodies,[tuple.rawTransaction]);}
});
test('BTC broadcast timeout abort DNS error retain one attempt and original tuple',async()=>{
  for(const config of [{hang:true},{dnsError:new Error('offline')}]){const {send,seen}=harness(config);assert.equal((await send(tuple)).state,'unknown');await assert.rejects(send(tuple));assert.equal(seen.calls,config.hang?1:0);}
  const controller=new AbortController();controller.abort();const {send,seen}=harness();assert.equal((await send(tuple,{signal:controller.signal})).state,'unknown');assert.equal(seen.dns,0);await assert.rejects(send(tuple));
  const active=new AbortController(), pending=harness({hang:true});const promise=pending.send(tuple,{signal:active.signal});queueMicrotask(()=>active.abort());assert.equal((await promise).state,'unknown');await assert.rejects(pending.send(tuple));
});
