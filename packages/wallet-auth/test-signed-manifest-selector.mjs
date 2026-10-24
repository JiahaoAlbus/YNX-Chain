import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {createIDEArtifactPublisherKeyData,readIDEArtifactPublisherPublicOriginalData,signIDEArtifactManifestData,destroyIDEArtifactPublisherKeyData,inspectIDEArtifactSignedManifestData} from './src/ide-artifact-signature.js';
import {encodeIDEArtifactManifestData} from './src/ide-artifact-manifest.js';
import {canonical} from './native/original-auth-identity-source-verifier.mjs';
// Generated PUBLIC fixture keys only. Never loaded from a user/profile/Root.
const binding={networkId:'ab'.repeat(32),subjectOwner:'0x'+'1'.repeat(40),account:'PUBLIC_ACCOUNT',projectId:'PUBLIC_PROJECT',publisherId:'PUBLIC_PUBLISHER',publisherKeyVersion:'9007199254740993'};
const handle=createIDEArtifactPublisherKeyData(binding),other=createIDEArtifactPublisherKeyData({...binding,publisherId:'PUBLIC_OTHER'});
test.after(()=>{assert.equal(destroyIDEArtifactPublisherKeyData(handle),true);assert.equal(destroyIDEArtifactPublisherKeyData(other),true);});
const publicOriginal=readIDEArtifactPublisherPublicOriginalData(handle);
const manifest=encodeIDEArtifactManifestData({byteSize:1,contentDigest:'a'.repeat(64),projectId:binding.projectId,publishPurpose:'PUBLIC_TEST',targetEnvironment:'PUBLIC_NO_DEPLOY',version:'PUBLIC_1'});
const signature=signIDEArtifactManifestData(handle,manifest,publicOriginal);
test('selector recovers exact original and verifies same independent expected N1 public',()=>{
 const r=inspectIDEArtifactSignedManifestData(signature,publicOriginal);
 assert.equal(r.publisherId,binding.publisherId);assert.equal(r.publisherKeyVersion,binding.publisherKeyVersion);assert.equal(r.manifestOriginal,Buffer.from(manifest).toString('base64url'));assert.equal(r.signatureVerified,true);assert.equal(r.memberCount,1);assert.equal(r.memberIndex,0);
 for(const name of ['trusted','authorized','nativeAdmission','registered','current','publicationAuthorized'])assert.equal(r[name],false);assert.equal(r.dataOnly,true);
});
test('selector rejects a caller substituted public instead of resolving from signature',()=>{assert.throws(()=>inspectIDEArtifactSignedManifestData(signature,readIDEArtifactPublisherPublicOriginalData(other)));});
test('selector rejects tamper/truncation/empty/capacity without grant projection',()=>{
 const changed=new Uint8Array(signature);changed[changed.length-1]^=1;
 for(const wire of [changed,signature.slice(0,signature.length-1),new Uint8Array(),new Uint8Array(100001)])assert.throws(()=>inspectIDEArtifactSignedManifestData(wire,publicOriginal));
});
test('normal Node24 fixed CLI returns exact DATA not a publisher grant',()=>{
 const input=canonical({operation:'ide-artifact-signed-manifest-data/v1',signatureOriginal:Buffer.from(signature).toString('base64url'),expectedPublicOriginal:Buffer.from(publicOriginal).toString('base64url')});
 const r=spawnSync(process.execPath,['--permission','--allow-fs-read='+import.meta.dirname,'native/original-auth-identity-source-verifier.mjs'],{cwd:import.meta.dirname,input,env:{},encoding:'utf8',timeout:10000,maxBuffer:32768});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');const p=JSON.parse(r.stdout);assert.equal(p.manifestOriginal,Buffer.from(manifest).toString('base64url'));assert.equal(p.publisherId,binding.publisherId);assert.equal(p.authorized,false);assert.equal(p.registered,false);
});
test('normal CLI rejects injected fields and signature public substitution',()=>{
 const base={operation:'ide-artifact-signed-manifest-data/v1',signatureOriginal:Buffer.from(signature).toString('base64url'),expectedPublicOriginal:Buffer.from(publicOriginal).toString('base64url')};
 for(const input of [{...base,manifestOriginal:Buffer.from(manifest).toString('base64url')},{...base,expectedPublicOriginal:Buffer.from(readIDEArtifactPublisherPublicOriginalData(other)).toString('base64url')}]){
 const r=spawnSync(process.execPath,['native/original-auth-identity-source-verifier.mjs'],{cwd:import.meta.dirname,input:canonical(input),env:{},encoding:'utf8',timeout:10000,maxBuffer:32768});assert.notEqual(r.status,0);assert.equal(r.stdout,'');}
});
