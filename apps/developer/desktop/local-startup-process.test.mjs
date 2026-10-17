import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

let inspectBundledNodeVersion;
if(process.env.YNX_IDE_PROBE_PARENT_SOURCE){
 const source=await readFile(process.env.YNX_IDE_PROBE_PARENT_SOURCE,'utf8');
 const match=source.match(/const version = \(await exec\(node, \['--version'\], \{ timeout: 5000 \}\)\)\.stdout\.trim\(\);/g);
 assert.equal(match?.length,1,'Require the exact original product version-probe expression');
 const parentProbe=vm.runInNewContext('(async function(node,exec){'+match[0]+'return version;})');
 inspectBundledNodeVersion=(node,{run})=>parentProbe(node,run);
}else{
 ({inspectBundledNodeVersion}=await import('./local-startup-process.mjs'));
}
function refusal(code='EAGAIN'){return Object.assign(Error('original spawn refusal'),{code,errno:-35,syscall:'spawn bundled-node'});}
function rejected(error,child={}){const p=Promise.reject(error);p.child=child;return p;}
test('unspawned transient version probe retries at most twice then returns the original runtime version',async()=>{
 const waits=[],calls=[];let n=0;
 const result=await inspectBundledNodeVersion('/sealed/node',{run:(...args)=>{calls.push(args);return ++n<3?rejected(refusal()):Object.assign(Promise.resolve({stdout:'v24.19.0\n'}),{child:{pid:123}});},pause:async ms=>waits.push(ms)});
 assert.equal(result,'v24.19.0');assert.equal(calls.length,3);assert.deepEqual(waits,[100,200]);
 for(const [file,args,options] of calls){assert.equal(file,'/sealed/node');assert.deepEqual(args,['--version']);assert.equal(options.timeout,5000);}
});
test('exhausted unspawned EAGAIN preserves original error and stops after three attempts',async()=>{
 const error=refusal();let calls=0,waits=0;
 await assert.rejects(inspectBundledNodeVersion('/sealed/node',{run:()=>{calls++;return rejected(error);},pause:async()=>{waits++;}}),e=>e===error);
 assert.equal(calls,3);assert.equal(waits,2);
});
test('an existing child PID or unknown child state must never replay a version probe',async()=>{
 for(const child of [{pid:123},{pid:0},null]){
  let calls=0,waits=0;const error=refusal();
  await assert.rejects(inspectBundledNodeVersion('/sealed/node',{run:()=>{calls++;const p=Promise.reject(error);if(child)p.child=child;return p;},pause:async()=>{waits++;}}),e=>e===error);
  assert.equal(calls,1);assert.equal(waits,0);
 }
});
test('permission, missing executable, timeout and abort errors are never retried',async()=>{
 for(const code of ['EPERM','EACCES','ENOENT','ETIMEDOUT','ABORT_ERR']){
  let calls=0;const error=refusal(code);
  await assert.rejects(inspectBundledNodeVersion('/sealed/node',{run:()=>{calls++;return rejected(error);},pause:async()=>assert.fail('must not wait')}),e=>e===error);
  assert.equal(calls,1);
 }
});
test('cancellation before startup does not create a process',async()=>{
 const abort=new AbortController();abort.abort();let calls=0;
 await assert.rejects(inspectBundledNodeVersion('/sealed/node',{signal:abort.signal,run:()=>{calls++;return Promise.resolve({stdout:'v24.19.0'});}}),{name:'AbortError'});
 assert.equal(calls,0);
});
test('cancellation during retry delay cannot start a late process',async()=>{
 const abort=new AbortController();let calls=0;
 await assert.rejects(inspectBundledNodeVersion('/sealed/node',{signal:abort.signal,run:()=>{calls++;return rejected(refusal());},pause:async(_ms,_value,{signal})=>{assert.equal(signal,abort.signal);abort.abort();signal.throwIfAborted();}}),{name:'AbortError'});
 assert.equal(calls,1);
});
test('cancellation after completed delay is rechecked before attempting spawn',async()=>{
 const abort=new AbortController();let calls=0;
 await assert.rejects(inspectBundledNodeVersion('/sealed/node',{signal:abort.signal,run:()=>{calls++;return rejected(refusal());},pause:async()=>abort.abort()}),{name:'AbortError'});
 assert.equal(calls,1);
});
test('synchronous failures have no known child ownership and are never retried',async()=>{
 const error=refusal();let calls=0;
 await assert.rejects(inspectBundledNodeVersion('/sealed/node',{run:()=>{calls++;throw error;},pause:async()=>assert.fail('must not wait')}),e=>e===error);
 assert.equal(calls,1);
});

test('the default implementation executes the original Node version probe',{skip:!!process.env.YNX_IDE_PROBE_PARENT_SOURCE},async()=>{
 assert.equal(await inspectBundledNodeVersion(process.execPath),process.version);
});
