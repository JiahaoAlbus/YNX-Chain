import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {walletNativeSourceProfile,walletPublisherNativeInputs,SDK32_NODE_TRANSLATION_UNITS,composeWalletPublisherNativeBuildPlan} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES,fixedSDKRuntimeManifestSources,declaredSDKRuntimeSources,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.33',supply=process.env.WALLET_AUTH33_NORMAL_SUPPLY,sha=b=>createHash('sha256').update(b).digest('hex');
const inventoryPin={bytes:76890,sha256:'5113796025da9449eb495d3a606131e0a181190b099332e67dd5199762f86288'},authPin={bytes:80280,sha256:'19f2e15913232f1dd84a1152799f89201e60300879feb75e0f36cf2742830d84'},unionPin={bytes:1466009,sha256:'692bdcb8511e50bf75d6ad18868e87ffc248d22a4075143048db696dec693eed',files:9424,totalBytes:77830031};
test('Auth33 independently selects its R225 inventory and runtime identities without changing32 or admitting42',()=>{
 const p=walletNativeSourceProfile(version);assert.equal(p.supplierNodeInputs,99);assert.equal(p.requiresRuntimeUnion,true);assert.deepEqual(p.inventory,inventoryPin);assert.deepEqual(p.tool,{bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'});
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],authPin);assert.deepEqual(sdkRuntimeUnionProfile(version),unionPin);assert.notDeepEqual(walletNativeSourceProfile('1.3.0-pq.3.32-auth.32').inventory,inventoryPin);assert.notDeepEqual(sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.32'),unionPin);assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.42'));
});
test('actual supplied33 inventory and both runtime manifests are exact and canonical selection rejects32 metadata',{skip:!supply},()=>{
 const raw=fs.readFileSync(path.join(supply,'SDK33_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json'));assert.equal(raw.length,9751);assert.equal(sha(raw),'fa30d434346cced360ba0e0b34a61b470d17124210d5c60b90db949d0a25e04d');const h=JSON.parse(raw);
 for(const[p,pin]of[[h.independent33SourcePins.inventory,inventoryPin],[h.runtime.Auth.manifest,authPin],[h.runtime.union,unionPin]]){const body=fs.readFileSync(p.path);assert.equal(body.length,pin.bytes);assert.equal(sha(body),pin.sha256);}
 const bytes=fs.readFileSync(h.independent33SourcePins.inventory.path),inventory=JSON.parse(bytes),wallet=walletPublisherNativeInputs(99,true,true,true),rows=[...inventory.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(version,names,bytes,pins).inputs.length,112);assert.throws(()=>canonicalNativeInputSelection('1.3.0-pq.3.32-auth.32',names,bytes,pins));assert.equal(h.truth.NativeAddonLinked,false);
 for(const name of ['original-auth-source-current-v2.js','original-auth-identity-private-joint-registration.js','original-pq-host-catalog-source.js']){const body=fs.readFileSync(path.join(h.prefix,'src',name));assert(relocateDesktopRuntimeSource('packages/wallet-auth/src/'+name,body,version).bytes.equals(body));}
});
test('Auth33 exact runtime source selection preserves Markdown classification and rejects a changed union',{skip:!supply},t=>{
 const h=JSON.parse(fs.readFileSync(path.join(supply,'SDK33_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json'))),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-auth33-public-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const native=path.join(root,'packages/wallet-auth/native'),scripts=path.join(root,'packages/wallet-auth/scripts');fs.mkdirSync(native,{recursive:true});fs.mkdirSync(scripts,{recursive:true});fs.writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({version,files:['scripts/NORMAL_RUNTIME_MATERIALIZATION.md']}));fs.writeFileSync(path.join(scripts,'NORMAL_RUNTIME_MATERIALIZATION.md'),'# PUBLIC existing document');
 fs.writeFileSync(path.join(native,'original-ide-auth-runtime-manifest.json'),fs.readFileSync(h.runtime.Auth.manifest.path));fs.writeFileSync(path.join(native,'original-ide-contract-relay-runtime-manifest.json'),fs.readFileSync(h.runtime.union.path));const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC exact33 DATA');};git('init','-q');commit();assert.equal(fixedSDKRuntimeManifestSources(root,'HEAD').length,2);assert.deepEqual(declaredSDKRuntimeSources(root,'HEAD'),[]);
 const wrong=fs.readFileSync(h.runtime.union.path);wrong[0]^=1;fs.writeFileSync(path.join(native,'original-ide-contract-relay-runtime-manifest.json'),wrong);commit();assert.throws(()=>fixedSDKRuntimeManifestSources(root,'HEAD'),/union identity differs/);
});
test('Auth33 profile retains18 Main translation units, one original co-resident archive and no authority',()=>{
 const repo='/PUBLIC/auth33',sources=SDK32_NODE_TRANSLATION_UNITS.map(name=>path.join(repo,name)),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node'),plan={sources,output,outputs:[output],minimumSystemVersion:'13.0',commands:[{tool:'/usr/bin/clang++',argv:['-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]},result=composeWalletPublisherNativeBuildPlan(plan,repo,walletNativeSourceProfile(version).supplierNodeInputs,true,true,true);
 assert.equal(result.sources.length,18);assert.equal(result.commands[0].argv.filter(p=>p.endsWith('.a')).length,1);assert.equal(result.nativeGrant,false);assert.equal(result.approval,false);
});
test('Auth33 actual normal afterPack selects the original paired helper before proof and outer packaging',async()=>{
 const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),stop=Error('PUBLIC helper stage');let calls=0;const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage(){},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version}),stageSDK13HelperBundle(){calls++;throw stop;}};runInNewContext(raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'')+'\nthis.run=afterPack;',context);await assert.rejects(context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch:3}),error=>error===stop);assert.equal(calls,1);
});
