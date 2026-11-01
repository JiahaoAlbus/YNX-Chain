import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createOriginalWalletPayContextBridge} from '../src/original-policy-supplier/pay-native-context.mjs';import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';import {PermissionEpoch} from '../src/permission-lease.mjs';import {FilePermissionStore} from '../src/desktop-permission-store.mjs';
// PUBLIC boundary doubles verify Main sequencing only. Actual pure-Native
// atomic epoch/current and lifetime controls belong to Auth's native-epoch-r1.
function fixture(){
 let ctx;const owners=new WeakSet(),bridge=createOriginalWalletPayContextBridge(()=>ctx,{isOriginalNativeOwner:x=>owners.has(x)});
 function owner(options={}){let valid=true,calls=0;const obj={};Object.defineProperty(obj,'retire',{value(){valid=false;calls++;options.onRetire?.();if(options.throwRetire)throw false;},writable:false,configurable:false});Object.freeze(obj);owners.add(obj);return {obj,valid:()=>valid,calls:()=>calls};}
 function capture(current=()=>{},expiresAtMs=Date.now()+10000){ctx={captureOpen:true,captureSelected:false,expiresAtMs,reviewId:'PUBLIC-review',request:null,permission:null,capsule:null,borrow:null,original:Object.freeze({hash:'PUBLIC'}),target:Object.freeze({service:'pay'}),signedMember:Buffer.from([1]),assertCurrent:current,recheck:async()=>{current();}};return bridge.capture();}
 return {bridge,owner,capture,context:()=>ctx};
}
async function finish(f,p,o){f.bridge.observedNativeJoin(o.obj);await p.close();f.bridge.assertSafeToClose();}
test('association rejects DATA/callback or other peer; only genuine-instance frozen Native retire method is retained',async()=>{
 const f=fixture(),p=f.capture(),o=f.owner();assert.throws(()=>f.bridge.associate(p,{retire(){}}),{code:'PAY_NATIVE_ASSOCIATION_OWNER'});assert.throws(()=>f.bridge.associate({...p},o.obj),{code:'PAY_NATIVE_ASSOCIATION_SCOPE'});
 f.bridge.associate(p,o.obj);f.bridge.associate(p,o.obj);p.retire();assert.equal(o.valid(),false);assert.equal(o.calls(),1);await assert.rejects(p.close(),{code:'PAY_NATIVE_CONTEXT_NATIVE_JOIN_REQUIRED'});await finish(f,p,o);
});
test('retirement never drops the actual owner before observed Native join, even on finally cleanup',async()=>{
 const f=fixture(),p=f.capture(),o=f.owner();f.bridge.associate(p,o.obj);await assert.rejects(f.bridge.closeContext(f.context()),{code:'PAY_NATIVE_CONTEXT_NATIVE_JOIN_REQUIRED'});assert.equal(o.valid(),false);assert.throws(()=>f.bridge.assertSafeToClose(),{code:'PAY_NATIVE_CONTEXT_CLOSE_UNCONFIRMED'});await finish(f,p,o);
});
test('all native children retire despite first falsy upstream failure; later focus cannot revive them',async()=>{
 const f=fixture(),p=f.capture(),a=f.owner({throwRetire:true});f.bridge.associate(p,a.obj);const q=f.capture(),b=f.owner();f.bridge.associate(q,b.obj);
 assert.throws(()=>f.bridge.invalidateAll(),e=>e===false);assert.equal(a.valid(),false);assert.equal(b.valid(),false);f.bridge.invalidateAll();assert.equal(a.calls(),1);assert.equal(b.calls(),1);await finishOne(p,a);await finishOne(q,b);f.bridge.assertSafeToClose();
 async function finishOne(peer,o){f.bridge.observedNativeJoin(o.obj);await peer.close();}
});
test('real lock retires before foreign invalidate/listeners, and still locks/notifies all after errors',async()=>{
 const f=fixture(),order=[];const life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account:'PUBLIC'}),invalidate(){order.push('foreign');throw 0;}},focused:()=>true,beforeInvalidate:()=>f.bridge.invalidateAll()});await life.unlock();
 let peer,o;await assert.rejects(life.run(async guard=>{peer=f.capture(()=>guard.assertEffectCurrent(),guard.expiresAtMs);o=f.owner({throwRetire:true,onRetire:()=>order.push('native')});f.bridge.associate(peer,o.obj);life.subscribe(()=>{order.push('listener-one');throw Error('PUBLIC_LISTENER');});life.subscribe(()=>order.push('listener-two'));life.lock();}),e=>e===false);
 assert.equal(life.status().locked,true);assert.deepEqual(order.slice(0,4),['native','foreign','listener-one','listener-two']);assert.equal(o.valid(),false);await finish(f,peer,o);
});
test('real account/focus/cancel and normal operation end retire same child synchronously',async()=>{
 for(const kind of ['account','focus','cancel','end']){
  const f=fixture(),life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account:'PUBLIC'}),inProcess:true},focused:()=>true,beforeInvalidate:()=>f.bridge.invalidateAll()});await life.unlock();let p,o;
  const run=life.run(async guard=>{p=f.capture(()=>guard.assertEffectCurrent(),guard.expiresAtMs);o=f.owner();f.bridge.associate(p,o.obj);if(kind==='account')life.setAccount('OTHER');if(kind==='focus')life.setFocused(false);if(kind==='cancel')life.cancelOperations();if(kind!=='end')assert.equal(o.valid(),false);});
  if(kind==='end')await run;else await assert.rejects(run);assert.equal(o.valid(),false);await finish(f,p,o);
 }
});
test('permission revocation lowers Native epoch before async persistence and cannot revive at finally',async()=>{
 const f=fixture(),p=f.capture(),o=f.owner();f.bridge.associate(p,o.obj);const epoch=new PermissionEpoch(),lease=epoch.lease('PUBLIC');epoch.addBeforeRevoke(()=>f.bridge.invalidateAll());let release,entered;const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const work=epoch.revoke('PUBLIC',async()=>{assert.equal(o.valid(),false);entered();await gate;});await ready;assert.throws(()=>lease.assert());release();await work;assert.equal(o.valid(),false);await finish(f,p,o);
});
test('shared file permission epoch invokes actual hook even when another instance performs revoke',async t=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'ynx-permission-native-retire-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const path=join(directory,'permissions.json');let called=0;new FilePermissionStore(path,{beforeRevoke(){called++;}});await new FilePermissionStore(path).revokeAll();assert.equal(called,1);
});
test('deadline is immutable protected lease minimum, never a fresh default or caller extension',async()=>{
 let now=1000;const f=fixture(),life=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account:'PUBLIC'})},focused:()=>true,now:()=>now,ttlMs:100,unlockTtlMs:20,schedule:()=>null,unschedule:()=>{}});await life.unlock();
 await life.run(async guard=>{const p=f.capture(()=>guard.assertEffectCurrent(),guard.expiresAtMs);assert.equal(f.bridge.copyDeadline(p).expiresAtMs,1020);f.context().expiresAtMs=999999;assert.equal(f.bridge.copyDeadline(p).expiresAtMs,1020);await p.close();});f.bridge.assertSafeToClose();
});
test('actual session-delete handler retires before asynchronous review termination or permission persistence',async()=>{
 const {default:vm}=await import('node:vm'),source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 const start=source.indexOf('onSessionDelete: async event => {'),end=source.indexOf('\n        onSessionRestore:',start);assert.ok(start>0&&end>start);
 const body=source.slice(start+'onSessionDelete: async event => {'.length,end).replace(/},\s*$/,'');
 const f=fixture(),p=f.capture(),o=f.owner();f.bridge.associate(p,o.obj);let release,entered,revoke=0;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const sandbox={retirePayContextsForEvent:()=>f.bridge.invalidateAll(),walletConnectInbox:{pending:()=>[{key:'PUBLIC',event:{topic:'PUBLIC-topic'}}],finish(){}},async terminateWalletConnectReview(){assert.equal(o.valid(),false);entered();await gate;},walletAuthority:{async revokeOrigin(){revoke++;assert.equal(o.valid(),false);}},window:{webContents:{send(){}}}};
 const handler=vm.compileFunction('return async event=>{'+body+'}',[],{contextExtensions:[sandbox]})();const pending=handler({topic:'PUBLIC-topic',origin:'https://public.example'});assert.equal(o.valid(),false);await ready;assert.equal(revoke,0);release();await pending;assert.equal(revoke,1);await finish(f,p,o);
});
