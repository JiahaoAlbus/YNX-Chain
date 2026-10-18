import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalAccountNetwork} from '../src/native-wallet-service.mjs';
test('metadata transport timeout keeps its real platform cause and bounded method observation',async()=>{
 const original=Object.assign(Error('PUBLIC controlled timeout'),{name:'TimeoutError'}),n=new CanonicalAccountNetwork({fetchImpl:async()=>{throw original;}});
 await assert.rejects(n.request('ynx_getDurabilityModel'),e=>{assert.equal(e.data.code,'RPC_TIMEOUT');assert.equal(e.cause,original);assert.equal(e.rpcMetadataObservation.method,'ynx_getDurabilityModel');assert.equal(e.rpcMetadataObservation.stage,'fetch');assert.equal(e.rpcMetadataObservation.httpStatus,null);assert.ok(Number.isSafeInteger(e.rpcMetadataObservation.elapsedMs));assert.ok(Object.isFrozen(e.rpcMetadataObservation));return true;});
});
test('metadata JSON decode failure is a response error, not an unreachable network',async()=>{
 const original=SyntaxError('PUBLIC malformed metadata JSON'),n=new CanonicalAccountNetwork({fetchImpl:async()=>({ok:true,status:200,url:'https://rpc-testnet.ynxweb4.com/',redirected:false,json:async()=>{throw original;}})});
 await assert.rejects(n.request('ynx_getDurabilityModel'),e=>{assert.equal(e.data.code,'RPC_INVALID_RESPONSE');assert.equal(e.cause,original);assert.equal(e.rpcMetadataObservation.stage,'decode');assert.equal(e.rpcMetadataObservation.httpStatus,200);return true;});
});
test('explicit RPC failure retains its method/status but no params, request or body in observation',async()=>{
 const n=new CanonicalAccountNetwork({fetchImpl:async()=>({ok:true,status:200,url:'https://rpc-testnet.ynxweb4.com/',redirected:false,json:async()=>({jsonrpc:'2.0',id:1,error:{code:-32601,message:'PUBLIC method missing'}})})});
 await assert.rejects(n.request('ynx_getDurabilityModel'),e=>{assert.equal(e.data.rpcCode,-32601);assert.equal(e.rpcMetadataObservation.stage,'envelope');assert.deepEqual(Object.keys(e.rpcMetadataObservation).sort(),['elapsedMs','endpoint','httpStatus','method','requestId','stage']);return true;});
});
test('nonmetadata requests never acquire the metadata observation field',async()=>{
 const n=new CanonicalAccountNetwork({fetchImpl:async()=>{throw Error('PUBLIC unavailable');}});await assert.rejects(n.request('eth_chainId'),e=>{assert.equal(e.data.code,'RPC_UNAVAILABLE');assert.equal(Object.hasOwn(e,'rpcMetadataObservation'),false);return true;});
});
test('reused original failure keeps first observation and cannot be masked by redefining it',async()=>{
 const original=Object.assign(Error('PUBLIC preserved error'),{data:{code:'RPC_UNAVAILABLE'}}),n=new CanonicalAccountNetwork({fetchImpl:async()=>{throw original;}});
 await assert.rejects(n.request('ynx_getFeeModel'),e=>e===original);const observed=original.rpcMetadataObservation;
 await assert.rejects(n.request('ynx_getDurabilityModel'),e=>e===original);assert.equal(original.rpcMetadataObservation,observed);assert.equal(observed.method,'ynx_getFeeModel');
});
test('frozen original error remains original even when annotation is unavailable',async()=>{
 const original=Object.freeze(Object.assign(Error('PUBLIC fixed error'),{data:{code:'RPC_UNAVAILABLE'}})),n=new CanonicalAccountNetwork({fetchImpl:async()=>{throw original;}});await assert.rejects(n.request('ynx_getFeeModel'),e=>e===original);
});
test('concurrent metadata failures retain the exact allocated wire id and fixed endpoint without params',async()=>{
 const sent=[],pending=[];
 const n=new CanonicalAccountNetwork({fetchImpl:(endpoint,options)=>{sent.push({endpoint,id:JSON.parse(options.body).id});return new Promise((_,reject)=>pending.push(reject));}});
 const a=n.request('ynx_getFeeModel',['DO_NOT_RECORD']),b=n.request('ynx_getDurabilityModel');
 const errors=Promise.allSettled([a,b]);pending[1](Error('PUBLIC second'));pending[0](Error('PUBLIC first'));
 const results=await errors;
 for(let i=0;i<2;i++){const trace=results[i].reason.rpcMetadataObservation;assert.equal(trace.requestId,sent[i].id);assert.equal(trace.endpoint,sent[i].endpoint);assert.doesNotMatch(JSON.stringify(trace),/DO_NOT_RECORD|params/);}
 assert.notEqual(sent[0].id,sent[1].id);
});
