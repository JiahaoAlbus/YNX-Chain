import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {WalletIDEIdentityReviewKernel} from '../src/wallet-ide-identity-review-kernel.mjs';
// Optional original SDK source path for this partial Main checkout only.
// Resolves ONE public pure DATA parser, not a Native/provider substitute.
const supplied=process.env.WALLET_PUBLICATION_SDK_ROOT;
const hooks=supplied?registerHooks({resolve(specifier,context,next){return specifier==='@ynx-chain/wallet-auth/ide-artifact-manifest'?{url:pathToFileURL(path.join(supplied,'src/ide-artifact-manifest.js')).href,shortCircuit:true}:next(specifier,context);}}):null;
const {encodeIDEArtifactManifestData}=await import('@ynx-chain/wallet-auth/ide-artifact-manifest');
const {inspectWalletIDEPublicationReviewData}=await import('../src/artifact-publication/publication-review-data.mjs');
hooks?.deregister();
const purpose='AUTH-PROTECTED-KEY-CALL',manifest={byteSize:42,contentDigest:'a'.repeat(64),projectId:'PUBLIC-project',publishPurpose:'release',targetEnvironment:'testnet',version:'PUBLIC-v2'};
const raw=Buffer.from(encodeIDEArtifactManifestData(manifest)).toString();
test('real original SDK parser exposes exact six fields without artifact, publisher or approval claims',()=>{
 const result=inspectWalletIDEPublicationReviewData(purpose,raw);
 for(const [k,v]of Object.entries(manifest))assert.equal(result[k],v);
 assert.deepEqual(Object.keys(result),[...Object.keys(manifest),'dataOnly','artifactVerified','publisherCurrent','publicationAuthorized']);
 assert.equal(result.dataOnly,true);assert.equal(result.artifactVerified,false);assert.equal(result.publisherCurrent,false);assert.equal(result.publicationAuthorized,false);assert(Object.isFrozen(result));
 assert.doesNotMatch(JSON.stringify(result),/requestOriginal|invocationOriginal|pkcs8|wire|reviewId/);
});
test('opaque calls, noncanonical JSON, duplicate fields and forbidden manifest characters do not invent semantics',()=>{
 const bad=[null,{},new String(raw),'{}',' '+raw,raw+'\n',raw.replace('"byteSize":42','"byteSize":42,"byteSize":42'),raw.replace('PUBLIC-project','\u202eproject'),raw.replace('PUBLIC-project','\ud800'),raw.replace('"byteSize":42','"byteSize":0'),raw.replace('a'.repeat(64),'A'.repeat(64)),raw.slice(0,-1)+',"authorized":true}', 'x'.repeat(16385)];
 for(const value of bad)assert.equal(inspectWalletIDEPublicationReviewData(purpose,value),null);
 for(const other of ['AUTH-IDENTITY-RECEIVE','AUTH-IDENTITY-RECOVER','ARTIFACT-RELEASE',null])assert.equal(inspectWalletIDEPublicationReviewData(other,raw),null);
});
test('inspection does not coerce invocation objects or accept caller-supplied view objects as originals',()=>{
 let calls=0;const value={toString(){calls++;return raw;}};assert.equal(inspectWalletIDEPublicationReviewData(purpose,value),null);assert.equal(calls,0);
 assert.equal(inspectWalletIDEPublicationReviewData(purpose,{...manifest,publicationAuthorized:true}),null);
});
test('actual Main review factory carries parsed semantics into the public review but not signing permission',()=>{
 // PUBLIC admitted-request/evidence seams only. Actual production factory,
 // actual kernel and original SDK parser execute; no real Source or key use.
 const text=readFileSync(new URL('../src/wallet-ide-identity-review.mjs',import.meta.url),'utf8'),body={owner:'PUBLIC-owner',networkId:'PUBLIC-network',requestId:'PUBLIC-request',expiresAtMs:'30000'};
 const context={inspectWalletIDEPublicationReviewData,WalletIDEIdentityReviewKernel,Date,isWalletIDEIdentityEvidence:v=>v===evidence,inspectOriginalAuthIdentityRequest:()=>({body}),createOriginalAuthIdentityProofAction:()=>assert.fail('public description cannot acquire a key')};
 const evidence={assertSafeToClose(){},persist(){assert.fail('public description cannot persist a choice');}};
 runInNewContext(text.replace(/^import .*;$/mg,'').replace('export function createWalletIDEIdentityReview','function createWalletIDEIdentityReview')+'\nthis.factory=createWalletIDEIdentityReview;',context);
 const review=context.factory({vault:{},requestOriginal:'PUBLIC request',expectedOriginal:'PUBLIC request',invocationOriginal:raw,purpose,assertCurrent(){},evidence});
 const view=review.describe();assert.equal(view.publication.projectId,manifest.projectId);assert.equal(view.publication.publicationAuthorized,false);assert.equal(review.status().decision,null);assert.equal(review.status().hasSignedResult,false);assert.doesNotMatch(JSON.stringify(view),/invocationOriginal|pkcs8|wire/);
});
