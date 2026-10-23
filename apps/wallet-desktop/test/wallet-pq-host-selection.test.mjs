import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {preparePQHostSelectionRequest,parsePQHostSelectionResult} from '../src/wallet-pq-host-selection.mjs';
import {PQFinalityVerifierProcessKernel} from '../src/wallet-pq-verifier-process.mjs';
import {original,binding,row} from './helpers/pq-host-export.mjs';
const selection={sourcePath:'/PUBLIC/fixed/source.json',sourceSha256:'a'.repeat(64),sourceId:'original.source',epoch:'9007199254740993'};
const execution=stdout=>({stdout:Buffer.from(stdout??JSON.stringify(selection)),stderr:Buffer.alloc(0),exitCode:0,signal:null});
test('selection request binds original transport and native hashes with exact six strings',()=>{
 const r=preparePQHostSelectionRequest(original,binding),body=JSON.parse(r.stdin);
 assert.deepEqual(Object.keys(body),['version','operationId','account','networkId','transactionHash','nativeWireHash']);
 assert.equal(body.transactionHash,row.expectedTransaction.transactionHash);
 assert.equal(body.nativeWireHash,original.hash.slice(2));
 assert.equal(body.operationId,original.operationId);
 assert.throws(()=>preparePQHostSelectionRequest(original,{...binding,account:'foreign'}));
});
test('exact four-field output remains immutable DATA for subsequent acquire/current',()=>{
 const r=parsePQHostSelectionResult(execution());assert.deepEqual(r,selection);assert.ok(Object.isFrozen(r));
 assert.equal(r.nativeGrant,undefined);assert.equal(r.proofVerified,undefined);
});
test('duplicate aliases unknown fields nested or numeric values and trailing JSON reject',()=>{
 const raw=JSON.stringify(selection);
 for(const text of [raw.replace('{','{"epoch":"1",'),raw.replace('{','{"\\u0065poch":"1",'),raw.replace('{','{"current":true,'),raw.replace('"9007199254740993"','9007199254740993'),raw+'{}',raw.replace('"original.source"','{}')])assert.throws(()=>parsePQHostSelectionResult(execution(text)));
});
test('nonzero exit or interruption cannot publish success-shaped output or diagnostics',()=>{
 for(const patch of [{exitCode:1},{exitCode:null},{signal:'SIGTERM'}])assert.throws(()=>parsePQHostSelectionResult({...execution(),...patch}),{code:'PQ_HOST_SELECTION_UNAVAILABLE'});
});
test('malformed source paths hashes and epochs cannot select an alternative source',()=>{
 for(const patch of [{sourcePath:'relative'},{sourcePath:'/PUBLIC/../wrong'},{sourceSha256:'A'.repeat(64)},{sourceSha256:'0'.repeat(64)},{epoch:'01'},{epoch:'18446744073709551616'}])assert.throws(()=>parsePQHostSelectionResult(execution(JSON.stringify({...selection,...patch}))));
});
test('bounded fatal UTF8 and no accessor/proxy/shared-buffer execution input',()=>{
 for(const stdout of [Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),execution().stdout]),Buffer.alloc(16385),new Uint8Array(new SharedArrayBuffer(1))])assert.throws(()=>parsePQHostSelectionResult({...execution(),stdout}));
 let calls=0;const e=execution();Object.defineProperty(e,'stdout',{get(){calls++;throw Error('not invoked');}});
 assert.throws(()=>parsePQHostSelectionResult(e));assert.throws(()=>parsePQHostSelectionResult(new Proxy(execution(),{})));assert.equal(calls,0);
});
test('new process mode fixes catalog argv and clean environment, dispatches once, preserves stdout',async()=>{
 const child=new EventEmitter();let calls=0,stdin;
 for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}
 child.kill=()=>true;
 child.stdin.end=bytes=>{stdin=Buffer.from(bytes);queueMicrotask(()=>{child.stdout.emit('data',execution().stdout);child.emit('close',0,null);});};
 const r=preparePQHostSelectionRequest(original,binding);
 const prepared={executable:'/PUBLIC/NEW-same-source-component',contextPath:'/PUBLIC/private-catalog',contextSha256:'b'.repeat(64),stdin:r.stdin};
 const kernel=new PQFinalityVerifierProcessKernel({mode:'host-selection',prepare:async()=>prepared,spawn:(file,args,options)=>{
  calls++;assert.equal(file,prepared.executable);assert.deepEqual(args,['--host-source-catalog',prepared.contextPath,'--host-source-catalog-sha256',prepared.contextSha256]);assert.equal(options.shell,false);assert.deepEqual(Object.keys(options.env).sort(),['LANG','PATH']);return child;
 }});
 const result=await kernel.run({});assert.equal(stdin.toString(),r.stdin);assert.deepEqual(parsePQHostSelectionResult(result.result),selection);
 await assert.rejects(kernel.run({}),{code:'PQ_FINALITY_VERIFIER_ALREADY_ENTERED'});await kernel.join();kernel.assertSafeToClose();assert.equal(calls,1);
});
test('selector output cap stops the owned child, preserving bounded original output',async()=>{
 const child=new EventEmitter();
 for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}
 child.kill=signal=>{queueMicrotask(()=>child.emit('close',null,signal));return true;};
 child.stdin.end=()=>queueMicrotask(()=>child.stdout.emit('data',Buffer.alloc(16385,65)));
 const kernel=new PQFinalityVerifierProcessKernel({mode:'host-selection',prepare:async()=>({executable:'/PUBLIC/new-component',contextPath:'/PUBLIC/catalog',contextSha256:'a'.repeat(64),stdin:'{}'}),spawn:()=>child});
 const result=await kernel.run({});assert.equal(result.result.stdout.length,16384);assert.equal(result.lifecycle.stdoutTruncated,true);assert.equal(result.lifecycle.interruption,'output-limit');
 assert.throws(()=>parsePQHostSelectionResult(result.result),{code:'PQ_HOST_SELECTION_UNAVAILABLE'});
 await kernel.join();kernel.assertSafeToClose();
});
