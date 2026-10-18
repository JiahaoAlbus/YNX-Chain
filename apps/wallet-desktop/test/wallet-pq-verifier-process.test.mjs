import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {PQFinalityVerifierProcessKernel} from '../src/wallet-pq-verifier-process.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),sha=b=>createHash('sha256').update(b).digest('hex');
function fixture({prepare,finish,kill}={}){
 const timers=new Set(),events=[],child=new EventEmitter();let spawns=0,input;
 for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{child[name].destroyed=true;};}
 child.stdin.end=bytes=>{input=Buffer.from(bytes);queueMicrotask(()=>finish?.(child));};child.kill=signal=>{events.push(signal);return kill?.(child,signal)??true;};
 const prepared={executable:'/PUBLIC/fixed-verifier',contextPath:'/PUBLIC/original-context.json',contextSha256:'a'.repeat(64),stdin:'{"PUBLIC":"not a real proof"}'};
 const kernel=new PQFinalityVerifierProcessKernel({prepare:prepare??(async()=>prepared),spawn:(executable,args,options)=>{spawns++;assert.equal(executable,prepared.executable);assert.deepEqual(args,['--trust-context',prepared.contextPath,'--trust-context-sha256',prepared.contextSha256]);assert.equal(options.shell,false);assert.equal(options.detached,false);assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.deepEqual(Object.keys(options.env).sort(),['LANG','PATH']);return child;},schedule:(fn,ms)=>{const t={fn,ms};timers.add(t);return t;},unschedule:t=>timers.delete(t)});
 return {kernel,child,timers,events,prepared,input:()=>input,spawns:()=>spawns,fire(ms){const t=[...timers].find(t=>t.ms===ms);assert.ok(t,'expected timer '+ms);timers.delete(t);t.fn();}};
}
test('one fixed argv/no inherited credential environment writes exact stdin and retains distinct raw stdout/stderr on actual close',async()=>{
 const out=Buffer.from([0,255,10]),err=Buffer.from('PUBLIC diagnostic');const f=fixture({finish:c=>{c.stdout.emit('data',out);c.stderr.emit('data',err);out.fill(7);c.emit('exit',0,null);c.emit('close',0,null);}}),result=await f.kernel.run({});
 assert.deepEqual(f.input(),Buffer.from(f.prepared.stdin));assert.deepEqual(result.result.stdout,Buffer.from([0,255,10]));assert.deepEqual(result.result.stderr,err);assert.equal(result.result.exitCode,0);assert.equal(result.result.signal,null);assert.equal(result.lifecycle.stdinSha256,sha(f.input()));assert.equal(result.lifecycle.closeObserved,true);assert.equal(result.lifecycle.cleanupPending,false);assert.equal(f.timers.size,0);await f.kernel.join();f.kernel.assertSafeToClose();assert.equal(result.consensusFinality,undefined);
 result.result.stdout.fill(9);assert.deepEqual(f.kernel.snapshot().result.stdout,Buffer.from([0,255,10]));
});
test('run is reserved before prepare awaits and never retries that instance after completion or error',async()=>{
 let release;const f=fixture({prepare:()=>new Promise(resolve=>{release=resolve;}),finish:c=>c.emit('close',1,null)}),work=f.kernel.run({});await assert.rejects(f.kernel.run({}),{code:'PQ_FINALITY_VERIFIER_ALREADY_ENTERED'});assert.equal(f.spawns(),0);release(f.prepared);await work;assert.equal(f.spawns(),1);await assert.rejects(f.kernel.run({}),{code:'PQ_FINALITY_VERIFIER_ALREADY_ENTERED'});
});
test('exit alone is not close and cannot release an outstanding process/stdio owner',async()=>{
 const f=fixture(),work=f.kernel.run({});await tick();let settled=false;work.then(()=>{settled=true;});f.child.emit('exit',0,null);await tick();assert.equal(settled,false);assert.throws(()=>f.kernel.assertSafeToClose());f.child.emit('close',0,null);await work;f.kernel.assertSafeToClose();assert.equal(f.timers.size,0);
});
test('cancel before run or during original preparation performs zero spawn without a clock/root fallback',async()=>{
 const early=fixture();early.kernel.retire();await assert.rejects(early.kernel.run({}),{code:'PQ_FINALITY_VERIFIER_CANCELLED'});await early.kernel.join();assert.equal(early.spawns(),0);
 let release;const f=fixture({prepare:()=>new Promise(resolve=>{release=resolve;})}),work=f.kernel.run({});f.kernel.retire();release(f.prepared);const result=await work;assert.equal(f.spawns(),0);assert.equal(result.lifecycle.started,false);assert.equal(result.lifecycle.closeObserved,false);assert.equal(result.lifecycle.interruption,'cancelled');assert.equal(f.timers.size,0);
});
test('cancellation retains already returned bytes and joins real close with no second dispatch',async()=>{
 const f=fixture({kill:(c,s)=>{c.emit('close',null,s);return true;}}),work=f.kernel.run({});await tick();f.child.stdout.emit('data',Buffer.from('retained before focus lock'));f.kernel.retire();const result=await work;assert.equal(result.result.stdout.toString(),'retained before focus lock');assert.equal(result.result.signal,'SIGTERM');assert.equal(result.lifecycle.interruption,'cancelled');assert.equal(f.spawns(),1);assert.deepEqual(f.events,['SIGTERM']);assert.equal(f.timers.size,0);await f.kernel.join();f.kernel.assertSafeToClose();
});
test('deadline escalates only the owned child; bounded return preserves partial owner until late close',async()=>{
 const f=fixture(),work=f.kernel.run({});await tick();f.child.stdout.emit('data',Buffer.from('first'));f.fire(30000);f.fire(1000);f.fire(1000);await assert.rejects(work,e=>e.code==='PQ_FINALITY_VERIFIER_CLEANUP_PENDING'&&e.partial===f.kernel);assert.deepEqual(f.events,['SIGTERM','SIGKILL']);assert.throws(()=>f.kernel.assertSafeToClose());
 assert.equal(f.kernel.snapshot().lifecycle.cleanupPending,true);f.child.stderr.emit('data',Buffer.from('late diagnostic'));f.child.emit('close',null,'SIGKILL');await f.kernel.join();assert.equal(f.kernel.snapshot().result.stderr.toString(),'late diagnostic');assert.equal(f.kernel.snapshot().result.stdout.toString(),'first');assert.equal(f.kernel.snapshot().lifecycle.interruption,'timeout');f.kernel.assertSafeToClose();assert.equal(f.spawns(),1);assert.equal(f.timers.size,0);
});
test('output caps preserve a detached bounded prefix, mark truncation and stop rather than decoding or retrying',async()=>{
 for(const name of ['stdout','stderr']){const f=fixture({kill:(c,s)=>{c.emit('close',null,s);return true;}}),work=f.kernel.run({});await tick();const limit=name==='stdout'?8<<20:64<<10,bytes=Buffer.alloc(limit+1,65);f.child[name].emit('data',bytes);bytes.fill(0);const result=await work;assert.equal(result.result[name].length,limit);assert.equal(result.result[name][0],65);assert.equal(result.lifecycle[name+'Truncated'],true);assert.equal(result.lifecycle.interruption,'output-limit');assert.equal(f.spawns(),1);}
});
test('first falsy process cause and independent cleanup cause are retained across later events',async()=>{
 const f=fixture({kill:()=>{throw undefined;}}),work=f.kernel.run({});await tick();f.child.emit('error',false);f.child.stderr.emit('error',Error('PUBLIC later error'));assert.equal(f.kernel.snapshot().firstCause,false);assert.equal(f.kernel.snapshot().lifecycle.firstCausePresent,true);assert.equal(f.kernel.snapshot().cleanupCause,undefined);assert.equal(f.kernel.snapshot().lifecycle.cleanupCausePresent,true);f.child.emit('close',1,null);const result=await work;assert.equal(result.firstCause,false);assert.equal(result.result.exitCode,1);assert.equal(f.timers.size,0);
});
test('malformed prepare and oversized/noncanonical input refuse before child dispatch, preserving exact first error',async()=>{
 for(const change of [{executable:'relative'},{contextPath:'/PUBLIC/../wrong'},{contextSha256:'UPPER'},{stdin:'\ud800'}]){const f=fixture();f.kernel.prepare=async()=>({...f.prepared,...change});await assert.rejects(f.kernel.run({}),{code:'PQ_FINALITY_VERIFIER_NOT_STARTED'});assert.equal(f.spawns(),0);await f.kernel.join();f.kernel.assertSafeToClose();assert.equal(f.timers.size,0);}
 const f=fixture({prepare:async()=>{throw false;}});await assert.rejects(f.kernel.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause===false);assert.equal(f.kernel.snapshot().firstCause,false);assert.equal(f.spawns(),0);
});
test('new Host profile has only fixed source flags and its own output cap; normal proof profile stays unchanged',async()=>{
 const child=new EventEmitter();for(const name of ['stdin','stdout','stderr']){child[name]=new EventEmitter();child[name].destroy=()=>{};}let calls=0;child.kill=()=>true;
 const input={executable:'/PUBLIC/new-producer-not034',contextPath:'/PUBLIC/host-source',contextSha256:'a'.repeat(64),stdin:'{"PUBLIC":"not authority"}'};
 child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.alloc(8*1024*1024+1,65));child.emit('close',0,null);});
 const kernel=new PQFinalityVerifierProcessKernel({mode:'host-producer',prepare:async()=>input,spawn:(file,args,options)=>{calls++;assert.equal(file,input.executable);assert.deepEqual(args,['--host-trust-source',input.contextPath,'--host-trust-source-sha256',input.contextSha256]);assert.equal(options.shell,false);assert.deepEqual(Object.keys(options.env).sort(),['LANG','PATH']);return child;}});
 const result=await kernel.run({});assert.equal(result.result.stdout.length,8*1024*1024+1);assert.equal(result.lifecycle.stdoutTruncated,false);assert.equal(calls,1);await kernel.join();kernel.assertSafeToClose();
});
test('Host request limit and unsupported modes fail before dispatch without relaxing original proof limits',async()=>{
 let calls=0;const kernel=new PQFinalityVerifierProcessKernel({mode:'host-producer',prepare:async()=>({executable:'/PUBLIC/fixed-new-binary',contextPath:'/PUBLIC/source',contextSha256:'a'.repeat(64),stdin:'x'.repeat(4097)}),spawn:()=>{calls++;throw Error('must not spawn');}});
 await assert.rejects(kernel.run({}),e=>e.code==='PQ_FINALITY_VERIFIER_NOT_STARTED'&&e.cause.code==='PQ_FINALITY_VERIFIER_INPUT_LIMIT');assert.equal(calls,0);await kernel.join();kernel.assertSafeToClose();
 assert.throws(()=>new PQFinalityVerifierProcessKernel({mode:'shell',prepare:async()=>{}}),{code:'PQ_FINALITY_VERIFIER_MODE_INVALID'});
});
