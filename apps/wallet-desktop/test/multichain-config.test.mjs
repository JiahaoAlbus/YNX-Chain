import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MultiConfigStore,validateNetwork,validateToken,rpcURL,publicAddress} from '../src/multichain-config.mjs';
const input={name:'PUBLIC synthetic local-chain fixture',rpcUrl:'https://qa.example.test/rpc',chainId:'31337',symbol:'QA',decimals:18,genesis:'0x'+'1'.repeat(64)};
test('custom config rejects private endpoints and canonical YNX override',()=>{
  for(const url of ['http://qa.example.test','https://localhost','https://127.0.0.1','https://[::1]','https://user:pass@qa.example.test','https://qa.example.test/?key=secret','https://192.168.1.1'])assert.throws(()=>rpcURL(url));
  for(const ip of ['10.0.0.1','169.254.1.1','100.64.1.1','::ffff:8.8.8.8','2001:db8::1'])assert.equal(publicAddress(ip),false);
  assert.equal(publicAddress('8.8.8.8'),true);assert.throws(()=>validateNetwork({...input,chainId:'6423'}));assert.throws(()=>validateNetwork({...input,genesis:'0x'+'0'.repeat(64)}));assert.throws(()=>validateNetwork({...input,decimals:6}));
});
test('network/genesis identities and token decimal bounds are strict',()=>{const network=validateNetwork(input);assert.notEqual(network.id,validateNetwork({...input,genesis:'0x'+'2'.repeat(64)}).id);for(const decimals of [0,6,18,255])assert.equal(validateToken({networkId:network.id,address:'0x'+'2'.repeat(40),name:'Fixture',symbol:'FIX',decimals}).decimals,decimals);for(const decimals of [-1,256,'18',1.1])assert.throws(()=>validateToken({networkId:network.id,address:'0x'+'2'.repeat(40),name:'Fixture',symbol:'FIX',decimals}));assert.throws(()=>validateNetwork({...input,extra:true}));});
test('atomic config persists edits/tokens/selection and preserves invalid data',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'ynx-public-multichain-config-'));try{const filePath=path.join(dir,'config.json'),store=new MultiConfigStore({filePath});await store.putNetwork(input);const network=(await store.read()).networks[0];await store.putToken({networkId:network.id,address:'0x'+'2'.repeat(40),name:'Fixture',symbol:'FIX',decimals:6});await store.putNetwork({...input,name:'Edited'});assert.equal((await new MultiConfigStore({filePath}).read()).tokens.length,1);assert.equal((await store.read()).networks.length,1);await store.remove(network.id);assert.equal((await store.read()).selected,null);await writeFile(filePath,'invalid-data');await assert.rejects(store.putNetwork(input),{code:'MULTICHAIN_STORE_INVALID'});assert.equal(await readFile(filePath,'utf8'),'invalid-data')}finally{await rm(dir,{recursive:true,force:true})}});
