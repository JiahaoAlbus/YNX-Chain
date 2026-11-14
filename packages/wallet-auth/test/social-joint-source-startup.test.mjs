import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openOriginalSocialJointSourceBeforeHost as open,originalSocialJointSourceForHost as source,originalSocialJointSourceStartupStatus as status,closeOriginalSocialJointSourceAfterHost as close,drainOriginalSocialJointSourcePartial as drain} from '../scripts/original-social-joint-source-startup.mjs';
test('fixed Social startup retains the actual unconfigured owner and its first failure through physical close',async()=>{
 const r=await open(),before=status(r);assert.equal(before.configured,false);assert.equal(before.firstCausePresent,true);assert.equal(before.firstCause.code,'SOCIAL_SOURCE_HELPER_NOT_SUPPLIED');assert.equal(source(r),null);
 assert.throws(()=>status({...r}),{code:'SOCIAL_SOURCE_STARTUP_ORIGINAL_REQUIRED'});assert.throws(()=>drain(r),{code:'SOCIAL_SOURCE_STARTUP_CLOSE_NOT_SELECTED'});
 const p=close(r);assert.equal(close(r),p);await assert.rejects(p,e=>e===before.firstCause);assert.equal(status(r).closed,true);assert.equal(status(r).firstCause,before.firstCause);await drain(r);await assert.rejects(p,e=>e===before.firstCause);
});
