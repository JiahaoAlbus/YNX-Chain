import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {walletNativeSourceProfile,walletPublisherNativeInputs} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES,fixedSDKRuntimeManifestSources,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.36',supply=process.env.WALLET_AUTH36_NORMAL_SUPPLY,sha=b=>createHash('sha256').update(b).digest('hex');
const inventoryPin={bytes:80385,sha256:'b262f8447437696dc84a0d51005e007be7690e0a30e1c40bf0f66ce871955068'},authPin={bytes:80552,sha256:'9ff6d289420a4593e36de4105b8fa287ee91abde81c01a551615377fa14e9ae8'},unionPin={bytes:1466281,sha256:'898e42a7f2aa2e5a8a9b4d8e8b2c958bf1d318299dc30f733c0617299d7039e4',files:9426,totalBytes:77841819};
test('Auth36 requires its own source/runtime tuple, preserves35 and refuses an unprovided41',()=>{
 const p=walletNativeSourceProfile(version);assert.equal(p.supplierNodeInputs,99);assert.equal(p.requiresRuntimeUnion,true);assert.deepEqual(p.inventory,inventoryPin);assert.deepEqual(p.tool,{bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'});
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],authPin);assert.deepEqual(sdkRuntimeUnionProfile(version),unionPin);assert.notDeepEqual(walletNativeSourceProfile('1.3.0-pq.3.32-auth.35').inventory,inventoryPin);assert.notDeepEqual(sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.35'),unionPin);assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.41'));
});
test('Auth36 actual afterPack selects the matching helper stage without building or registering it',async()=>{
 const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),stop=Error('PUBLIC helper stage');let calls=0;const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage(){},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version}),stageSDK13HelperBundle(){calls++;throw stop;}};runInNewContext(raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'')+'\nthis.run=afterPack;',context);await assert.rejects(context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch:3}),e=>e===stop);assert.equal(calls,1);
});
test('actual36 changed JS and full tables bind new immutable source; old35 inventory cannot qualify36',{skip:!supply},t=>{
 const raw=fs.readFileSync(path.join(supply,'SDK36_R2_CANONICAL_NORMAL_PREFIX_RUNTIME_HANDOFF.json'));assert.equal(raw.length,18088);assert.equal(sha(raw),'92e393ca7c7eb0a1ec431b45d93cc6063951078d803372d953b96915eada195a');const h=JSON.parse(raw);
 for(const[p,pin]of[[h.sourceRoles.canonicalInventory.path,inventoryPin],[h.runtime.Auth.manifest.path,authPin],[h.runtime.union.manifest.path,unionPin]]){const b=fs.readFileSync(p);assert.equal(b.length,pin.bytes);assert.equal(sha(b),pin.sha256);}
 const b=fs.readFileSync(h.sourceRoles.canonicalInventory.path),inventory=JSON.parse(b),wallet=walletPublisherNativeInputs(99,true,true,true),rows=[...inventory.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));assert.equal(canonicalNativeInputSelection(version,names,b,pins).inputs.length,112);assert.throws(()=>canonicalNativeInputSelection('1.3.0-pq.3.32-auth.35',names,b,pins));
 const auth=JSON.parse(fs.readFileSync(h.runtime.Auth.manifest.path)),union=JSON.parse(fs.readFileSync(h.runtime.union.manifest.path));
 for(const delta of h.normalPrefix.newSix.filter(r=>r.path.endsWith('.js'))){const body=fs.readFileSync(path.join(h.prefix,delta.path));assert.equal(sha(body),delta.after.sha256);for(const table of[auth,union])assert.deepEqual(table.files.find(r=>r.path===delta.path),delta.after);assert(relocateDesktopRuntimeSource('packages/wallet-auth/'+delta.path,body,version).bytes.equals(body));}
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-auth36-public-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const native=path.join(root,'packages/wallet-auth/native');fs.mkdirSync(native,{recursive:true});fs.writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({version}));fs.copyFileSync(h.runtime.Auth.manifest.path,path.join(native,'original-ide-auth-runtime-manifest.json'));fs.copyFileSync(h.runtime.union.manifest.path,path.join(native,'original-ide-contract-relay-runtime-manifest.json'));const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC exact36 DATA');};git('init','-q');commit();assert.equal(fixedSDKRuntimeManifestSources(root,'HEAD').length,2);fs.appendFileSync(path.join(native,'original-ide-contract-relay-runtime-manifest.json'),' ');commit();assert.throws(()=>fixedSDKRuntimeManifestSources(root,'HEAD'),/union identity differs/);
});
