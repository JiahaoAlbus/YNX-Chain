import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {preparePQMigrationTransport,decodePQMigrationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const row=vector.originals.find(x=>x.name==='rotation'),wire=Buffer.from(row.wire,'base64'),request=preparePQMigrationTransport(wire),decoded=decodePQMigrationRequest(wire),binding={account:decoded.intent.owner,networkId:decoded.intent.chainId};
const original=createPQOriginalRecord({account:binding.account,kind:'pq-migration',operationId:'PUBLIC-migration-node',request}),health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
function fixture({status=202,headers={},bytes=Buffer.from('{"error":"PUBLIC pending"}'),event,first,effect,clock=()=>0}={}){
 const calls=[];const impl=(url,options,receive)=>{const req=new EventEmitter();req.destroy=()=>req.emit('error',Error('cleanup only'));req.end=body=>{const i=calls.length;calls.push({url,options,body});queueMicrotask(()=>{const res=new EventEmitter();res.destroy=()=>res.emit('error',Error('cleanup only'));res.statusCode=i<2?200:status;res.headers={'content-type':'application/json','cache-control':'no-store',...(i===2?headers:{})};receive(res);if(i===0)first?.();if(i===2)effect?.();if(i===2&&event){res.emit(event,false);return;}res.emit('data',i===0?Buffer.from(JSON.stringify(health)):i===1?Buffer.from(JSON.stringify({height:0,hash:CANONICAL_NETWORK_ID})):bytes);res.emit('end');res.emit('close');});};return req;};return{calls,kernel:new PQTransactionNodeTransportKernel(impl,clock)};
}
test('migration normal node sends detached original E6 once to exact canonical migrate route',async()=>{
 assert.equal(binding.networkId,CANONICAL_NETWORK_ID);const body=Buffer.from(wire),input={...request,body},f=fixture({first:()=>body.fill(0)}),out=await f.kernel.submitMigration(input,()=>{});
 assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['POST','/accounts/'+binding.account+'/authorization/migrate']]);assert.deepEqual(f.calls[2].body,wire);assert.equal(f.calls[2].options.headers['content-type'],'application/octet-stream');assert.equal(out.method,'POST');assert.equal(out.status,202);assert.deepEqual(Object.keys(out),['method','requestPath','status','contentType','cacheControl','body']);
 for(const c of f.calls){assert.equal(c.url.origin,NORMAL_OPERATOR.origin);assert.equal(c.options.agent,false);assert.equal(c.options.rejectUnauthorized,true);assert.equal(typeof c.options.checkServerIdentity,'function');}
});
test('migration refuses absent guard and altered URL/body/hash before I/O',async()=>{
 const f=fixture();await assert.rejects(f.kernel.submitMigration(request),{code:'PQ_TRANSACTION_NODE_CURRENT_REQUIRED'});
 for(const edit of [{path:'/transactions/pq/broadcast'},{transportHash:'0x'+'12'.repeat(32)},{contentType:'application/json'},{body:Buffer.from('not E6')}])await assert.rejects(f.kernel.submitMigration({...request,...edit},()=>{}));assert.equal(f.calls.length,0);
});
test('migration complete raw response survives effect lock, malformed UTF8 and admission rejection without another POST',async()=>{
 for(const status of [200,202,400,413,415,422]){let current=true;const bytes=Buffer.from([255,0,1]),f=fixture({status,bytes,effect:()=>{current=false;}}),out=await f.kernel.submitMigration(request,()=>{if(!current)throw Error('LATE_LOCK')});assert.deepEqual(Buffer.from(out.body),bytes);assert.equal(out.status,status);assert.equal(f.calls.length,3);}
});
test('migration stream first cause and HTTP bounds never retry or follow redirects',async()=>{
 for(const event of ['aborted','close','error']){const f=fixture({event});await assert.rejects(f.kernel.submitMigration(request,()=>{}),e=>event==='error'?e===false:e.code==='PQ_TRANSACTION_NODE_RESPONSE_ABORTED');assert.equal(f.calls.length,3);}
 for(const extra of [{status:302},{status:404},{status:500},{headers:{'cache-control':'public'}},{headers:{'content-type':'text/plain'}},{headers:{'content-encoding':'gzip'}},{bytes:Buffer.alloc(524289)}]){const f=fixture(extra);await assert.rejects(f.kernel.submitMigration(request,()=>{}));assert.equal(f.calls.length,3);}
});
test('migration proof collector uses canonical envelope ABCI hash, never E6 hash or another POST',async()=>{
 assert.notEqual(row.nativeWireHash,row.abciTransactionHash);const f=fixture({status:502,bytes:Buffer.from('{"error":"unavailable DATA"}')});const out=await f.kernel.readFinalityProof(original,binding);assert.equal(out.status,502);assert.equal(f.calls[2].url.pathname,'/txs/'+row.abciTransactionHash+'/pq-finality-proof');assert(f.calls.every(c=>c.options.method==='GET'));assert.deepEqual(Object.keys(out),['status','rawBytes']);
});
