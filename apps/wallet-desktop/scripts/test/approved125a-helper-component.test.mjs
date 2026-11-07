import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyApproved125aHelperComponent as verify,APPROVED125A_HELPER_SOURCE_TUPLE as tuple} from '../approved125a-helper-component.mjs';
const archive=fileURLToPath(new URL('./fixtures/approved125a-helper/original-inputs.tar.gz',import.meta.url));
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),'6fd4a86f9ab4b678a472f8d153654ef7891abec76f89067fb6988ca2e0c12bdc');
const root=mkdtempSync(path.join(tmpdir(),'ynx-approved125a-data-'));
execFileSync('/usr/bin/tar',['-xzf',archive,'-C',root]);
const recordBytes=readFileSync(path.join(root,'record.json')),originalAttemptBytes=readFileSync(path.join(root,'attempt.json')),record=JSON.parse(recordBytes),helper=readFileSync(path.join(root,'artifacts/helper')),plist=readFileSync(path.join(root,'artifacts/plist'));
const original={recordBytes,originalAttemptBytes,expectedHelperSourceTuple:tuple,
 readSource(relative,commit){assert.ok([tuple.compileCommit,tuple.producerCommit].includes(commit));return readFileSync(path.join(root,commit===tuple.compileCommit?'compile':'producer',relative));},
 readPackedAsset(relative){if(relative===record.helperBuild.packagedOutput)return helper;if(relative===record.helperBuild.plist.relative)return plist;throw Error('UNEXPECTED_PACKAGE_MEMBER');}};
const rejects=(args,code)=>assert.throws(()=>verify({...original,...args}),e=>e.code===code);
try{
 test('actual approved125a executed helper13 original Git source and actual packaged artifact positive',()=>{const source=[],packed=[];const r=verify({...original,readSource(n,c){source.push([n,c]);return original.readSource(n,c);},readPackedAsset(n){packed.push(n);return original.readPackedAsset(n);}});assert.equal(r.helper.translationUnits,13);assert.equal(r.helper.sourceInputs,272);assert.equal(r.helper.producerSourceInputs,76);assert.equal(source.length,348);assert.deepEqual(packed,[record.helperBuild.packagedOutput,record.helperBuild.plist.relative]);assert.equal(r.nodeComponentVerified,false);assert.equal(r.pairedComponentVerified,false);assert.equal(r.helperExecutedNow,false);assert.equal(r.RootAdmission,false);assert.equal(r.SourceAdmission,false);assert.equal(r.originalAttempt.failed,true);});
 test('different Node paired record cannot be renamed125a',()=>{const b=Buffer.from(recordBytes);b[10]^=1;rejects({recordBytes:b},'APPROVED125A_RECORD_DIFFERS');});
 test('original failed62 attempt cannot be rewritten successful',()=>{const v=JSON.parse(originalAttemptBytes);v.failed=false;rejects({originalAttemptBytes:Buffer.from(JSON.stringify(v))},'APPROVED125A_ORIGINAL_ATTEMPT_DIFFERS');});
 test('independent compile or producer tuple cannot become new c6',()=>{rejects({expectedHelperSourceTuple:{...tuple,compileCommit:'c6'.padEnd(40,'0')}},'APPROVED125A_SOURCE_TUPLE_DIFFERS');rejects({expectedHelperSourceTuple:{...tuple,producerCommit:'0'.repeat(40)}},'APPROVED125A_SOURCE_TUPLE_DIFFERS');});
 test('getter or foreign tuple field refused without execution',()=>{let calls=0;const v={...tuple};Object.defineProperty(v,'compileCommit',{get(){++calls;return tuple.compileCommit;},enumerable:true});rejects({expectedHelperSourceTuple:v},'APPROVED125A_SOURCE_TUPLE_DIFFERS');assert.equal(calls,0);rejects({expectedHelperSourceTuple:{...tuple,NativeAdmission:true}},'APPROVED125A_SOURCE_TUPLE_DIFFERS');});
 test('actual helper TU source contamination refused',()=>rejects({readSource(n,c){const b=original.readSource(n,c);if(n==='apps/developer/helper/main.mm'&&c===tuple.compileCommit){const z=Buffer.from(b);z[0]^=1;return z;}return b;}},'APPROVED125A_COMPILE_SOURCE_PIN_DIFFERS'));
 test('actual producer original Git contamination refused',()=>rejects({readSource(n,c){const b=original.readSource(n,c);if(c===tuple.producerCommit){const z=Buffer.from(b);z[0]^=1;return z;}return b;}},'APPROVED125A_PRODUCER_SOURCE_PIN_DIFFERS'));
 test('packaged helper byte contamination refused',()=>rejects({readPackedAsset(n){const b=original.readPackedAsset(n);if(n===record.helperBuild.packagedOutput){const z=Buffer.from(b);z[0]^=1;return z;}return b;}},'APPROVED125A_PACKAGED_HELPER_DIFFERS'));
 test('packaged plist contamination refused',()=>rejects({readPackedAsset(n){const b=original.readPackedAsset(n);if(n===record.helperBuild.plist.relative)return Buffer.from('foreign plist');return b;}},'APPROVED125A_PACKAGED_PLIST_DIFFERS'));
 test('new Node bytes cannot be passed as helper qualification input',()=>assert.throws(()=>verify({...original,moduleBytes:Buffer.from('c6 Node')}),e=>e.code==='APPROVED125A_OPTIONS_INVALID'));
 test('legacy11 recipe cannot replace approved13 actual command',()=>{const v=JSON.parse(recordBytes);v.helperBuild.commands[0].argv=v.helperBuild.commands[0].argv.filter(x=>!x.endsWith('original-http-v5-registered-private.mm'));rejects({recordBytes:Buffer.from(JSON.stringify(v))},'APPROVED125A_RECORD_DIFFERS');});
 test('byte callbacks confer no installer/runtime/Root qualification',()=>{const r=verify(original);assert.equal(r.installed,false);assert.equal(r.serviceRegistered,false);assert.equal(r.nativeQualified,false);assert.equal(r.appSigned,false);assert.equal(r.bundleMustBeVerifiedSeparately,true);assert.ok(Object.isFrozen(r.helper));});
}finally{
 // node:test executes registered synchronous tests after module evaluation;
 // keep fixture until the process-exit event, then remove this own scratch only.
 process.once('exit',()=>rmSync(root,{recursive:true,force:true}));
}
