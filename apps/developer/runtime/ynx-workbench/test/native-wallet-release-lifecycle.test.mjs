import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
const require=createRequire(import.meta.url);
const {NativeWalletController}=require('../lib/native-wallet-controller');
const source=fs.readFileSync(process.env.YNX_R63_PARENT_TS || new URL('../../../frontend/src/wallet/product-session-v2.ts',import.meta.url),'utf8');
const start=source.indexOf('  let active = grantedDevice !== undefined;');
const end=source.indexOf('  const sdk = createProductWalletConnection({',start);
assert.ok(start>=0&&end>start,'exact original native runtime lifecycle boundaries');
const body=stripTypeScriptTypes('function lifecycle(grantedDevice,bridge,owner,sdk,developerWalletV2Bridge,journal) { let explicitNativeOwner = owner;\n'+source.slice(start,end)+
 '\nreturn {endNativeOperation, finished, owned:()=>explicitNativeOwner===owner, markPending:()=>{pendingOperation={method:"restore"}}}; }',{mode:'strip'});
const createLifecycle=Function(body+';return lifecycle;')();
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const drain=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(end) {
 let calls=0,networkChanges=0;const entered=deferred();
 const bridge={endConnection(){calls++;entered.resolve();return end()}};
 const runtime=createLifecycle({},bridge,Symbol('TEST_ONLY_OWNER'),{setNetworkAvailable(){networkChanges++}},()=>bridge);
 const controller=new NativeWalletController({subscribeDeveloperWalletCallbacks:()=>()=>{}});
 controller.runtime=runtime;
 return{runtime,controller,entered,calls:()=>calls,networkChanges:()=>networkChanges};
}
test('normal Cancel waits for an already pending real native release',async()=>{
 const gate=deferred(),p=fixture(()=>gate.promise);
 const first=p.runtime.endNativeOperation();let settled=false;
 const cancel=p.controller.cancel().then(()=>{settled=true});
 try{await p.entered.promise;await drain();assert.equal(settled,false);
 assert.equal(p.controller.state.busy,true);assert.ok(p.controller.cancelling);assert.equal(p.calls(),1)}
 finally{gate.resolve();await Promise.all([first,cancel]);await p.controller.dispose()}
 assert.equal(p.controller.state.busy,false);assert.equal(p.controller.cancelling,undefined);
});
test('duplicate endNativeOperation cannot acknowledge before the original native reply',async()=>{
 const gate=deferred(),p=fixture(()=>gate.promise);let finished=false,secondDone=false;
 p.runtime.finished.then(()=>{finished=true});
 const first=p.runtime.endNativeOperation(),second=p.runtime.endNativeOperation().then(()=>{secondDone=true});
 try{await p.entered.promise;await drain();assert.equal(secondDone,false);assert.equal(finished,false);
 assert.equal(p.runtime.owned(),true);assert.equal(p.calls(),1)}
 finally{gate.resolve();await Promise.all([first,second]);await p.controller.dispose()}
 assert.equal(finished,true);assert.equal(p.runtime.owned(),false);
});
test('every release waiter receives the identical original native failure',async()=>{
 const gate=deferred(),p=fixture(()=>gate.promise),original=Error('TEST_ONLY_NATIVE_UNKNOWN');
 const first=p.runtime.endNativeOperation(),second=p.runtime.endNativeOperation();
 const both=Promise.allSettled([first,second]);
 await p.entered.promise;gate.reject(original);const results=await both;
 assert.deepEqual(results.map(r=>r.status),['rejected','rejected']);
 assert.ok(results.every(r=>r.reason===original));assert.equal(p.calls(),1);
 p.controller.runtime=undefined;await p.controller.dispose();
});
test('UNKNOWN cleanup keeps normal cancellation owned without implicit replay or retry',async()=>{
 const gate=deferred(),p=fixture(()=>gate.promise),original=Error('TEST_ONLY_NATIVE_UNKNOWN');
 const first=p.runtime.endNativeOperation().catch(e=>e),cancel=p.controller.cancel();
 await p.entered.promise;gate.reject(original);assert.equal(await first,original);await cancel;
 try{assert.ok(p.controller.cancelling);assert.equal(p.controller.state.busy,true);
 await p.controller.cancel();await p.controller.connect();
 assert.ok(p.controller.cancelling);assert.equal(p.controller.state.busy,true);assert.equal(p.calls(),1)}
 finally{await p.controller.dispose()}
});
test('a synchronous native bridge reentry joins the original cleanup',async()=>{
 const gate=deferred();let p,reentered,secondDone=false;
 p=fixture(()=>{reentered=p.runtime.endNativeOperation().then(()=>{secondDone=true});return gate.promise});
 const first=p.runtime.endNativeOperation();
 try{await p.entered.promise;await drain();assert.ok(reentered);assert.equal(secondDone,false);
 assert.equal(p.calls(),1)}finally{gate.resolve();await first;await reentered;await p.controller.dispose()}
});
test('confirmed release remains idempotent and disables only its pending SDK operation once',async()=>{
 const p=fixture(()=>Promise.resolve());p.runtime.markPending();
 await p.runtime.endNativeOperation();await p.runtime.endNativeOperation();
 assert.equal(p.calls(),1);assert.equal(p.networkChanges(),1);assert.equal(p.runtime.owned(),false);
 await p.runtime.finished;p.controller.runtime=undefined;await p.controller.dispose();
});
