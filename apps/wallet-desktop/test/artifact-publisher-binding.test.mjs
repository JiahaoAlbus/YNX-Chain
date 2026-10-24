import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
function fixture(t,artifactRelease=false){
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-publisher-binding-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const headers='/Users/huangjiahao/Library/Caches/node-gyp/22.13.1/include/node';
 const binary=path.join(temp,'PUBLIC-binding.node');
 // Both explicit PUBLIC variants may load in this process. Give their fake
 // Objective-C classes distinct names instead of relying on duplicate-class
 // runtime selection. Production source/class names remain unchanged.
 const compile=spawnSync('/usr/bin/xcrun',['clang++','-DYNXOriginalArtifactReleaseApproval=YNXPublicReleaseApproval'+(artifactRelease?'RoleOn':'RoleOff'),'-DYNXOriginalIDEWalletPeerLaunch=YNXPublicPeerLaunch'+(artifactRelease?'RoleOn':'RoleOff'),...(artifactRelease?['-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1']:[]),'-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-shared','-undefined','dynamic_lookup','-I'+headers,path.join(root,'test/native/artifact-publisher-binding-public.mm'),'-framework','Foundation','-o',binary],{encoding:'utf8',timeout:30000});
 assert.equal(compile.status,0,compile.stderr);
 return {temp,binary,binding:createRequire(import.meta.url)(binary)};
}
test('actual Main NAPI binding retains original parent and refuses recapture across close/failure/GC (PUBLIC Native doubles)',{skip:process.platform!=='darwin'},t=>{
 const {binary,binding}=fixture(t),capture=binding.captureOriginalWalletPublisherApproval;
 assert.throws(()=>capture({}),/ORIGINAL_PARENT_REQUIRED/);
 assert.throws(()=>capture(),/ARGUMENTS_INVALID/);
 const parent=binding.PUBLICParent(),owner=capture(parent);
 assert(Object.isFrozen(owner));const review=owner.copyOriginalReview();assert.equal(review.reviewId,'PUBLIC-review');assert.equal(review.actualApprovalRef,undefined);
 assert.throws(()=>capture(parent),/CAPTURE_ONCE/);
 assert.throws(()=>owner.copyOriginalReview.call({}),/ORIGINAL_APPROVAL_REQUIRED/);
 assert.equal(owner.approveOriginalReview('PUBLIC-review').actualApprovalRef,'PUBLIC-ref');
 assert.equal(owner.assertOriginalApprovalCurrent('PUBLIC-ref').actualApprovalRef,'PUBLIC-ref');
 owner.close();owner.close();assert.throws(()=>capture(parent),/CAPTURE_ONCE/);
 assert.throws(()=>owner.copyOriginalReview(),/APPROVAL_RETIRED/);
 const failedParent=binding.PUBLICParent(),failed=capture(failedParent);
 assert.throws(()=>failed.approveOriginalReview('wrong'),/APPROVAL_REFUSED/);
 assert.throws(()=>failed.approveOriginalReview('PUBLIC-review'),/APPROVAL_REFUSED/);
 failed.close();assert.throws(()=>capture(failedParent),/CAPTURE_ONCE/);
 const revokedParent=binding.PUBLICParent(),revoked=capture(revokedParent);
 binding.PUBLICRetireParent(revokedParent);
 assert.throws(()=>revoked.copyOriginalReview(),/PARENT_NOT_CURRENT/);revoked.close();
 // No production signing entry, raw keys, transport or native parent escapes.
 assert.deepEqual(Object.getOwnPropertyNames(owner),['copyOriginalReview','approveOriginalReview','assertOriginalApprovalCurrent','retire','close','copyOriginalSigningOutcome','saveOriginalSigningOutcome']);
 binding.PUBLICPendingOutcome();const resultParent=binding.PUBLICParent(),resultOwner=capture(resultParent);
 binding.PUBLICRetireParent(resultParent);resultOwner.retire();
 assert.throws(()=>resultOwner.copyOriginalReview(),/PARENT_NOT_CURRENT/);
 assert.throws(()=>resultOwner.close(),/OUTCOME_SAVE_REQUIRED/);
 assert.equal(resultOwner.copyOriginalSigningOutcome().phase,'signed-outcome-unknown');
 assert.throws(()=>resultOwner.copyOriginalSigningOutcome.call({}),/ORIGINAL_APPROVAL_REQUIRED/);
 assert.throws(()=>resultOwner.saveOriginalSigningOutcome('extra'),/ARGUMENTS_INVALID/);
 assert.equal(resultOwner.saveOriginalSigningOutcome().phase,'signed-unhanded');
 resultOwner.close();resultOwner.close();
 assert.throws(()=>resultOwner.copyOriginalSigningOutcome(),/APPROVAL_CLOSED/);
 assert.throws(()=>capture(resultParent),/ORIGINAL_PARENT_REQUIRED/);
 const gc=spawnSync(process.execPath,['--expose-gc','-e',`const b=require(${JSON.stringify(binary)}),p=b.PUBLICParent();(()=>{b.captureOriginalWalletPublisherApproval(p)})();global.gc();setImmediate(()=>{global.gc();setImmediate(()=>{try{b.captureOriginalWalletPublisherApproval(p);process.exitCode=9}catch(e){if(!/CAPTURE_ONCE/.test(e.code))throw e;console.log('PUBLIC_GC_ONCE_PASS')}})})`],{encoding:'utf8',timeout:10000});
 assert.equal(gc.status,0,gc.stderr);assert.match(gc.stdout,/PUBLIC_GC_ONCE_PASS/);
});
test('explicit Main CABI role exposes one original sign call and preserves outcomes across post-call loss and save failure (PUBLIC Native effect)',{skip:process.platform!=='darwin'},async t=>{
 const {temp,binary,binding:b}=fixture(t,true);
 const privateDir=path.join(temp,'src/artifact-publication');fs.mkdirSync(privateDir,{recursive:true});fs.mkdirSync(path.join(temp,'native'));
 const normalFactory=path.join(privateDir,'native-publisher-approval.mjs');fs.copyFileSync(new URL('../src/artifact-publication/native-publisher-approval.mjs',import.meta.url),normalFactory);
 // PUBLIC fixture only: realpath to the one already loaded addon prevents a
 // second class/module image. Production uses its one canonical App addon.
 fs.symlinkSync(binary,path.join(temp,'native/original-auth-identity.node'));
 const {captureOriginalWalletPublisherApproval:capture}=await import(pathToFileURL(normalFactory));
 assert.throws(()=>capture({}),/ORIGINAL_PARENT_REQUIRED/);
 const denied=capture(b.PUBLICParent());assert.equal(typeof denied.signOriginalRelease,'function');
 assert.throws(()=>denied.signOriginalRelease('PUBLIC-ref'),/REFUSED/);assert.equal(b.PUBLICSigningCalls(),0);denied.close();
 const p=b.PUBLICParent(),owner=capture(p);owner.approveOriginalReview('PUBLIC-review');
 assert.throws(()=>owner.signOriginalRelease.call({},'PUBLIC-ref'),/ORIGINAL_APPROVAL_REQUIRED/);
 assert.throws(()=>owner.signOriginalRelease('PUBLIC-ref','extra'),/ARGUMENTS_INVALID/);
 assert.equal(owner.signOriginalRelease('PUBLIC-ref').phase,'signed-unhanded');assert.equal(b.PUBLICSigningCalls(),1);
 assert.throws(()=>owner.signOriginalRelease('PUBLIC-ref'),/REFUSED/);assert.equal(b.PUBLICSigningCalls(),1);assert.equal(owner.copyOriginalSigningOutcome().phase,'signed-unhanded');owner.close();
 const lateParent=b.PUBLICParent(),late=capture(lateParent);late.approveOriginalReview('PUBLIC-review');b.PUBLICRetireOnSign(lateParent);
 assert.throws(()=>late.signOriginalRelease('PUBLIC-ref'),/PARENT_NOT_CURRENT/);assert.equal(b.PUBLICSigningCalls(),2);
 assert.equal(late.copyOriginalSigningOutcome().phase,'signed-unhanded');assert.throws(()=>late.signOriginalRelease('PUBLIC-ref'),/PARENT_NOT_CURRENT/);late.close();
 b.PUBLICPendingOutcome();const debt=capture(b.PUBLICParent());debt.approveOriginalReview('PUBLIC-review');
 assert.throws(()=>debt.signOriginalRelease('PUBLIC-ref'),/OUTCOME_SAVE_REQUIRED/);assert.equal(b.PUBLICSigningCalls(),3);
 assert.equal(debt.copyOriginalSigningOutcome().phase,'signed-outcome-unknown');assert.throws(()=>debt.close(),/OUTCOME_SAVE_REQUIRED/);
 debt.retire();assert.equal(debt.saveOriginalSigningOutcome().phase,'signed-unhanded');assert.equal(b.PUBLICSigningCalls(),3);debt.close();
 const channel=capture(b.PUBLICParent());channel.approveOriginalReview('PUBLIC-review');channel.signOriginalRelease('PUBLIC-ref');
 assert.equal(typeof channel.sendOriginalPublicationResult,'function');
 const retained=channel.copyOriginalPublicationResult();assert(retained instanceof Uint8Array);assert.equal(b.PUBLICSendCalls(),0);
 retained.fill(0);const exact=Buffer.from(channel.copyOriginalPublicationResult());assert.notEqual(exact[0],0);
 assert.throws(()=>channel.sendOriginalPublicationResult(new Uint8Array([1])),/ARGUMENTS_INVALID/);
 assert.equal(await channel.sendOriginalPublicationResult(),undefined);assert.equal(b.PUBLICSendCalls(),1);
 const sent=JSON.parse(b.PUBLICSentResult());assert.equal(sent.version,'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1');assert.equal(sent.purpose,'ARTIFACT-RELEASE');assert.equal(sent.manifestOriginal,sent.invocationOriginal);assert.equal(sent.signatureOriginal,'AQID');assert.equal(Object.keys(sent).length,11);
 assert.equal(b.PUBLICSentResult(),exact.toString());
 assert.throws(()=>channel.sendOriginalPublicationResult(),/RESULT_ALREADY_SELECTED/);assert.equal(b.PUBLICSendCalls(),1);channel.close();
 const unsigned=capture(b.PUBLICParent());unsigned.approveOriginalReview('PUBLIC-review');assert.throws(()=>unsigned.sendOriginalPublicationResult(),/SIGNED_RESULT_REQUIRED/);assert.equal(b.PUBLICSendCalls(),1);unsigned.close();
 const held=capture(b.PUBLICParent());held.approveOriginalReview('PUBLIC-review');held.signOriginalRelease('PUBLIC-ref');b.PUBLICHoldSend();const pending=held.sendOriginalPublicationResult();
 assert.throws(()=>held.close(),/CLOSE_PENDING/);assert(Buffer.from(held.copyOriginalPublicationResult()).equals(exact));b.PUBLICFinishSend();await pending;held.close();assert.equal(b.PUBLICSendCalls(),2);
 const uncertain=capture(b.PUBLICParent());uncertain.approveOriginalReview('PUBLIC-review');uncertain.signOriginalRelease('PUBLIC-ref');b.PUBLICFailSend();assert.throws(()=>uncertain.sendOriginalPublicationResult(),/PUBLIC_QUEUE_UNKNOWN/);assert.equal(b.PUBLICSendCalls(),3);
 assert.throws(()=>uncertain.sendOriginalPublicationResult(),/QUEUE_UNKNOWN|RESULT_ALREADY_SELECTED/);assert.equal(b.PUBLICSendCalls(),3);assert(Buffer.from(uncertain.copyOriginalPublicationResult()).equals(exact));uncertain.close();
 const exit=spawnSync(process.execPath,['-e',`const b=require(${JSON.stringify(binary)});(async()=>{const p=b.PUBLICParent(),o=b.captureOriginalWalletPublisherApproval(p);o.approveOriginalReview('PUBLIC-review');o.signOriginalRelease('PUBLIC-ref');await o.sendOriginalPublicationResult();console.log('PUBLIC_QUEUED_OWNER_ENV_EXIT');})();`],{encoding:'utf8',timeout:10000});
 assert.equal(exit.status,0,exit.stderr);assert.match(exit.stdout,/PUBLIC_QUEUED_OWNER_ENV_EXIT/);assert.doesNotMatch(exit.stderr,/FATAL|HandleScope/);
});
