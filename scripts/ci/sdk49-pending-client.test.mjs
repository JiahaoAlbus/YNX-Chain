import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
const root=new URL('../../packages/wallet-auth/src/',import.meta.url);
const loader=new URL('original-auth-identity-fixed-native-image.js',root).href;
let sequence=0;
async function openWith(native){
 const m=mock.module(loader,{namedExports:{loadOriginalAuthIdentityNativeImage:()=>native}});
 const api=await import(new URL('original-product-device-v4-pending-client.js?public-case='+sequence++,root));
 return {api,restore:()=>m.restore()};
}
const ctx=()=>Object.freeze({signal:new AbortController().signal});
function fixture(overrides={}){
 const trace=[],member=Buffer.from('PUBLIC original partial'),review=Buffer.from('{}');
 const status=Object.freeze({result:0,cleanup:2,reportedLengthExact:'18446744073709551615',entered:true,mathCompleted:true,authorized:false,nativeAdmission:false});
 const op=Object.freeze({readOriginalMember:()=>member,readOriginalStatus:()=>status,assertCurrent(){},retire(){trace.push('op.retire');},join(){trace.push('op.join');},close(){trace.push('op.close');},...overrides.op});
 const owner=Object.freeze({readOriginalReview:()=>review,assertCurrent(){},produceRegistrationProof(context){trace.push('registration');overrides.capture?.(context);return op;},produceChallengeProof(context){trace.push('challenge');overrides.capture?.(context);return op;},retire(){trace.push('owner.retire');},join(){trace.push('owner.join');},close(){trace.push('owner.close');},...overrides.owner});
 return {trace,op,owner,review,native:{acquireOriginalProductSessionDeviceV4PendingSource(){return owner;}}};
}
test('fixed zero-input entry refuses extra inputs and missing pending ABI, no GET fallback',async()=>{
 const {api,restore}=await openWith({acquireOriginalProductSessionDeviceV4Source(){throw Error('GET must not be called');}});
 try{await assert.rejects(api.openOriginalProductSessionDeviceV4PendingProofClient({}),{code:'PENDING_DEVICE_V4_EXACT_ARGUMENTS'});await assert.rejects(api.openOriginalProductSessionDeviceV4PendingProofClient(),{code:'PENDING_DEVICE_V4_NATIVE_ENTRY_NOT_SUPPLIED'});}finally{restore();}
});
test('acquisition preserves the exact frozen error and its original partial without cleanup/retry',async()=>{
 const f=fixture(),cause=Object.freeze(Object.assign(Error('PUBLIC partial'),{partial:f.owner}));let calls=0;
 const {api,restore}=await openWith({acquireOriginalProductSessionDeviceV4PendingSource(){calls++;throw cause;}});
 try{await assert.rejects(api.openOriginalProductSessionDeviceV4PendingProofClient(),e=>e===cause&&e.partial===f.owner);assert.equal(calls,1);assert.deepEqual(f.trace,[]);}finally{restore();}
});
test('same original frozen AbortContext and operation are retained, no proof/status wrapping',async()=>{
 const original=ctx(),f=fixture({capture:c=>assert.equal(c,original)}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();assert.equal(c.readOriginalReview(),f.review);assert.equal(c.capabilities.management,false);const op=await c.produceRegistrationProof(original);assert.equal(op,f.op);assert.equal(op.readOriginalStatus().reportedLengthExact,'18446744073709551615');assert.equal(op.readOriginalMember(),f.op.readOriginalMember());await assert.rejects(c.produceChallengeProof(original),{code:'PENDING_DEVICE_V4_CLIENT_ONCE'});await c.close();assert.deepEqual(f.trace,['registration','op.retire','op.join','op.close','owner.retire','owner.join','owner.close']);}finally{restore();}
});
test('late operation error leaves original public partial available before caller assertCurrent',async()=>{
 const late=Object.freeze(Error('PUBLIC late')),f=fixture({op:{assertCurrent(){throw late;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient(),op=await c.produceChallengeProof(ctx());assert.equal(op,f.op);assert.throws(()=>op.assertCurrent(),e=>e===late);assert.equal(op.readOriginalMember(),f.op.readOriginalMember());assert.equal(c.status().operationRetained,true);await c.close();}finally{restore();}
});
test('client current fence forwards the SAME original Source refusal without losing cleanup',async()=>{
 const cause=Object.freeze(Error('PUBLIC Source changed')),f=fixture({owner:{assertCurrent(){throw cause;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();assert.throws(()=>c.assertCurrent(),e=>e===cause);await assert.rejects(c.produceRegistrationProof(ctx()),e=>e===cause);assert.equal(c.status().sourceFailurePresent,true);assert.equal(c.status().sourceRetained,true);assert(!f.trace.includes('registration'));await c.close();assert.equal(c.status().closed,true);assert.equal(c.status().unknown,true);}finally{restore();}
});
test('falsy Native call failure cannot rearm or replay the pending client',async()=>{
 let calls=0;const f=fixture({owner:{produceRegistrationProof(){calls++;throw null;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await assert.rejects(c.produceRegistrationProof(ctx()),e=>e===null);await assert.rejects(c.produceRegistrationProof(ctx()),{code:'PENDING_DEVICE_V4_CLIENT_ONCE'});assert.equal(calls,1);assert.equal(c.status().unknown,true);assert.equal(c.status().firstBoundaryCause,null);await c.close();assert.equal(c.status().unknown,true);assert.equal(c.status().proofOutcome,'not-inspected');assert.deepEqual(f.trace,['owner.retire','owner.join','owner.close']);}finally{restore();}
});
test('join drains without choosing child or parent close',async()=>{
 const f=fixture(),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await c.produceRegistrationProof(ctx());await assert.rejects(c.join(),{code:'PENDING_DEVICE_V4_CLIENT_NOT_RETIRED'});c.retire();await c.join();assert.deepEqual(f.trace,['registration','op.retire','op.join']);await c.close();assert.equal(f.trace.filter(x=>x==='op.join').length,1);}finally{restore();}
});
test('first falsy retire/close failure and exact first close Promise stay stable',async()=>{
 let count=0;const f=fixture({op:{retire(){count++;throw 0;},close(){throw Error('PUBLIC second');}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await c.produceRegistrationProof(ctx());const first=c.close();assert.equal(c.close(),first);await assert.rejects(first,e=>e===0);await assert.rejects(c.close(),e=>e===0);assert.equal(count,1);assert.equal(c.status().firstCleanupCause,0);assert.equal(c.status().sourceRetained,true);assert(!f.trace.includes('owner.close'));}finally{restore();}
});
test('child-close UNKNOWN retains parent instead of releasing it',async()=>{
 let count=0;const f=fixture({op:{close(){count++;throw null;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await c.produceChallengeProof(ctx());await assert.rejects(c.close(),e=>e===null);assert.equal(count,1);assert.equal(c.status().unknown,true);assert.equal(c.status().sourceRetained,true);assert(!f.trace.includes('owner.join'));assert(!f.trace.includes('owner.close'));}finally{restore();}
});
test('unexpected false close result is not cleanup success',async()=>{
 const f=fixture({op:{close(){return false;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await c.produceChallengeProof(ctx());await assert.rejects(c.close(),e=>e.code==='PENDING_DEVICE_V4_LIFECYCLE_RESULT_INVALID'&&e.originalResult===false);assert.equal(c.status().sourceRetained,true);assert(!f.trace.includes('owner.close'));}finally{restore();}
});
test('parent close keeps the first falsy error and cannot repeat cleanup',async()=>{
 let count=0;const f=fixture({owner:{close(){count++;throw false;}}}),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();await assert.rejects(c.close(),e=>e===false);await assert.rejects(c.close(),e=>e===false);assert.equal(count,1);assert.equal(c.status().sourceRetained,true);}finally{restore();}
});
test('invalid/getter/spoofed/aborted contexts do not enter Native or invoke caller getters',async()=>{
 let getter=0;const f=fixture(),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient();const bad=Object.freeze(Object.defineProperty({},'signal',{get(){getter++;return new AbortController().signal;}}));for(const value of [bad,Object.freeze({signal:{aborted:false}}),Object.freeze({signal:new AbortController().signal,provider:'fake'})])await assert.rejects(c.produceRegistrationProof(value),{code:'PENDING_DEVICE_V4_ORIGINAL_ABORT_CONTEXT_REQUIRED'});const controller=new AbortController();controller.abort();await assert.rejects(c.produceRegistrationProof(Object.freeze({signal:controller.signal})),{code:'PENDING_DEVICE_V4_CALLER_ABORTED'});assert.equal(getter,0);assert.equal(c.status().selected,false);assert.deepEqual(f.trace,[]);await c.close();}finally{restore();}
});
test('close adopts the synchronous original operation before the caller await resumes',async()=>{
 const f=fixture(),{api,restore}=await openWith(f.native);
 try{const c=await api.openOriginalProductSessionDeviceV4PendingProofClient(),pending=c.produceRegistrationProof(ctx());assert.equal(c.status().operationRetained,true);const closing=c.close();assert.equal(await pending,f.op);await closing;await assert.rejects(c.produceChallengeProof(ctx()),{code:'PENDING_DEVICE_V4_CLIENT_RETIRED'});assert.equal(c.status().closed,true);}finally{restore();}
});
