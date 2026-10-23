import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,composeWalletPublisherNativeBuildPlan,SDK13_NODE_TRANSLATION_UNITS,walletPublisherNativeInputs} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {sdk13HelperBuildCommands} from '../scripts/sdk13-native-component.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
const root='/PUBLIC/SDK20',flag='-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1';
function original(arch='arm64'){
 const sources=SDK13_NODE_TRANSLATION_UNITS.map(p=>path.join(root,p)),output=path.join(root,'apps/wallet-desktop/native/original-auth-identity.node');
 const arches=arch==='universal'?['arm64','x64']:[arch];
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-framework','AppKit','-framework','ServiceManagement','-lbsm','-arch',a,...sources,'-o',output+(arches.length===2?'.'+a:'')]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return {minimumSystemVersion:'13.0',sources,output,outputs:[output],commands};
}
test('exact SDK20 profile exists without selecting future/unknown or borrowing19 pins',()=>{
 const profile=walletNativeSourceProfile('1.3.0-pq.3.32-auth.20');assert.equal(profile.supplierNodeInputs,77);
 assert.deepEqual(profile.inventory,{bytes:51343,sha256:'408042f992ecbf4904e3677e4bb503e65ab6fb56990743adc1b19540829b9ea4'});
 assert.deepEqual(profile.tool,{bytes:12387,sha256:'882c936591a31fed919cadb063a5d496182d82175cc80a80dbaaaf6d109e179e'});
 assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.21'));
});
test('SDK20 closed inventory requires77 supplier plus3 Main leaves, both evidence files and no helper approval flag',()=>{
 const version='1.3.0-pq.3.32-auth.20',bytes=readFileSync(new URL('./fixtures/auth20-native-inventory.json',import.meta.url)),inventory=JSON.parse(bytes);
 assert.equal(bytes.length,51343);assert.equal(createHash('sha256').update(bytes).digest('hex'),walletNativeSourceProfile(version).inventory.sha256);
 const rows=[...inventory.NativeInputs,...walletPublisherNativeInputs(77)],helper=inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path);
 const names=[...rows.map(p=>p.path),...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS],receipt=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const selected=canonicalNativeInputSelection(version,names,bytes,receipt);assert.equal(selected.inputs.length,80);assert.equal(names.length,85);assert.equal(selected.walletInputs.length,3);
 const binding=rows.at(-1).path;
 for(const bad of [names.filter(p=>p!==binding),names.filter(p=>p!==CANONICAL_NATIVE_EVIDENCE_TESTS[0]),[...names,binding]])assert.throws(()=>canonicalNativeInputSelection(version,bad,bytes,receipt));
 const changed=structuredClone(receipt);changed.at(-1).sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,changed));
 assert.throws(()=>canonicalNativeInputSelection(version,names,readFileSync(new URL('./fixtures/auth19-native-inventory.json',import.meta.url)),receipt));
 for(const c of sdk13HelperBuildCommands('/PUBLIC/source',['arm64','x86_64']))assert(!c.argv.some(p=>p.includes('YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING')));
 assert.deepEqual(sdkRuntimeUnionProfile(version),{bytes:1453195,sha256:'6cfd7cdf412c007eb827096afb6eb8358ad0981debe2c40bc710f221b74b7b3a',files:9335,totalBytes:77271135});
});
test('SDK20 composes exactly three Main inputs and a single Main-only flag, without mutating supplier plans',()=>{
 for(const arch of ['arm64','universal']){
  const base=original(arch),before=structuredClone(base),plan=composeWalletPublisherNativeBuildPlan(base,root,77);
  assert.deepEqual(base,before);assert.equal(plan.walletInputFiles.length,3);assert.equal(plan.sources.length,14);
  assert.equal(plan.walletInputFiles.at(-1).path,'apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm');
  for(const c of plan.commands)assert.equal(c.argv.filter(p=>p===flag).length,c.tool==='/usr/bin/clang++'?1:0);
  assert.equal(plan.nativeGrant,false);assert.equal(plan.approval,false);
 }
 const old=composeWalletPublisherNativeBuildPlan(original(),root,76);assert.equal(old.walletInputFiles.length,2);assert(!old.commands[0].argv.includes(flag));
 for(const bad of [flag,'-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=0','-UYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING']){
  const plan=original();plan.commands[0].argv.unshift(bad);assert.throws(()=>composeWalletPublisherNativeBuildPlan(plan,root,77),/PLAN_MISMATCH/);
 }
});
