import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {compileFunction} from 'node:vm';
import {recordWalletTransactionPolicyFailure as record} from '../src/transaction-policy-failure-record.mjs';
const failure=()=>{const cause=Object.assign(Error('PRIVATE message'),{code:'AUTH_POLICY_TLS_PIN',owner:'PRIVATE owner',url:'PRIVATE URL'}),error=Object.assign(Error('policy unavailable',{cause}),{code:'AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'});Object.defineProperty(error,'policySourceObservation',{value:Object.freeze({PRIVATE:'must not serialize this supplied object'})});return error;};
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-policy-record-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('Main protected diagnostic records finite original cause only, preserves original error and partial, no raw source values',t=>{
 const p=path.join(dir(t),'record.jsonl'),e=failure(),partial=Object.freeze({PRIVATE:'held'});Object.defineProperty(e,'partial',{value:partial});const cause=e.cause;
 assert.equal(record(e,p),true);const raw=fs.readFileSync(p,'utf8'),row=JSON.parse(raw);assert.equal(row.observation.code,'AUTH_POLICY_TLS_PIN');assert.equal(row.observation.policyAvailable,false);assert.equal(row.observation.stage,'tls');assert.equal(fs.statSync(p).mode&0o777,0o600);assert(!raw.includes('PRIVATE'));assert.equal(e.cause,cause);assert.equal(e.partial,partial);assert.equal(Object.keys(e).includes('policySourceObservation'),false);
});
test('arbitrary errors, getters and proxies cannot create a diagnostic file or run accessors',t=>{
 const p=path.join(dir(t),'record.jsonl');let called=0;for(const e of [{code:'OTHER'}, {get code(){called++;throw 0;}},new Proxy({},{getOwnPropertyDescriptor(){called++;throw 0;}})])assert.equal(record(e,p),false);assert.equal(called,0);assert.equal(fs.existsSync(p),false);
});
test('symlink, insecure mode, full log and multiple hard links refuse without changing original bytes',t=>{
 const d=dir(t),original=path.join(d,'original'),alias=path.join(d,'alias'),e=failure();fs.writeFileSync(original,'PUBLIC',{mode:0o600});fs.symlinkSync(original,alias);assert.equal(record(e,alias),false);assert.equal(fs.readFileSync(original,'utf8'),'PUBLIC');fs.unlinkSync(alias);fs.linkSync(original,alias);assert.equal(record(e,original),false);fs.unlinkSync(alias);fs.chmodSync(original,0o644);assert.equal(record(e,original),false);fs.chmodSync(original,0o600);fs.writeFileSync(original,'x'.repeat(65536));assert.equal(record(e,original),false);assert.equal(fs.statSync(original).size,65536);
});
const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),begin=main.indexOf('async function safeIPC('),end=main.indexOf('function safeErrorClass(',begin);
function ipc(directory,logger){return compileFunction(main.slice(begin,end)+';return safeIPC;',[],{contextExtensions:[{path,app:{getPath:()=>directory},recordRPCMetadataFailure(){},recordWalletTransactionPolicyFailure:logger}]})();}
test('actual safeIPC catch persists the safe original cause while retaining its existing public failure envelope',async t=>{
 const d=dir(t),e=failure();let calls=0;const safe=ipc(d,record);const result=await safe(()=>{calls++;throw e;});assert.equal(calls,1);assert.deepEqual(result,{ok:false,error:{code:e.code,message:e.message}});assert.equal(JSON.parse(fs.readFileSync(path.join(d,'wallet-transaction-policy-failures-v1.jsonl'),'utf8')).observation.code,'AUTH_POLICY_TLS_PIN');
});
test('actual catch never turns diagnostic failure into success, replay, or discarded UNKNOWN',async t=>{
 const e=failure();e.data={outcomeUnknown:true,transactionHash:'PUBLIC existing hash'};let calls=0;const safe=ipc(dir(t),()=>{throw Error('PUBLIC diagnostic unavailable');});const result=await safe(()=>{calls++;throw e;});assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.error.code,e.code);assert.equal(result.error.outcomeUnknown,true);assert.equal(result.error.transactionHash,'PUBLIC existing hash');
});
