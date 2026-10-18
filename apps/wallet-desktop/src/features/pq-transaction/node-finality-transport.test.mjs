import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {PQTransactionNodeTransportKernel,createPQTransactionNodeTransport} from './node-transport.mjs';
import {planPQTransferFinalityCollector,PQ_FINALITY_COLLECTOR_LIMITS as limits} from './finality-collector.mjs';

// PUBLIC producer wire; every HTTPS peer and event below is controlled I/O.
const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const wire=Buffer.from(vector.originals.find(x=>x.name==='transfer-lost-response').wire,'base64');
const binding=Object.freeze({account:vector.owner,networkId:vector.networkId});
const original=createPQOriginalRecord({account:binding.account,kind:'pq-transfer',operationId:'QA-finality-transport',request:preparePQTransferTransport(wire)});
const plan=planPQTransferFinalityCollector(original,binding);
const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
const maximum=limits.proofBytes+limits.envelopeBytes;
const digest=value=>createHash('sha256').update(value).digest('hex');

function fixture({phase=2,status=200,headers,bytes=Buffer.from('{}'),events,healthValue=health,genesis={height:0,hash:CANONICAL_NETWORK_ID},timeout=false,requestError=false,delayResponse=false}={}) {
  const calls=[];let clockReads=0;
  const clock=()=>++clockReads===1?0:timeout&&calls.length>=phase?NORMAL_OPERATOR.lifetimeMs-2:0;
  const requestImpl=(url,options,receive)=>{
    const req=new EventEmitter();const call={url,options,req,res:null,body:null,requestDestroyed:0,responseDestroyed:0};
    req.destroy=()=>{call.requestDestroyed++;req.emit('error',Error('CONTROLLED_REQUEST_DESTROY'));};
    req.end=body=>{call.body=body;const index=calls.length;calls.push(call);queueMicrotask(()=>{
      if(index===phase&&requestError){req.emit('error',Object.assign(Error('CONTROLLED_REQUEST_ERROR'),{code:'CONTROLLED_REQUEST_ERROR'}));return;}
      const deliver=()=>{
      const res=new EventEmitter();call.res=res;res.statusCode=index===phase?status:200;
      res.headers=index===phase&&headers?headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'};
      res.destroy=()=>{call.responseDestroyed++;res.emit('error',Error('CONTROLLED_RESPONSE_DESTROY'));res.emit('close');};
      receive(res);
      if(index===phase){if(events){events(res,req,call);return;}if(timeout)return;}
      const payload=index===0?Buffer.from(JSON.stringify(healthValue)):index===1?Buffer.from(JSON.stringify(genesis)):bytes;
      res.emit('data',payload);res.emit('end');res.emit('close');
      };
      if(index===phase&&delayResponse)call.deliver=deliver;else deliver();
    });};
    return req;
  };
  return {calls,transport:new PQTransactionNodeTransportKernel(requestImpl,clock)};
}
const read=f=>f.transport.readFinalityProof(original,binding);

test('shared metadata and original reads reject abort/early close and destroy both sides before late end',async()=>{
  for(const phase of [0,1,2])for(const event of ['aborted','close']) {
    const f=fixture({phase,events:res=>{res.emit(event);res.emit('data',Buffer.from('{}'));res.emit('end');}});
    await assert.rejects(f.transport.readOriginal(original.hash),{code:'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});
    assert.equal(f.calls.length,phase+1);assert.equal(f.calls[phase].requestDestroyed,1);assert.equal(f.calls[phase].responseDestroyed,1);
  }
});

test('new factory entry binds the original ABCI GET, fixed TLS/node gates and closed raw result',async()=>{
  const raw=Buffer.from(' {"keep":"exact bytes"}\r\n'),f=fixture({bytes:raw});
  const result=await read(f);
  assert.deepEqual(Object.keys(createPQTransactionNodeTransport()),['submitTransfer','readOriginal','readFinalityProof']);
  assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['GET',plan.path]]);
  assert.notEqual(plan.path,'/txs/'+original.hash+'/pq-finality-proof');
  for(const call of f.calls){assert.equal(call.url.origin,NORMAL_OPERATOR.origin);assert.equal(call.options.agent,false);assert.equal(call.options.rejectUnauthorized,true);assert.equal(typeof call.options.checkServerIdentity,'function');assert.equal(call.body,undefined);}
  assert.deepEqual(Object.keys(result),['status','rawBytes']);assert.equal(result.status,200);assert.ok(result.rawBytes instanceof Uint8Array);assert.ok(Object.isFrozen(result));
  assert.equal(digest(result.rawBytes),digest(raw));raw.fill(0);assert.equal(Buffer.from(result.rawBytes).toString(),' {"keep":"exact bytes"}\r\n');
  assert.equal(f.calls[2].options.headers['accept-encoding'],'identity');
});

