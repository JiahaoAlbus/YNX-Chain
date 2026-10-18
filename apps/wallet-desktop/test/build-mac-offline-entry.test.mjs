import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const url=new URL('../scripts/build-mac.mjs',import.meta.url);
const source=readFileSync(url,'utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));
async function entry(args,{version='42.10.0',directory=true,status=19,stage=true}={}){
 const calls=[],images=[],sources=[],verified=[],stop={PUBLIC_STOP_BEFORE_ANY_BUILD:true};
 args=[...args];if(stage&&args[0]==='arm64'&&!args.some(a=>a.startsWith('--proof-verifier-stage=')))args.push('--proof-verifier-stage=/PUBLIC/fixed-resources');
 const context={path,fileURLToPath,URL,process:{platform:'darwin',argv:['/PUBLIC/node','/PUBLIC/build-mac.mjs',...args],execPath:'/PUBLIC/node',env:{PUBLIC_ENV:'kept'},exit:()=>{throw stop;}},
  originalPQVerifierReceipt:{PUBLIC_ONLY:true},verifyPackagedPQVerifierAssets:async stage=>{verified.push(stage);},
  stat:async p=>({size:1,isFile:()=>true,isDirectory:()=>directory}),readFile:async p=>String(p).endsWith('/version')?version:JSON.stringify({devDependencies:{electron:'42.10.0'},version:'0.6.10',build:{productName:'YNX Wallet'}}),
  spawnSync:(command,argv,options)=>{calls.push({command,argv:Array.from(argv),cwd:options.cwd,env:options.env});return {status};},
  withMacDmgSource:async(app,createImage)=>{sources.push(app);return createImage('/PUBLIC/exclusive-output');},
  execFileSync:(command,args,options)=>{images.push({command,args:Array.from(args),options});}};
 let error;try{await runInNewContext('(async()=>{'+source+'})()',context);}catch(cause){if(cause!==stop)error=cause;}
 return {calls,error,images,sources,verified};
}
test('normal Mac entry forwards only the explicit local Electron distribution and no-rebuild pair',async()=>{
 const result=await entry(['arm64','--config.electronDist=/PUBLIC/fixed electron-dist','--config.npmRebuild=false']);assert.equal(result.error,undefined);assert.equal(result.calls.length,1);
 assert.deepEqual(result.calls[0].argv.slice(1),['--mac','--dir','--arm64','--publish','never','--config.electronDist=/PUBLIC/fixed electron-dist','--config.npmRebuild=false']);assert.equal(result.calls[0].env.PUBLIC_ENV,'kept');
});
test('normal Mac entry refuses partial, duplicate, unknown and unsafe overrides before spawning',async()=>{
 for(const args of [
  ['--config.npmRebuild=false'],['--config.electronDist=/PUBLIC/dist'],
  ['--config.electronDist=relative','--config.npmRebuild=false'],
  ['--config.electronDist=/PUBLIC/../dist','--config.npmRebuild=false'],
  ['--config.electronDist=/PUBLIC/dist','--config.npmRebuild=false','--config.npmRebuild=false'],
  ['--config.electronDist=/PUBLIC/dist','--config.electronDist=/OTHER/dist','--config.npmRebuild=false'],
  ['--config.npmRebuild=true'],['--publish=always'],['--config.afterPack=/PUBLIC/injected.mjs']
 ]){const result=await entry(['arm64',...args]);assert.ok(result.error,args.join(' '));assert.equal(result.calls.length,0);}
});
test('normal Mac entry refuses wrong or incomplete local Electron before a build can download',async()=>{
 for(const options of [{version:'42.9.0'},{directory:false}]){const result=await entry(['arm64','--config.electronDist=/PUBLIC/dist','--config.npmRebuild=false'],options);assert.match(result.error.message,/LOCAL_ELECTRON/);assert.equal(result.calls.length,0);}
});
test('normal Mac entry preserves the no-override recipe and architecture rejection',async()=>{
 const result=await entry([]);assert.equal(result.error,undefined);assert.deepEqual(result.calls[0].argv.slice(1),['--mac','--dir','--universal','--publish','never']);
 const rejected=await entry(['invalid']);assert.ok(rejected.error);assert.equal(rejected.calls.length,0);
});
test('successful normal Mac entry uses the exclusive source helper and unchanged native DMG command',async()=>{
 const result=await entry(['arm64'],{status:0});assert.equal(result.error,undefined);
 assert.equal(result.sources.length,1);assert.ok(result.sources[0].endsWith(path.join('apps','wallet-desktop','dist','mac-arm64','YNX Wallet.app')));
 assert.equal(result.images.length,1);assert.equal(result.images[0].command,'/usr/bin/hdiutil');
 assert.deepEqual(result.images[0].args.slice(0,-1),['create','-volname','YNX Wallet','-srcfolder','/PUBLIC/exclusive-output','-ov','-format','UDZO']);
 assert.ok(result.images[0].args.at(-1).endsWith(path.join('apps','wallet-desktop','dist','ynx-wallet-macos-0.6.10-arm64.dmg')));
 assert.equal(result.images[0].options.stdio,'inherit');
 assert.equal(result.calls[0].env.YNX_WALLET_PROOF_VERIFIER_RESOURCES_STAGE,'/PUBLIC/fixed-resources');assert.equal(result.verified.length,2);assert.equal(result.verified[0],'/PUBLIC/fixed-resources');assert.ok(result.verified[1].endsWith('/YNX Wallet.app/Contents/Resources'));
});
test('arm64 proof stage is explicit and canonical; inherited environment cannot silently select it',async()=>{
 for(const args of [[],['--proof-verifier-stage=relative'],['--proof-verifier-stage=/PUBLIC/../other'],['--proof-verifier-stage=/PUBLIC/fixed','--proof-verifier-stage=/PUBLIC/other']]){const r=await entry(['arm64',...args],{stage:false});assert.ok(r.error);assert.equal(r.calls.length,0);}
 const r=await entry(['x64','--proof-verifier-stage=/PUBLIC/arm64']);assert.ok(r.error);assert.equal(r.calls.length,0);
});
