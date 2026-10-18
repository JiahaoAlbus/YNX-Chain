import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const source=readFileSync(process.env.WALLET_METADATA_MAIN_SOURCE??new URL('../src/main.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function safeIPC('),source.indexOf('\nfunction safeCode(',source.indexOf('async function safeIPC(')));
function actualSafeIPC(record,getPath=()=>'/PUBLIC_QA_PROFILE') {
 return Function('recordRPCMetadataFailure','app','path','safeCode',body+'; return safeIPC;')(record,{getPath},path,e=>e?.data?.code??e?.code??'WALLET_REQUEST_FAILED');
}
test('actual main safeIPC consumes private observation before unchanged renderer projection',async()=>{
 const calls=[],failure=Object.assign(Error('PUBLIC timeout'),{data:{code:'RPC_TIMEOUT'}});Object.defineProperty(failure,'rpcMetadataObservation',{value:{method:'ynx_getFeeModel'}});
 const safe=actualSafeIPC((e,p)=>calls.push([e,p]));
 const result=await safe(async()=>{throw failure;});
 assert.deepEqual(calls,[[failure,'/PUBLIC_QA_PROFILE/wallet-rpc-metadata-failures-v1.jsonl']]);
 assert.deepEqual(result,{ok:false,error:{code:'RPC_TIMEOUT',message:'PUBLIC timeout'}});
 assert.equal(Object.hasOwn(result.error,'rpcMetadataObservation'),false);
});
test('diagnostic path or recorder failure does not change returned error or success',async()=>{
 const e=Object.assign(Error('PUBLIC failure'),{data:{code:'RPC_UNAVAILABLE'}});
 for(const safe of [actualSafeIPC(()=>{throw Error('PUBLIC disk failure');}),actualSafeIPC(()=>assert.fail(),()=>{throw Error('PUBLIC path failure');})]) {
   assert.deepEqual(await safe(async()=>{throw e;}),{ok:false,error:{code:'RPC_UNAVAILABLE',message:'PUBLIC failure'}});
   assert.deepEqual(await safe(async()=>42),{ok:true,value:42});
 }
});
