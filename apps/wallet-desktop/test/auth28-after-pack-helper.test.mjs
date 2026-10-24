import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';

// Controlled build boundary only: execute the actual afterPack branch and stop
// at staging. This does not compile/sign/stage/register a real Native helper.
const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8');
function caller(sdkVersion){
 const staged=Error('PUBLIC original helper staging boundary'),plist=Error('PUBLIC plist boundary'),calls=[];
 const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage:()=>{},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version:sdkVersion}),stageSDK13HelperBundle:args=>{calls.push(args);throw staged;},installPackagedPQVerifierAssets:async()=>{},originalPQVerifierReceipt:{PUBLIC:true},execFileSync:()=>{throw plist;}};
 const code=raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'');
 runInNewContext(code+'\nthis.run=afterPack;',context);
 return {calls,staged,plist,run:()=>context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch:3})};
}
test('Auth28 and Auth26 normal afterPack must stage the original paired helper before proof assets or outer sealing',async()=>{
 for(const version of ['1.3.0-pq.3.32-auth.28','1.3.0-pq.3.32-auth.26','1.3.0-pq.3.32-auth.20']){
  const f=caller(version);await assert.rejects(f.run(),e=>e===f.staged);assert.equal(f.calls.length,1);assert.equal(f.calls[0].contents,'/PUBLIC/build/YNX Wallet.app/Contents');assert.equal(f.calls[0].projectDir,'/PUBLIC/source/apps/wallet-desktop');
 }
});
test('unselected Auth29 does not inherit Auth28 helper packaging from a loose version range',async()=>{
 const f=caller('1.3.0-pq.3.32-auth.29');await assert.rejects(f.run(),e=>e===f.plist);assert.equal(f.calls.length,0);
});
