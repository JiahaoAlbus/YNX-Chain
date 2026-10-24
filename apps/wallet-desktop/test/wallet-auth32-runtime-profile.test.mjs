import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES,fixedSDKRuntimeManifestSources,relocateDesktopRuntimeSource} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.32',supply=process.env.WALLET_AUTH32_NORMAL_SUPPLY,sha=b=>createHash('sha256').update(b).digest('hex');
const authPin={bytes:80280,sha256:'58b5bbfd4fd93b4ea18f27292cd7a82751583147858163e4ebd899d1eb16a986'},unionPin={bytes:1466009,sha256:'7543115cdd892e2a84c2af71a3e99200c17dd760ab0bcd4823df824748658e32',files:9424,totalBytes:77829265};
test('Auth32 runtime profile selects exact564 Auth and9424 union, not31 manifests or an unselected33',()=>{
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],authPin);assert.deepEqual(sdkRuntimeUnionProfile(version),unionPin);
 assert.notDeepEqual(sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.31'),unionPin);assert.equal(FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.33'],undefined);assert.throws(()=>sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.33'));
});
test('actual supplied32 manifests and private caller relocation match without rerunning9424 dependency readback',{skip:!supply},()=>{
 const raw=fs.readFileSync(path.join(supply,'SDK32_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json'));assert.equal(raw.length,9933);assert.equal(sha(raw),'cfb60af3669a72e3fdc638844b41b0fc01031aae05b24d9a8fab5e3722c454e3');const h=JSON.parse(raw);
 for(const [p,want]of[[h.runtime.Auth.manifest,authPin],[h.runtime.union,unionPin]]){const body=fs.readFileSync(p.path);assert.equal(body.length,want.bytes);assert.equal(sha(body),want.sha256);}
 assert.equal(h.runtime.Auth.files,564);assert.equal(h.runtime.unionFiles,9424);assert.equal(h.truth.NativeAddonLinked,false);
 for(const name of ['original-auth-source-current-v2.js','original-auth-identity-private-joint-registration.js','original-pq-host-catalog-source.js']){const body=fs.readFileSync(path.join(h.prefix,'src',name));assert(relocateDesktopRuntimeSource('packages/wallet-auth/src/'+name,body,version).bytes.equals(body));}
});
test('normal32 fixed source selector accepts only the two exact generated manifests and rejects a changed union',{skip:!supply},t=>{
 const h=JSON.parse(fs.readFileSync(path.join(supply,'SDK32_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json'))),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-auth32-runtime-public-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const native=path.join(root,'packages/wallet-auth/native');fs.mkdirSync(native,{recursive:true});fs.writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({version}));
 fs.writeFileSync(path.join(native,'original-ide-auth-runtime-manifest.json'),fs.readFileSync(h.runtime.Auth.manifest.path));fs.writeFileSync(path.join(native,'original-ide-contract-relay-runtime-manifest.json'),fs.readFileSync(h.runtime.union.path));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC exact manifest DATA');};git('init','-q');commit();
 assert.equal(fixedSDKRuntimeManifestSources(root,'HEAD').length,2);const wrong=fs.readFileSync(h.runtime.union.path);wrong[0]^=1;fs.writeFileSync(path.join(native,'original-ide-contract-relay-runtime-manifest.json'),wrong);commit();assert.throws(()=>fixedSDKRuntimeManifestSources(root,'HEAD'),/union identity differs/);
});
test('Auth32 actual normal afterPack enters paired helper staging, not an older optional branch',async()=>{
 const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),stop=Error('PUBLIC stage boundary');let calls=0;
 const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage(){},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version}),stageSDK13HelperBundle(){calls++;throw stop;}};
 runInNewContext(raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'')+'\nthis.run=afterPack;',context);
 await assert.rejects(context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch:3}),error=>error===stop);assert.equal(calls,1);
});
