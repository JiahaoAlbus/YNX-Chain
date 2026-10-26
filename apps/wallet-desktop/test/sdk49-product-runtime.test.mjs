import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readSDK49ProductRuntime,assertSDK49ProductArchive,assertSDK49CanonicalRuntimeManifest,SDK49_PRODUCT_PINS} from '../scripts/sdk49-product-runtime.mjs';
import {fixedSDKRuntimeManifestSources,assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const product=()=>readSDK49ProductRuntime(root,commit);
test('existing normal release preflight consumes SDK49 full source identity and product pack filters',()=>{
 assert.equal(fixedSDKRuntimeManifestSources(root,commit).length,2);
 assertSDKRuntimePackCoverage(path.join(root,'apps/wallet-desktop'),commit);
});
test('normal SDK49 product reader binds committed formal6 slots and keeps full Native custody separate',()=>{
 const p=product();assert.equal(p.selected.size,9591);assert.equal(p.authRows.size,580);assert.equal(p.unionRows.size,9441);assert.equal(p.excluded.size,15);assert.equal(p.manifestRows.length,2);
 assert.equal(p.public.SourceQualified,false);assert.equal(p.public.fullBuildCustodyUnchanged,true);assert.equal(Object.keys(SDK49_PRODUCT_PINS).length,6);
 assert.equal(readSDK49ProductRuntime(root,'8d232f59c0e95f62bd91330dd2fbd872b02b6000'),null,'old46 is not a49 source');
});
test('normal SDK49 archive plan includes exact9591+2 and refuses unlisted/excluded/missing/changed rows',()=>{
 const p=product(),prepared=p.prepare([]),inventory=[...prepared.dataRows,...p.manifestRows.map(r=>({...r,type:'file',unpacked:false,executable:false}))];
 assert.equal(inventory.length,9593);assertSDK49ProductArchive(p,inventory);
 const excluded=prepared.excludedRows[0];assert.throws(()=>assertSDK49ProductArchive(p,[...inventory,{...excluded,type:'file'}]),/SDK49_PRODUCT_EXCLUDED_PACK_MEMBER/);
 assert.throws(()=>assertSDK49ProductArchive(p,inventory.slice(1)),/SDK49_PRODUCT_PACK_ROW_MISSING_OR_CHANGED/);
 assert.throws(()=>assertSDK49ProductArchive(p,[{...inventory[0],sha256:'0'.repeat(64)},...inventory.slice(1)]),/SDK49_PRODUCT_PACK_ROW_MISSING_OR_CHANGED/);
 assert.throws(()=>assertSDK49ProductArchive(p,[...inventory,{path:p.manifestRows[0].path.replace(/native\/[^/]+$/,'unlisted.bin'),type:'file',bytes:0,sha256:'0'.repeat(64)}]),/SDK49_PRODUCT_UNLISTED_PACK_MEMBER/);
 const source=prepared.dataRows.find(r=>r.path.endsWith('/src/product-session-v2.js'));assert.equal(prepared.readAdditional(source.path).length,source.bytes);
});
test('SDK49 product manifests preserve raw canonical bytes and are not silently trimmed or regenerated',()=>{
 const bytes=fs.readFileSync(root+'/runtime-projections/sdk49-product/original-ide-auth-runtime-manifest.json');
 assert.equal(assertSDK49CanonicalRuntimeManifest(bytes).files.length,580);
 assert.throws(()=>assertSDK49CanonicalRuntimeManifest(Buffer.concat([bytes,Buffer.from('\n')])),/SDK49_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS/);
});
