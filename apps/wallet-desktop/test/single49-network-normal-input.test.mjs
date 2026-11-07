import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{fileURLToPath}from'node:url';
import{inspectRoot14ManifestDATA,inspectRoot14PlanDATA}from'../scripts/original-auth-single49-network-profile.mjs';
import{go49,assertRoot14StrongSymbolsDATA}from'../scripts/original-auth-single49-network-gate.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'apps/wallet-desktop/native/original-wallet-single49-network-build-inputs.json')));
const planPath=process.env.SINGLE49_SOURCE_PLAN;
if(!planPath)throw Error('SINGLE49_SOURCE_PLAN_TEST_INPUT_REQUIRED');
const plan=JSON.parse(fs.readFileSync(planPath));const clone=structuredClone;
test('finite normal manifest and actual source-only plan do not inherit old77 execution',()=>{
 const m=inspectRoot14ManifestDATA(manifest),p=inspectRoot14PlanDATA(plan);assert.equal(m.objectCount,84);assert.equal(p.commands,86);assert.equal(plan.postCommands.length,7);assert.equal(plan.compilerExecuted,false);assert.equal(plan.NativeLoaded,false);assert.equal(plan.RootAdmission,false);assert.equal(plan.normalBuildReady,true);assert.equal(plan.buildBlocker,null);assert.equal(manifest.single49NetworkSourceContract.readerStrongAuthOpenH.sha256,'41b3200f60ca90a7a17489544f4737185815aaa43234882421c17d0e51c26959');
});
test('one archive49, full24 headers and exact C++ operands are actual pinned bytes',()=>{
 assert.equal(go49.length,49);assert.equal(new Set(go49).size,49);assert.equal(manifest.current24Headers.length,24);const rows=manifest.files.filter(r=>r.path.endsWith('.a'));assert.equal(rows.length,1);assert.equal(rows[0].sha256,'815ebd4bb890a89724d8bb23fefe3f1b3a56b74468a2bdc1ca16cf90e95a7a8a');
 for(const r of [...rows,...manifest.current24Headers]){const b=fs.readFileSync(path.join(root,r.path));assert.equal(b.length,r.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),r.sha256)}
});
test('old47 archive and Core17 tuple cannot describe the new role',()=>{
 const a=clone(manifest),row=a.files.find(r=>r.path===a.archive);row.sha256='f0bb5b7da5c275473bdca47cc035be60dc6b68694322befa6af0c93bae175660';assert.throws(()=>inspectRoot14ManifestDATA(a));const b=clone(manifest);b.goExportCounts={Core17:17,LINK22:22,Product8:8};assert.throws(()=>inspectRoot14ManifestDATA(b));
});
test('all native macros are explicit; PUBLIC Go/fixture callers never production TU',()=>{
 for(const t of manifest.translationUnits)assert(!/fixture|\.test\./i.test(t.path),t.path);
 assert(!manifest.translationUnits.some(t=>t.path.endsWith('original-source-current-dirfd-node.cpp')));
 assert(manifest.translationUnits[0].extraFlags.includes('YNX_NETWORK_CURRENT_PUBLISHER_CAPTURE_V1'));
 assert(manifest.translationUnits[76].extraFlags.includes('YNX_NETWORK_PUBLISHER_LINK_RESOURCE_CURRENT_V2'));
 assert(manifest.translationUnits[82].extraFlags.includes('YNX_LINK_RESOURCE_CURRENT_AUTH_ADAPTER'));
 const bad=clone(plan);bad.commands[82].argv=bad.commands[82].argv.filter(x=>x!=='-DYNX_LINK_RESOURCE_CURRENT_AUTH_ADAPTER');assert.throws(()=>inspectRoot14PlanDATA(bad));
 const pub=clone(plan);pub.commands[79].argv.push('-DYNX_LINK_RESOURCE_CURRENT_PUBLIC_TEST');assert.throws(()=>inspectRoot14PlanDATA(pub));
});
test('single main initializer owns original registrar, fixed SDK path is same normal image',()=>{
 const node=fs.readFileSync(path.join(root,'apps/wallet-desktop/native/original-auth-identity-node.mm'),'utf8');assert.equal((node.match(/NAPI_MODULE\(/g)??[]).length,1);assert(node.includes('if(!RegisterOriginalNetworkCurrentPublisherCaptureV1(env,exports))return nullptr;'));
 const sdk=fs.readFileSync(path.join(root,'packages/wallet-auth/native/original-network-current-publisher-reference-private.mjs'),'utf8');assert(sdk.includes('../../../apps/wallet-desktop/native/original-auth-identity.node'));assert(!sdk.includes('../../../apps/wallet-desktop/native/original-source-current-dirfd.node'));
 const reader=fs.readFileSync(path.join(root,'packages/wallet-auth/native/NetworkPublisherReaderV2.hpp'),'utf8');assert(reader.includes('ynx_link_resource_current_open_original_auth_v2'));const capture=fs.readFileSync(path.join(root,'packages/wallet-auth/native/network_publisher_capture.mm'),'utf8');assert(capture.includes('openOriginal'));
});
test('second archive, weak lookup and substituted catalog TU are rejected',()=>{
 const a=clone(plan);a.commands[84].argv.push('/tmp/another-Go.a');assert.throws(()=>inspectRoot14PlanDATA(a));const b=clone(plan);b.commands[84].argv.push('-weak_library');assert.throws(()=>inspectRoot14PlanDATA(b));const c=clone(plan);c.commands[0].argv[c.commands[0].argv.indexOf('-c')+1]=path.join(root,'packages/wallet-auth/native/original-source-current-dirfd-node.cpp');assert.throws(()=>inspectRoot14PlanDATA(c));
});
test('strong-symbol parser checks only expected49, rejects weak/duplicate/one missing',()=>{
 const names=go49,globals=names.map(n=>'0000000000000001 T _'+n).join('\n'),attrs=names.map(n=>'0000000000000001 (__TEXT,__text) external _'+n).join('\n');assertRoot14StrongSymbolsDATA(globals,attrs,names,'archive');assert.throws(()=>assertRoot14StrongSymbolsDATA(globals+'\n0000000000000002 T _'+names[0],attrs,names,'archive'));assert.throws(()=>assertRoot14StrongSymbolsDATA(globals,attrs.replace('external','weak external'),names,'archive'));assert.throws(()=>assertRoot14StrongSymbolsDATA(globals.split('\n').slice(1).join('\n'),attrs,names,'archive'));
});
