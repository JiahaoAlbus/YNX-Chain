import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createRequire} from 'node:module';
import {resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Test harness only. A supplied normal-package root is mandatory and has no
// source/dependency fallback. Every production export and primitive must resolve
// inside this exact package, including realpath resolution of symlinks.
const selected=process.env.YNX_ARTIFACT_GO_INTEROP_PACKAGE_ROOT;
assert.ok(selected===undefined||selected.length>0,'empty package root is not a default');
const packageRoot=realpathSync(selected===undefined?fileURLToPath(new URL('..',import.meta.url)):resolve(selected));
function inside(path){const actual=realpathSync(path);assert.ok(actual.startsWith(packageRoot+sep),`module escaped selected package: ${actual}`);return actual;}
const packageJSON=inside(resolve(packageRoot,'package.json')),metadata=JSON.parse(readFileSync(packageJSON,'utf8'));
// Native-only successors retain the exact frozen Auth9 crypto bytes below.
const expectedVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
assert.equal(metadata.name,'@ynx-chain/wallet-auth');assert.equal(metadata.version,expectedVersion);
const selectedRequire=createRequire(packageJSON);
const publicPath=name=>inside(selectedRequire.resolve(name));
const signaturePath=publicPath('@ynx-chain/wallet-auth/ide-artifact-signature'),manifestPath=publicPath('@ynx-chain/wallet-auth/ide-artifact-manifest');
const primitivePath=publicPath('@ynx/batch-v01-candidate');
// Confirm exact frozen production originals before loading their code.
assert.equal(hash(readFileSync(signaturePath)),'cb4c2e730c207c1c4aeb96fef3ce73f1776915cc1abeb977c5b32d0d3f8ca01a');
assert.equal(hash(readFileSync(inside(resolve(packageRoot,'src/ide-artifact-signature.d.ts')))),'c9eda72f8e43cf1521401ff8d97bdf981df46e808eac72cb02975c07176ef6bf');
assert.equal(hash(readFileSync(manifestPath)),'f0796db44a60a0d8111ed48f2e94b9476950191a07367739670da228671a29dd');
const {inspectIDEArtifactPublisherPublicOriginalData,inspectIDEArtifactSignatureData}=await import(pathToFileURL(signaturePath).href);
const {inspectIDEArtifactManifestData}=await import(pathToFileURL(manifestPath).href);
const {decodeMember,encodeMember,encodeFields}=await import(pathToFileURL(primitivePath).href);
// Original Go514e77631, CI39991253705 focusedjob120543276557 SUCCESS.
// A PUBLIC synthetic key/vector only: no publisher registration/Root/approval.
// Consumes existing .9 verifier; never recompiles Go or generates another key.
const raw=readFileSync(new URL('./fixtures/ide-artifact-go-514e77631.json',import.meta.url));
assert.equal(raw.length,90026);
assert.equal(hash(raw),'3af410529c96ad2af66f051754f619a7718be4fe590dddbff0fc7dd7f8afcfc9');
const fixture=JSON.parse(raw.toString('utf8'));
const r=Buffer.from(fixture.registrationBase64,'base64'),m=Buffer.from(fixture.manifestBase64,'base64'),message=Buffer.from(fixture.messageBase64,'base64'),signature=Buffer.from(fixture.memberBase64,'base64');
const inspect=(wire=signature,manifest=m,registration=r)=>inspectIDEArtifactSignatureData(new Uint8Array(wire),new Uint8Array(manifest),new Uint8Array(registration));
const refuses=fn=>assert.throws(fn,{code:'IDE_ARTIFACT_SIGNATURE_DATA_INVALID'});
function originalRFields(){const fields=[];let at=4;assert.equal(r.readUInt32BE(0),13);for(let i=0;i<13;i++){const n=r.readUInt32BE(at);at+=4;fields.push(Buffer.from(r.subarray(at,at+n)));at+=n;}assert.equal(at,r.length);return fields;}
test('original Go vector preserves exact R13/M3/N1 originals and verifies both signature branches',()=>{
 assert.equal(fixture.version,'YNX-IDE-ARTIFACT-PUBLIC-VECTOR/v1');assert.equal(fixture.syntheticFixture,true);
 for(const [bytes,key]of [[r,'registrationSHA256'],[message,'messageSHA256'],[signature,'memberSHA256']])assert.equal(hash(bytes),fixture[key]);
 assert.deepEqual(encodeFields(['YNX-IDE-ARTIFACT-RELEASE/v1',r,m]),message);
 const member=decodeMember(signature);assert.deepEqual(member.message,message);assert.equal(member.certificate.N,1);assert.equal(member.index,0);assert.deepEqual(member.pathA,[]);assert.deepEqual(member.pathB,[]);assert.equal(member.certificate.purpose,'ARTIFACT-RELEASE');
 const publicData=inspectIDEArtifactPublisherPublicOriginalData(new Uint8Array(r)),manifest=inspectIDEArtifactManifestData(new Uint8Array(m));assert.equal(manifest.projectId,publicData.projectId);
 const result=inspect();assert.equal(result.signatureVerified,true);assert.equal(result.memberCount,1);assert.equal(result.memberIndex,0);
 assert.equal(result.projectId,publicData.projectId);assert.equal(result.publisherId,publicData.publisherId);assert.equal(result.publisherKeyVersion,publicData.publisherKeyVersion);
 for(const data of [result,publicData]){assert.equal(data.dataOnly,true);for(const key of ['trusted','authorized','nativeAdmission','registered','current'])assert.equal(data[key],false);assert.ok(Object.isFrozen(data));}
 assert.equal(result.publicationAuthorized,false);
});
test('each actual Go signature branch independently refuses tampering and trailing bytes',()=>{
 for(const branch of ['sigmaA','sigmaB']){const changed=decodeMember(signature);changed.certificate[branch][0]^=1;refuses(()=>inspect(encodeMember(changed)));}
 refuses(()=>inspect(Buffer.concat([signature,Buffer.from([0])])));
});
test('original Go manifest and registration context/key changes cannot reuse a signature',()=>{
 const changedManifest=Buffer.from(m);const dto=inspectIDEArtifactManifestData(new Uint8Array(m));const offset=changedManifest.indexOf(Buffer.from(dto.contentDigest));assert.ok(offset>=0);changedManifest[offset]=changedManifest[offset]===97?98:97;
 // Still a valid canonical manifest; unchanged signature must bind the old bytes.
 inspectIDEArtifactManifestData(new Uint8Array(changedManifest));refuses(()=>inspect(signature,changedManifest));
 for(const index of [7,8,9,10]){const fields=originalRFields();fields[index]=Buffer.from(index===10?'2':'different-binding');const changed=encodeFields(fields);inspectIDEArtifactPublisherPublicOriginalData(new Uint8Array(changed));refuses(()=>inspect(signature,m,changed));}
 const fields=originalRFields();fields[11][0]^=1;fields[12][0]^=1;const changed=encodeFields(fields);inspectIDEArtifactPublisherPublicOriginalData(new Uint8Array(changed));refuses(()=>inspect(signature,m,changed));
});
