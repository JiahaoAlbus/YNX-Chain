import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,walletPublisherNativeInputs,SDK26_NODE_TRANSLATION_UNITS,composeWalletPublisherNativeBuildPlan} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {verifySDK13NativeComponent} from '../scripts/sdk13-native-component.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES,relocateDesktopRuntimeSource,matchedCustodyPackagedNativeSources} from '../scripts/release-provenance.mjs';
import {runInNewContext} from 'node:vm';
const version='1.3.0-pq.3.32-auth.31',root=process.env.WALLET_AUTH31_SOURCE_ROOT,sha=b=>createHash('sha256').update(b).digest('hex');
function base(){const repo='/PUBLIC/auth31',sources=SDK26_NODE_TRANSLATION_UNITS.map(name=>path.join(repo,name)),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');return{repo,plan:{sources,output,outputs:[output],minimumSystemVersion:'13.0',commands:[{tool:'/usr/bin/clang++',argv:['-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]}};}
test('Auth31 has an explicit independent92-input profile without relabeling Auth28 or admitting intermediate versions',()=>{
 const p=walletNativeSourceProfile(version);assert.equal(p.supplierNodeInputs,92);assert.equal(p.requiresRuntimeUnion,true);
 assert.deepEqual(p.inventory,{bytes:73563,sha256:'c598c7f7541c6854885c5c227315cd9215a7aeefa3e1d1f23192bcd7acf72dbb'});
 assert.deepEqual(p.tool,{bytes:14702,sha256:'83db7b575e57ceb67cf59efdc767c6988d30eb075877dca44ea55c003888e6be'});
 assert.equal(walletNativeSourceProfile('1.3.0-pq.3.32-auth.28').supplierNodeInputs,91);
 assert.deepEqual(sdkRuntimeUnionProfile(version),{bytes:1464442,sha256:'2070d6ca11b27693fa8d21b97fef71315aab89b2ef6b861105d087fa4657facc',files:9413,totalBytes:77777339});
 for(const n of [29,30,41])assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.'+n));
});
test('an Auth28 executed-record identity cannot be relabeled31 or reach supplier and binary reads',{skip:!root},()=>{
 const raw=fs.readFileSync(path.join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),old=walletNativeSourceProfile('1.3.0-pq.3.32-auth.28');let reads=0;
 const record={readbackOnly:false,commandsKind:'executed-normal-build',sourceInventory:{relative:'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...old.inventory}};
 assert.throws(()=>verifySDK13NativeComponent({record,inventoryBytes:raw,moduleBytes:Buffer.alloc(0),helperBytes:Buffer.alloc(0)},()=>{reads++;throw Error('must not read');}));assert.equal(reads,0);assert.equal(record.sourceInventory.sha256,old.inventory.sha256);
});
test('Auth31 actual Main composition retains supplier14 plus Main3 and exactly one co-resident archive',()=>{
 const f=base(),plan=composeWalletPublisherNativeBuildPlan(f.plan,f.repo,92,true,true,true);
 assert.equal(plan.sources.length,17);assert.equal(plan.commands[0].argv.filter(v=>v.endsWith('.a')).length,1);
 assert.equal(plan.commands[0].argv.filter(v=>v==='LocalAuthentication').length,1);
 assert.equal(plan.commands[0].argv.filter(v=>v.includes('libynx_artifact_release.a')).length,0);
 assert.equal(plan.walletInputFiles.length,13);assert.equal(plan.supplierNodeInputCount,92);assert.equal(plan.nativeGrant,false);assert.equal(plan.approval,false);
});
test('Auth31 custody roles cannot compose an altered supplier plan, duplicate historical archive or unknown input count',()=>{
 const f=base();assert.throws(()=>composeWalletPublisherNativeBuildPlan({...f.plan,sources:f.plan.sources.slice(0,-1)},f.repo,92,true,true,true));
 const altered={...f.plan,commands:[{...f.plan.commands[0],argv:[...f.plan.commands[0].argv,'/PUBLIC/libynx_artifact_release.a']}]};assert.throws(()=>composeWalletPublisherNativeBuildPlan(altered,f.repo,92,true,true,true));
 assert.throws(()=>walletPublisherNativeInputs(93,true,true,true));assert.throws(()=>walletPublisherNativeInputs(92,true,false,true));
});
test('actual canonical Auth31 tool and inventory match own profile and105 selected Main inputs without executing Native',{skip:!root},()=>{
 const p=walletNativeSourceProfile(version),raw=fs.readFileSync(path.join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),tool=fs.readFileSync(path.join(root,'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'));
 assert.equal(raw.length,p.inventory.bytes);assert.equal(sha(raw),p.inventory.sha256);assert.equal(tool.length,p.tool.bytes);assert.equal(sha(tool),p.tool.sha256);
 const inventory=JSON.parse(raw);assert.equal(inventory.NativeInputs.length,92);assert.equal(inventory.HelperInputs.length,5);assert.equal(inventory.require.translationUnits,14);assert.equal(inventory.require.helperTranslationUnits,11);
 const wallet=walletPublisherNativeInputs(92,true,true,true),rows=[...inventory.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(version,names,raw,pins).inputs.length,105);
 assert.deepEqual(matchedCustodyPackagedNativeSources(raw,{sourceBytesVerified:true,walletInputs:wallet},names),names);
 assert.throws(()=>canonicalNativeInputSelection('1.3.0-pq.3.32-auth.28',names,raw,pins));
 const changed=Buffer.from(raw);changed[0]^=1;assert.throws(()=>canonicalNativeInputSelection(version,names,changed,pins));
});
test('Auth31 normal App selection pins its own553 manifest and exact SourceV2 operand without granting optional IO',{skip:!root},()=>{
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],{bytes:78713,sha256:'68e7497e7444cbbdc344ec7721c5ddb4c762299cc18f737a78c24943bbb6629e'});
 const name='packages/wallet-auth/src/original-auth-source-current-v2.js',body=fs.readFileSync(path.join(root,name)),result=relocateDesktopRuntimeSource(name,body,version);
 assert(result.bytes.equals(body));assert.equal(result.operands.length,1);assert.equal(result.operands[0].count,1);
 assert.throws(()=>relocateDesktopRuntimeSource(name,Buffer.concat([body,body]),version));
});
test('Auth31 actual normal afterPack enters original paired helper staging before proof/outer packaging',async()=>{
 const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),staged=Error('PUBLIC stage boundary');let count=0;
 const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage(){},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version}),stageSDK13HelperBundle(){count++;throw staged;}};
 runInNewContext(raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'')+'\nthis.run=afterPack;',context);
 await assert.rejects(context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch:3}),error=>error===staged);assert.equal(count,1);
});
