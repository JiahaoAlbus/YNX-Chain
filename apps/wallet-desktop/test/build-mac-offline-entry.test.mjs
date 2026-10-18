import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const url=new URL('../scripts/build-mac.mjs',import.meta.url);
const source=readFileSync(url,'utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));
async function entry(args,{version='42.10.0',directory=true}={}){
 const calls=[],stop={PUBLIC_STOP_BEFORE_ANY_BUILD:true};
 const context={path,fileURLToPath,URL,process:{platform:'darwin',argv:['/PUBLIC/node','/PUBLIC/build-mac.mjs',...args],execPath:'/PUBLIC/node',env:{PUBLIC_ENV:'kept'},exit:()=>{throw stop;}},
  stat:async p=>({size:1,isFile:()=>true,isDirectory:()=>directory}),readFile:async p=>String(p).endsWith('/version')?version:JSON.stringify({devDependencies:{electron:'42.10.0'}}),
  spawnSync:(command,argv,options)=>{calls.push({command,argv:Array.from(argv),cwd:options.cwd,env:options.env});return {status:19};},execFileSync:()=>{throw Error('PUBLIC_DMG_FORBIDDEN');}};
 let error;try{await runInNewContext('(async()=>{'+source+'})()',context);}catch(cause){if(cause!==stop)error=cause;}
 return {calls,error};
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
