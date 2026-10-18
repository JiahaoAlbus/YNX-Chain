import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalAccountNetwork} from '../src/native-wallet-service.mjs';
import {DURABILITY_MODEL} from '../src/transaction-durability.mjs';
import {providerError} from '../src/desktop-wallet-vault.mjs';
const fee={version:'ynx-ethereum-native-v1',chainId:'0x1917',transactionType:'0x0',feeYNXT:'1',feeWei:'0xde0b6b3a7640000',gas:'0x61a8',gasPrice:'0x246139ca8000',decimals:18,amountQuantumWei:'0xde0b6b3a7640000',scope:'whole-YNXT plain native transfers',fullEVM:false,eip1559:false,enabled:true,durability:DURABILITY_MODEL};
const network=(answer)=>{const calls=[],n=new CanonicalAccountNetwork();n.request=async method=>{calls.push(method);if(method==='ynx_getFeeModel')return fee;return answer();};return{n,calls};};
for(const code of ['RPC_TIMEOUT','RPC_UNAVAILABLE','RPC_INVALID_RESPONSE'])test('durability request preserves original '+code+' instead of claiming unsupported model',async()=>{
 const original=providerError(4900,code,'PUBLIC controlled transport failure'),{n,calls}=network(()=>{throw original;});
 await assert.rejects(n.capabilities(),error=>error===original);assert.deepEqual(calls,['ynx_getFeeModel','ynx_getDurabilityModel']);
});
test('explicit missing RPC method retains its cause but remains unsupported',async()=>{
 const original=Object.assign(Error('PUBLIC method missing'),{data:{rpcCode:-32601}}),{n}=network(()=>{throw original;});
 await assert.rejects(n.capabilities(),error=>error.data?.code==='RPC_DURABILITY_UNSUPPORTED'&&error.cause===original);
});
test('node execution error is not relabelled as a schema or transport conclusion',async()=>{
 const original=Object.assign(Error('PUBLIC node failure'),{data:{rpcCode:-32000}}),{n}=network(()=>{throw original;});await assert.rejects(n.capabilities(),e=>e===original);
});
test('invalid explicit model still fails closed with parser cause retained',async()=>{
 for(const value of [{...DURABILITY_MODEL,consensusFinality:true},{...DURABILITY_MODEL,pendingStatus:'pending'},null]){const {n}=network(()=>value);await assert.rejects(n.capabilities(),e=>e.data?.code==='RPC_DURABILITY_UNSUPPORTED'&&e.cause?.data?.code==='RPC_DURABILITY_UNSUPPORTED');}
});
test('exact currently advertised model passes without bypassing its separate read',async()=>{
 const {n,calls}=network(()=>({...DURABILITY_MODEL})),result=await n.capabilities();assert.deepEqual(result.durability,DURABILITY_MODEL);assert.deepEqual(calls,['ynx_getFeeModel','ynx_getDurabilityModel']);
});
test('canonical root response URL may use the standard trailing slash',async()=>{
 const n=new CanonicalAccountNetwork({fetchImpl:async()=>({url:'https://rpc-testnet.ynxweb4.com/',redirected:false,ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1917'})})});assert.equal(await n.request('eth_chainId'),'0x1917');
});
test('URL normalization does not permit redirects or any noncanonical resource',async()=>{
 for(const [url,redirected] of [['https://rpc-testnet.ynxweb4.com/',true],['https://foreign.invalid/',false],['https://rpc-testnet.ynxweb4.com/other',false],['https://rpc-testnet.ynxweb4.com/?x=1',false],['https://user@rpc-testnet.ynxweb4.com/',false]]){const n=new CanonicalAccountNetwork({fetchImpl:async()=>({url,redirected,ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x1917'})})});await assert.rejects(n.request('eth_chainId'),e=>e.data?.code==='RPC_INVALID_RESPONSE');}
});
