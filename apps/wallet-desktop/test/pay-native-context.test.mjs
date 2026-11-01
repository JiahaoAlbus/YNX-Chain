import test from 'node:test';import assert from 'node:assert/strict';
import {createOriginalWalletPayContextBridge} from '../src/original-policy-supplier/pay-native-context.mjs';
// PUBLIC caller-lease controls only. These are not Native Source/Root grants.
function fixture({query=false,current=()=>{},recheck=async()=>{},onCaptured}={}){
 let ctx;const bridge=createOriginalWalletPayContextBridge(()=>ctx),parent={retire:0,close:0};
 const permission=Object.freeze({retire(){parent.retire++;},close(){parent.close++;}}),capsule=Object.freeze(Object.create(null)),borrow=Object.freeze({});
 ctx={expiresAtMs:Date.now()+10000,captureOpen:true,captureSelected:false,request:query?null:Object.freeze({action:'broadcast'}),permission:query?null:permission,capsule:query?null:capsule,borrow:query?null:borrow,original:Object.freeze({hash:'PUBLIC-original'}),target:Object.freeze({service:'pay'}),signedMember:Buffer.from([1,2,3]),assertCurrent:current,recheck,onCaptured};
 return {bridge,ctx,parent};
}
test('capture has zero input, no caller-created approval/context and no out-of-scope lookup',()=>{
 const outside=createOriginalWalletPayContextBridge(()=>null);assert.throws(()=>outside.capture(),{code:'PAY_NATIVE_CONTEXT_NOT_ACTIVE'});
 const f=fixture();assert.throws(()=>f.bridge.capture({approved:true}),{code:'PAY_NATIVE_CONTEXT_ZERO_INPUT_REQUIRED'});assert.equal(f.ctx.captureSelected,false);
});
test('one actual bridge instance keeps same opaque refs and sealed public Member copies; clones and other instances fail recognition',async()=>{
 const f=fixture(),peer=f.bridge.capture(),packet=peer.readOriginal();assert.equal(packet.permission,f.ctx.permission);assert.equal(packet.capsule,f.ctx.capsule);assert.equal(packet.borrow,f.ctx.borrow);assert.equal(packet.original,f.ctx.original);assert.equal(packet.target,f.ctx.target);
 f.ctx.signedMember.fill(9);const member=packet.signedMember;assert.deepEqual(member,Buffer.from([1,2,3]));member.fill(0);assert.deepEqual(packet.signedMember,Buffer.from([1,2,3]));
 assert.equal(f.bridge.isPeer(peer),true);assert.equal(f.bridge.isPeer({...peer}),false);assert.equal(fixture().bridge.isPeer(peer),false);
 assert.equal(peer.claim(),undefined);assert.throws(()=>peer.claim(),{code:'PAY_NATIVE_CONTEXT_ALREADY_CLAIMED'});
 assert.throws(()=>f.bridge.capture(),{code:'PAY_NATIVE_CONTEXT_NOT_ACTIVE'});await peer.close();assert.throws(()=>peer.readOriginal(),{code:'PAY_NATIVE_CONTEXT_RETIRED'});f.bridge.assertSafeToClose();assert.deepEqual(f.parent,{retire:0,close:0});
});
test('query peer contains no signing permission/capsule/borrow and cannot be promoted by a nonnull authority',async()=>{
 const f=fixture({query:true}),p=f.bridge.capture(),r=p.readOriginal();assert.equal(r.purpose,'query');for(const k of ['permission','capsule','borrow','request'])assert.equal(r[k],null);await p.close();
 const bad=fixture({query:true});bad.ctx.permission={};let error;try{bad.bridge.capture();}catch(e){error=e;}assert.equal(error.cause.code,'PAY_NATIVE_CONTEXT_QUERY_AUTHORITY');assert.ok(error.partial);await error.partial.close();
});
test('falsy current failure retains nonnull same peer partial and does not become nil success',async()=>{
 const f=fixture({current(){throw false;}});let error;try{f.bridge.capture();}catch(e){error=e;}
 assert.equal(error.cause,false);assert.equal(f.bridge.isPeer(error.partial),true);assert.throws(()=>f.bridge.assertSafeToClose(),{code:'PAY_NATIVE_CONTEXT_CLOSE_UNCONFIRMED'});await error.partial.close();f.bridge.assertSafeToClose();
});
test('retire/join drains in-flight recheck before close; parent ownership is never retired or closed',async()=>{
 let release,entered;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;}),f=fixture({recheck:async()=>{entered();await gate;}}),peer=f.bridge.capture();
 const checking=peer.recheck();await started;peer.retire();let joined=false;const joining=peer.join().then(()=>{joined=true;});await Promise.resolve();assert.equal(joined,false);
 release();await assert.rejects(checking,{code:'PAY_NATIVE_CONTEXT_RETIRED'});await joining;await peer.close();await peer.close();f.bridge.assertSafeToClose();assert.deepEqual(f.parent,{retire:0,close:0});
});
test('capture observer failure also preserves partial, and explicit context cleanup drains it',async()=>{
 const f=fixture({onCaptured(){throw 0;}});let error;try{f.bridge.capture();}catch(e){error=e;}
 assert.equal(error.cause,0);assert.ok(error.partial);await f.bridge.closeContext(f.ctx);f.bridge.assertSafeToClose();
});
test('unsafe public Member backing is refused without invoking iterator or property hooks',async()=>{
 let hooks=0;const values=[new Uint8Array(new SharedArrayBuffer(3)),new Uint8Array(new ArrayBuffer(3,{maxByteLength:8})),new Proxy(new Uint8Array([1]),{get(){hooks++;throw false;}})];
 const detached=new Uint8Array([1]);structuredClone(detached,{transfer:[detached.buffer]});values.push(detached);
 for(const value of values){const f=fixture();f.ctx.signedMember=value;let error;try{f.bridge.capture();}catch(e){error=e;}assert.ok(error.partial);await error.partial.close();}
 const f=fixture(),raw=Buffer.from([1,2]);Object.defineProperty(raw,Symbol.iterator,{value(){hooks++;throw false;}});f.ctx.signedMember=raw;const p=f.bridge.capture();assert.deepEqual(p.readOriginal().signedMember,Buffer.from([1,2]));assert.equal(hooks,0);await p.close();
});
test('non-void current or recheck values fail closed while cleanup still succeeds',async()=>{
 const f=fixture({current:()=>false});let error;try{f.bridge.capture();}catch(e){error=e;}assert.equal(error.cause.code,'PAY_NATIVE_CONTEXT_CURRENT_RESULT');await error.partial.close();
 const r=fixture({recheck:async()=>false}),peer=r.bridge.capture();await assert.rejects(peer.recheck(),{code:'PAY_NATIVE_CONTEXT_RECHECK_RESULT'});await peer.close();r.bridge.assertSafeToClose();
});
