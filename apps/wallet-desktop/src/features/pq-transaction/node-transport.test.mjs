import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
const v=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const wire=Buffer.from(v.originals.find(x=>x.name==='transfer-lost-response').wire,'base64'),request=preparePQTransferTransport(wire);
const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
function fixture(extra={}){
 const calls=[];const requestImpl=(url,options,receive)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=body=>{calls.push({url,options,body});queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json','cache-control':'no-store'};res.destroy=()=>{res.emit('error',Error('CONTROLLED_DESTROY'));};
 let bytes=Buffer.from(JSON.stringify(url.pathname==='/status'?(extra.health??health):url.pathname==='/blocks/0'?{height:0,hash:CANONICAL_NETWORK_ID}:{status:'unknown'}));
 if(url.pathname!=='/status'&&url.pathname!=='/blocks/0'){if(extra.status)res.statusCode=extra.status;if(extra.bytes)bytes=extra.bytes;if(extra.headers)res.headers=extra.headers;}
 receive(res);if(res.listenerCount('data')){res.emit('data',bytes);res.emit('end');}});};return req;};
 return {calls,transport:new PQTransactionNodeTransportKernel(requestImpl)};
}
test('fixed existing node pins and exact SDK POST are preserved; reconciliation only GETs the BFT original',async()=>{
 const f=fixture();assert.equal((await f.transport.submitTransfer(request,()=>{})).status,200);assert.deepEqual(f.calls.map(x=>[x.options.method,x.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['POST','/transactions/pq/broadcast']]);
 assert.deepEqual(f.calls[2].body,wire);assert.equal(f.calls[2].options.rejectUnauthorized,true);assert.equal(typeof f.calls[2].options.checkServerIdentity,'function');assert.equal(f.calls[2].url.origin,NORMAL_OPERATOR.origin);
 await f.transport.readOriginal(request.transportHash);assert.equal(f.calls.at(-1).url.pathname,'/transactions/pq/originals/'+request.transportHash);assert.equal(f.calls.at(-1).options.method,'GET');assert.equal(f.calls.at(-1).body,undefined);
});
test('wrong URL/hash/native policy and unhealthy release fail before any POST',async()=>{
 const f=fixture();await assert.rejects(f.transport.submitTransfer({...request,path:'/other'},()=>{}),{code:'PQ_TRANSACTION_NODE_REQUEST'});assert.equal(f.calls.length,0);
 const old=fixture({health:{...health,build:{commit:'other',release:health.build.release}}});await assert.rejects(old.transport.submitTransfer(request,()=>{}),{code:'PQ_TRANSACTION_NODE_VERSION_OR_HEALTH'});assert.equal(old.calls.length,1);
});
test('redirect, cacheable, oversized and invalid UTF8 results are bounded failures, never followed/retried',async()=>{
 for(const [extra,code] of [[{status:302},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'content-type':'application/json'}},'PQ_TRANSACTION_NODE_CACHE_POLICY'],[{bytes:Buffer.alloc(524289)},'PQ_TRANSACTION_NODE_RESPONSE_SIZE'],[{bytes:Buffer.from([255])},'PQ_TRANSACTION_NODE_UTF8']]){const f=fixture(extra);await assert.rejects(f.transport.submitTransfer(request,()=>{}),{code});assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);}
});
