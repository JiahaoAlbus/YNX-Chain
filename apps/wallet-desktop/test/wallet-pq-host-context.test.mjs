import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePQTransferHostContext,preparePQHostSourceRequest,PQ_HOST_LIMITS} from '../src/wallet-pq-host-context.mjs';
import {sha,original,binding,H,J,fixture} from './helpers/pq-host-export.mjs';
const parse=(f,execution=f.encode(),prior=null)=>parsePQTransferHostContext(original,binding,f.selection,execution,prior);
const prior=c=>Object.fromEntries(['sourceId','epoch','sourceFingerprint','sourceSha256','lifecycleSha256','contextSha256'].map(k=>[k,c[k]]));
test('same source/lifecycle/context/target exact bytes map Protocol SHA256 spelling into original capture inputs as DATA only',()=>{
 const f=fixture(),execution=f.encode(),result=parse(f,execution);assert.equal(result.contextPath,f.source.contextFile);assert.equal(result.contextSha256,sha(result.contextBytes));assert.deepEqual(result.expected,f.expected);assert.equal(result.epoch,'9007199254740993');assert.equal(result.sourceSha256,f.selection.sourceSha256);assert.equal(result.stdoutSha256,sha(execution.stdout));assert.equal(result.classification,'data');
 for(const flag of ['nativeRootAuthorized','sourceDeploymentQualified','proofVerified','independentFinality','canRetry','clearsOriginal'])assert.equal(result[flag],false);
 assert(Object.isFrozen(result));assert(Object.isFrozen(result.expected.block));execution.stdout.fill(0);assert.equal(sha(result.contextBytes),result.contextSha256);
});
test('the exact5string request has no target, context, Root, clock or provider input and preserves uint64 epoch precision',()=>{
 const f=fixture();f.encode();const a=preparePQHostSourceRequest(f.selection,'acquire'),c=preparePQHostSourceRequest(f.selection,'current',H);assert.equal(JSON.parse(a.stdin).sourceFingerprint,'');assert.equal(JSON.parse(c.stdin).sourceFingerprint,H);assert.deepEqual(Object.keys(JSON.parse(a.stdin)),['version','operation','sourceId','epoch','sourceFingerprint']);assert.equal(sha(a.stdin),a.stdinSha256);assert.equal(a.selection.epoch,f.selection.epoch);
 for(const [op,fp]of [['acquire',H],['current',''],['revoke','']])assert.throws(()=>preparePQHostSourceRequest(f.selection,op,fp));
 for(const change of [{sourcePath:'relative'},{sourcePath:'/PUBLIC/../other'},{sourceSha256:'0'.repeat(64)},{epoch:'01'},{epoch:'18446744073709551616'},{sourceId:'not allowed'}])assert.throws(()=>preparePQHostSourceRequest({...f.selection,...change},'acquire'));
});
test('current export must retain same independently captured source epoch fingerprint lifecycle and context pins',()=>{
 const f=fixture(),first=parse(f);assert.deepEqual(parse(f,f.encode(),prior(first)).expected,first.expected);
 for(const key of Object.keys(prior(first))){const changed=prior(first);changed[key]=key==='epoch'?'2':key==='sourceId'?'foreign':J;assert.throws(()=>parse(f,f.encode(),changed));}
});
test('changing raw bytes, base64 representation, output target or original binding cannot select another context',()=>{
 for(const mutate of [f=>{f.exported.contextBytes+='\n';},f=>{f.exported.contextSHA256=H;},f=>{f.exported.expectedTransaction.index='1';},f=>{f.exported.engineHeight='7';},f=>{f.exported.contextPath='/PUBLIC/foreign';},f=>{f.exported.sourceId='foreign';}]){
  const f=fixture();f.encode();mutate(f);const execution={stdout:Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-RESULT/v1',code:'EXPORTED_PROOF_TRUST_DATA',context:f.exported})),stderr:Buffer.alloc(0),exitCode:0,signal:null};assert.throws(()=>parse(f,execution));
 }
 const f=fixture(),execution=f.encode();assert.throws(()=>parsePQTransferHostContext(original,{...binding,account:'foreign'},f.selection,execution));
});
test('even repinned PUBLIC source data must cross-bind same context target and light statement, not merely self-consistent hashes',()=>{
 for(const mutate of [f=>{f.context.expectedTransaction.index='1';},f=>{f.light.expectedBlockHash=H;},f=>{f.lifecycle.status='retired';},f=>{f.source.genesisSHA256=H;},f=>{f.source.runtimePlanSHA256=H;}]){const f=fixture();mutate(f);assert.throws(()=>parse(f,f.encode()));}
});
test('closed recursive grammar rejects duplicate and escaped-alias keys unknown fields null scalars and numeric epochs',()=>{
 const f=fixture(),run=f.encode(),raw=run.stdout.toString();
 for(const text of [raw.replace('"code":','"code":"EXPORTED_PROOF_TRUST_DATA","code":'),raw.replace('"classification":','"version":"duplicate","classification":'),raw.replace('"classification":','"\\u0076ersion":"duplicate","classification":'),raw.replace('"classification":"data"','"classification":"data","foreign":true'),raw.replace('"epoch":"9007199254740993"','"epoch":9007199254740993'),raw.replace('"currentChecked":true','"currentChecked":null'),raw.replace('"expectedTransaction":{','"expectedTransaction":[')])assert.throws(()=>parse(f,{...run,stdout:Buffer.from(text)}));
});
test('fatal UTF8 BOM trailing values and byte caps reject, while normal Go escaped paths and whitespace remain accepted',()=>{
 const f=fixture(),run=f.encode();for(const stdout of [Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),run.stdout]),Buffer.concat([run.stdout,Buffer.from('{}')]),new Uint8Array(PQ_HOST_LIMITS.stdout+1)])assert.throws(()=>parse(f,{...run,stdout}));
 assert.throws(()=>parse(f,{...run,stderr:new Uint8Array(PQ_HOST_LIMITS.stderr+1)}));
 const text=run.stdout.toString().replaceAll('&','\\u0026');assert.equal(parse(f,{...run,stdout:Buffer.from(' \n'+text+'\t')}).contextPath,f.source.contextFile);
});
test('known exit1 rejection never returns a context or copies producer diagnostics into the public error',()=>{
 const f=fixture();f.encode();const run={stdout:Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-RESULT/v1',code:'HOST_SOURCE_NOT_CURRENT',error:'/PRIVATE/diagnostic-body'})),stderr:Buffer.from([0,255]),exitCode:1,signal:null};
 assert.throws(()=>parse(f,run),e=>{assert.equal(e.code,'PQ_HOST_SOURCE_UNAVAILABLE');assert.equal(e.reportedCode,'HOST_SOURCE_NOT_CURRENT');assert.equal(e.stdoutSha256,sha(run.stdout));assert.doesNotMatch(e.message,/PRIVATE|diagnostic/);return true;});
 for(const change of [{exitCode:0},{exitCode:null},{exitCode:2},{signal:'SIGTERM'}])assert.throws(()=>parse(f,{...run,...change}));
});
test('accessor/proxy/shared storage cannot supply a source selector execution envelope or mutable output snapshot',()=>{
 const f=fixture(),run=f.encode();let getters=0;const sel={...f.selection};Object.defineProperty(sel,'epoch',{get(){getters++;return f.selection.epoch;}});assert.throws(()=>preparePQHostSourceRequest(sel,'acquire'));assert.throws(()=>preparePQHostSourceRequest(new Proxy(f.selection,{}),'acquire'));
 const ex={...run};Object.defineProperty(ex,'stdout',{get(){getters++;return run.stdout;}});assert.throws(()=>parse(f,ex));assert.throws(()=>parse(f,{...run,stdout:new Uint8Array(new SharedArrayBuffer(1))}));assert.equal(getters,0);
 Object.defineProperty(run.stdout,'byteLength',{get(){getters++;throw Error('untrusted getter');}});assert.equal(parse(f,run).sourceId,f.selection.sourceId);assert.equal(getters,0);
});
