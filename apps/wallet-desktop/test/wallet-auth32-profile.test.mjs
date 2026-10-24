import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,walletPublisherNativeInputs,SDK26_NODE_TRANSLATION_UNITS,composeWalletPublisherNativeBuildPlan} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
const version='1.3.0-pq.3.32-auth.32',root=process.env.WALLET_AUTH32_SOURCE_ROOT,sha=b=>createHash('sha256').update(b).digest('hex'),extra='packages/wallet-auth/native/original-pq-host-catalog-source.mm';
function base(){const repo='/PUBLIC/auth32',relative=[...SDK26_NODE_TRANSLATION_UNITS.slice(0,6),extra,...SDK26_NODE_TRANSLATION_UNITS.slice(6)],sources=relative.map(p=>path.join(repo,p)),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');return{repo,plan:{sources,output,outputs:[output],minimumSystemVersion:'13.0',commands:[{tool:'/usr/bin/clang++',argv:['-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]}};}
test('Auth32 selects its own99-input inventory and actual R224 build tool; no31 runtime union is borrowed',()=>{
 const p=walletNativeSourceProfile(version);assert.equal(p.supplierNodeInputs,99);assert.equal(p.requiresRuntimeUnion,true);
 assert.deepEqual(p.inventory,{bytes:76220,sha256:'20cf1f242571d679028539b5201591bc274d5f6ca710a608342f9d57605e5ead'});
 assert.deepEqual(p.tool,{bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'});
 assert.equal(walletNativeSourceProfile('1.3.0-pq.3.32-auth.31').supplierNodeInputs,92);assert.throws(()=>sdkRuntimeUnionProfile(version));
});
test('Auth32 composes actual15-source ordering plus Main3 exactly once and retains one co-resident archive',()=>{
 const f=base(),result=composeWalletPublisherNativeBuildPlan(f.plan,f.repo,99,true,true,true);
 assert.equal(result.sources.length,18);assert.equal(result.sources[6],path.join(f.repo,extra));assert.equal(result.sources.filter(p=>p.endsWith('/original-pq-host-catalog-source.mm')).length,1);
 assert.equal(result.commands[0].argv.filter(p=>p.endsWith('.a')).length,1);assert.equal(result.walletInputFiles.length,13);assert.equal(result.supplierNodeInputCount,99);assert.equal(result.nativeGrant,false);
});
test('Auth32 requires exact new TU ordering; a31 source list or a duplicated/new TU cannot use another profile',()=>{
 const f=base();for(const sources of [f.plan.sources.filter(p=>!p.endsWith('/original-pq-host-catalog-source.mm')),[...f.plan.sources,f.plan.sources[6]]])assert.throws(()=>composeWalletPublisherNativeBuildPlan({...f.plan,sources},f.repo,99,true,true,true));
 assert.throws(()=>composeWalletPublisherNativeBuildPlan(f.plan,f.repo,92,true,true,true));assert.throws(()=>walletPublisherNativeInputs(100,true,true,true));
});
test('actual canonical reader requires all seven private Source leaves before adding the new TU at original index6',()=>{
 const raw=fs.readFileSync(new URL('../scripts/canonical-package.mjs',import.meta.url),'utf8'),start=raw.indexOf(' const pqCatalog='),end=raw.indexOf(' if(withTransport)sourceRel.push',start);assert(start>0&&end>start);
 const run=Function('expectedInputs','sourceRel','bad',raw.slice(start,end)+'\nreturn sourceRel;'),group=['apps/wallet-desktop/native/original-pq-host-catalog-source-owner.inc.mm',...['original-pq-host-catalog-source.h','original-pq-host-catalog-source.mm','original-pq-host-catalog-source-state.h','original-pq-host-catalog-receipt.h','original-pq-host-catalog-source-contract.mjs','original-pq-host-catalog-task-exit.h'].map(n=>'packages/wallet-auth/native/'+n)],initial=SDK26_NODE_TRANSLATION_UNITS.slice(0,6);
 assert.deepEqual(run(group,[...initial],()=>{throw Error('PUBLIC incomplete');}),[...initial,extra]);
 for(const missing of group)assert.throws(()=>run(group.filter(name=>name!==missing),[...initial],()=>{throw Error('PUBLIC incomplete');}));
 assert.deepEqual(run([],[...initial],()=>{throw Error('PUBLIC incomplete');}),initial);
});
test('actual canonical32 inventory selects112 Main inputs and rejects31 identity without executing Native',{skip:!root},()=>{
 const p=walletNativeSourceProfile(version),raw=fs.readFileSync(path.join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),tool=fs.readFileSync(path.join(root,'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'));
 assert.equal(raw.length,p.inventory.bytes);assert.equal(sha(raw),p.inventory.sha256);assert.equal(tool.length,p.tool.bytes);assert.equal(sha(tool),p.tool.sha256);
 const inventory=JSON.parse(raw);assert.equal(inventory.NativeInputs.length,99);assert.equal(inventory.require.translationUnits,15);assert.equal(inventory.require.helperTranslationUnits,11);
 assert.equal([...inventory.NativeInputs,...inventory.HelperInputs].filter(p=>/\.(?:h|mm|cpp)$/.test(p.path)).length,87);assert.equal(inventory.sourceCurrentIOInputs.length,1);
 const wallet=walletPublisherNativeInputs(99,true,true,true),rows=[...inventory.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(version,names,raw,pins).inputs.length,112);assert.throws(()=>canonicalNativeInputSelection('1.3.0-pq.3.32-auth.31',names,raw,pins));
});
