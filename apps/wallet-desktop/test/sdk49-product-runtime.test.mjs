import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readSDK49ProductRuntime,assertSDK49ProductArchive,assertSDK49CanonicalRuntimeManifest,SDK49_PRODUCT_PINS} from '../scripts/sdk49-product-runtime.mjs';
import {fixedSDKRuntimeManifestSources,assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
import {issuerSourceFixture,issuerSourceBytes} from './fixtures/sdk49-issuer-source-fixture.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const fixture=t=>issuerSourceFixture(t,fs.readFileSync(path.join(root,'apps/wallet-desktop/package.json')));
test('frozen issuer normal release preflight retains its exact full source identity and product pack filters',t=>{
 const f=fixture(t);assert.equal(fixedSDKRuntimeManifestSources(f.root,'HEAD').length,2);
 assertSDKRuntimePackCoverage(path.join(f.root,'apps/wallet-desktop'),'HEAD');
});
test('normal issuer SDK49 product reader binds committed formal6 slots and keeps full Native custody separate',t=>{
 const f=fixture(t),p=readSDK49ProductRuntime(f.root,'HEAD');assert.equal(p.selected.size,9598);assert.equal(p.authRows.size,587);assert.equal(p.unionRows.size,9448);assert.equal(p.excluded.size,15);assert.equal(p.manifestRows.length,2);
 assert.equal(p.public.SourceQualified,false);assert.equal(p.public.fullBuildCustodyUnchanged,true);assert.equal(Object.keys(SDK49_PRODUCT_PINS).length,6);
 assert.equal(readSDK49ProductRuntime(root,'8d232f59c0e95f62bd91330dd2fbd872b02b6000'),null,'old46 is not a49 source');
});
test('normal issuer SDK49 archive plan includes exact9598+2 and refuses unlisted/excluded/missing/changed rows',t=>{
 const f=fixture(t),p=readSDK49ProductRuntime(f.root,'HEAD'),missing='src/product-session-v2.js';
 f.put('packages/wallet-auth/'+missing,fs.readFileSync(path.join(root,'packages/wallet-auth',missing)));
 const before=[...p.selected.values()].filter(r=>r.path!==missing).map(r=>({...r,path:'code/packages/wallet-auth/'+r.path,type:'file',unpacked:false,executable:false}));
 const prepared=p.prepare(before),inventory=[...prepared.dataRows,...p.manifestRows.map(r=>({...r,type:'file',unpacked:false,executable:false}))];
 assert.equal(inventory.length,9600);assertSDK49ProductArchive(p,inventory);
 const excluded=prepared.excludedRows[0];assert.throws(()=>assertSDK49ProductArchive(p,[...inventory,{...excluded,type:'file'}]),/SDK49_PRODUCT_EXCLUDED_PACK_MEMBER/);
 assert.throws(()=>assertSDK49ProductArchive(p,inventory.slice(1)),/SDK49_PRODUCT_PACK_ROW_MISSING_OR_CHANGED/);
 assert.throws(()=>assertSDK49ProductArchive(p,[{...inventory[0],sha256:'0'.repeat(64)},...inventory.slice(1)]),/SDK49_PRODUCT_PACK_ROW_MISSING_OR_CHANGED/);
 assert.throws(()=>assertSDK49ProductArchive(p,[...inventory,{path:p.manifestRows[0].path.replace(/native\/[^/]+$/,'unlisted.bin'),type:'file',bytes:0,sha256:'0'.repeat(64)}]),/SDK49_PRODUCT_UNLISTED_PACK_MEMBER/);
 const source=prepared.dataRows.find(r=>r.path.endsWith('/src/product-session-v2.js'));assert.equal(prepared.readAdditional(source.path).length,source.bytes);
});
test('SDK49 product manifests preserve raw canonical bytes and are not silently trimmed or regenerated',()=>{
 const bytes=issuerSourceBytes('runtime-projections/sdk49-product/original-ide-auth-runtime-manifest.json');
 assert.equal(assertSDK49CanonicalRuntimeManifest(bytes).files.length,587);
 assert.throws(()=>assertSDK49CanonicalRuntimeManifest(Buffer.concat([bytes,Buffer.from('\n')])),/SDK49_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS/);
});
