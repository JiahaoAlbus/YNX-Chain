import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalDeploymentV2Signer} from '../src/original-deployment-v2-signer.mjs';

// PUBLIC lifecycle controls only; these do not provide Source or signing math.
function fixture(options={}) {
 const events=[],payload=Buffer.from('PUBLIC E11'),artifact=Buffer.from('PUBLIC CONTENT');
 const partial={payloadOriginal:payload.toString('base64url'),memberOriginal:Buffer.from('PUBLIC MEMBER').toString('base64url'),signed:true,sourceGranted:false,nativeAdmission:false,deployed:false};
 let joinPending=options.joinPending,signHook=options.signHook;
 const owner={
  async signOriginalE11(p,a){events.push('sign');assert.deepEqual(p,payload);assert.deepEqual(a,artifact);if(signHook)await signHook();if(options.signError)throw options.signError;return partial;},
  status(){events.push('partial');return {partial};},
  retire(){events.push('retire');},
  join(){events.push('join');if(joinPending)throw Object.assign(Error('pending'),{code:'IDE_DEPLOYMENT_V2_JOIN_PENDING'});},
  close(){events.push('close');if(options.closeError)throw options.closeError;},
 };
 const signer=createOriginalDeploymentV2Signer({originalSDK:{acquireOriginalIDEDeploymentV2Signer(...args){assert.equal(args.length,0);events.push('acquire');return {owner,error:options.acquireError??null};}}});
 const hooks={reserve(){events.push('reserve');},async beforeSign(){events.push('fence');},retainPartial(value){events.push('retain');assert.deepEqual(value,partial);}};
 return {signer,events,payload,artifact,partial,hooks,allowJoin(){joinPending=false;}};
}
test('exact bytes reach zero-input original owner; no submission, one close and no repeat sign',async()=>{
 const h=fixture(),result=await h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,h.hooks);
 assert.deepEqual(result,h.partial);assert.deepEqual(h.events,['acquire','reserve','fence','sign','retain','retire','join','close']);
 await assert.rejects(h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,h.hooks),{code:'IDE_DEPLOYMENT_V2_SIGNING_RECONCILE_REQUIRED'});
 h.signer.finishCleanup('PUBLIC_OPERATION');assert.equal(h.events.filter(x=>x==='close').length,1);
});
test('acquisition nonnull owner is journaled and partial retained before its error and cleanup',async()=>{
 const first=Object.assign(Error('acquire partial'),{code:'PUBLIC_ACQUISITION_PARTIAL'}),h=fixture({acquireError:first});
 await assert.rejects(h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,h.hooks),error=>error.cause===first&&error.partial.memberOriginal===h.partial.memberOriginal);
 assert.deepEqual(h.events,['acquire','reserve','partial','retain','retire','join','close']);
});
test('pending join keeps the original owner; finish only cleans, never reacquires or signs',async()=>{
 const h=fixture({joinPending:true});
 await assert.rejects(h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,h.hooks),e=>e.cleanupPending===true&&e.partial.signed===true);
 assert.equal(h.events.includes('close'),false);h.allowJoin();const result=h.signer.finishCleanup('PUBLIC_OPERATION');assert.equal(result.closed,true);
 assert.equal(h.events.filter(x=>x==='acquire').length,1);assert.equal(h.events.filter(x=>x==='sign').length,1);assert.equal(h.events.filter(x=>x==='close').length,1);
});
test('close failure is sticky and cannot invoke foreign close twice',async()=>{
 const first=Error('PUBLIC close unknown'),h=fixture({closeError:first});
 await assert.rejects(h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,h.hooks),e=>e.cleanupPending===true);
 assert.throws(()=>h.signer.finishCleanup('PUBLIC_OPERATION'),e=>e===first);assert.equal(h.events.filter(x=>x==='close').length,1);
});
test('late signed result after cancellation retained for reconcile and not returned as success',async()=>{
 let arrived,release;const entered=new Promise(r=>arrived=r),resume=new Promise(r=>release=r),cancel=new AbortController();
 const h=fixture({signHook:async()=>{arrived();await resume;}}),pending=h.signer.sign('PUBLIC_OPERATION',h.payload,h.artifact,{...h.hooks,signal:cancel.signal});
 await entered;cancel.abort();release();await assert.rejects(pending,e=>e.cause?.name==='AbortError'&&e.partial.signed===true&&e.retryAllowed===false);
 assert.ok(h.events.indexOf('retain')<h.events.indexOf('close'));
});
test('missing original release fails without acquiring substitute owner or running hooks',async()=>{
 let calls=0;const signer=createOriginalDeploymentV2Signer({originalSDK:{acquireOriginalIDEDeploymentV2Signer(){throw Object.assign(Error('Source absent'),{code:'IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED'});}}});
 await assert.rejects(signer.sign('PUBLIC_OPERATION',Buffer.from('x'),Buffer.from('y'),{reserve(){calls++;},beforeSign(){calls++;},retainPartial(){calls++;}}),{code:'IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED'});assert.equal(calls,0);
});