test('original account/network/wire and caller URL injection fail before any I/O',async()=>{
  const f=fixture();let getterCalls=0;
  for(const [record,context] of [[{...original,path:'/other'},binding],[{...original,hash:'0x'+'ab'.repeat(32)},binding],[original,{...binding,networkId:'ab'.repeat(32)}],[original,{...binding,account:'0x'+'ab'.repeat(20)}],[plan,binding],[original,{...binding,url:'https://example.invalid'}],[Object.defineProperty({...original},'wire',{get(){getterCalls++;return original.wire;}}),binding]])await assert.rejects(f.transport.readFinalityProof(record,context),error=>/^PQ_/.test(error.code));
  assert.equal(getterCalls,0);assert.equal(f.calls.length,0);
});

test('metadata version/genesis/JSON/size gates still stop the finality request',async()=>{
  for(const [options,code,count] of [
    [{healthValue:{...health,build:{...health.build,commit:'other'}}},'PQ_TRANSACTION_NODE_VERSION_OR_HEALTH',1],
    [{genesis:{height:0,hash:'ab'.repeat(32)}},'PQ_TRANSACTION_NODE_NETWORK',2],
    [{phase:0,status:502},'PQ_TRANSACTION_NODE_RESPONSE',1],
    [{phase:1,events:res=>{res.emit('data',Buffer.from('{'));res.emit('end');}},'PQ_TRANSACTION_NODE_JSON',2],
    [{phase:0,events:res=>{res.emit('data',Buffer.alloc(524289));res.emit('end');}},'PQ_TRANSACTION_NODE_RESPONSE_SIZE',1],
  ]){const f=fixture(options);await assert.rejects(read(f),{code});assert.equal(f.calls.length,count);}
});

test('200/202/502 preserve full bytes including malformed JSON/UTF8 for protected evidence',async()=>{
  const bytes=Buffer.from([0xef,0xbb,0xbf,0xff,0,0x7b]);
  for(const status of [200,202,502]){const f=fixture({status,bytes}),result=await read(f);assert.equal(result.status,status);assert.deepEqual(Buffer.from(result.rawBytes),bytes);assert.equal(f.calls.length,3);}
});

test('collector rejects all other status/redirect/content-type/cache policies without retry',async()=>{
  for(const [options,code] of [
    ...[199,201,204,301,302,307,400,500,503].map(status=>[{status},'PQ_TRANSACTION_NODE_RESPONSE']),
    [{headers:{'content-type':'text/html','cache-control':'no-store'}},'PQ_TRANSACTION_NODE_RESPONSE'],
    [{headers:{'content-type':'application/json','cache-control':'no-cache'}},'PQ_TRANSACTION_NODE_CACHE_POLICY'],
  ]){const f=fixture(options);await assert.rejects(read(f),{code});assert.equal(f.calls.length,3);assert.equal(f.calls[2].requestDestroyed,1);assert.equal(f.calls[2].responseDestroyed,1);}
});

test('whole collector bytes exceed old 8MiB and accept the exact 80MiB plus 64KiB cap',async()=>{
  const chunk=Buffer.alloc(1024*1024,0x20),tail=Buffer.alloc(limits.envelopeBytes,0x0a);
  const f=fixture({events:res=>{for(let i=0;i<80;i++)res.emit('data',chunk);res.emit('data',tail);chunk.fill(0);tail.fill(0);res.emit('end');}});
  const result=await read(f);assert.equal(result.rawBytes.byteLength,maximum);
  assert.equal(result.rawBytes[0],0x20);assert.equal(result.rawBytes[80*1024*1024-1],0x20);assert.equal(result.rawBytes.at(-1),0x0a);
});

test('one byte over whole cap rejects and late data/end cannot replace first cause',async()=>{
  const f=fixture({events:res=>{const chunk=Buffer.alloc(1024*1024);for(let i=0;i<80;i++)res.emit('data',chunk);res.emit('data',Buffer.alloc(limits.envelopeBytes+1));res.emit('data',Buffer.from('{}'));res.emit('end');}});
  await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_RESPONSE_SIZE'});assert.equal(f.calls.length,3);assert.equal(f.calls[2].requestDestroyed,1);assert.equal(f.calls[2].responseDestroyed,1);
});

