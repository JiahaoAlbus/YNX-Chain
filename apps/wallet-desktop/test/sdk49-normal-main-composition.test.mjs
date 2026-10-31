import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifySDK49NormalSource,verifySDK49FullRuntimeTables} from '../scripts/sdk49-runtime-source.mjs';
import {readSDK49ProductRuntime} from '../scripts/sdk49-product-runtime.mjs';
import {SDK49_NORMAL_COMMIT,SDK49_NORMAL_VARIANT} from '../scripts/sdk49-normal-profile.mjs';
const root=path.resolve(fileURLToPath(new URL('../../..',import.meta.url)));
test('normal Main consumes one complete SDK prefix and full2 source without lending Native or installation qualification',()=>{
 const inventory=gunzipSync(readFileSync(new URL('./fixtures/sdk49-normal-prefix.json.gz',import.meta.url)));
 const result=verifySDK49NormalSource(path.join(root,'packages/wallet-auth'),inventory);
 assert.equal(result.sourceCommit,SDK49_NORMAL_COMMIT);assert.equal(result.sourceVariant,SDK49_NORMAL_VARIANT);
 assert.equal(result.normalPrefixFiles,9676);assert.equal(result.materializedFiles,9678);
 for(const flag of ['NativeAdmission','SourceAdmission','issuerSupplied','AppBuilt','installed'])assert.equal(result[flag],false);
 const changed=Buffer.from(inventory);changed[0]^=1;assert.throws(()=>verifySDK49NormalSource(path.join(root,'packages/wallet-auth'),changed));
});
test('normal full source tables keep Auth within the same union and reject a changed table',()=>{
 const auth=readFileSync(path.join(root,'packages/wallet-auth/native/original-ide-auth-runtime-manifest.json'));
 const union=readFileSync(path.join(root,'packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json'));
 const result=verifySDK49FullRuntimeTables(auth,union);assert.equal(result.authFiles,632);assert.equal(result.unionFiles,9492);assert.equal(result.fullAuthSubsetOfFullUnion,true);assert.equal(result.NativeAdmission,false);
 assert.throws(()=>verifySDK49FullRuntimeTables(Buffer.concat([auth,Buffer.from('\n')]),union));
});
test('normal six source slots project the matching product closure, preserving finite exclusions and full source custody',()=>{
 const result=readSDK49ProductRuntime(root,'HEAD');
 assert.equal(result.public.sourceVariant,SDK49_NORMAL_VARIANT);assert.equal(result.public.inputs.length,6);
 assert.equal(result.selected.size,9661);assert.equal(result.authRows.size,622);assert.equal(result.unionRows.size,9482);assert.equal(result.excluded.size,15);
 assert.equal(result.manifestRows.length,2);assert.equal(result.public.SourceQualified,false);assert.equal(result.public.Root,false);
 assert.equal(result.selected.get('node_modules/.package-lock.json').sha256,'a6156ecfdededf82c182684e86f00d803b04fc76c6a4b59b27e62ea81983e775');
});
