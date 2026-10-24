import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createOriginalPublicationInputData} from './publication-result-originals.mjs';

test('normal SDK public decoder feeds the Auth six-field caller without altering inner result or member',async()=>{
 const root=await realpath(process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT||fileURLToPath(new URL('../../../packages/wallet-auth',import.meta.url)));
 const metadataPath=join(root,'package.json'),metadata=JSON.parse(await readFile(metadataPath));assert.equal(metadata.name,'@ynx-chain/wallet-auth');assert.equal(metadata.version,'1.3.0-pq.3.32-auth.37');
 const sdk=createRequire(pathToFileURL(metadataPath)),target=await realpath(sdk.resolve('@ynx-chain/wallet-auth/ide-artifact-release-result'));assert.ok(target.startsWith(root+sep));
 const {decodeIDEArtifactReleaseResultData}=await import(pathToFileURL(target).href);
 const fields={version:'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1',purpose:'ARTIFACT-RELEASE',requestOriginal:'{"requestId":"PUBLIC-request"}',manifestOriginal:'{"projectId":"PUBLIC-project","label":"中文/🌏"}',invocationOriginal:'{"projectId":"PUBLIC-project","label":"中文/🌏"}',publisherOriginal:'AQID',signatureOriginal:'BAUG',actualApprovalRef:'00000000-0000-4000-8000-000000000001',publisherRegistrationRef:'PUBLIC-registration',publisherRevision:'1',publisherKeyVersion:'1'};
 // PUBLIC framing bytes, not a mathematically valid N1 signature/approval.
 const raw=new TextEncoder().encode(JSON.stringify(fields,null,1)),before=new Uint8Array(raw),input={resultOriginal:raw,expectedRequestOriginal:fields.requestOriginal,expectedManifestOriginal:fields.manifestOriginal};
 const packet=createOriginalPublicationInputData(input,decodeIDEArtifactReleaseResultData),roundtrip=JSON.parse(JSON.stringify(packet));
 assert.deepEqual(Object.keys(roundtrip).sort(),['version','requestOriginal','resultOriginal','invocationOriginal','signatureOriginal','actualApprovalRef'].sort());
 assert.equal(roundtrip.version,'YNX-IDE-PUBLICATION-INPUT/v1');assert.deepEqual(new TextEncoder().encode(roundtrip.resultOriginal),before);assert.equal(roundtrip.signatureOriginal,fields.signatureOriginal);assert.equal(roundtrip.invocationOriginal,fields.manifestOriginal);
 const decoded=decodeIDEArtifactReleaseResultData(before);assert.deepEqual(decoded.signatureOriginalBytes,Uint8Array.of(4,5,6));
 const sha=b=>createHash('sha256').update(b).digest('hex');assert.notEqual(sha(decoded.signatureOriginalBytes),sha(new TextEncoder().encode(roundtrip.signatureOriginal)));
 assert.equal(decoded.authorized,false);assert.equal(decoded.signatureVerified,false);assert.equal(decoded.approvalCurrent,false);
});
