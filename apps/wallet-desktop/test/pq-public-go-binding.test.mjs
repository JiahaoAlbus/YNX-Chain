import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodePublicGoRestoreBinding} from './pq-public-go-binding.mjs';
// Serialization/entry controls only: public synthetic bytes are not valid keys,
// Source registration, a real Go verifier result, or another restore test.
const owner='0x'+'11'.repeat(20),policy={version:'YNX-ACCOUNT-POLICY/v1',networkId:Buffer.alloc(32,0x71).toString('base64'),enableAt:10,records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:Buffer.alloc(2592,1).toString('base64'),pkB:Buffer.alloc(64,2).toString('base64'),revision:1,registeredAt:10,activeFrom:20,ledgerNonce:1}]};
const original=()=>({state:Buffer.from(JSON.stringify(policy)),owner,executionHeight:'30',nativeChainId:'6423'});
test('Go consumer binding preserves exact original full-key policy and string uint64 without a certificate input',()=>{
 const input=original(),bytes=encodePublicGoRestoreBinding(input),value=JSON.parse(bytes);input.state.fill(0);
 assert.deepEqual(Object.keys(value),['version','owner','executionHeight','nativeChainId','policy']);assert.equal(value.version,'ynx-wallet-restore-interop-v1');assert.deepEqual(value.policy,policy);assert.equal(value.executionHeight,'30');assert.equal(value.nativeChainId,'6423');
});
test('missing original policy, wrong owner, malformed UTF8 and inexact uint64 refuse before public artifact output',()=>{
 for(const patch of [{state:Buffer.from('{}')},{state:Buffer.from([255])},{state:Buffer.alloc(256*1024+1)},{owner:'0x'+'22'.repeat(20)},{executionHeight:30},{executionHeight:'030'},{nativeChainId:'18446744073709551616'}])assert.throws(()=>encodePublicGoRestoreBinding({...original(),...patch}),/QA_ORIGINAL_PUBLIC_BINDING_REQUIRED/);
});
test('normal fresh-process parent freezes Go binding before restore and exports the exact CLI binding.json leaf',()=>{
 const text=readFileSync(new URL('./pq-fresh-process-vault.test.mjs',import.meta.url),'utf8');assert.ok(text.indexOf('const originalGoBinding=')<text.indexOf("const restored=run({operation:'restore'"));assert.ok(text.includes("['binding.json',originalGoBinding]"));assert.ok(text.includes("flag:'wx'"));
});
