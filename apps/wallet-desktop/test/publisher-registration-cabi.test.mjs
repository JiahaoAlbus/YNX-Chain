import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const supplier=process.env.WALLET_PUBLISHER_REGISTRATION_CABI_SOURCE;
test('three fixed Main publisher Native adapters preserve output and wipe boundaries with public controlled ABI faults',{skip:process.platform!=='darwin'?'requires Foundation':!supplier?'requires original Protocol94b publisher header source':false},t=>{
 const header=fs.readFileSync(path.join(supplier,'publisher_registration.h'));
 assert.equal(header.length,5416);assert.equal(createHash('sha256').update(header).digest('hex'),'0cde9f0c04696cfda2ca1236f7c41ea7de934519c2a1ff75889c69902cf6a25d');
 assert.deepEqual(fs.readFileSync(new URL('../native/publisher_registration.h',import.meta.url)),header);
 for(const [name,bytes,sha256]of [['ynx_artifact_release.h',5089,'1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616'],['ynx_project_control.h',4420,'98c4f5fa607d6a1e87b5ea091c7110288aee7f8ac9ff5a901f98e1c2990ca5af']]){const b=fs.readFileSync(path.join(supplier,name));assert.equal(b.length,bytes);assert.equal(createHash('sha256').update(b).digest('hex'),sha256);}
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-publisher-registration-PUBLIC-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const binary=path.join(temp,'PUBLIC-adapter-no-crypto');
 const build=spawnSync('/usr/bin/xcrun',['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-I'+supplier,path.join(root,'test/native/publisher-registration-cabi-public.mm'),'-framework','Foundation','-o',binary],{encoding:'utf8',timeout:30000});
 assert.equal(build.status,0,build.stderr);const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.match(/^PASS /gm)?.length,20,run.stdout);assert.match(run.stdout,/actualCrypto=0 realGeneration=0 Source=0 userApproval=0 keychain=0/);
 const onceBinary=path.join(temp,'PUBLIC-generation-lifecycle');
 const onceBuild=spawnSync('/usr/bin/xcrun',['clang++','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-I'+supplier,path.join(root,'test/native/publisher-generation-attempt-public.mm'),'-framework','Foundation','-o',onceBinary],{encoding:'utf8',timeout:30000});assert.equal(onceBuild.status,0,onceBuild.stderr);
 const once=spawnSync(onceBinary,[],{encoding:'utf8',timeout:10000});assert.equal(once.status,0,once.stderr);assert.equal(once.stdout.match(/^PASS_ONCE /gm)?.length,5,once.stdout);assert.match(once.stdout,/actualCrypto=0 realKeychain=0 realConsent=0 Source=0 registration=0/);
});
test('publisher adapter has no public export, fallback purpose or injected signing provider',()=>{
 const source=fs.readFileSync(new URL('../native/original-publisher-registration-cabi.h',import.meta.url),'utf8');
 for(const name of ['YNXPublisherGenerateV1','YNXPublisherPoPSignV1','YNXPublisherCustodianSignV1'])assert.equal(source.split(name+'(').length-1,1);
 assert.doesNotMatch(source,/napi_|ipcRenderer|process\.env|seed|purpose_override|std::function/);
 for(const name of ['preload.cjs','main.mjs'])assert.doesNotMatch(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),/invokeOriginalPublisher(?:Generate|PoP|Custodian)CABI/);
 const once=fs.readFileSync(new URL('../native/original-publisher-generation-attempt.h',import.meta.url),'utf8');assert(once.indexOf('beginOriginalGenerationForRequest:')<once.indexOf('auto result=invokeOriginalPublisherGenerateCABI'));
 assert(once.indexOf('firstRecord_=result.record')<once.indexOf('return saveResult(error)'));assert.doesNotMatch(once,/napi_|std::function|copyOriginalControl|purpose_override/);
});