test('collector abort/early close/incomplete end/error keeps first cause and cleans both streams',async()=>{
  for(const event of ['aborted','close','incomplete','error']) {
    const f=fixture({events:res=>{res.emit('data',Buffer.from('{'));if(event==='incomplete'){res.complete=false;res.emit('end');}else if(event==='error')res.emit('error',Object.assign(Error('CONTROLLED_PEER_ERROR'),{code:'CONTROLLED_PEER_ERROR'}));else res.emit(event);res.emit('data',Buffer.from('}'));res.emit('end');}});
    await assert.rejects(read(f),{code:event==='error'?'CONTROLLED_PEER_ERROR':'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});
    assert.equal(f.calls[2].requestDestroyed,1);assert.equal(f.calls[2].responseDestroyed,1);assert.equal(f.calls.length,3);
  }
});

test('one original deadline covers metadata and collector timeouts, with no retry',async()=>{
  for(const phase of [0,1,2]){const f=fixture({phase,timeout:true});await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_TIMEOUT'});assert.equal(f.calls.length,phase+1);assert.equal(f.calls[phase].requestDestroyed,1);assert.equal(f.calls[phase].responseDestroyed,1);}
});

test('request failure before response cleans the original request without another GET',async()=>{
  for(const phase of [0,1,2]){const f=fixture({phase,requestError:true});await assert.rejects(read(f),{code:'CONTROLLED_REQUEST_ERROR'});assert.equal(f.calls.length,phase+1);assert.equal(f.calls[phase].requestDestroyed,1);assert.equal(f.calls[phase].res,null);}
});

test('late response after timeout is destroyed without data listeners or a second request',async()=>{
  for(const phase of [0,1,2]){
    const f=fixture({phase,timeout:true,delayResponse:true});await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_TIMEOUT'});
    const call=f.calls[phase];assert.equal(call.res,null);call.deliver();
    assert.equal(call.res.listenerCount('data'),0);assert.equal(call.res.listenerCount('end'),0);
    call.res.emit('data',Buffer.from('{}'));call.res.emit('end');call.res.emit('error',Error('CONTROLLED_LATE_ERROR'));
    assert.equal(call.requestDestroyed,1);assert.equal(call.responseDestroyed,1);assert.equal(f.calls.length,phase+1);
  }
});

test('input mutation during awaited metadata cannot replace the already-bound GET',async()=>{
  const record={...original},context={...binding},f=fixture();const pending=f.transport.readFinalityProof(record,context);
  record.hash='0x'+'ab'.repeat(32);record.wire='';context.networkId='ab'.repeat(32);context.account='0x'+'ab'.repeat(20);
  await pending;assert.equal(f.calls.at(-1).url.pathname,plan.path);assert.equal(f.calls.length,3);
});

test('successful complete end clears the timeout and preserves byte-wise chunk boundaries',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const raw=Buffer.from(' {"whole":"bytes"}\r\n'),f=fixture({events:res=>{for(const byte of raw)res.emit('data',Buffer.from([byte]));res.emit('data',Buffer.alloc(0));res.emit('end');res.emit('close');}});
  assert.deepEqual(Buffer.from((await read(f)).rawBytes),raw);t.mock.timers.tick(NORMAL_OPERATOR.lifetimeMs+1);
  for(const call of f.calls){assert.equal(call.requestDestroyed,0);assert.equal(call.responseDestroyed,0);}
});

test('request close after a complete HTTP message still drains buffered response before end',async()=>{
  const raw=Buffer.from('{"complete":"buffered"}'),f=fixture({events:(res,req)=>{res.complete=true;req.emit('close');res.emit('data',raw);res.emit('end');res.emit('close');}});
  assert.deepEqual(Buffer.from((await read(f)).rawBytes),raw);
  assert.equal(f.calls[2].requestDestroyed,0);assert.equal(f.calls[2].responseDestroyed,0);
});

test('request close with incomplete response rejects immediately and keeps the first cause',async()=>{
  const f=fixture({events:(res,req)=>{res.complete=false;req.emit('close');res.emit('data',Buffer.from('{}'));res.emit('end');}});
  await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});
  assert.equal(f.calls[2].requestDestroyed,1);assert.equal(f.calls[2].responseDestroyed,1);
});
