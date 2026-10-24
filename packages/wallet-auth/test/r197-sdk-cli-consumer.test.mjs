// New SDK intake controls only; no keys, network, signing or admission.
import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {dispatchOriginalProjectControlCurrent} from '../native/original-ide-project-control-dispatch.mjs';
import {dispatchOriginalIDEApprovalCurrent} from '../native/original-ide-publication-approval-dispatch.mjs';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalDeveloperCommandDATA} from '../native/original-ide-project-control-contract.mjs';
const cli=fileURLToPath(new URL('../native/original-auth-identity-source-verifier.mjs',import.meta.url));
const run=input=>spawnSync(process.execPath,[cli],{input:canonical(input),encoding:'utf8',timeout:5000,maxBuffer:2<<20});
test('SDK cold circular import includes both exact CONTROL and inherited publication dispatch',()=>{
 for(const fn of [dispatchOriginalProjectControlCurrent,dispatchOriginalIDEApprovalCurrent,canonical,sha,encodeOriginalDeveloperCommandDATA])assert.equal(typeof fn,'function');
});
test('fixed CONTROL current CLI wrong dedicated Source refuses before transport with DATA flags false',()=>{
 const r=run({operation:'ide-project-control-current-native-node/v1',source:{policy:{signatureContract:{purpose:'PUBLIC-wrong-purpose'}}},approvalOriginal:'PUBLIC',principal:{},command:{},expected:{}});assert.equal(r.status,1,r.stderr);assert.equal(r.stderr,'');const v=JSON.parse(r.stdout);assert.equal(v.failureCode,'IDE_CONTROL_DISPATCH_DEDICATED_SOURCE_REQUIRED');assert.equal(v.completed,false);assert.equal(v.sourceBefore,null);assert.equal(v.sourceAfter,null);assert.equal(v.projection,null);assert.equal(v.dataOnly,true);assert.equal(v.authorized,false);assert.equal(v.nativeAdmission,false);
});
test('fixed CONTROL signature CLI rejects extra schema before registration or proof processing',()=>{
 const r=run({operation:'ide-project-control-signature-data/v1',approvalOriginal:'PUBLIC',registeredSender:{},registeredContext:{},principal:{},command:{},expected:{},approved:true});assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr,'AUTH_IDENTITY_NATIVE_SOURCE_INVALID\n');assert.doesNotMatch(r.stderr,/MODULE_NOT_FOUND/);
});
test('inherited publication CLI missing required schema reaches formal callee and fails without network',()=>{
 const r=run({operation:'ide-publication-approval-current-native-node/v1'});assert.equal(r.status,1,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.completed,false);assert.equal(v.dataOnly,true);assert.equal(v.authorized,false);assert.equal(v.nativeAdmission,false);assert.equal(v.sourceBefore,null);assert.equal(v.sourceAfter,null);
});
