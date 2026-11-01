// Verify the installed normal public parent entry and its private file closure.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),pkg=path.join(root,'packages/wallet-auth'),temp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP??os.tmpdir(),'ide-cloud-parent-package-'));
const env={...process.env,NPM_CONFIG_CACHE:path.join(temp,'cache'),NPM_CONFIG_USERCONFIG:path.join(temp,'npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(temp,'global-npmrc')};delete env.NODE_OPTIONS;delete env.NODE_PATH;fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'registry=https://registry.npmjs.org\n');fs.writeFileSync(env.NPM_CONFIG_GLOBALCONFIG,'');
function run(command,args,cwd){const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:600000,maxBuffer:10485760});if(r.error)throw r.error;if(r.status!==0)throw Error(JSON.stringify({command,args,status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr}));return r.stdout;}
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 const packed=JSON.parse(run('npm',['pack','--workspaces=false','--ignore-scripts','--json','--pack-destination',temp],pkg))[0],consumer=path.join(temp,'consumer');fs.mkdirSync(consumer);fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'ide-cloud-parent-production-consumer',private:true,type:'module'}));
 run('npm',['install','--workspaces=false','--omit=dev','--ignore-scripts','--audit=false','--fund=false',path.join(temp,packed.filename)],consumer);
 const installed=path.join(consumer,'node_modules/@ynx-chain/wallet-auth'),leaves=['src/original-ide-admission-parent-delivery.js','src/original-ide-admission-parent-delivery.d.ts','src/original-ide-cloud-project-lookup-private.js','src/original-ide-cloud-retained-get-private.js','src/original-ide-cloud-get-request.js','src/original-ide-cloud-get-request.d.ts'];
 for(const p of leaves){const f=path.join(installed,p);if(fs.lstatSync(f).isSymbolicLink()||sha(fs.readFileSync(f))!==sha(fs.readFileSync(path.join(pkg,p))))throw Error('INSTALLED_PARENT_CLOSURE_DIFFERS:'+p);}
 const normal=run(process.execPath,['--input-type=module','-e',`
 import assert from 'node:assert/strict';import{realpathSync}from'node:fs';import{pathToFileURL}from'node:url';
 const name='@ynx-chain/wallet-auth/original-ide-admission',url=import.meta.resolve(name);assert.ok(url.startsWith(pathToFileURL(realpathSync('node_modules/@ynx-chain/wallet-auth')+'/').href));const m=await import(name);
 let retains=0;const workspace={retainOriginalChild(){retains++;throw Error('UNEXPECTED_RETAIN')}};
 assert.throws(()=>m.acquireOriginalIDECloudProjectLookupForCurrentParent({}),{code:'IDE_CLOUD_SAME_ADMITTED_PARENT_REQUIRED'});
 await assert.rejects(m.retainOriginalIDECloudGETForCurrentParent(workspace),{code:'IDE_CLOUD_SAME_ADMITTED_PARENT_REQUIRED'});assert.equal(retains,0);
 console.log(JSON.stringify({installedNormalPublicParent:true,root0Refused:true,sourceNotReacquired:true,RootAdmission:false,NativeAdmission:false,CloudGETProof:false,CloudGETRequest:false,node:process.version}));
 `],consumer);
 const browser=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',"await import('@ynx-chain/wallet-auth/original-ide-admission')"],{cwd:consumer,env,encoding:'utf8'});if(browser.status===0||!browser.stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'))throw Error('IDE_NODE_ONLY_BOUNDARY_FAILED');
 console.log(JSON.stringify({productionOnly:true,borrowedDevModules:false,exactInstalledLeaves:leaves.length,browserRefused:true,tgzSHA256:sha(fs.readFileSync(path.join(temp,packed.filename))),normal:JSON.parse(normal.trim())}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
