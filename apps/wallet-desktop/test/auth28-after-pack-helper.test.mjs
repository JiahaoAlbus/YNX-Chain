import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

// Controlled build boundary only: execute the actual afterPack branch and stop
// at staging. This does not compile/sign/stage/register a real Native helper.
const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8');
function caller(sdkVersion,arch=3){
 const staged=Error('PUBLIC original helper staging boundary'),plist=Error('PUBLIC plist boundary'),calls=[];
 const context={path,process:{env:{}},desktopReleaseIdentity:()=>({PUBLIC:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage:()=>{},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:async()=>JSON.stringify({version:sdkVersion}),stageSDK13HelperBundle:args=>{calls.push(args);throw staged;},installPackagedPQVerifierAssets:async()=>{},originalPQVerifierReceipt:{PUBLIC:true},execFileSync:()=>{throw plist;}};
 const code=raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'');
 runInNewContext(code+'\nthis.run=afterPack;',context);
 return {calls,staged,plist,run:()=>context.run({packager:{projectDir:'/PUBLIC/source/apps/wallet-desktop',appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:'/PUBLIC/build',electronPlatformName:'darwin',arch})};
}
test('Auth28 and Auth26 normal afterPack must stage the original paired helper before proof assets or outer sealing',async()=>{
 for(const version of ['1.3.0-pq.3.32-auth.46','1.3.0-pq.3.32-auth.28','1.3.0-pq.3.32-auth.26','1.3.0-pq.3.32-auth.20']){
  const f=caller(version);await assert.rejects(f.run(),e=>e===f.staged);assert.equal(f.calls.length,1);assert.equal(f.calls[0].contents,'/PUBLIC/build/YNX Wallet.app/Contents');assert.equal(f.calls[0].projectDir,'/PUBLIC/source/apps/wallet-desktop');
 }
});
test('unselected Auth29 does not inherit Auth28 helper packaging from a loose version range',async()=>{
 const f=caller('1.3.0-pq.3.32-auth.29');await assert.rejects(f.run(),e=>e===f.plist);assert.equal(f.calls.length,0);
});
test('SDK46 refuses another architecture before helper copy; SDK48 never inherits this fixed supplier role',async()=>{
 const wrong=caller('1.3.0-pq.3.32-auth.46',1);await assert.rejects(wrong.run(),/SDK46 paired component is arm64 only/);assert.equal(wrong.calls.length,0);
 const future=caller('1.3.0-pq.3.32-auth.48');await assert.rejects(future.run(),e=>e===future.plist);assert.equal(future.calls.length,0);
 const build=fs.readFileSync(new URL('../scripts/build-mac.mjs',import.meta.url),'utf8');
 assert(build.indexOf("if(matchedSDK.version==='1.3.0-pq.3.32-auth.46')verifySDK13HelperBundle(")<build.indexOf('await withMacDmgSource(appDir'));
});
test('actual build-mac control flow refuses failed SDK46 helper verification before any DMG source or image work',async()=>{
 const url=new URL('../scripts/build-mac.mjs',import.meta.url),source=fs.readFileSync(url,'utf8'),failure=Error('CONTROLLED helper verification refusal'),calls=[];
 const helper=Buffer.from('PUBLIC helper byte stand-in, never executable'),plist=Buffer.from('PUBLIC plist byte stand-in');let image=false;
 const metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
 const context={path,URL,fileURLToPath,process:{platform:'darwin',argv:['node','build-mac.mjs','arm64','--proof-verifier-stage=/PUBLIC/stage'],execPath:'/PUBLIC/node',env:{},exit:()=>{throw Error('unexpected exit');}},console:{log:()=>{}},stat:async()=>({isFile:()=>true,isDirectory:()=>true,size:1}),readFile:async value=>{
  const file=String(value);if(file.endsWith('/packages/wallet-auth/package.json'))return JSON.stringify({version:'1.3.0-pq.3.32-auth.46'});
  if(file.endsWith('/package.json'))return JSON.stringify(metadata);if(file.endsWith('/YNXIdentityReceiver'))return helper;return plist;
 },assertSelectedProofVerifierForSDK:()=>{},verifyPackagedPQVerifierAssets:async()=>{},originalPQVerifierReceipt:{},spawnSync:()=>({status:0}),verifySDK13HelperBundle:(...args)=>{calls.push(args);throw failure;},SDK13_HELPER_ASSET:'apps/wallet-desktop/native/YNXIdentityReceiver',SDK13_HELPER_PLIST:'apps/developer/helper/com.ynxweb4.developer.testnetpreview.identity-receiver.plist',withMacDmgSource:async()=>{image=true;},execFileSync:()=>{throw Error('unexpected disk image operation');}};
 context.assertNativeComponentGitSourceClosure=()=>{};
 context.execFileSync=(tool,args)=>{if(tool==='git')return args.includes('HEAD')?'a'.repeat(40)+'\n':'/PUBLIC/source\n';throw Error('unexpected disk image operation');};
 const code=source.replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));runInNewContext('this.run=async()=>{'+code+'\n};',context);
 await assert.rejects(context.run(),e=>e===failure);assert.equal(image,false);assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(1),[helper,plist]);assert(calls[0][0].endsWith('/dist/mac-arm64/YNX Wallet.app/Contents'));
 const closureFailure=Error('CONTROLLED missing immutable Native source closure');context.assertNativeComponentGitSourceClosure=()=>{throw closureFailure;};context.spawnSync=()=>{throw Error('builder must not run with missing source closure');};
 await assert.rejects(context.run(),e=>e===closureFailure);assert.equal(image,false);assert.equal(calls.length,1);
});
