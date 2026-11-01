// PUBLIC lifecycle seam, never a cryptographic/Root qualification fixture.
import assert from 'node:assert/strict';
export function verifyOriginalAuthSourceTransitionV2(...args){
 const c=globalThis.__auth101;assert.equal(args.length,9);c.transitionCalls++;
 assert.deepEqual(args[7],{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'});
 return Object.freeze({historical:true,dataOnly:true,nativeAdmission:false,status:c.mode==='terminal'?'revoked':'active',sequence:20,floor:10,head:'ab'.repeat(32),timeFloor:Date.now(),executionHeight:'10'});
}
export function verifyOriginalAuthSourceCurrentV2(...args){
 const c=globalThis.__auth101;assert.equal(args.length,9);c.currentMathCalls++;c.previous=args[7];
 assert.equal(JSON.parse(args[3]).nonce,args[6]);assert.notEqual(args[6],'A'.repeat(43));
 if(c.mode==='math-reject')throw Object.assign(Error('PUBLIC sole math rejected'),{code:'PUBLIC_MATH_REJECT'});
 return Object.freeze({status:'active',dataOnly:true,nativeAdmission:false,timeFloor:Date.now(),expiresAtMs:Date.now()+(c.mode==='expired'?-1:10000),sequence:31,floor:10,head:'cd'.repeat(32)});
}
